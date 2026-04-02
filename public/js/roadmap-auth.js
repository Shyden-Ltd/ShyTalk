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

  // Firebase config
  var firebaseConfig = window.SHYTALK_FIREBASE_CONFIG || {
    apiKey: isDev ? 'AIzaSyDev-placeholder' : 'AIzaSyProd-placeholder',
    authDomain: isDev ? 'shytalk-dev.firebaseapp.com' : 'shytalk-7ba69.firebaseapp.com',
    projectId: isDev ? 'shytalk-dev' : 'shytalk-7ba69',
  };

  var auth = null;
  var currentUser = null;
  var shytalkProfile = null;

  // ─── Auth state container rendering ───────────────────────────

  function renderAuthUI() {
    var container = document.getElementById('auth-container');
    if (!container) {
      // Create auth container in suggestions section
      var sugSection = document.getElementById('suggestions') || document.querySelector('[data-section="suggestions"]');
      if (!sugSection) return;
      container = document.createElement('div');
      container.id = 'auth-container';
      container.className = 'auth-container';
      sugSection.insertBefore(container, sugSection.firstChild);
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
          '<p data-i18n="auth_login_prompt">Sign in with your ShyTalk account to vote, suggest features, and subscribe to updates.</p>' +
          '<div class="auth-buttons">' +
            '<button class="auth-google-btn" data-testid="auth-google-btn" aria-label="Sign in with Google">' +
              '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>' +
              ' Sign in with Google' +
            '</button>' +
            '<button class="auth-apple-btn" data-testid="auth-apple-btn" aria-label="Sign in with Apple">' +
              '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="currentColor" d="M15.53 12.97c-.355.79-.525 1.143-.98 1.84-.635.975-1.53 2.19-2.64 2.2-1.005.012-1.262-.655-2.625-.647-1.363.008-1.645.66-2.65.648-1.11-.012-1.96-1.1-2.595-2.076C2.38 12.43 1.69 8.69 3.42 6.26c.865-1.215 2.175-1.96 3.48-1.96 1.255 0 2.04.66 3.076.66 1.006 0 1.618-.66 3.067-.66 1.164 0 2.33.633 3.196 1.726-2.808 1.54-2.353 5.553.29 6.944zM11.12 2.7c.49-.63.86-1.52.725-2.43-.8.055-1.735.565-2.28 1.23-.495.605-.905 1.51-.745 2.38.87.027 1.77-.49 2.3-1.18z"/></svg>' +
              ' Sign in with Apple' +
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
})();
