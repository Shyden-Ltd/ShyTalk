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

  // Environment-aware API base (check isLocal BEFORE isDev — localhost matches both)
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var isDev = location.hostname.includes('dev') || isLocal;
  var API_BASE = isLocal
    ? 'http://localhost:3000'
    : isDev
      ? 'https://dev-api.shytalk.shyden.co.uk'
      : 'https://api.shytalk.shyden.co.uk';

  // Firebase config — loaded from API via firebase-config-ready event
  var firebaseConfig = null;

  var auth = null;
  var currentUser = null;
  var shytalkProfile = null;
  var authStateKnown = false;

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

    // Don't render login buttons until we know the auth state (prevents flash)
    if (!authStateKnown) {
      container.innerHTML = '<div class="auth-loading" style="text-align:center;padding:16px;color:var(--text-secondary,#888);font-size:0.875rem;">Loading...</div>';
      return;
    }

    if (shytalkProfile) {
      // Logged in with valid ShyTalk account — show status + sign out
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
      // Signed in but no ShyTalk account — sign out silently, show download prompt
      if (auth) auth.signOut().catch(function (err) {
        console.warn('Auto sign-out failed:', err && err.code);
      });
      currentUser = null;
      updateGlobalAuth();
      container.innerHTML =
        '<div class="auth-login-prompt" data-testid="auth-login-prompt">' +
          '<p class="auth-prompt-text">We couldn\'t find a ShyTalk account linked to that login. Create your free account in the app, then come back to get involved!</p>' +
          '<div class="auth-download-links">' +
            '<a href="https://play.google.com/store/apps/details?id=com.shyden.shytalk" target="_blank" rel="noopener noreferrer" data-testid="download-android" class="download-link" aria-label="Download from Google Play">' +
              '<svg width="20" height="22" viewBox="0 0 20 22"><path fill="#3DDC84" d="M1.43 1.12L10.3 10l-8.9 8.88c-.5-.4-.82-1.02-.82-1.74V2.86c0-.72.32-1.34.85-1.74z"/><path fill="#4285F4" d="M14.15 6.16L2.6.5C2.2.28 1.76.2 1.35.25l8.95 8.95 3.85-3.04z"/><path fill="#FBBC04" d="M1.35 21.75c.41.05.85-.03 1.25-.25l11.55-5.66-3.85-3.04-8.95 8.95z"/><path fill="#EA4335" d="M17.45 9.4l-3.3-1.84L10.3 11l3.85 3.04 3.3-1.84c.9-.5.9-1.8 0-2.8z"/></svg>' +
              '<span>Google Play</span>' +
            '</a>' +
            '<a href="https://apps.apple.com/app/shytalk/id6741488545" target="_blank" rel="noopener noreferrer" data-testid="download-ios" class="download-link" aria-label="Download from App Store">' +
              '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>' +
              '<span>App Store</span>' +
            '</a>' +
          '</div>' +
        '</div>';
    } else {
      // Not logged in — friendly welcome with download links, login happens on action
      container.innerHTML =
        '<div class="auth-login-prompt" data-testid="auth-login-prompt">' +
          '<p class="auth-prompt-text" data-i18n="auth_login_prompt">Want to vote, suggest features, or subscribe to updates? Sign in with your ShyTalk account. Don\'t have one yet? Download the app to get started — or feel free to look around!</p>' +
          '<div class="auth-download-links">' +
            '<a href="https://play.google.com/store/apps/details?id=com.shyden.shytalk" target="_blank" rel="noopener noreferrer" data-testid="download-android" class="download-link" aria-label="Download from Google Play">' +
              '<svg width="20" height="22" viewBox="0 0 20 22"><path fill="#3DDC84" d="M1.43 1.12L10.3 10l-8.9 8.88c-.5-.4-.82-1.02-.82-1.74V2.86c0-.72.32-1.34.85-1.74z"/><path fill="#4285F4" d="M14.15 6.16L2.6.5C2.2.28 1.76.2 1.35.25l8.95 8.95 3.85-3.04z"/><path fill="#FBBC04" d="M1.35 21.75c.41.05.85-.03 1.25-.25l11.55-5.66-3.85-3.04-8.95 8.95z"/><path fill="#EA4335" d="M17.45 9.4l-3.3-1.84L10.3 11l3.85 3.04 3.3-1.84c.9-.5.9-1.8 0-2.8z"/></svg>' +
              '<span>Google Play</span>' +
            '</a>' +
            '<a href="https://apps.apple.com/app/shytalk/id6741488545" target="_blank" rel="noopener noreferrer" data-testid="download-ios" class="download-link" aria-label="Download from App Store">' +
              '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>' +
              '<span>App Store</span>' +
            '</a>' +
          '</div>' +
        '</div>';
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

    // Skip Firebase init if the API key is obviously fake (local/CI test env)
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey.indexOf('fake') !== -1 || firebaseConfig.apiKey.indexOf('placeholder') !== -1) {
      authStateKnown = true;
      renderAuthUI();
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      auth = firebase.auth();
      // Connect to Auth emulator in local dev mode
      if (isLocal && !auth._emulatorConnected) {
        auth.useEmulator('http://localhost:9099');
        auth._emulatorConnected = true;
      }
    } catch (err) {
      console.warn('Firebase auth unavailable:', err && err.code, err && err.message);
      authStateKnown = true;
      renderAuthUI();
      return;
    }

    // Handle redirect result (user returning from Google/Apple OAuth page)
    auth.getRedirectResult().then(function (result) {
      // result.user is set if returning from a redirect sign-in
      // onAuthStateChanged below will handle the state update
    }).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Redirect sign-in error:', err && err.code, err && err.message);
      }
    });

    auth.onAuthStateChanged(function (user) {
      authStateKnown = true;
      currentUser = user;
      if (user) {
        // Publish the Firebase auth state IMMEDIATELY (with profile still
        // null) so click-handlers triggered before the async ShyTalk
        // account fetch resolves can see that the user is signed in.
        // Without this synchronous publish, `window.shytalkAuth.currentUser`
        // stayed null until checkShyTalkAccount finished its fetch — any
        // bell/subscribe click during that window incorrectly opened the
        // login modal for an already-signed-in user (W1 bundled bug).
        // The bell handler treats `profile === null` as "loading" and
        // routes to the subscribe modal which has its own loading state.
        shytalkProfile = null;
        updateGlobalAuth();
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
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithRedirect(provider);
  }

  function signInWithApple() {
    if (!auth) return;
    var provider = new firebase.auth.OAuthProvider('apple.com');
    auth.signInWithRedirect(provider);
  }

  function signOut() {
    if (!auth) return;
    auth.signOut().then(function () {
      currentUser = null;
      shytalkProfile = null;
      renderAuthUI();
      updateGlobalAuth();
    }).catch(function (err) {
      console.error('Sign out failed:', err && err.code, err && err.message);
    });
  }

  function signInWithEmail(email, password) {
    if (!auth) return Promise.reject(new Error('Auth not initialized'));
    return auth.signInWithEmailAndPassword(email, password);
  }

  function updateGlobalAuth() {
    window.shytalkAuth = {
      currentUser: currentUser,
      profile: shytalkProfile,
      getToken: getToken,
      signOut: signOut,
      signInWithGoogle: signInWithGoogle,
      signInWithApple: signInWithApple,
      signInWithEmail: signInWithEmail,
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
      console.warn('Token refresh failed:', e && e.code);
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

  window.shytalkAuth = { currentUser: null, profile: null, getToken: getToken, signOut: signOut, API_BASE: API_BASE };

  // Wait for Firebase config from API before initializing
  if (window.SHYTALK_FIREBASE_CONFIG) {
    initAuth();
  } else {
    document.addEventListener('firebase-config-ready', function () {
      initAuth();
    });
    // Show loading state while waiting for Firebase config
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderAuthUI);
    } else {
      renderAuthUI();
    }
    // If config never loads (API down), show login buttons after 3s
    setTimeout(function () {
      if (!authStateKnown) {
        authStateKnown = true;
        renderAuthUI();
      }
    }, 3000);
  }
})();
