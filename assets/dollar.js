// Main Street Agent — Dollar tracker. Loads POST /api/dollar and renders it.
// Everything from the server is inserted with textContent; links are checked before use.
(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var groupsEl = document.getElementById('groups');
  var heroEl = document.getElementById('hero');
  var refreshBtn = document.getElementById('btn-refresh');
  var SVG = 'http://www.w3.org/2000/svg';
  var CACHE_KEY = 'main-street-agent-dollar-v1';
  var CACHE_MS = 5 * 60 * 1000; // reuse a fresh snapshot for 5 minutes in this tab

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      return c && c.at && Date.now() - c.at < CACHE_MS && c.body && Array.isArray(c.body.metrics) ? c.body : null;
    } catch (e) { return null; }
  }
  function writeCache(body) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), body: body })); } catch (e) { /* storage unavailable */ }
  }

  var GROUPS = [
    { id: 'gold', title: 'Gold', intro: 'Gold has no interest rate and no central bank, which makes it a blunt but useful ruler for the dollar. It is also volatile, so read it next to everyday prices.' },
    { id: 'inflation', title: 'Everyday prices and buying power', intro: 'The official measures of how fast prices rise, and how much a dollar buys compared with the past.' },
    { id: 'rates', title: 'Interest rates and the bond market', intro: 'The Fed steers short-term rates and the market sets long-term ones. Real rates show whether savers are beating inflation.' },
    { id: 'debt', title: 'The national debt and its interest bill', intro: 'Straight from the Treasury’s daily and monthly counts, so anyone can check whether the debt went up and what it costs to carry.' },
    { id: 'world', title: 'The dollar abroad', intro: 'How the dollar trades against the currencies of major U.S. trading partners.' },
    { id: 'economy', title: 'The real economy', intro: 'Growth measured two independent ways (spending and income) and, where available, how much electricity the country makes.' }
  ];

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeUrl(u) {
    try {
      var url = new URL(u);
      return url.protocol === 'https:' ? url.href : null;
    } catch (e) { return null; }
  }
  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function sparkline(points) {
    var vals = (points || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (vals.length < 3) return null;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var W = 100, H = 30;
    var pts = vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * W;
      var y = H - 2 - ((v - min) / span) * (H - 4);
      return x.toFixed(2) + ' ' + y.toFixed(2);
    });
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    var area = document.createElementNS(SVG, 'path');
    area.setAttribute('class', 'area');
    area.setAttribute('d', 'M0 ' + H + ' L' + pts.join(' L') + ' L' + W + ' ' + H + ' Z');
    var line = document.createElementNS(SVG, 'path');
    line.setAttribute('class', 'line');
    line.setAttribute('d', 'M' + pts.join(' L'));
    svg.appendChild(area);
    svg.appendChild(line);
    return svg;
  }

  function metricCard(m) {
    var card = h('article', 'metric');
    card.appendChild(h('h3', null, str(m.label)));
    card.appendChild(h('p', 'val', str(m.display) || '—'));
    if (m.sub) card.appendChild(h('p', 'sub', str(m.sub)));
    var sp = sparkline(m.spark);
    if (sp) card.appendChild(sp);
    if (m.note) card.appendChild(h('p', 'note', str(m.note)));
    var meta = h('p', 'meta');
    if (m.asOf) meta.appendChild(h('span', null, 'As of ' + str(m.asOf)));
    var href = m.source ? safeUrl(m.source.url) : null;
    if (href) {
      var a = h('a', null, str(m.source.label) || 'Source');
      a.href = href;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      meta.appendChild(a);
    }
    card.appendChild(meta);
    return card;
  }

  function renderHero(metrics) {
    var gold = metrics.filter(function (m) { return m.id === 'gold'; })[0];
    var dig = metrics.filter(function (m) { return m.id === 'dollar-in-gold'; })[0];
    if (!gold) { heroEl.hidden = true; return; }
    heroEl.hidden = false;
    document.getElementById('hero-grams').textContent = str(gold.sub).replace(/^\$100 buys about /, '$100 buys ').replace(/ of gold$/, ' of gold') || str(gold.display);
    document.getElementById('hero-sub').textContent = 'Gold is ' + str(gold.display) + ' right now.';
    var meta = document.getElementById('hero-meta');
    meta.textContent = '';
    meta.appendChild(document.createTextNode('As of ' + str(gold.asOf) + ' · '));
    var href = gold.source ? safeUrl(gold.source.url) : null;
    if (href) {
      var a = h('a', null, str(gold.source.label));
      a.href = href; a.rel = 'noopener noreferrer'; a.target = '_blank';
      meta.appendChild(a);
    }
    var refsEl = document.getElementById('hero-refs');
    refsEl.textContent = '';
    if (dig && Array.isArray(dig.refs)) {
      dig.refs.forEach(function (r) {
        if (typeof r.dollarChange !== 'number' || typeof r.year !== 'number') return;
        var box = h('div', 'd-ref');
        var top = h('div', 'd-ref-top');
        top.appendChild(h('span', null, 'Since ' + r.year));
        var pct = Math.round(r.dollarChange);
        top.appendChild(h('b', null, (pct >= 0 ? '+' : '−') + Math.abs(pct) + '%'));
        box.appendChild(top);
        box.appendChild(h('small', null, 'A dollar buys ' + (pct < 0 ? Math.abs(pct) + '% less' : pct + '% more') + ' gold than in ' + r.year + ' (gold then about $' + Number(r.price).toLocaleString('en-US') + ')'));
        var bar = h('div', 'd-bar');
        var fill = h('span');
        fill.style.width = Math.min(100, Math.abs(r.dollarChange)).toFixed(1) + '%';
        bar.appendChild(fill);
        box.appendChild(bar);
        refsEl.appendChild(box);
      });
    }
  }

  function renderGroups(metrics) {
    groupsEl.textContent = '';
    GROUPS.forEach(function (g) {
      var list = metrics.filter(function (m) { return m.group === g.id; });
      if (!list.length) return;
      var sec = h('section', 'd-group');
      sec.setAttribute('aria-label', g.title);
      sec.appendChild(h('h2', null, g.title));
      sec.appendChild(h('p', null, g.intro));
      var grid = h('div', 'd-grid');
      list.forEach(function (m) { grid.appendChild(metricCard(m)); });
      sec.appendChild(grid);
      groupsEl.appendChild(sec);
    });
  }

  function renderSkeleton() {
    groupsEl.textContent = '';
    var sec = h('section', 'd-group');
    var grid = h('div', 'd-grid');
    for (var i = 0; i < 6; i++) {
      var s = h('div', 'metric skeleton');
      s.setAttribute('aria-hidden', 'true');
      grid.appendChild(s);
    }
    sec.appendChild(grid);
    groupsEl.appendChild(sec);
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', !!isError);
  }

  function render(body) {
    var metrics = body.metrics.filter(function (m) { return m && typeof m === 'object'; });
    renderHero(metrics);
    renderGroups(metrics);
    var when = new Date(body.updated);
    var t = isNaN(when.getTime()) ? '' : when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var missing = [];
    var av = body.available || {};
    if (av.gold === false) missing.push('gold');
    if (av.fred === false) missing.push('rates and inflation');
    if (av.treasury === false) missing.push('Treasury debt');
    setStatus((t ? 'Updated ' + t + '. ' : '') + metrics.length + ' live figures.' + (missing.length ? ' Not available right now: ' + missing.join(', ') + '.' : ''), false);
  }

  function load(force) {
    var cached = force ? null : readCache();
    if (cached) { render(cached); return; }
    refreshBtn.disabled = true;
    setStatus('Loading the latest numbers…', false);
    if (!groupsEl.children.length) renderSkeleton();
    fetch('/api/dollar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (res) {
        if (!res.ok || !res.body || !Array.isArray(res.body.metrics)) {
          throw new Error(res.body && typeof res.body.error === 'string' ? res.body.error : 'The live data could not be loaded right now. Please try again in a few minutes.');
        }
        writeCache(res.body);
        render(res.body);
      })
      .catch(function (err) {
        if (groupsEl.querySelector('.skeleton')) groupsEl.textContent = '';
        setStatus(err && err.message ? err.message : 'The live data could not be loaded right now.', true);
      })
      .then(function () { refreshBtn.disabled = false; });
  }

  refreshBtn.addEventListener('click', function () { load(true); });
  load(false);
})();
