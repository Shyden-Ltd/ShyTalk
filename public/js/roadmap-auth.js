/**
 * Firebase auth integration for the roadmap page.
 *
 * Handles:
 * - Google/Apple sign-in via Firebase Auth
 * - ShyTalk account verification (GET /api/roadmap/me)
 * - "Logged in as: {name}" display with sign out
 * - "No account found" with download links if no ShyTalk account
 */

/* global firebase */

(function () {
  'use strict';

  // Environment-aware API base
  var isDev = location.hostname.includes('dev') || location.hostname === 'localhost';
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API_BASE = isDev
    ? 'https://dev-api.shytalk.shyden.co.uk'
    : isLocal
      ? 'http://localhost:3000'
      : 'https://api.shytalk.shyden.co.uk';

  // Firebase config — loaded from API via firebase-config-ready event
  var firebaseConfig = null;

  var auth = null;
  var currentUser = null;
  var shytalkProfile = null;

  // ─── Auth state container rendering ───────────────────────────

  function renderAuthUI() {
    var container = document.getElementById('auth-container');
    if (!container) {
      // Create auth container in suggestions section
      var sugBoard = document.getElementById('suggestions-board');
      if (!sugBoard) return;
      container = document.createElement('div');
      container.id = 'auth-container';
      container.className = 'auth-container';
      sugBoard.parentNode.insertBefore(container, sugBoard);
    }

    if (shytalkProfile) {
      // Logged in state
      container.innerHTML =
        '<div class="auth-user-info" data-testid="auth-user-info">' +
          (shytalkProfile.avatarUrl
            ? '<img class="auth-avatar" data-testid="auth-avatar" src="' + escapeHtml(shytalkProfile.avatarUrl) + '" alt="Avatar" width="32" height="32" />'
            : '') +
          '<span class="auth-display-name" data-testid="auth-display-name">Logged in as: ' +
            escapeHtml(shytalkProfile.displayName || 'User') +
          '</span>' +
          '<button class="auth-signout-btn" data-testid="auth-signout-btn" aria-label="Sign out">Sign out</button>' +
        '</div>';
      container.querySelector('.auth-signout-btn').addEventListener('click', signOut);
    } else if (currentUser && shytalkProfile === false) {
      // Authenticated with Firebase but no ShyTalk account
      container.innerHTML =
        '<div class="auth-no-account" data-testid="auth-no-account">' +
          '<p data-i18n="auth_no_account">No ShyTalk account found for this login. Download the app to create an account, then come back.</p>' +
          '<div class="auth-download-links">' +
            '<a href="https://play.google.com/store/apps/details?id=com.shyden.shytalk" target="_blank" rel="noopener noreferrer" data-testid="download-android" class="download-link" aria-label="Download from Google Play">' +
              'Google Play' +
            '</a>' +
            '<a href="https://apps.apple.com/app/shytalk/id6741488545" target="_blank" rel="noopener noreferrer" data-testid="download-ios" class="download-link" aria-label="Download from App Store">' +
              'App Store' +
            '</a>' +
          '</div>' +
          '<button class="auth-dismiss-btn" data-testid="auth-dismiss-btn">Browse as guest</button>' +
        '</div>';
      container.querySelector('.auth-dismiss-btn').addEventListener('click', function () {
        container.style.display = 'none';
      });
    } else {
      // Not logged in — show login prompt
      container.innerHTML =
        '<div class="auth-login-prompt" data-testid="auth-login-prompt">' +
          '<p class="auth-prompt-text" data-i18n="auth_login_prompt">Sign in with your ShyTalk account to vote, suggest features, and subscribe to updates.</p>' +
          '<div class="auth-buttons">' +
            '<button class="auth-google-btn" data-testid="auth-google-btn" aria-label="Sign in with Google">' +
              '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
              '<span>Sign in with Google</span>' +
            '</button>' +
            '<button class="auth-apple-btn" data-testid="auth-apple-btn" aria-label="Sign in with Apple">' +
              '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>' +
              '<span>Sign in with Apple</span>' +
            '</button>' +
          '</div>' +
        '</div>';
      container.querySelector('.auth-google-btn').addEventListener('click', signInWithGoogle);
      container.querySelector('.auth-apple-btn').addEventListener('click', signInWithApple);
    }
  }

  // ─── Firebase auth ────────────────────────────────────────────

  function initAuth() {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded — auth features disabled');
      renderAuthUI();
      return;
    }

    firebaseConfig = window.SHYTALK_FIREBASE_CONFIG;
    if (!firebaseConfig) {
      // Config not loaded yet — render unauthenticated UI
      renderAuthUI();
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      if (user) {
        checkShyTalkAccount(user);
      } else {
        shytalkProfile = null;
        renderAuthUI();
        updateGlobalAuth();
      }
    });
  }

  async function checkShyTalkAccount(user) {
    try {
      var token = await user.getIdToken();
      var res = await fetch(API_BASE + '/api/roadmap/me', {
        headers: { Authorization: 'Bearer ' + token },
      });

      if (res.ok) {
        shytalkProfile = await res.json();
      } else if (res.status === 404) {
        shytalkProfile = false; // Firebase auth exists but no ShyTalk account
      } else {
        shytalkProfile = null;
      }
    } catch (err) {
      console.error('Failed to check ShyTalk account:', err);
      shytalkProfile = null;
    }

    renderAuthUI();
    updateGlobalAuth();
  }

  function signInWithGoogle() {
    if (!auth) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Google sign-in failed:', err);
      }
    });
  }

  function signInWithApple() {
    if (!auth) return;
    var provider = new firebase.auth.OAuthProvider('apple.com');
    auth.signInWithPopup(provider).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Apple sign-in failed:', err);
      }
    });
  }

  function signOut() {
    if (!auth) return;
    auth.signOut().then(function () {
      currentUser = null;
      shytalkProfile = null;
      renderAuthUI();
      updateGlobalAuth();
    });
  }

  function updateGlobalAuth() {
    window.shytalkAuth = {
      currentUser: currentUser,
      profile: shytalkProfile,
      getToken: getToken,
      API_BASE: API_BASE,
    };
    document.dispatchEvent(new CustomEvent('shytalk-auth-changed', {
      detail: { user: currentUser, profile: shytalkProfile },
    }));
  }

  async function getToken() {
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken();
    } catch (e) {
      return null;
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    var el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }

  // ─── Initialize ───────────────────────────────────────────────

  window.shytalkAuth = { currentUser: null, profile: null, getToken: getToken, API_BASE: API_BASE };

  // Wait for Firebase config from API before initializing
  if (window.SHYTALK_FIREBASE_CONFIG) {
    initAuth();
  } else {
    document.addEventListener('firebase-config-ready', function () {
      initAuth();
    });
    // Also render unauthenticated UI immediately so the page isn't blank
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderAuthUI);
    } else {
      renderAuthUI();
    }
  }
})();
