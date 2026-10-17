// Main Street Agent — builds a simple, shareable PDF of the current chat, entirely in the browser.
// No libraries and no network calls: the conversation never leaves the visitor's device.
// Uses the built-in PDF fonts Helvetica and Helvetica-Bold (WinAnsi encoding).
(function () {
  'use strict';

  var PAGE_W = 612, PAGE_H = 792; // US Letter, in points
  var M_LEFT = 54, M_RIGHT = 54, M_TOP = 54, M_BOTTOM = 64;
  var TEXT_W = PAGE_W - M_LEFT - M_RIGHT;

  // Character widths (per 1000 units) for ASCII 32..126, from the standard Helvetica metrics.
  var W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  // Unicode characters that WinAnsi can show, mapped to their single-byte codes.
  var WINANSI = { 0x20AC: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99 };
  var WIDE = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000 };
  var SWAP = { '−': '-', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≈': '~', ' ': ' ', ' ': ' ', ' ': ' ', '​': '' };

  // Turn any text into WinAnsi bytes (as a string of char codes 0..255).
  function toAnsi(text) {
    var out = '';
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (SWAP.hasOwnProperty(ch)) { out += SWAP[ch]; continue; }
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { i++; out += '?'; continue; } // emoji and other astral symbols
      if (c === 9) { out += '    '; continue; }
      if (c >= 32 && c <= 126) out += ch;
      else if (c >= 0xA0 && c <= 0xFF) out += String.fromCharCode(c);
      else if (WINANSI[c]) out += String.fromCharCode(WINANSI[c]);
      else if (c >= 32) out += '?';
    }
    return out;
  }

  function charW(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
    if (WIDE[code]) return WIDE[code];
    return 556;
  }
  function textW(ansi, size, bold) {
    var w = 0;
    for (var i = 0; i < ansi.length; i++) w += charW(ansi.charCodeAt(i), bold);
    return (w * size) / 1000;
  }

  // Word-wrap one paragraph (already WinAnsi) to a width; long words are broken.
  function wrap(ansi, size, bold, width) {
    var words = ansi.split(' ');
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var candidate = line ? line + ' ' + word : word;
      if (textW(candidate, size, bold) <= width) { line = candidate; return; }
      if (line) lines.push(line);
      while (textW(word, size, bold) > width) {
        var cut = word.length;
        while (cut > 1 && textW(word.slice(0, cut), size, bold) > width) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    });
    lines.push(line);
    return lines;
  }

  function esc(ansi) { return ansi.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(function (v) { return v.toFixed(3); }).join(' ');
  }

  var NAVY = '#0b2545', OCEAN = '#0e5f76', MUTED = '#3b5470', INK = '#14213d', LINE = '#cfe3e6', TINT = '#eef8f7';

  function build(opts) {
    var pages = [];
    var ops = null;
    var y = 0;

    function newPage() {
      ops = [];
      pages.push(ops);
      y = PAGE_H - M_TOP;
    }
    function ensure(h) { if (y - h < M_BOTTOM) newPage(); }
    function text(x, yy, ansi, size, bold, color) {
      ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + rgb(color) + ' rg ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' Td (' + esc(ansi) + ') Tj ET');
    }
    function rect(x, yy, w, h, color) { ops.push(rgb(color) + ' rg ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f'); }
    function hline(x1, x2, yy, color) { ops.push(rgb(color) + ' RG 0.6 w ' + x1 + ' ' + yy.toFixed(2) + ' m ' + x2 + ' ' + yy.toFixed(2) + ' l S'); }

    // Paragraphs: "- " lines become bullets with a hanging indent.
    function body(content, size, color) {
      var lh = size * 1.42;
      String(content || '').split(/\r?\n/).forEach(function (raw) {
        var t = raw.replace(/\s+$/, '');
        if (!t.trim()) { y -= lh * 0.5; return; }
        var bullet = /^\s*[-*•]\s+/.test(t);
        var indent = bullet ? 14 : 0;
        var ansi = toAnsi(bullet ? t.replace(/^\s*[-*•]\s+/, '') : t.trim());
        var lines = wrap(ansi, size, false, TEXT_W - indent - 2);
        lines.forEach(function (ln, i) {
          ensure(lh);
          y -= lh;
          if (bullet && i === 0) text(M_LEFT + 3, y, String.fromCharCode(0x95), size, false, OCEAN);
          text(M_LEFT + indent, y, ln, size, false, color);
        });
      });
    }

    newPage();
    // Title band
    rect(0, PAGE_H - 92, PAGE_W, 92, NAVY);
    text(M_LEFT, PAGE_H - 46, toAnsi('Main Street Agent'), 20, true, '#ffffff');
    text(M_LEFT, PAGE_H - 68, toAnsi(opts.subtitle || 'Saved conversation'), 10.5, false, '#cdeeea');
    y = PAGE_H - 92 - 26;

    (opts.messages || []).forEach(function (m) {
      var isUser = m.role === 'user';
      ensure(48);
      y -= 6;
      var label = toAnsi(isUser ? 'You asked' : 'Main Street Agent');
      text(M_LEFT, y - 10, label, 9, true, isUser ? OCEAN : NAVY);
      y -= 16;
      if (isUser) {
        // light tint behind short questions (only when the whole question fits on this page)
        var qLines = 0;
        String(m.text).split(/\r?\n/).forEach(function (p) { qLines += wrap(toAnsi(p.trim()), 11, false, TEXT_W - 2).length; });
        var h = qLines * 11 * 1.42 + 10;
        if (y - h >= M_BOTTOM) rect(M_LEFT - 8, y - h + 2, TEXT_W + 16, h + 2, TINT);
        body(m.text, 11, INK);
        y -= 6;
      } else {
        body(m.text, 10.5, INK);
      }
      y -= 8;
      ensure(14);
      hline(M_LEFT, PAGE_W - M_RIGHT, y, LINE);
      y -= 6;
    });

    if (opts.matches && opts.matches.length) {
      ensure(60);
      y -= 14;
      text(M_LEFT, y - 12, toAnsi('Matched topics'), 13, true, NAVY);
      y -= 22;
      opts.matches.forEach(function (mt) {
        ensure(36);
        y -= 14;
        var head = toAnsi(mt.title + (typeof mt.score === 'number' ? '  (' + mt.score + '/100)' : ''));
        wrap(head, 10.5, true, TEXT_W).forEach(function (ln, i) {
          if (i) { ensure(15); y -= 15; }
          text(M_LEFT, y, ln, 10.5, true, OCEAN);
        });
        if (mt.why) body(mt.why, 9.5, MUTED);
        y -= 4;
      });
    }

    ensure(70);
    y -= 18;
    body(opts.disclaimer || '', 8.5, MUTED);

    // Footers with page counts
    var total = pages.length;
    pages.forEach(function (p, i) {
      ops = p;
      hline(M_LEFT, PAGE_W - M_RIGHT, 44, LINE);
      text(M_LEFT, 30, toAnsi('Main Street Agent · educational, not financial advice'), 8, false, MUTED);
      var right = toAnsi('Page ' + (i + 1) + ' of ' + total);
      text(PAGE_W - M_RIGHT - textW(right, 8, false), 30, right, 8, false, MUTED);
    });

    // Assemble the file
    var objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    var kids = [];
    pages.forEach(function (p, i) {
      var pageId = 5 + i * 2, contentId = pageId + 1;
      var stream = p.join('\n');
      objs[contentId] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
      objs[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentId + ' 0 R >>';
      kids.push(pageId + ' 0 R');
    });
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    var infoId = objs.length;
    objs[infoId] = '<< /Title (' + esc(toAnsi(opts.title || 'Main Street Agent conversation')) + ') /Producer (Main Street Agent) >>';

    var out = '%PDF-1.4\n%âãÏÓ\n';
    var offsets = [];
    for (var id = 1; id < objs.length; id++) {
      offsets[id] = out.length;
      out += id + ' 0 obj\n' + objs[id] + '\nendobj\n';
    }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (var j = 1; j < objs.length; j++) out += ('0000000000' + offsets[j]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    var bytes = new Uint8Array(out.length);
    for (var k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  window.MSAChatPdf = { build: build };
})();
