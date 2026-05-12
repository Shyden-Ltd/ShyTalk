/**
 * ShyTalk Shared Header
 *
 * Consistent header across all web pages.
 * - Logo (left) linking to home
 * - Auth state (right): user info dropdown when signed in, Sign In button when not
 * - Listens for shytalk-auth-changed events to update state
 *
 * Usage: <script src="/js/shared-header.js"></script>
 * The header injects itself at the top of <body> automatically.
 */
(function () {
  'use strict';

  var isRendered = false;
  var documentClickHandler = null;

  function getAuth() {
    var auth = window.shytalkAuth;
    if (!auth) return null;
    // Treat any non-false profile (object OR null) as "signed in" for header
    // rendering. The Firebase auth state is reflected synchronously via
    // updateGlobalAuth() in roadmap-auth.js; the ShyTalk profile fetch is
    // async, so `profile === null` is the "loading" window. Requiring a
    // truthy profile here would briefly flash the "Sign In" button to an
    // already-signed-in user on every page load. `profile === false` is
    // the explicit "Firebase auth but no ShyTalk account" state — treat
    // it as unauthenticated for the header (the user can't be greeted
    // as a ShyTalk member yet). W1 bundled bug fix.
    if (!auth.currentUser || auth.profile === false) return null;
    return auth;
  }

  function getDisplayName() {
    var auth = getAuth();
    if (!auth) return null;
    return (auth.profile && auth.profile.displayName) || auth.currentUser.displayName || null;
  }

  function getAvatarUrl() {
    var auth = getAuth();
    if (!auth) return null;
    return (auth.profile && auth.profile.profilePhotoUrl) || auth.currentUser.photoURL || null;
  }

  function render() {
    // Clean up previous render's document click listener
    if (documentClickHandler) {
      document.removeEventListener('click', documentClickHandler);
      documentClickHandler = null;
    }
    var existing = document.querySelector('[data-testid="shared-header"]');
    if (existing) existing.remove();

    var auth = getAuth();
    var isAuthenticated = !!auth;
    var displayName = getDisplayName();
    var avatarUrl = getAvatarUrl();

    var rightHtml;
    if (isAuthenticated) {
      var avatarHtml = avatarUrl
        ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" class="sh-avatar" />'
        : '<span class="sh-avatar sh-avatar--fallback">' + escapeHtml(displayName ? displayName.charAt(0).toUpperCase() : '?') + '</span>';

      rightHtml =
        '<div class="sh-user" data-testid="header-user-info">' +
          avatarHtml +
          '<span class="sh-user-name">' + escapeHtml(displayName || 'User') + '</span>' +
          '<svg class="sh-chevron" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>' +
        '</div>' +
        '<div class="sh-dropdown" data-testid="header-dropdown">' +
          '<button class="sh-dropdown-item" data-testid="header-signout-btn" data-i18n="signOut">Sign Out</button>' +
        '</div>';
    } else {
      rightHtml =
        '<button class="sh-signin-btn" data-testid="header-signin-btn" data-i18n="signIn">Sign In</button>';
    }

    var html =
      '<header class="sh-header" role="banner" data-testid="shared-header">' +
        '<div class="sh-header-inner">' +
          '<a href="/" class="sh-logo" data-testid="header-logo">ShyTalk</a>' +
          '<div class="sh-right">' + rightHtml + '</div>' +
        '</div>' +
      '</header>';

    document.body.insertAdjacentHTML('afterbegin', html);
    isRendered = true;

    // Wire up event handlers
    var header = document.querySelector('[data-testid="shared-header"]');

    if (isAuthenticated) {
      var userInfo = header.querySelector('[data-testid="header-user-info"]');
      var dropdown = header.querySelector('[data-testid="header-dropdown"]');
      var signOutBtn = header.querySelector('[data-testid="header-signout-btn"]');

      userInfo.addEventListener('click', function (e) {
        e.stopPropagation();
        dropdown.classList.toggle('sh-dropdown--open');
      });

      signOutBtn.addEventListener('click', function () {
        dropdown.classList.remove('sh-dropdown--open');
        if (window.shytalkAuth && window.shytalkAuth.signOut) {
          window.shytalkAuth.signOut();
        } else if (typeof firebase !== 'undefined' && firebase.auth) {
          firebase.auth().signOut();
        }
      });

      // Close dropdown on outside click (stored for cleanup on re-render)
      documentClickHandler = function () {
        dropdown.classList.remove('sh-dropdown--open');
      };
      document.addEventListener('click', documentClickHandler);
    } else {
      var signInBtn = header.querySelector('[data-testid="header-signin-btn"]');
      if (signInBtn) {
        signInBtn.addEventListener('click', function () {
          // Roadmap registers `window.shytalkShowLoginModal` (via
          // suggestions-board.js) for an in-page modal. The static
          // legal pages, homepage, and event landing pages do NOT
          // load suggestions-board.js, so the modal hook is undefined
          // there — leaving the Sign In button silently broken.
          // Fall back to the unified portal at /portal/, which is the
          // canonical web auth UI per roadmap item #47.
          if (window.shytalkShowLoginModal) {
            window.shytalkShowLoginModal('access your account');
          } else {
            window.location.href = '/portal/';
          }
        });
      }
    }

    // Re-apply translations to the freshly-injected header. Without this
    // the data-i18n="signIn"/"signOut" buttons render the inline English
    // default in non-English locales — the page's applyLanguage chain
    // already ran during DOMContentLoaded BEFORE shared-header injected
    // its DOM, so it had no buttons to translate.
    if (typeof window.applyLanguage === 'function') {
      var savedLang = (window.ShyTalkLanguage && typeof window.ShyTalkLanguage.get === 'function')
        ? window.ShyTalkLanguage.get()
        : ((typeof localStorage !== 'undefined' && localStorage.getItem('shytalk_language')) || null);
      if (savedLang) window.applyLanguage(savedLang);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function injectStyles() {
    if (document.getElementById('sh-header-styles')) return;
    var style = document.createElement('style');
    style.id = 'sh-header-styles';
    style.textContent =
      '.sh-header {' +
        'background: var(--surface, #1a1d27);' +
        'border-bottom: 1px solid var(--border, #2a2e3a);' +
        'padding: 0 24px;' +
        'position: relative;' +
        'z-index: 100;' +
      '}' +
      '.sh-header-inner {' +
        'max-width: 960px;' +
        'margin: 0 auto;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: space-between;' +
        'min-height: 56px;' +
      '}' +
      '.sh-logo {' +
        'font-size: 1.4rem;' +
        'font-weight: 800;' +
        'letter-spacing: 0.04em;' +
        'background: linear-gradient(135deg, var(--primary, #7c5cfc) 0%, var(--primary-glow, #9b82ff) 100%);' +
        '-webkit-background-clip: text;' +
        '-webkit-text-fill-color: transparent;' +
        'background-clip: text;' +
        'text-decoration: none;' +
        'min-height: 44px;' +
        'min-width: 44px;' +
        'display: inline-flex;' +
        'align-items: center;' +
      '}' +
      '.sh-logo:focus-visible {' +
        'outline: 2px solid var(--primary, #7c5cfc);' +
        'outline-offset: 4px;' +
        'border-radius: 4px;' +
      '}' +
      '.sh-right {' +
        'display: flex;' +
        'align-items: center;' +
        'gap: 12px;' +
        'position: relative;' +
      '}' +
      '.sh-signin-btn {' +
        'padding: 8px 20px;' +
        'background: var(--primary, #7c5cfc);' +
        'color: #fff;' +
        'border: none;' +
        'border-radius: 999px;' +
        'font-family: inherit;' +
        'font-size: 0.85rem;' +
        'font-weight: 600;' +
        'cursor: pointer;' +
        'min-height: 40px;' +
        'transition: background 0.2s, transform 0.2s;' +
      '}' +
      '.sh-signin-btn:hover {' +
        'background: var(--primary-glow, #9b82ff);' +
        'transform: translateY(-1px);' +
      '}' +
      '.sh-signin-btn:focus-visible {' +
        'outline: 2px solid var(--primary-glow, #9b82ff);' +
        'outline-offset: 3px;' +
      '}' +
      '.sh-user {' +
        'display: flex;' +
        'align-items: center;' +
        'gap: 8px;' +
        'cursor: pointer;' +
        'padding: 6px 12px;' +
        'border-radius: 999px;' +
        'transition: background 0.2s;' +
      '}' +
      '.sh-user:hover {' +
        'background: rgba(255,255,255,0.06);' +
      '}' +
      '.sh-avatar {' +
        'width: 32px;' +
        'height: 32px;' +
        'border-radius: 50%;' +
        'object-fit: cover;' +
      '}' +
      '.sh-avatar--fallback {' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: center;' +
        'background: var(--primary, #7c5cfc);' +
        'color: #fff;' +
        'font-weight: 700;' +
        'font-size: 0.85rem;' +
      '}' +
      '.sh-user-name {' +
        'font-size: 0.85rem;' +
        'font-weight: 500;' +
        'color: var(--text, #e0e0e0);' +
      '}' +
      '.sh-chevron {' +
        'color: var(--text-secondary, #8b8fa3);' +
        'transition: transform 0.2s;' +
      '}' +
      '.sh-dropdown {' +
        'display: none;' +
        'position: absolute;' +
        'top: 100%;' +
        'right: 0;' +
        'margin-top: 4px;' +
        'background: var(--surface, #1a1d27);' +
        'border: 1px solid var(--border, #2a2e3a);' +
        'border-radius: 8px;' +
        'box-shadow: 0 8px 32px rgba(0,0,0,0.4);' +
        'min-width: 160px;' +
        'z-index: 200;' +
        'overflow: hidden;' +
      '}' +
      '.sh-dropdown--open {' +
        'display: block;' +
      '}' +
      '.sh-dropdown-item {' +
        'display: block;' +
        'width: 100%;' +
        'padding: 12px 16px;' +
        'background: none;' +
        'border: none;' +
        'color: var(--text, #e0e0e0);' +
        'font-family: inherit;' +
        'font-size: 0.85rem;' +
        'text-align: left;' +
        'cursor: pointer;' +
      '}' +
      '.sh-dropdown-item:hover {' +
        'background: rgba(255,255,255,0.06);' +
      '}' +
      '@media (max-width: 640px) {' +
        '.sh-header { padding: 0 16px; }' +
        '.sh-user-name { display: none; }' +
      '}';
    document.head.appendChild(style);
  }

  // Initialize
  function init() {
    injectStyles();
    render();
  }

  // Re-render on auth state change
  document.addEventListener('shytalk-auth-changed', function () {
    if (isRendered) render();
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
