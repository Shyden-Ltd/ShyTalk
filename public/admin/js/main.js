/**
 * Admin panel entry point.
 *
 * Wires Firebase Auth + Firestore, creates the admin state store,
 * configures core modules, handles auth state flow, tab switching,
 * and module lifecycle.
 *
 * Tab modules are pre-loaded via dynamic import (non-blocking).
 * Each tab exports init(deps), activate(deps), deactivate().
 */

import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, collection, query, where, onSnapshot, getDocs, orderBy, limit, doc }
  from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

import { createStore } from '/js/core/state.js';
import * as api from '/js/core/api.js';
import { showScreen, registerScreen } from '/js/core/ui.js';

// Static import — ensures users module is loaded before auth handler fires
import * as usersModule from '/admin/js/tabs/users.js';
// Age Verification subtab — also static so the pending-count badge
// renders the moment login completes (without waiting on a dynamic
// import). Registered as a sub-feature of the Users tab.
import * as ageVerificationModule from '/admin/js/tabs/age-verification.js';
// Maintenance sub-features (not tabs — initialised once after login)
import * as syncProd from '/admin/js/sync-prod.js';
import * as nuclearReset from '/admin/js/nuclear-reset.js';

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

// ── Firebase ────────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const clientDb = getFirestore(app);

if (CONFIG.USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(clientDb, 'localhost', 8080);
}

// Re-export auth utilities for external consumers (tests, etc.)
export { auth, signInWithEmailAndPassword, signOut };

// ── Configure core modules ──────────────────────────────────────
api.configure({
  apiBase: API_BASE,
  getToken: () => {
    const user = store.get('currentUser');
    return user ? user.getIdToken() : Promise.resolve(null);
  },
});

// ── Screens ─────────────────────────────────────────────────────
registerScreen('loading', document.getElementById('loading-screen'));
registerScreen('login', document.getElementById('login-screen'));
registerScreen('dashboard', document.getElementById('dashboard-screen'));

// ── Tab Modules ─────────────────────────────────────────────────
export const TAB_MODULES = {};
TAB_MODULES['users'] = usersModule;

const _tabPaths = {
  appeals: '/admin/js/tabs/appeals.js',
  reports: '/admin/js/tabs/reports.js',
  gifts: '/admin/js/tabs/gifts.js',
  economy: '/admin/js/tabs/economy-config.js',
  maintenance: '/admin/js/tabs/maintenance.js',
  monitor: '/admin/js/tabs/spin-monitor.js',
  banners: '/admin/js/tabs/banners.js',
  funfacts: '/admin/js/tabs/fun-facts.js',
  backups: '/admin/js/tabs/backups.js',
  logs: '/admin/js/tabs/logs.js',
  devices: '/admin/js/tabs/devices.js',
  'starting-screens': '/admin/js/tabs/starting-screens.js',
  suggestions: '/admin/js/tabs/suggestions.js',
  'audit-log': '/admin/js/tabs/audit-log.js',
  'age-segregation': '/admin/js/tabs/age-segregation.js',
};
// Load all tab modules in parallel and register them once loaded.
// Using Promise.allSettled ensures all modules are available before
// login completes, preventing race conditions with waitForModule().
const _moduleLoadPromise = Promise.allSettled(
  Object.entries(_tabPaths).map(async ([key, path]) => {
    try {
      const m = await import(path);
      TAB_MODULES[key] = m;
    } catch (err) {
      console.warn(`Tab module ${key} failed to load:`, err);
    }
  }),
);

// ── Module lifecycle ────────────────────────────────────────────
let cachedPityHardLimit = 120;
window._updatePityHardLimit = (val) => { cachedPityHardLimit = val; };

const _moduleInitialised = new Set();
const _moduleDeps = {
  apiBase: API_BASE,
  getToken: () => {
    const user = store.get('currentUser');
    return user ? user.getIdToken() : Promise.resolve(null);
  },
  switchTab,
  get clientDb() { return clientDb; },
  firestoreFns: { collection, query, orderBy, limit, where, onSnapshot, getDocs, doc },
  getCurrentTab: () => currentTab,
  currentTab: () => currentTab,
  getPityHardLimit: () => cachedPityHardLimit,
  searchUserByUniqueId: (uid) => TAB_MODULES['users']?.searchUserByUniqueId?.(uid),
  renderEvidence: (urls) => TAB_MODULES['users']?.renderEvidence?.(urls) ?? '',
  openEvidenceLightbox: (url, type) => TAB_MODULES['users']?.openEvidenceLightbox?.(url, type),
  auth,
};

async function waitForModule(tabId) {
  if (TAB_MODULES[tabId]) return TAB_MODULES[tabId];
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (TAB_MODULES[tabId]) { clearInterval(check); resolve(); }
    }, 50);
    setTimeout(() => { clearInterval(check); resolve(); }, 15000);
  });
  return TAB_MODULES[tabId];
}

