/**
 * Firebase auth integration for the roadmap page.
 * Handles login prompts and session management for interactive features.
 */

/* global firebase */

(function () {
  'use strict';

  // Determine API base URL based on environment
  const isDev = location.hostname.includes('dev') || location.hostname === 'localhost';
  const API_BASE = isDev
    ? 'https://dev-api.shytalk.shyden.co.uk'
    : 'https://api.shytalk.shyden.co.uk';

  // Firebase config (loaded from global or inline)
  const firebaseConfig = window.SHYTALK_FIREBASE_CONFIG || {
    apiKey: isDev ? '' : '',
    authDomain: isDev ? 'shytalk-dev.firebaseapp.com' : 'shytalk-7ba69.firebaseapp.com',
    projectId: isDev ? 'shytalk-dev' : 'shytalk-7ba69',
  };

  let auth = null;
  let currentUser = null;

  function initAuth() {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded — auth features disabled');
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      window.shytalkAuth = { currentUser, getToken, API_BASE };
      document.dispatchEvent(new CustomEvent('shytalk-auth-changed', { detail: { user } }));
    });
  }

  async function getToken() {
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken();
    } catch {
      return null;
    }
  }

  // Expose globally
  window.shytalkAuth = { currentUser: null, getToken, API_BASE };

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
})();
