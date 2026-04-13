# Admin Panel Restructure — Design

**Date:** 2026-04-11
**Roadmap item:** #41 Phase 0 — Admin panel restructure
**Goal:** Break the 14,520-line `public/admin/index.html` into modular ES modules to support future growth (more tabs, shared infrastructure for 5+ upcoming panels) without a build step.
**Unblocks:** MC Host panel (#43), MC Host Team Leader (#49), MC Singer panel (#44), MC Singer Team Leader (#50), Teacher panel (#45), Web personal profile (#48) — all planned for Phase 6.

## Current state

- `public/admin/index.html`: **14,520 lines**
- ~3,000 lines of HTML markup + CSS
- One giant inline `<script type="module">` from lines 5058-14510 (~9,500 lines of JS, **214 top-level functions**)
- 15 tabs: Users, Appeals, Reports, Gifts, Economy, Maintenance, Spin Monitor, Banners, Fun Facts, Backups, Logs, Devices, Starting Screens, Suggestions, Audit Log
- Tab buttons use IDs `tab-users`, `tab-reports`, etc. (nav buttons in the top bar)
- Tab content panels use IDs `appeals-panel`, `reports-panel`, etc. — **with one asymmetry**: Users tab uses `user-form` (no `users-panel` wrapper; it's the default main content)
- Already uses ES modules internally (the big inline `<script type="module">`)
- Modular Firebase SDK v11.6.0 (`import {initializeApp, getAuth, onAuthStateChanged}`)
- 28 Playwright spec files with extensive `data-testid` / data-attribute selectors
- Deployed as static files to Cloudflare Pages — **zero build step**, $0 hosting constraint

## Constraints

1. **Zero build step** — Cloudflare Pages deploys `public/` verbatim. No bundler, no transpiler, no preprocessor.
2. **$0 hosting** — no paid tools, no CDN-only solutions that introduce subscription costs.
3. **Playwright tests must pass unchanged** — any rewrite of the 28 admin spec files would double the cost. DOM shapes, class names, IDs, and data-attributes are preserved.
4. **Reusable for future panels** — MC Host, MC Host Team Leader, MC Singer, MC Singer Team Leader, Teacher, and Personal Profile panels are all coming (Phase 6). Shared infrastructure should be designed for reuse from day one, not retrofitted later.
5. **Incremental migration** — one big PR is too risky. Split into phases that can each be reviewed, deployed, manually QA'd, and reverted independently.

## Approach

**Pure ES modules, no framework, no build step.** ES modules are natively supported by every modern browser and work over HTTP/2 with caching. The admin panel already uses a `<script type="module">` inline block, so nothing new to learn.

**Alternatives considered and rejected:**
- **Web Components (native Custom Elements)** — Shadow DOM breaks Playwright's normal selectors unless pierced with `::part()` or Light DOM escape hatches. Significant test rewrite risk.
- **Lightweight framework (Vue/Svelte/Alpine)** — Requires a build step (breaks zero-build constraint). CDN versions are slower and clunky. Playwright tests would need rewrites for reactive DOM.
- **Multi-page app (one HTML file per tab)** — Full page reloads between tabs break the SPA feel; tests would need to handle navigation; more HTML duplication.
- **Extract JS only, leave HTML monolithic** — Minimal but doesn't unblock future panels. Still a single unmanageable HTML file.

## Directory layout

Shared modules live at `public/js/core/` alongside the existing shared utilities (`logger.js`, `language-selector.js`). Admin-specific code lives in `public/admin/js/`.

```
public/
├── js/
│   ├── logger.js                (existing — shared)
│   ├── language-selector.js     (existing — shared)
│   └── core/                    ← NEW
│       ├── state.js             (createStore factory — app-agnostic)
│       ├── auth.js              (SDK-agnostic auth-state handler factory)
│       ├── api.js               (apiCall wrapper, AbortController per tab)
│       ├── ui.js                (showToast, showConfirm, showScreen, escapeHtml)
│       └── tabs.js              (tab switcher — generic, uses panel ID map)
├── admin/
│   ├── index.html               (thin HTML shell — markup + one script tag)
│   ├── js/
│   │   ├── main.js              (admin entry point — imports core, wires auth, registers tabs)
│   │   └── tabs/
│   │       ├── users.js         (~1000 lines)
│   │       ├── reports.js       (~800 lines)
│   │       ├── appeals.js       (~400 lines)
│   │       ├── gifts.js         (~600 lines)
│   │       ├── economy.js       (~400 lines)
│   │       ├── maintenance.js   (~600 lines)
│   │       ├── spin-monitor.js  (~300 lines)
│   │       ├── banners.js       (~500 lines)
│   │       ├── fun-facts.js     (~400 lines)
│   │       ├── backups.js       (~300 lines)
│   │       ├── logs.js          (~600 lines)
│   │       ├── devices.js       (~400 lines)
│   │       ├── starting-screens.js (~400 lines)
│   │       ├── suggestions.js   (~900 lines)
│   │       └── audit-log.js     (~200 lines)
│   ├── assets/                  (unchanged)
│   ├── config.js                (unchanged — env URLs)
│   └── translations.js          (unchanged — already external)
```

**Total result:** ~7,500 lines of JS spread across ~20 files, replacing the current 9,500-line inline block. No file exceeds ~1,000 lines. Each file has a single responsibility.

## Module contracts

### `public/js/core/state.js` — app-agnostic state store factory

```js
export function createStore(initial) {
  const _state = { ...initial };
  const _listeners = new EventTarget();
  return {
    get: (key) => _state[key],
    set: (key, value) => {
      const old = _state[key];
      _state[key] = value;
      if (old !== value) {
        _listeners.dispatchEvent(new CustomEvent(`${key}:change`, { detail: { old, value } }));
      }
    },
    on: (key, handler) => _listeners.addEventListener(`${key}:change`, handler),
    off: (key, handler) => _listeners.removeEventListener(`${key}:change`, handler),
  };
}
```

The admin panel's `main.js` creates its own store with admin-specific keys. Future panels create their own stores with panel-specific keys.

### `public/js/core/auth.js` — SDK-agnostic auth state handler

```js
// Zero Firebase imports — pure logic. Caller plugs this into their own onAuthStateChanged.
export function createAuthStateHandler({ requireClaim, onAccessDenied, onReady }) {
  return async (user) => {
    if (!user) { onReady(null); return; }
    const tokenResult = await user.getIdTokenResult();
    if (requireClaim && tokenResult.claims[requireClaim] !== true) {
      onAccessDenied({ reason: 'missing_claim', claim: requireClaim });
      return;
    }
    onReady(user, tokenResult);
  };
}
```

Works with both modular Firebase SDK (admin panel) and compat Firebase SDK (portal) because it's a pure callback factory. Required: admin panel sets `requireClaim: 'admin'` and `onAccessDenied` shows the inline error (preserving PR #284 behavior — no `signOut()` call).

### `public/js/core/api.js` — fetch wrapper with per-tab AbortController

```js
let _apiBase = '';
let _getToken = () => Promise.resolve(null);
let _abortController = new AbortController();

export function configure({ apiBase, getToken }) {
  _apiBase = apiBase;
  _getToken = getToken;
}

/** Called by core/tabs.js on every tab switch to cancel stale in-flight requests. */
export function resetAbortController() {
  _abortController.abort();
  _abortController = new AbortController();
}

/**
 * @param opts.signal        caller-supplied AbortSignal (overrides tab-level abort)
 * @param opts.skipTabAbort  true = survive tab switches (for saves, user search, etc.)
 */
export async function apiCall(method, path, body, { signal, skipTabAbort } = {}) {
  const token = await _getToken();
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}` },
    signal: signal || (skipTabAbort ? undefined : _abortController.signal),
  };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${_apiBase}${path}`, opts);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`HTTP ${res.status}: server returned non-JSON response`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
```

