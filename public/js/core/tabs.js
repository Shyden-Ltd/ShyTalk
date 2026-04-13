/**
 * Generic tab switcher for admin/MC Host/Singer panels.
 * Each tab module must expose: init({root}), activate({root}), deactivate().
 */

import { resetAbortController } from './api.js';

let _panelMap = {};
const _modules = new Map();
const _initialised = new Set();
let _activeTab = null;

/**
 * Configure the tab switcher with a panel map.
 * @param {{ panelMap: Object }} options
 */
export function configure({ panelMap }) {
  _panelMap = panelMap || {};
}

/**
 * Register a tab module.
 * @param {string} tabId
 * @param {{ init, activate, deactivate }} module
 */
export function register(tabId, module) {
  _modules.set(tabId, module);
}

/**
 * Get the currently active tab ID.
 * @returns {string|null}
 */
export function getActiveTab() {
  return _activeTab;
}

/**
 * Handle asymmetric DOM visibility for different tab panels.
 * @param {string} tabId
 */
function setPanelVisibility(tabId) {
  // Hide all known panels first
  const usersForm = document.getElementById('user-form');
  const searchBar = document.getElementById('search-bar');
  const auditPanel = document.getElementById('audit-log-panel');

  if (usersForm) usersForm.style.display = 'none';
  if (searchBar) searchBar.style.display = 'none';
  if (auditPanel) auditPanel.style.display = 'none';

  // Hide all generic panels via .visible class
  for (const id of Object.values(_panelMap)) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }

  // Show the active panel
  if (tabId === 'users') {
    if (usersForm) usersForm.style.display = '';
    if (searchBar) searchBar.style.display = '';
  } else if (tabId === 'audit') {
    if (auditPanel) auditPanel.style.display = 'block';
  } else {
    const panelId = _panelMap[tabId] || `${tabId}-panel`;
    const el = document.getElementById(panelId);
    if (el) el.classList.add('visible');
  }
}

/**
 * Switch to the given tab.
 * @param {string} tabId
 */
export async function show(tabId) {
  resetAbortController();

  const prevTab = _activeTab;
  const prevModule = prevTab ? _modules.get(prevTab) : null;
  if (prevModule && typeof prevModule.deactivate === 'function') {
    prevModule.deactivate();
  }

  _activeTab = tabId;

  const mod = _modules.get(tabId);
  if (mod) {
    const root = document.getElementById(_panelMap[tabId] || `${tabId}-panel`);
    if (!_initialised.has(tabId) && typeof mod.init === 'function') {
      await mod.init({ root });
      _initialised.add(tabId);
    }

    setPanelVisibility(tabId);

    // Update .tab-btn active states with WebKit layout flush
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
        void btn.offsetHeight; // WebKit layout flush
      }
    });

    if (typeof mod.activate === 'function') {
      mod.activate({ root });
    }
  } else {
    setPanelVisibility(tabId);

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
        void btn.offsetHeight;
      }
    });
  }

  sessionStorage.setItem('activeTab', tabId);
}