async function activateTabModule(tabId) {
  const mod = await waitForModule(tabId);
  if (!mod) return;
  if (!_moduleInitialised.has(tabId) && typeof mod.init === 'function') {
    mod.init(_moduleDeps);
    _moduleInitialised.add(tabId);
  }
  if (typeof mod.activate === 'function') mod.activate(_moduleDeps);
  // Signal that the module is ready for interaction (used by Playwright tests)
  const panelId = PANEL_MAP[tabId];
  if (panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.dataset.moduleReady = 'true';
  }
}

function deactivateTabModule(tabId) {
  const mod = TAB_MODULES[tabId];
  if (mod && typeof mod.deactivate === 'function') mod.deactivate();
}

async function initTabModule(tabId) {
  const mod = await waitForModule(tabId);
  if (!mod) return;
  if (!_moduleInitialised.has(tabId) && typeof mod.init === 'function') {
    mod.init(_moduleDeps);
    _moduleInitialised.add(tabId);
  }
}

// ── Tab Switching ───────────────────────────────────────────────

// All tab IDs in presentation order
const TAB_IDS = [
  'users', 'appeals', 'reports', 'gifts', 'economy', 'maintenance',
  'monitor', 'banners', 'funfacts', 'backups', 'logs', 'devices',
  'starting-screens', 'suggestions', 'audit-log', 'age-segregation',
];

// Panel ID for each tab (maps tab ID → DOM panel element ID)
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
  'age-segregation':  'age-segregation-panel',
};

let currentTab = 'users';
let tabAbortController = new AbortController();
let _firstTabSwitch = true;

async function switchTab(tab) {
  // Abort in-flight tab-specific API requests from the previous tab.
  // Skip on first switch (during login) to avoid cancelling init requests.
  if (!_firstTabSwitch) {
    tabAbortController.abort();
    tabAbortController = new AbortController();
    api.resetAbortController();
  }
  _firstTabSwitch = false;
  currentTab = tab;
  sessionStorage.setItem('admin_tab', tab);

  // Update tab button active states
  for (const id of TAB_IDS) {
    const btn = document.getElementById('tab-' + id);
    if (btn) btn.classList.toggle('active', id === tab);
  }
  // Force synchronous layout flush — WebKit batches classList mutations,
  // which can cause automated tests to read stale class values.
  void document.getElementById('tab-users')?.offsetHeight;

  // Users tab has special visibility (search bar + form, not a panel with .visible class)
  const searchBar = document.querySelector('.search-bar');
  const userForm = document.getElementById('user-form');
  if (searchBar) searchBar.style.display = tab === 'users' ? '' : 'none';
  if (userForm) userForm.style.display = tab === 'users' ? '' : 'none';

  // Toggle panel visibility
  for (const [id, panelId] of Object.entries(PANEL_MAP)) {
    if (id === 'users') continue; // handled above
    const panel = document.getElementById(panelId);
    if (!panel) continue;
    if (id === 'audit-log') {
      panel.style.display = tab === 'audit-log' ? 'block' : 'none';
    } else {
      panel.classList.toggle('visible', id === tab);
    }
  }

  // Deactivate modules no longer active
  if (tab !== 'logs') deactivateTabModule('logs');
  if (tab !== 'audit-log') deactivateTabModule('audit-log');

  // Activate the selected tab's module
  await activateTabModule(tab);
}

// Wire tab button click listeners
for (const id of TAB_IDS) {
  const btn = document.getElementById('tab-' + id);
  if (btn) btn.addEventListener('click', () => switchTab(id));
}

// ── Number input sanitization (global) ──────────────────────────
document.addEventListener('wheel', (e) => {
  if (e.target.type === 'number') e.target.blur();
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.target.type !== 'number') return;
  if (['e', 'E', '+', '-'].includes(e.key)) return e.preventDefault();
  if (e.key === '.' && e.target.step !== '0.01') e.preventDefault();
});
document.addEventListener('input', (e) => {
  if (e.target.type === 'number' && e.target.step !== '0.01') {
    const v = e.target.value;
    if (v && !/^-?\d*$/.test(v)) {
      e.target.value = v.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
    }
  }
});