Preserves all semantics of the current inline `apiCall`: Bearer auth, FormData uploads, tab-scoped abort, content-type validation.

### `public/js/core/ui.js` — DOM-preserving UI helpers

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let _toastTimer = null;
export function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className = `toast ${type} visible`;
  _toastTimer = setTimeout(
    () => toast.classList.remove('visible'),
    type === 'error' ? 7000 : 4000
  );
}

const _screens = new Map();
export function registerScreen(name, element) { _screens.set(name, element); }
export function showScreen(name) {
  for (const el of _screens.values()) el.classList.remove('active');
  _screens.get(name)?.classList.add('active');
}

export function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="confirm-buttons">
          <button class="confirm-cancel">Cancel</button>
          <button class="confirm-ok">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

export { escapeHtml };
```

**Critical:** class names (`.toast`, `.confirm-overlay`, `.confirm-dialog`, `.confirm-ok`, `.confirm-cancel`) and element IDs (`#toast`) are **identical to current code**. Playwright tests use `page.locator('.confirm-ok')` — these must keep working.

### `public/js/core/tabs.js` — generic tab switcher

```js
import { resetAbortController } from './api.js';

const _modules = new Map();  // tabId -> { init, activate, deactivate, initialized }
let _panelMap = null;
let _activeTab = null;

export function configure({ panelMap }) {
  _panelMap = panelMap;
}

export function register(tabId, module) {
  _modules.set(tabId, { ...module, initialized: false });
}

export async function show(tabId) {
  if (!_panelMap) throw new Error('tabs.configure() must be called first');
  const mod = _modules.get(tabId);
  if (!mod) throw new Error(`No tab module registered for: ${tabId}`);

  resetAbortController();   // cancel previous tab's in-flight requests

  // deactivate previous tab
  if (_activeTab && _activeTab !== tabId) {
    const prevMod = _modules.get(_activeTab);
    await prevMod?.deactivate?.();
  }

  // init on first activation
  if (!mod.initialized) {
    const root = document.getElementById(_panelMap[tabId]);
    await mod.init?.({ root });
    mod.initialized = true;
  }

  // update panel visibility (preserves the asymmetric class/display pattern
  // from current code — .visible for most panels, style.display for audit-log
  // and user-form, preserving test compatibility)
  setPanelVisibility(tabId);

  // update tab button active state
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tab-${tabId}`);
  if (btn) {
    btn.classList.add('active');
    // Force synchronous layout flush — WebKit batches classList mutations,
    // which can cause automated tests to read stale class values.
    void btn.offsetHeight;
  }

  // activate current tab
  const root = document.getElementById(_panelMap[tabId]);
  await mod.activate?.({ root });

  sessionStorage.setItem('admin_tab', tabId);
  _activeTab = tabId;
}

