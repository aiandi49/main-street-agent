// Main Street Agent engine: chat, match parsing, side cards, voice input, full-page mode.
// All model and user text is rendered with textContent (never innerHTML).
(function () {
  'use strict';

  var STORE_KEY = 'main-street-agent-chat-v1';
  var MAX_HISTORY = 24;

  var el = function (id) { return document.getElementById(id); };
  var log = el('log');
  var empty = el('empty');
  var input = el('chat-input');
  var form = el('composer');
  var sendBtn = el('btn-send');
  var micBtn = el('btn-mic');
  var voiceMsg = el('voice-msg');
  var countChip = el('msg-count');
  var resetBtn = el('btn-reset');
  var fullBtn = el('btn-full');
  var downloadBtn = el('btn-download');
  var card = el('chat-card');
  var cell = el('chat-cell');

  var state = { messages: [], matches: [], selected: null };
  var guide = {};
  var busy = false;

  // ---------- storage (sessionStorage, tab only) ----------
  function load() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.messages)) {
        state.messages = data.messages.filter(function (m) {
          return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
        }).slice(-MAX_HISTORY);
      }
      if (data && Array.isArray(data.matches)) state.matches = data.matches.filter(validMatch).slice(0, 6);
      if (data && typeof data.selected === 'string') state.selected = data.selected;
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- guide data (for links and next steps) ----------
  function loadGuide() {
    return fetch('/data/gub.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.entries)) {
          data.entries.forEach(function (e) { guide[e.id] = e; });
        }
      })
      .catch(function () { /* side cards still work without it */ });
  }

  // ---------- MATCH parsing ----------
  function validMatch(m) {
    return m && typeof m.id === 'string' && m.id.length < 80 && typeof m.title === 'string';
  }
  function parseReply(text) {
    var lines = String(text || '').split(/\r?\n/);
    var visible = [];
    var matches = [];
    lines.forEach(function (line) {
      // Accept small formatting slips around a MATCH line (a list dash, bullet, bold or code ticks).
      var t = line.trim().replace(/^(?:[-*\u2022]\s*)?[`*]*\s*(?=MATCH:)/i, '').replace(/[`*]+\s*$/, '');
      if (/^MATCH:/i.test(t)) {
        try {
          var obj = JSON.parse(t.replace(/^MATCH:\s*/i, ''));
          if (validMatch(obj)) {
            var score = Math.max(0, Math.min(100, Math.round(Number(obj.score) || 0)));
            var details = {};
            if (obj.details && typeof obj.details === 'object' && !Array.isArray(obj.details)) {
              Object.keys(obj.details).slice(0, 6).forEach(function (k) {
                var v = obj.details[k];
                if (typeof v === 'string' || typeof v === 'number') details[String(k).slice(0, 40)] = String(v).slice(0, 160);
              });
            }
            matches.push({
              id: obj.id.slice(0, 80),
              title: obj.title.slice(0, 120),
              score: score,
              why: typeof obj.why === 'string' ? obj.why.slice(0, 240) : '',
              details: details
            });
          }
        } catch (e) { /* malformed MATCH line: drop it silently */ }
        return;
      }
      visible.push(line);
    });
    matches.sort(function (a, b) { return b.score - a.score; });
    return { text: visible.join('\n').replace(/\n{3,}/g, '\n\n').trim(), matches: matches };
  }

  // ---------- rendering ----------
  function appendLinkified(node, text) {
    var re = /(https?:\/\/[^\s)]+|\b(?:[a-z0-9-]+\.)+(?:gov|org|com)(?:\/[^\s)]*)?)/gi;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var raw = m[0].replace(/[.,;:!?]+$/, '');
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var href = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      var a = document.createElement('a');
      try {
        var u = new URL(href);
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          a.href = u.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = raw;
          node.appendChild(a);
        } else {
          node.appendChild(document.createTextNode(raw));
        }
      } catch (e) {
        node.appendChild(document.createTextNode(raw));
      }
      last = m.index + raw.length;
      re.lastIndex = last;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function bubble(role, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : role === 'error' ? 'err' : 'bot');
    if (role === 'assistant') appendLinkified(div, text);
    else div.textContent = text;
    log.appendChild(div);
    return div;
  }

  function scrollLog() { log.scrollTop = log.scrollHeight; }

  function renderLog() {
    Array.prototype.slice.call(log.querySelectorAll('.msg')).forEach(function (n) { n.remove(); });
    empty.hidden = state.messages.length > 0;
    state.messages.forEach(function (m) {
      bubble(m.role, m.role === 'assistant' ? parseReply(m.content).text : m.content);
    });
    renderCount();
    if (state.messages.length) scrollLog(); else log.scrollTop = 0;
  }

  function renderCount() {
    var n = state.messages.length;
    countChip.textContent = n === 0 ? 'No messages yet' : n === 1 ? '1 message' : n + ' messages';
    if (downloadBtn) downloadBtn.disabled = !state.messages.some(function (m) { return m.role === 'assistant'; });
  }

  function guideIdFor(match) {
    if (!match) return null;
    if (/^fdic-/.test(match.id)) return 'find-banks-by-zip';
    return guide[match.id] ? match.id : (Object.keys(guide).length ? null : match.id);
  }

  function kindFor(match) {
    if (/^fdic-/.test(match.id)) return 'FDIC-insured branch';
    var g = guide[match.id];
    return g && g.kind ? g.kind : 'Match';
  }

  function renderSide() {
    var top = state.matches[0];
    el('top-kind').textContent = top ? kindFor(top) : 'Ready';
    el('top-name').textContent = top ? top.title : 'Waiting for your first question';
    el('top-score').textContent = top ? top.score + ' / 100' : '—';
    el('top-why').textContent = top ? (top.why || 'Best fit for what you described.') : 'Your best option will show here, with one line on why it fits.';

    var gv = el('gauge-val');
    gv.setAttribute('stroke-dasharray', (top ? top.score : 0) + ' 100');
    el('gauge-num').textContent = top ? String(top.score) : '—';
    el('gauge-sr').textContent = top ? 'Top fit score ' + top.score + ' out of 100.' : 'No matches yet.';
    el('short-note').textContent = state.matches.length
      ? 'Ranked by fit score · ' + state.matches.length + (state.matches.length === 1 ? ' option' : ' options')
      : 'Ranked by fit score.';

    var list = el('matches');
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!state.matches.length) {
      var li0 = document.createElement('li');
      li0.className = 'placeholder';
      li0.textContent = 'Matches will appear here.';
      list.appendChild(li0);
    }
    if (state.matches.length && !state.matches.some(function (m) { return m.id === state.selected; })) {
      state.selected = state.matches[0].id;
    }
    state.matches.forEach(function (m) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'match-btn';
      b.setAttribute('aria-pressed', m.id === state.selected ? 'true' : 'false');
      var t = document.createElement('span');
      t.className = 'm-title';
      t.textContent = m.title;
      var s = document.createElement('span');
      s.className = 'm-score';
      s.textContent = String(m.score);
      s.setAttribute('aria-label', 'fit ' + m.score + ' out of 100');
      b.appendChild(t);
      b.appendChild(s);
      b.addEventListener('click', function () {
        state.selected = m.id;
        save();
        renderSide();
      });
      li.appendChild(b);
      list.appendChild(li);
    });

    renderDetails();
  }

  function renderDetails() {
    var m = null;
    for (var i = 0; i < state.matches.length; i++) if (state.matches[i].id === state.selected) m = state.matches[i];
    var name = el('det-name');
    var dl = el('det-list');
    var link = el('det-link');
    var next = el('det-next');
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    if (!m) {
      name.textContent = 'Pick a match to see its details.';
      link.hidden = true;
      next.textContent = 'Ask a question to get a specific next step.';
      return;
    }
    name.textContent = m.title;
    var details = m.details || {};
    var g = guide[m.id];
    if (!Object.keys(details).length && g && g.details) details = g.details;
    Object.keys(details).forEach(function (k) {
      var row = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = k;
      var dd = document.createElement('dd');
      dd.textContent = details[k];
      row.appendChild(dt);
      row.appendChild(dd);
      dl.appendChild(row);
    });
    var gid = guideIdFor(m);
    if (gid) {
      link.href = '/guide?e=' + encodeURIComponent(gid);
      link.textContent = /^fdic-/.test(m.id) ? 'How to compare banks near you →' : 'Read this in the guide →';
      link.hidden = false;
    } else {
      link.hidden = true;
    }
    var gEntry = gid ? guide[gid] : null;
    next.textContent = gEntry && gEntry.next_step
      ? gEntry.next_step
      : (/^fdic-/.test(m.id) ? 'Call or visit the branch and ask for the account fee schedule before you apply.' : 'Confirm the current fees and terms directly with the institution.');
  }

  // ---------- sending ----------
  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    sendBtn.textContent = on ? 'Sending…' : 'Send';
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'msg bot';
    div.id = 'typing';
    div.setAttribute('aria-label', 'Main Street Agent is typing');
    var dots = document.createElement('span');
    dots.className = 'typing';
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
    div.appendChild(dots);
    log.appendChild(div);
    scrollLog();
  }
  function hideTyping() { var t = el('typing'); if (t) t.remove(); }

  // What goes to the server: earlier replies without their MATCH lines (the cards already hold
  // those), and the oldest turns dropped if the request would pass the server's 32 KB body limit.
  var MAX_PAYLOAD_BYTES = 30000;
  var MAX_REPLY_CONTEXT = 6000;
  function payloadMessages() {
    var msgs = state.messages.map(function (m) {
      if (m.role !== 'assistant') return { role: m.role, content: m.content };
      return { role: 'assistant', content: parseReply(m.content).text.slice(0, MAX_REPLY_CONTEXT) || 'Here are your options.' };
    });
    var size = function () {
      var json = JSON.stringify({ messages: msgs });
      return window.TextEncoder ? new TextEncoder().encode(json).length : json.length * 3;
    };
    while (msgs.length > 1 && size() > MAX_PAYLOAD_BYTES) {
      msgs.shift();
      while (msgs.length > 1 && msgs[0].role !== 'user') msgs.shift();
    }
    return msgs;
  }

  function send(text) {
    if (busy) return;
    var content = text.trim();
    if (!content) { input.focus(); return; }
    if (state.messages.length >= MAX_HISTORY) {
      bubble('error', 'This conversation is getting long. Tap Start over to begin a fresh one.');
      scrollLog();
      return;
    }
    state.messages.push({ role: 'user', content: content.slice(0, 2000) });
    save();
    empty.hidden = true;
    bubble('user', content);
    renderCount();
    input.value = '';
    autoGrow();
    scrollLog();
    setBusy(true);
    showTyping();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payloadMessages() })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
      })
      .then(function (res) {
        hideTyping();
        if (!res.ok || !res.data || typeof res.data.reply !== 'string') {
          var msg = res.data && typeof res.data.error === 'string' ? res.data.error : 'Something went wrong. Please try again.';
          state.messages.pop();
          save();
          renderCount();
          bubble('error', msg + ' (Your message was not sent.)');
          input.value = content;
          autoGrow();
          scrollLog();
          return;
        }
        state.messages.push({ role: 'assistant', content: res.data.reply });
        var parsed = parseReply(res.data.reply);
        if (parsed.matches.length) {
          state.matches = parsed.matches.slice(0, 6);
          state.selected = state.matches[0].id;
        }
        save();
        bubble('assistant', parsed.text || 'Here are your options.');
        renderCount();
        renderSide();
        scrollLog();
      })
      .catch(function () {
        hideTyping();
        state.messages.pop();
        save();
        renderCount();
        bubble('error', 'Could not reach Main Street Agent. Check your connection and try again.');
        input.value = content;
        autoGrow();
        scrollLog();
      })
      .then(function () { setBusy(false); });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      send(input.value);
    }
  });

  function autoGrow() {
    input.style.height = 'auto';
    var full = input.scrollHeight;
    input.style.height = full + 'px'; // CSS max-height caps it
    // Only show a scrollbar once the typed text is taller than the cap (an empty box never scrolls).
    input.style.overflowY = input.value && full > input.clientHeight + 1 ? 'auto' : 'hidden';
  }
  input.addEventListener('input', autoGrow);
  autoGrow();

  // Download the conversation as a PDF, built in the browser (nothing is uploaded).
  if (downloadBtn) downloadBtn.addEventListener('click', function () {
    if (!window.MSAChatPdf || !state.messages.length) return;
    var now = new Date();
    var all = [];
    var messages = state.messages.map(function (m) {
      if (m.role !== 'assistant') return { role: 'user', text: m.content };
      var parsed = parseReply(m.content);
      parsed.matches.forEach(function (x) { if (!all.some(function (y) { return y.id === x.id; })) all.push(x); });
      return { role: 'assistant', text: parsed.text };
    });
    var blob = window.MSAChatPdf.build({
      title: 'Main Street Agent conversation',
      subtitle: 'Saved ' + now.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' \u00b7 main street money and business help',
      messages: messages,
      matches: all.sort(function (a, b) { return b.score - a.score; }).slice(0, 6),
      disclaimer: 'Main Street Agent explains common processes and public data and points you to the right institution or professional. It is not financial, legal or tax advice. Figures change; confirm every number with its source before you act. Live dollar figures come from the U.S. Treasury, FRED (Federal Reserve Bank of St. Louis) and a spot gold feed. This product uses the FRED\u00ae API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.'
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'main-street-agent-chat-' + now.toISOString().slice(0, 10) + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });

  resetBtn.addEventListener('click', function () {
    state = { messages: [], matches: [], selected: null };
    save();
    renderLog();
    renderSide();
    input.value = '';
    autoGrow();
    input.focus();
  });

  // ---------- full page ----------
  function setFull(on) {
    if (on) {
      cell.style.height = cell.getBoundingClientRect().height + 'px';
      card.classList.add('is-full');
      document.body.classList.add('chat-full');
      fullBtn.setAttribute('aria-pressed', 'true');
      fullBtn.setAttribute('aria-label', 'Exit full page');
      fullBtn.querySelector('.pill-label').textContent = 'Exit full page';
      input.focus();
    } else {
      card.classList.remove('is-full');
      document.body.classList.remove('chat-full');
      cell.style.height = '';
      fullBtn.setAttribute('aria-pressed', 'false');
      fullBtn.setAttribute('aria-label', 'Full page');
      fullBtn.querySelector('.pill-label').textContent = 'Full page';
      fullBtn.focus();
    }
    scrollLog();
  }
  fullBtn.addEventListener('click', function () { setFull(!card.classList.contains('is-full')); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && card.classList.contains('is-full')) setFull(false);
  });

  // ---------- voice input ----------
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null;
  var listening = false;
  function voiceNote(text) {
    voiceMsg.textContent = text || '';
    voiceMsg.hidden = !text;
  }
  if (Rec) {
    micBtn.hidden = false;
    micBtn.addEventListener('click', function () {
      if (listening && rec) { rec.stop(); return; }
      voiceNote('');
      try {
        rec = new Rec();
        rec.lang = document.documentElement.lang === 'en' ? 'en-US' : (navigator.language || 'en-US');
        rec.interimResults = true;
        rec.continuous = false;
        var base = input.value ? input.value.replace(/\s*$/, ' ') : '';
        rec.onresult = function (e) {
          var text = '';
          for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
          input.value = (base + text).slice(0, 2000);
          autoGrow();
        };
        rec.onerror = function (e) {
          var code = e && e.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') voiceNote('The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.');
          else if (code === 'audio-capture') voiceNote('No microphone was found. Plug one in or type your message instead.');
          else if (code === 'no-speech') voiceNote("I didn't catch that. Tap the mic and try again.");
          else if (code === 'network') voiceNote("Voice input needs a connection to your browser's speech service. Please type instead.");
          else if (code !== 'aborted') voiceNote('Voice input stopped. You can type your message instead.');
        };
        rec.onend = function () {
          listening = false;
          micBtn.setAttribute('aria-pressed', 'false');
          micBtn.setAttribute('aria-label', 'Speak your message');
          input.focus();
        };
        rec.start();
        listening = true;
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.setAttribute('aria-label', 'Stop listening');
      } catch (err) {
        voiceNote('Voice input is not available right now. Please type your message.');
      }
    });
  }

  // ---------- start ----------
  load();
  renderLog();
  renderSide();
  loadGuide().then(renderSide);
})();
