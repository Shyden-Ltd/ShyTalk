/**
 * Admin panel entry point.
 *
 * Wires Firebase Auth, creates the admin state store, configures
 * core modules (api, tabs, ui), and handles the auth state flow
 * (admin claim check, access-denied inline error, dashboard show).
 *
 * Tab modules are NOT imported here yet — PR B handles that.
 * The inline <script> block in index.html still owns all tab logic.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

import { createStore } from '/js/core/state.js';
import { createAuthStateHandler } from '/js/core/auth.js';
import * as api from '/js/core/api.js';
import { showScreen, registerScreen } from '/js/core/ui.js';
import * as tabs from '/js/core/tabs.js';

// ── Config ──────────────────────────────────────────────────────
const CONFIG = window.SHYTALK_CONFIG || {};
const FIREBASE_CONFIG = CONFIG.FIREBASE_CONFIG || {};
const API_BASE = CONFIG.API_BASE || '';

// ── Admin state store ───────────────────────────────────────────
export const store = createStore({
  currentUser: null,
  currentUid: null,
  currentFirebaseUid: null,
  currentTab: 'users',
});

// ── Firebase Auth ───────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

if (CONFIG.USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

// Re-export auth utilities for the inline script block to use during
// the transitional period (PR A). PR B will remove these re-exports.
export { auth, signInWithEmailAndPassword, signOut };

// ── Configure core modules ──────────────────────────────────────
api.configure({
  apiBase: API_BASE,
  getToken: () => {
    const user = store.get('currentUser');
    return user ? user.getIdToken() : Promise.resolve(null);
  },
});

const PANEL_MAP = {
  users:              'user-form',
  appeals:            'appeals-panel',
  reports:            'reports-panel',
  gifts:              'gifts-panel',
  economy:            'economy-panel',
  maintenance:        'maintenance-panel',
  monitor:            'monitor-panel',
  banners:            'banners-panel',
  funfacts:           'funfacts-panel',
  backups:            'backups-panel',
  logs:               'logs-panel',
  devices:            'devices-panel',
  'starting-screens': 'starting-screens-panel',
  suggestions:        'suggestions-panel',
  'audit-log':        'audit-log-panel',
};

tabs.configure({ panelMap: PANEL_MAP });

// ── Screens ─────────────────────────────────────────────────────
// These are registered once the DOM is ready (this script runs as
// type="module" which is deferred, so DOM is available).
registerScreen('loading', document.getElementById('loading-screen'));
registerScreen('login', document.getElementById('login-screen'));
registerScreen('dashboard', document.getElementById('dashboard-screen'));

// ── Auth state handler ──────────────────────────────────────────
// NOTE: During PR A transition, the inline script block still has its
// own onAuthStateChanged handler that does the actual dashboard setup.
// This handler in main.js is NOT wired yet — it will be wired in PR B
// when the inline auth block is removed. For now, main.js just sets up
// the infrastructure; the inline block remains authoritative for auth flow.

// Export for future use in PR B:
export const authHandler = createAuthStateHandler({
  requireClaim: 'admin',
  onAccessDenied: () => {
    const loginError = document.getElementById('login-error');
    if (loginError) {
      loginError.textContent = 'Access denied \u2014 admin privileges required. If you have a portal account, go to /portal/ instead.';
      loginError.style.display = 'block';
    }
    showScreen('login');
  },
  onReady: (user) => {
    if (user) {
      store.set('currentUser', user);
      showScreen('dashboard');
      const saved = sessionStorage.getItem('admin_tab') || 'users';
      tabs.show(saved);
    } else {
      store.set('currentUser', null);
      showScreen('login');
    }
  },
});