function setPanelVisibility(tabId) {
  // Exact logic from current switchTab() (lines 6055-6070) — preserves the
  // asymmetric DOM: Users uses inline style (no panel wrapper), Audit Log
  // uses style.display="block", everything else uses a .visible class toggle.
  const isUsers = tabId === 'users';
  const searchBar = document.querySelector('.search-bar');
  const userForm = document.getElementById('user-form');
  if (searchBar) searchBar.style.display = isUsers ? '' : 'none';
  if (userForm) userForm.style.display = isUsers ? '' : 'none';

  // .visible class toggle for most panels
  const visibleClassPanels = [
    'appeals', 'reports', 'gifts', 'economy', 'maintenance', 'monitor',
    'banners', 'funfacts', 'backups', 'logs', 'devices',
    'starting-screens', 'suggestions',
  ];
  for (const id of visibleClassPanels) {
    const panel = document.getElementById(`${id}-panel`);
    if (panel) panel.classList.toggle('visible', tabId === id);
  }

  // Audit log uses style.display (not .visible class) for historical reasons
  const auditLogPanel = document.getElementById('audit-log-panel');
  if (auditLogPanel) {
    auditLogPanel.style.display = tabId === 'audit-log' ? 'block' : 'none';
  }
}

export function getActiveTab() { return _activeTab; }
```

### Tab module shape

Each tab module exports up to three functions:

```js
// public/admin/js/tabs/users.js
import { store } from '../main.js';
import { apiCall } from '/js/core/api.js';
import { showToast, showConfirm } from '/js/core/ui.js';
import { show as showTab } from '/js/core/tabs.js';

