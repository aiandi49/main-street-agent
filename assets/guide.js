// Main Street Agent guide: renders /data/gub.json into a topic list and entry pages.
// Everything from the JSON is inserted with textContent.
(function () {
  'use strict';

  var listView = document.getElementById('list-view');
  var entryView = document.getElementById('entry-view');
  var masthead = document.getElementById('masthead');
  var grid = document.getElementById('grid');
  var count = document.getElementById('result-count');
  var filtersEl = document.getElementById('filters');
  var search = document.getElementById('search');
  var searchForm = document.getElementById('search-form');
  var micBtn = document.getElementById('btn-mic');
  var voiceMsg = document.getElementById('voice-msg');

  var data = null;
  var byId = {};
  var activeCat = 'all';
  var BASE_TITLE = document.title;

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
  function isWarning(e) { return e.kind === 'Warning'; }
  function catLabel(id) {
    var c = (data.categories || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.label : '';
  }

  // ---------- filters + search ----------
  function renderFilters() {
    var cats = [{ id: 'all', label: 'All topics' }].concat(data.categories || []);
    cats.forEach(function (c) {
      var b = h('button', 'filter', c.label);
      b.type = 'button';
      b.setAttribute('data-cat', c.id);
      b.setAttribute('aria-pressed', c.id === activeCat ? 'true' : 'false');
      b.addEventListener('click', function () {
        activeCat = c.id;
        Array.prototype.forEach.call(filtersEl.querySelectorAll('.filter'), function (x) {
          x.setAttribute('aria-pressed', x.getAttribute('data-cat') === activeCat ? 'true' : 'false');
        });
        renderList();
      });
      filtersEl.appendChild(b);
    });
  }

  function matches(e, q) {
    if (!q) return true;
    var hay = [e.title, e.summary, e.kind, (e.tags || []).join(' '), (e.body || []).join(' ')].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function renderList() {
    var q = search.value.trim();
    var items = data.entries.filter(function (e) {
      return (activeCat === 'all' || e.category === activeCat) && matches(e, q);
    });
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    count.textContent = items.length === data.entries.length
      ? data.entries.length + ' topics'
      : items.length + (items.length === 1 ? ' topic' : ' topics') + ' found';
    if (!items.length) {
      grid.appendChild(h('p', 'empty-results', 'No topics match that yet. Try a simpler word, or ask the engine on the home page.'));
      return;
    }
    items.forEach(function (e) {
      var a = h('a', 'entry-card' + (isWarning(e) ? ' is-warning' : ''));
      a.href = '/guide?e=' + encodeURIComponent(e.id);
      a.setAttribute('data-id', e.id);
      a.appendChild(h('span', 'badge' + (isWarning(e) ? ' warn' : ''), e.kind + ' · ' + catLabel(e.category)));
      a.appendChild(h('h2', null, e.title));
      a.appendChild(h('p', null, e.summary));
      a.appendChild(h('span', 'more', 'Read the guide →'));
      a.addEventListener('click', function (ev) {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        go(e.id);
      });
      grid.appendChild(a);
    });
  }

  // ---------- entry ----------
  function renderEntry(e) {
    while (entryView.firstChild) entryView.removeChild(entryView.firstChild);

    var crumbs = h('p', 'crumbs');
    var back = h('a', null, '← All topics');
    back.href = '/guide';
    back.addEventListener('click', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      go(null);
    });
    crumbs.appendChild(back);
    entryView.appendChild(crumbs);

    var head = h('header', 'entry-head');
    head.appendChild(h('span', 'badge' + (isWarning(e) ? ' warn' : ''), e.kind + ' · ' + catLabel(e.category)));
    var title = h('h1', null, e.title);
    title.id = 'entry-title';
    title.tabIndex = -1;
    head.appendChild(title);
    head.appendChild(h('p', 'summary', e.summary));
    entryView.appendChild(head);

    var layout = h('div', 'entry-layout');
    var prose = h('div', 'prose');
    (e.body || []).forEach(function (p) { prose.appendChild(h('p', null, p)); });
    if (e.steps && e.steps.length) {
      prose.appendChild(h('h2', null, 'What people usually do'));
      var ol = h('ol', 'steps');
      e.steps.forEach(function (s) { ol.appendChild(h('li', null, s)); });
      prose.appendChild(ol);
    }
    layout.appendChild(prose);

    var aside = h('aside', 'aside');
    aside.setAttribute('aria-label', 'Key facts and sources');

    var next = h('section', 'panel next-panel' + (isWarning(e) ? ' warn-panel' : ''));
    next.appendChild(h('h2', null, 'Next step'));
    next.appendChild(h('p', null, e.next_step));
    if (e.link && typeof e.link.href === 'string' && /^\/[a-z0-9\/_-]*$/i.test(e.link.href)) {
      var local = h('a', 'cta', e.link.label || 'Open');
      local.href = e.link.href;
      next.appendChild(local);
      next.appendChild(document.createTextNode(' '));
    }
    var cta = h('a', 'cta', 'Ask the engine about this');
    cta.href = '/';
    next.appendChild(cta);
    aside.appendChild(next);

    var keys = Object.keys(e.details || {});
    if (keys.length) {
      var facts = h('section', 'panel');
      facts.appendChild(h('h2', null, 'Key facts'));
      var table = h('table', 'facts');
      var tbody = h('tbody');
      keys.forEach(function (k) {
        var tr = h('tr');
        var th = h('th', null, k);
        th.scope = 'row';
        tr.appendChild(th);
        tr.appendChild(h('td', null, e.details[k]));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      facts.appendChild(table);
      facts.appendChild(h('p', 'checked', 'Checked ' + (data.meta.updated || '') + '. Confirm current numbers with the institution.'));
      aside.appendChild(facts);
    }

    if (e.sources && e.sources.length) {
      var src = h('section', 'panel');
      src.appendChild(h('h2', null, 'Sources'));
      var ul = h('ul', 'sources');
      e.sources.forEach(function (s) {
        var href = safeUrl(s.url);
        var li = h('li');
        if (href) {
          var a = h('a', null, s.label);
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
        } else {
          li.textContent = s.label;
        }
        ul.appendChild(li);
      });
      src.appendChild(ul);
      aside.appendChild(src);
    }

    layout.appendChild(aside);
    entryView.appendChild(layout);
  }

  // ---------- routing ----------
  function currentId() {
    try { return new URLSearchParams(location.search).get('e'); } catch (e) { return null; }
  }
  function show(id) {
    var e = id ? byId[id] : null;
    if (e) {
      masthead.hidden = true;
      listView.hidden = true;
      entryView.hidden = false;
      renderEntry(e);
      document.title = e.title + ' — Main Street Guide';
      var t = document.getElementById('entry-title');
      if (t) t.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else {
      masthead.hidden = false;
      listView.hidden = false;
      entryView.hidden = true;
      document.title = BASE_TITLE;
    }
  }
  function go(id) {
    var url = id ? '/guide?e=' + encodeURIComponent(id) : '/guide';
    try { history.pushState({ id: id }, '', url); } catch (e) { location.href = url; return; }
    show(id);
  }
  window.addEventListener('popstate', function () { show(currentId()); });

  searchForm.addEventListener('submit', function (ev) { ev.preventDefault(); renderList(); });
  search.addEventListener('input', renderList);

  // ---------- voice search ----------
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function note(t) { voiceMsg.textContent = t || ''; voiceMsg.hidden = !t; }
  if (Rec) {
    micBtn.hidden = false;
    var rec = null;
    var on = false;
    micBtn.addEventListener('click', function () {
      if (on && rec) { rec.stop(); return; }
      note('');
      try {
        rec = new Rec();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.onresult = function (e) {
          var text = '';
          for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
          search.value = text.slice(0, 120);
          renderList();
        };
        rec.onerror = function (e) {
          var code = e && e.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') note('The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.');
          else if (code === 'audio-capture') note('No microphone was found. Type your search instead.');
          else if (code === 'no-speech') note("I didn't catch that. Tap the mic and try again.");
          else if (code !== 'aborted') note('Voice search stopped. You can type instead.');
        };
        rec.onend = function () {
          on = false;
          micBtn.setAttribute('aria-pressed', 'false');
          micBtn.setAttribute('aria-label', 'Search by voice');
          search.focus();
        };
        rec.start();
        on = true;
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.setAttribute('aria-label', 'Stop listening');
      } catch (err) {
        note('Voice search is not available right now. Please type.');
      }
    });
  }

  // ---------- start ----------
  fetch('/data/gub.json', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('load'); return r.json(); })
    .then(function (json) {
      data = json;
      data.entries.forEach(function (e) { byId[e.id] = e; });
      document.getElementById('foot-meta').textContent = 'Guide content checked ' + (data.meta.updated || '') + '.';
      renderFilters();
      renderList();
      show(currentId());
    })
    .catch(function () {
      count.textContent = 'The guide could not load. Please refresh the page.';
    });
})();