// ── Auth ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims.admin !== true) {
      const loginError = document.getElementById('login-error');
      loginError.textContent = 'Access denied \u2014 admin privileges required. If you have a portal account, go to /portal/ instead.';
      loginError.style.display = 'block';
      showScreen('login');
      return;
    }
    store.set('currentUser', user);
    if (typeof ShyTalkLogger !== 'undefined') {
      ShyTalkLogger.init({
        source: 'admin-panel',
        endpoint: `${API_BASE}/api/logs`,
        getToken: () => {
          const u = store.get('currentUser');
          return u ? u.getIdToken() : Promise.resolve(null);
        },
      });
    }
    showScreen('dashboard');

    // Ensure all tab modules are loaded before proceeding
    await _moduleLoadPromise;

    // Init maintenance sub-features (sync from prod, nuclear reset)
    const maintenanceDeps = {
      apiBase: API_BASE,
      getToken: () => {
        const u = store.get('currentUser');
        return u ? u.getIdToken() : Promise.resolve(null);
      },
      auth,
    };
    syncProd.init(maintenanceDeps);
    nuclearReset.init(maintenanceDeps);

    // Age-verification subtab (PR 6/14) — wires its event listeners
    // and registers the onSubtabOpen callback into the Users tab.
    // Initialised as a sub-feature alongside maintenance because it's
    // owned by the Users tab and needs to fire its initial badge
    // refresh as soon as login completes.
    ageVerificationModule.init({
      searchUserByUniqueId: (uid) => usersModule.searchUserByUniqueId?.(uid),
      refreshAfterDecision: async (uid) => {
        // Re-search the user so the read-only DOB / verified-badge
        // section in the Users tab updates after Modify-DOB or
        // Approve-flips-verified.
        try {
          await usersModule.searchUserByUniqueId?.(uid);
        } catch (_err) {
          // Non-fatal — toast shown at the call site.
        }
      },
    });
    usersModule._register?.('onAgeVerifSubtabOpen', (uid) =>
      ageVerificationModule.onSubtabOpen(uid),
    );

    // Eagerly load economy config so pity limit is available for spin monitor
    await activateTabModule('economy');
    // Start alert bell badge refresh + logs auto-refresh
    await initTabModule('logs');
    TAB_MODULES['logs']?.startGlobalRefresh?.();
    // Update suggestions badge on login
    await initTabModule('suggestions');
    await TAB_MODULES['suggestions']?.updateSuggestionsBadgeOnLoad?.();

    // Restore saved tab and report filter
    try {
      const savedTab = sessionStorage.getItem('admin_tab') || 'users';
      await switchTab(savedTab);
      const savedUserSearch = sessionStorage.getItem('admin_user_search');
      if (savedUserSearch) {
        TAB_MODULES['users']?.searchUserByUniqueId?.(savedUserSearch);
      }
      const savedReportFilter = sessionStorage.getItem('admin_report_filter');
      if (savedReportFilter && ['pending', 'resolved', 'archived'].includes(savedReportFilter)) {
        for (const btn of document.querySelectorAll('[data-report-filter]')) {
          btn.classList.toggle('active', btn.dataset.reportFilter === savedReportFilter);
        }
      }
      const savedSearch = sessionStorage.getItem('admin_report_search');
      if (savedSearch) {
        const reportSearchInput = document.getElementById('report-search-input');
        if (reportSearchInput) reportSearchInput.value = savedSearch;
      }
    } catch (e) { console.warn('Tab restore error:', e); }
  } else {
    store.set('currentUser', null);
    showScreen('login');
  }
});

// ── Login ───────────────────────────────────────────────────────
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

// Prevent the form from doing a default browser submit (which would
// reload the page and lose the SPA state). The login-btn click handler
// below already runs on form submit because submit-type buttons fire
// `click` before the `submit` event. Without this preventDefault,
// pressing Enter on an empty form would reload to /admin/?login-email=...
if (loginForm) {
  loginForm.addEventListener('submit', (e) => e.preventDefault());
}

loginBtn.addEventListener('click', async (e) => {
  // The button's click handler may be invoked from a `submit` event
  // (Enter key) — preventDefault here too to keep the chain idempotent
  // even if the form-level handler is removed.
  e.preventDefault?.();
  loginError.textContent = '';
  const email = loginEmail.value.trim();
  const pass = loginPassword.value;
  if (!email || !pass) { loginError.textContent = 'Enter email and password'; return; }

  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    if (err.code === 'auth/visibility-check-was-unavailable' || (err.message && err.message.includes('visibility-check'))) {
      try {
        await signInWithEmailAndPassword(auth, email, pass);
      } catch (retryErr) {
        loginError.textContent = retryErr.message;
      }
    } else {
      loginError.textContent = err.message;
    }
  }
  loginBtn.disabled = false;
});

loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
loginEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPassword.focus(); });

// ── Sign-out ────────────────────────────────────────────────────
document.getElementById('signout-btn').addEventListener('click', async () => {
  TAB_MODULES['monitor']?.stopMonitoring?.();
  TAB_MODULES['logs']?.stopAll?.();
  TAB_MODULES['reports']?.deactivate?.();
  sessionStorage.clear();
  await signOut(auth);
  const userForm = document.getElementById('user-form');
  if (userForm) userForm.classList.remove('visible');
  const subtabs = document.getElementById('user-subtabs');
  if (subtabs) subtabs.style.display = 'none';
  const preview = document.getElementById('profile-preview');
  if (preview) preview.style.display = 'none';
  const searchUid = document.getElementById('search-uid');
  if (searchUid) searchUid.value = '';
});