// Local state (not shared across tabs)
let tabAbortController = new AbortController();
let currentFormData = null;

/** Run once on first activation — wire DOM listeners, nothing async. */
export function init({ root }) {
  root.querySelector('#search-btn')?.addEventListener('click', handleSearch);
  // etc.
}

/** Run every time the tab becomes active — data loads go here. */
export function activate({ root }) {
  // e.g., loadUserByLastSearched();
}

/** Run when the tab is switched away from — optional. */
export function deactivate() {
  // e.g., stopPollingIfAny();
}

// ... rest of tab logic
```

Tabs are imported eagerly in `main.js` (static imports) but `init()` runs lazily on first activation. This gives fast startup (parse all modules upfront) without paying the cost of initializing tabs the user never visits.

### `public/admin/js/main.js` — admin entry point

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

import { createStore } from '/js/core/state.js';
import { createAuthStateHandler } from '/js/core/auth.js';
import * as api from '/js/core/api.js';
import { showToast, showScreen, registerScreen } from '/js/core/ui.js';
import * as tabs from '/js/core/tabs.js';

// Admin-specific tabs
import * as usersTab from './tabs/users.js';
import * as reportsTab from './tabs/reports.js';
// ... all 15 tab modules imported

// Admin-specific state store
export const store = createStore({
  currentUser: null,
  currentUid: null,
  currentFirebaseUid: null,
  currentTab: 'users',
});

// Register screens for the showScreen helper
registerScreen('loading', document.getElementById('loading-screen'));
registerScreen('login', document.getElementById('login-screen'));
registerScreen('dashboard', document.getElementById('dashboard-screen'));

// Firebase Auth
const app = initializeApp(window.SHYTALK_CONFIG.FIREBASE_CONFIG);
const auth = getAuth(app);
if (window.SHYTALK_CONFIG.USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

// Configure core/api with auth provider
api.configure({
  apiBase: window.SHYTALK_CONFIG.API_BASE,
  getToken: () => store.get('currentUser')?.getIdToken() ?? Promise.resolve(null),
});

// Configure core/tabs with the panel ID map (defined as a constant so
// we can reuse it below to wire tab button click handlers)
const PANEL_MAP = {
  users:              'user-form',           // asymmetric — no panel wrapper
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

// Register each tab module (mapping tab ID to the imported module)
const TAB_MODULES = {
  users: usersTab,
  reports: reportsTab,
  // ... etc (15 entries)
};
for (const [tabId, mod] of Object.entries(TAB_MODULES)) {
  tabs.register(tabId, mod);
}

// Wire tab button clicks
for (const tabId of Object.keys(PANEL_MAP)) {
  document.getElementById(`tab-${tabId}`)?.addEventListener('click', () => tabs.show(tabId));
}

// Wire Firebase Auth
onAuthStateChanged(auth, createAuthStateHandler({
  requireClaim: 'admin',
  onAccessDenied: () => {
    const loginError = document.getElementById('login-error');
    loginError.textContent = 'Access denied — admin privileges required. If you have a portal account, go to /portal/ instead.';
    loginError.style.display = 'block';
    showScreen('login');
  },
  onReady: (user) => {
    if (user) {
      store.set('currentUser', user);
      showScreen('dashboard');
      // Restore last-viewed tab from sessionStorage
      const saved = sessionStorage.getItem('admin_tab') || 'users';
      tabs.show(saved);
    } else {
      showScreen('login');
    }
  },
}));
```

