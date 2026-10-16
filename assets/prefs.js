// Theme toggle and text-size selector, shared by every page.
(function () {
  'use strict';
  var root = document.documentElement;
  var SIZE_NAMES = { sm: 'small', md: 'medium', lg: 'large', xl: 'extra large' };

  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  function syncTheme() {
    var theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btns[i].setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      btns[i].setAttribute('title', theme === 'dark' ? 'Light theme' : 'Dark theme');
    }
  }

  function syncSize() {
    var size = root.getAttribute('data-font-size') || 'sm';
    var btns = document.querySelectorAll('.size[data-size]');
    for (var i = 0; i < btns.length; i++) {
      var s = btns[i].getAttribute('data-size');
      var on = s === size;
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      btns[i].setAttribute('aria-label', 'Text size ' + SIZE_NAMES[s] + (on ? ', selected' : ''));
    }
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.theme-toggle, .size[data-size]') : null;
    if (!t) return;
    if (t.classList.contains('theme-toggle')) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      save('pref-theme', next);
      syncTheme();
    } else {
      var size = t.getAttribute('data-size');
      root.setAttribute('data-font-size', size);
      save('pref-font-size', size);
      syncSize();
    }
    document.dispatchEvent(new CustomEvent('prefs:change'));
  });

  syncTheme();
  syncSize();
})();
