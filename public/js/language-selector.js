/**
 * Shared language selector for all ShyTalk web pages.
 *
 * Renders a floating globe button (bottom-left) that opens a searchable
 * language picker modal. Persists selection in localStorage. All pages
 * that include this script get automatic language switching.
 *
 * Usage: <script src="/js/language-selector.js"></script>
 *
 * Pages must implement window.applyLanguage(lang) to handle the switch.
 * If not implemented, only the HTML lang attribute is updated.
 */

(function () {
  var LANGUAGES = [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'ar', name: 'Arabic', native: 'العربية' },
    { code: 'de', name: 'German', native: 'Deutsch' },
    { code: 'es', name: 'Spanish', native: 'Español' },
    { code: 'fr', name: 'French', native: 'Français' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'it', name: 'Italian', native: 'Italiano' },
    { code: 'ja', name: 'Japanese', native: '日本語' },
    { code: 'ko', name: 'Korean', native: '한국어' },
    { code: 'nl', name: 'Dutch', native: 'Nederlands' },
    { code: 'pl', name: 'Polish', native: 'Polski' },
    { code: 'pt', name: 'Portuguese', native: 'Português' },
    { code: 'ru', name: 'Russian', native: 'Русский' },
    { code: 'sv', name: 'Swedish', native: 'Svenska' },
    { code: 'th', name: 'Thai', native: 'ไทย' },
    { code: 'tr', name: 'Turkish', native: 'Türkçe' },
    { code: 'uk', name: 'Ukrainian', native: 'Українська' },
    { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'zh', name: 'Chinese', native: '中文' },
  ];

  var STORAGE_KEY = 'shytalk_language';

  function getLanguage() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some(function (l) { return l.code === saved; })) return saved;
    var browser = (navigator.language || 'en').split('-')[0];
    if (LANGUAGES.some(function (l) { return l.code === browser; })) return browser;
    return 'en';
  }

  function setLanguage(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    if (typeof window.applyLanguage === 'function') {
      window.applyLanguage(lang);
    }
  }

  // Expose globally
  window.ShyTalkLanguage = {
    get: getLanguage,
    set: setLanguage,
    languages: LANGUAGES,
  };

  // ── Inject styles ──
  var style = document.createElement('style');
  style.textContent = [
    '.stl-lang-btn{position:fixed;bottom:20px;left:20px;z-index:9999;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(30,28,40,.85);backdrop-filter:blur(8px);color:#d0bcff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;box-shadow:0 2px 12px rgba(0,0,0,.3)}',
    '.stl-lang-btn:hover{transform:scale(1.1);box-shadow:0 4px 20px rgba(103,80,164,.4)}',
    '.stl-lang-btn:focus-visible{outline:2px solid #d0bcff;outline-offset:3px}',
    '.stl-lang-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}',
    '.stl-lang-overlay.open{opacity:1;pointer-events:auto}',
    '.stl-lang-modal{background:#1c1a24;border:1px solid #3a3550;border-radius:16px;width:90%;max-width:400px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5)}',
    '.stl-lang-header{padding:16px 20px 12px;border-bottom:1px solid #3a3550}',
    '.stl-lang-header h2{margin:0 0 12px;font-size:1.1rem;color:#e8e0f0;font-weight:600}',
    '.stl-lang-search{width:100%;padding:10px 14px;border:1px solid #3a3550;border-radius:10px;background:#0f0d15;color:#e8e0f0;font-size:.95rem;outline:none}',
    '.stl-lang-search:focus{border-color:#6750a4}',
    '.stl-lang-search::placeholder{color:#6b6480}',
    '.stl-lang-list{overflow-y:auto;padding:8px 0;flex:1}',
    '.stl-lang-item{display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;transition:background .15s;color:#e8e0f0;font-size:.95rem;border:none;background:none;width:100%;text-align:left}',
    '.stl-lang-item:hover,.stl-lang-item:focus-visible{background:rgba(103,80,164,.15)}',
    '.stl-lang-item:focus-visible{outline:2px solid #d0bcff;outline-offset:-2px}',
    '.stl-lang-item.active{background:rgba(103,80,164,.25)}',
    '.stl-lang-item .native{color:#d0bcff;font-weight:600;min-width:80px}',
    '.stl-lang-item .name{color:#a89ec0}',
    '.stl-lang-item .check{margin-left:auto;color:#66bb6a;font-size:1.1rem;visibility:hidden}',
    '.stl-lang-item.active .check{visibility:visible}',
    '.stl-lang-close{position:absolute;top:12px;right:12px;background:none;border:none;color:#a89ec0;font-size:1.4rem;cursor:pointer;padding:4px 8px;border-radius:8px}',
    '.stl-lang-close:hover{color:#e8e0f0;background:rgba(255,255,255,.1)}',
    '.stl-lang-close:focus-visible{outline:2px solid #d0bcff}',
  ].join('\n');
  document.head.appendChild(style);

  // ── Inject button ──
  var btn = document.createElement('button');
  btn.className = 'stl-lang-btn lang-selector';
  btn.setAttribute('aria-label', 'Change language');
  btn.setAttribute('title', 'Change language');
  btn.setAttribute('data-testid', 'language-selector');
  btn.innerHTML = '&#127760;';
  btn.addEventListener('click', openModal);
  document.body.appendChild(btn);

  // ── Inject modal ──
  var overlay = document.createElement('div');
  overlay.className = 'stl-lang-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Select language');
  overlay.innerHTML = [
    '<div class="stl-lang-modal">',
    '  <div class="stl-lang-header" style="position:relative">',
    '    <h2>Select Language</h2>',
    '    <button class="stl-lang-close" aria-label="Close">&times;</button>',
    '    <input class="stl-lang-search" type="text" placeholder="Search languages..." aria-label="Search languages">',
    '  </div>',
    '  <div class="stl-lang-list" role="listbox" aria-label="Languages"></div>',
    '</div>',
  ].join('\n');
  document.body.appendChild(overlay);

  var searchInput = overlay.querySelector('.stl-lang-search');
  var listEl = overlay.querySelector('.stl-lang-list');
  var closeBtn = overlay.querySelector('.stl-lang-close');

  function renderList(filter) {
    var current = getLanguage();
    var q = (filter || '').toLowerCase();
    var html = '';
    LANGUAGES.forEach(function (lang) {
      if (q && lang.name.toLowerCase().indexOf(q) === -1 &&
          lang.native.toLowerCase().indexOf(q) === -1 &&
          lang.code.indexOf(q) === -1) return;
      var active = lang.code === current ? ' active' : '';
      html += '<button class="stl-lang-item' + active + '" role="option" aria-selected="' + (lang.code === current) + '" data-lang="' + lang.code + '">';
      html += '<span class="native">' + lang.native + '</span>';
      html += '<span class="name">' + lang.name + '</span>';
      html += '<span class="check" aria-hidden="true">&#10003;</span>';
      html += '</button>';
    });
    listEl.innerHTML = html || '<div style="padding:20px;color:#6b6480;text-align:center">No languages found</div>';
  }

  function openModal() {
    renderList('');
    searchInput.value = '';
    overlay.classList.add('open');
    searchInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('open');
    btn.focus();
  }

  // Close on overlay click
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // Close button
  closeBtn.addEventListener('click', closeModal);

  // Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
  });

  // Search filter
  searchInput.addEventListener('input', function () {
    renderList(searchInput.value);
  });

  // Language selection
  listEl.addEventListener('click', function (e) {
    var item = e.target.closest('.stl-lang-item');
    if (!item) return;
    var lang = item.getAttribute('data-lang');
    setLanguage(lang);
    closeModal();
  });

  // Keyboard navigation in list
  listEl.addEventListener('keydown', function (e) {
    var items = listEl.querySelectorAll('.stl-lang-item');
    var current = document.activeElement;
    var idx = Array.prototype.indexOf.call(items, current);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) items[idx + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) items[idx - 1].focus();
      else searchInput.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current && current.classList.contains('stl-lang-item')) current.click();
    }
  });

  // Arrow down from search moves to first item
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var first = listEl.querySelector('.stl-lang-item');
      if (first) first.focus();
    }
  });

  // Apply saved language on load
  var savedLang = getLanguage();
  document.documentElement.lang = savedLang;
  if (typeof window.applyLanguage === 'function') {
    window.applyLanguage(savedLang);
  }
})();