## Cross-tab navigation

Each tab module that needs to navigate to another tab imports `{ show as showTab }` from `/js/core/tabs.js` and calls it:

```js
// tabs/reports.js — clicking a username navigates to Users tab
userNameLink.addEventListener('click', (e) => {
  e.preventDefault();
  store.set('currentUid', clickedUid);
  showTab('users');
});
```

Only 5 cross-tab call sites in the current code. None create circular dependencies because tabs only depend on `core/tabs.js`, not on other tab modules.

## Phased delivery

### PR A — Core infrastructure (no tab extraction)

**Scope:** ~1,500 lines moved. Zero tab logic touched.

1. Create `public/js/core/{state,auth,api,ui,tabs}.js` with the contracts above.
2. Create `public/admin/js/main.js` that wires Firebase Auth, creates the store, configures `api`/`tabs`, imports each core module.
3. Modify `public/admin/index.html`:
   - Add a new `<script type="module" src="js/main.js"></script>` before the existing inline block. This triggers all the core-module setup (Firebase Auth, store, tab switcher wiring) without touching any tab logic.
   - Keep the existing inline `<script type="module">` block, but add `import` statements at the top to bring in the extracted helpers as module-local bindings:
     ```js
     <script type="module">
     // Import the helpers that used to be defined inline. These are module-
     // local bindings (not window.* globals) and completely replace the
     // original function definitions. PR B will move the rest of the tab
     // logic out of this block into tabs/*.js files. PR C removes this
     // block entirely.
     import { showToast, showConfirm, showScreen } from '/js/core/ui.js';
     import { apiCall } from '/js/core/api.js';
     import { show as switchTab } from '/js/core/tabs.js';
     import { store } from './js/main.js';

     // ... rest of the original inline code, minus the duplicated function
     // definitions that were just imported above.
     </script>
     ```
   - Delete the original `function showToast(...)`, `function showConfirm(...)`, `function showScreen(...)`, `async function apiCall(...)`, `function switchTab(...)`, and the Firebase Auth init block — they're all replaced by the imports above.
4. All Playwright tests still pass unchanged (class names and DOM shapes preserved).
5. Manual QA: all tabs still work, all confirm dialogs still work, tab switching still cancels requests, admin access-denied fix (PR #284) still works.

**Commit structure within PR A** (3 commits):
- **A1**: create `public/js/core/*.js` modules + `public/admin/js/main.js`. No changes to `index.html`. Pure addition — zero regression risk. Deployed files exist but aren't imported yet.
- **A2**: add `<script type="module" src="js/main.js"></script>` to `index.html`. Now `main.js` runs alongside the inline block, but the inline block still has its own copies of `showToast`/`apiCall`/etc. Both versions exist but the inline ones win (they're defined after main.js runs). Tests still pass because inline versions are unchanged.
- **A3**: replace the inline `function showToast(...)` etc. definitions with `import` statements at the top of the inline block. Each commit in isolation is revertable.

**Why this order:** A1 is a pure addition (zero regression risk). A2 wires main.js but the inline block still has its own copies. A3 is the actual removal. Each commit is revertable.

### PR B — Tab extraction

**Scope:** ~7,000 lines moved. One tab per commit, grouped by risk.

**Commit group 1 — Easy tabs (read-only or simple CRUD):**
- audit-log.js
- backups.js
- fun-facts.js
- banners.js

**Commit group 2 — Medium tabs:**
- appeals.js
- devices.js
- starting-screens.js
- spin-monitor.js

**Commit group 3 — Complex tabs:**
- gifts.js
- economy.js
- maintenance.js
- logs.js
- suggestions.js
- reports.js
- users.js (largest, most interconnected)

**Extraction procedure per tab** (documented in the impl plan, not the design):
1. Identify the tab's functions in the inline block (grep by tab-specific DOM IDs, comments).
2. Move them to `tabs/{tab}.js` as a module with `init/activate/deactivate` exports.
3. Replace any references to extracted helpers (`apiCall`, `showToast`) with ES module imports.
4. Move `loadXxx()` calls from `switchTab`'s activation side-effects into the tab module's `activate()`.
5. Import the module in `main.js` and register it with `tabs.register()`.
6. Delete the now-extracted functions from the inline block.
7. Run Playwright tests for that tab's spec file.
8. Manual smoke check: open the tab, verify basic functionality.
9. Commit.

### PR C — Cleanup

1. Remove the now-empty inline `<script type="module">` block from `index.html`.
2. Remove any lingering backwards-compat shims from PR A.
3. Add JSDoc to core module exports.
4. Create `public/js/core/README.md` describing the core modules for future panel work (MC Host/Singer/Team Leaders/Teacher/Personal Profile).
5. Update `CLAUDE.md` with the new module layout under "Architecture".
6. Verify no `window.*` globals leak from the admin panel (console check).

## Testing strategy

**Unchanged (must pass):**
- 28 Playwright spec files × 5 browsers × Android E2E (CI)
- Full manual QA cycle before each PR merges (per auto-mode rule)

**New (optional, non-blocking):**
- Jest unit tests for pure core functions (`createStore`, `createAuthStateHandler`, `escapeHtml`). Placed in `public/js/core/__tests__/` or merged into `express-api/tests/unit/` (easier — jest config already exists). Not blocking for this PR — can ship as a follow-up.

## Rollback strategy

Each PR is independently revertable via `git revert <merge-commit>`.

- **PR A revert:** restores inline `showToast`/`apiCall`/etc. in the same file. No tab logic was touched. Fully reversible in one commit.
- **PR B revert:** restores the big inline block. Tab modules are deleted. Larger diff but reversible. Individual commits within PR B can also be reverted in isolation.
- **PR C revert:** restores the window shims and the (still empty) inline script tag. Trivial.

## Non-goals

- No framework adoption (Vue/Svelte/React) — explicitly out of scope.
- No TypeScript — out of scope for this PR (could be a follow-up).
- No test rewrites — existing Playwright tests must pass unchanged.
- No refactoring beyond extraction — `users.js` stays ~1,000 lines. Splitting it further (e.g., `users/profile.js`, `users/moderation.js`) is a follow-up, not this PR.
- No bundling / minification — Cloudflare Pages serves as-is over HTTP/2.
- No lazy loading via dynamic `import()` — eager static imports give simpler startup and are fine for <20 modules. Dynamic imports can be added later if the bundle grows.

## Success criteria

- `public/admin/index.html` is < 5,000 lines (down from 14,520) — most of that is HTML markup + CSS, no inline JS.
- `public/js/core/` exists with 5 app-agnostic modules, all importable from future panels.
- `public/admin/js/tabs/` exists with 15 per-tab modules.
- Every existing Playwright admin spec passes unchanged on all 5 browsers.
- Full manual QA pass on each PR before merge.
- Dev and prod deploys successful after each merge.
- No regressions reported within 24h of prod deploy.

## Follow-up tasks (out of scope for this design)

1. Unit tests for `public/js/core/` modules (`createStore`, `createAuthStateHandler`, `escapeHtml`).
2. Split `users.js` further into subtab modules (`profile`, `moderation`, `security`, `economy`, `identity`) if it grows beyond ~1,500 lines.
3. Migrate `public/portal/portal.js` to use `public/js/core/` modules (currently uses compat Firebase SDK with its own wrappers).
4. MC Host panel at `public/mc-host/` using the shared `public/js/core/` modules (roadmap #43).
