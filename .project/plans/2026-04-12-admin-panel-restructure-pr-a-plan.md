# Admin Panel Restructure — PR A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared core modules (`state`, `auth`, `api`, `ui`, `tabs`) from the 9,500-line inline `<script>` in `public/admin/index.html` into reusable ES module files, and wire them via `public/admin/js/main.js`. Zero behavior change, zero Playwright regressions.

**Architecture:** Pure ES modules at `public/js/core/` (shared, reusable by future panels) + `public/admin/js/main.js` (admin-specific entry point). Inline `<script type="module">` block is shortened by ~1,500 lines. Remaining inline code imports the extracted helpers via standard ES module `import` statements.

**Tech Stack:** Vanilla JS (ES modules), Firebase Auth (modular SDK v11.6.0), Jest (unit tests for pure functions)

**Spec:** `.project/plans/2026-04-11-admin-panel-restructure-design.md`

---

## File Structure

### New Files
```
public/js/core/state.js              ← createStore factory (EventTarget-based)
public/js/core/auth.js               ← createAuthStateHandler (SDK-agnostic)
public/js/core/api.js                ← apiCall + resetAbortController
public/js/core/ui.js                 ← showToast, showConfirm, showScreen, escapeHtml
public/js/core/tabs.js               ← register, configure, show, setPanelVisibility
public/admin/js/main.js              ← admin entry point (Firebase init, store, tab wiring)
express-api/tests/client-core/state.test.js     ← unit tests for createStore
express-api/tests/client-core/auth.test.js      ← unit tests for createAuthStateHandler
express-api/tests/client-core/ui.test.js        ← unit tests for escapeHtml
```

### Modified Files
```
public/admin/index.html              ← add <script src="js/main.js">, replace inline helpers with imports
```

---

## Commit A1 — Create core modules + main.js (no HTML changes)

### Task 1: core/state.js — TDD

**Files:**
- Create: `public/js/core/state.js`
- Test: `express-api/tests/client-core/state.test.js`

- [ ] **Step 1: Write failing tests**

Create `express-api/tests/client-core/state.test.js`:
```js
const { createStore } = require('../../../public/js/core/state');

describe('createStore', () => {
  test('get returns undefined for unset key', () => {
    const store = createStore({});
    expect(store.get('missing')).toBeUndefined();
  });

  test('get returns initial value', () => {
    const store = createStore({ name: 'Alice' });
    expect(store.get('name')).toBe('Alice');
  });

  test('set updates value and get reflects it', () => {
    const store = createStore({ count: 0 });
    store.set('count', 5);
    expect(store.get('count')).toBe(5);
  });

  test('set fires change event with old and new value', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.set('x', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ old: 1, value: 2 });
  });

  test('set does NOT fire event when value unchanged', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.set('x', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  test('off removes listener', () => {
    const store = createStore({ x: 1 });
    const handler = jest.fn();
    store.on('x:change', handler);
    store.off('x:change', handler);
    store.set('x', 2);
    expect(handler).not.toHaveBeenCalled();
  });

  test('multiple stores are independent', () => {
    const a = createStore({ val: 'a' });
    const b = createStore({ val: 'b' });
    a.set('val', 'changed');
    expect(a.get('val')).toBe('changed');
    expect(b.get('val')).toBe('b');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd express-api && npx jest tests/client-core/state.test.js --verbose`
Expected: FAIL — `Cannot find module '../../../public/js/core/state'`

- [ ] **Step 3: Implement state.js**

Create `public/js/core/state.js`:
```js
/**
 * App-agnostic reactive state store factory.
 *
 * Each app (admin panel, MC Host panel, etc.) creates its own store
 * with app-specific keys. Changes fire events via EventTarget so
 * modules can subscribe to cross-cutting state updates.
 *
 * @param {Object} initial - Initial state keys and values
 * @returns {{ get, set, on, off }}
 */
function createStore(initial) {
  const _state = { ...initial };
  const _listeners = new EventTarget();
  return {
    get: (key) => _state[key],
    set: (key, value) => {
      const old = _state[key];
      _state[key] = value;
      if (old !== value) {
        _listeners.dispatchEvent(
          new CustomEvent(`${key}:change`, { detail: { old, value } }),
        );
      }
    },
    on: (key, handler) => _listeners.addEventListener(key, handler),
    off: (key, handler) => _listeners.removeEventListener(key, handler),
  };
}

// Dual export: ES module default + CJS for Jest
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createStore };
}
export { createStore };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd express-api && npx jest tests/client-core/state.test.js --verbose`
Expected: ALL PASS (7 tests)

### Task 2: core/auth.js — TDD

**Files:**
- Create: `public/js/core/auth.js`
- Test: `express-api/tests/client-core/auth.test.js`

- [ ] **Step 1: Write failing tests**

Create `express-api/tests/client-core/auth.test.js`:
```js
const { createAuthStateHandler } = require('../../../public/js/core/auth');

describe('createAuthStateHandler', () => {
  test('calls onReady(null) when user is null', async () => {
    const onReady = jest.fn();
    const handler = createAuthStateHandler({ onReady });
    await handler(null);
    expect(onReady).toHaveBeenCalledWith(null);
  });

  test('calls onReady(user, tokenResult) when no claim required', async () => {
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: {} }) };
    const handler = createAuthStateHandler({ onReady });
    await handler(user);
    expect(onReady).toHaveBeenCalledWith(user, { claims: {} });
  });

  test('calls onReady when required claim is present', async () => {
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: { admin: true } }) };
    const handler = createAuthStateHandler({ requireClaim: 'admin', onReady });
    await handler(user);
    expect(onReady).toHaveBeenCalledWith(user, { claims: { admin: true } });
  });

  test('calls onAccessDenied when required claim is missing', async () => {
    const onAccessDenied = jest.fn();
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: {} }) };
    const handler = createAuthStateHandler({
      requireClaim: 'admin',
      onAccessDenied,
      onReady,
    });
    await handler(user);
    expect(onAccessDenied).toHaveBeenCalledWith({ reason: 'missing_claim', claim: 'admin' });
    expect(onReady).not.toHaveBeenCalled();
  });

  test('calls onAccessDenied when claim is false', async () => {
    const onAccessDenied = jest.fn();
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: { admin: false } }) };
    const handler = createAuthStateHandler({
      requireClaim: 'admin',
      onAccessDenied,
      onReady,
    });
    await handler(user);
    expect(onAccessDenied).toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd express-api && npx jest tests/client-core/auth.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement auth.js**

Create `public/js/core/auth.js`:
```js
/**
 * SDK-agnostic Firebase Auth state handler factory.
 *
 * Returns a callback suitable for both:
 *   - Modular SDK: onAuthStateChanged(auth, handler)
 *   - Compat SDK:  auth.onAuthStateChanged(handler)
 *
 * Zero Firebase imports — the caller owns the SDK.
 *
 * @param {Object} opts
 * @param {string} [opts.requireClaim] - Custom claim key that must be true
 * @param {Function} [opts.onAccessDenied] - Called with { reason, claim } when claim missing
 * @param {Function} opts.onReady - Called with (user, tokenResult) or (null) on sign-out
 * @returns {Function} Auth state handler callback
 */
function createAuthStateHandler({ requireClaim, onAccessDenied, onReady }) {
  return async (user) => {
    if (!user) {
      onReady(null);
      return;
    }
    const tokenResult = await user.getIdTokenResult();
    if (requireClaim && tokenResult.claims[requireClaim] !== true) {
      if (onAccessDenied) {
        onAccessDenied({ reason: 'missing_claim', claim: requireClaim });
      }
      return;
    }
    onReady(user, tokenResult);
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAuthStateHandler };
}
export { createAuthStateHandler };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd express-api && npx jest tests/client-core/auth.test.js --verbose`
Expected: ALL PASS (5 tests)

### Task 3: core/ui.js — TDD (escapeHtml) + implementation (DOM helpers)

**Files:**
- Create: `public/js/core/ui.js`
- Test: `express-api/tests/client-core/ui.test.js`

- [ ] **Step 1: Write failing tests for escapeHtml**

Create `express-api/tests/client-core/ui.test.js`:
```js
const { escapeHtml } = require('../../../public/js/core/ui');

describe('escapeHtml', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('converts non-string to string first', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });

  test('preserves safe characters', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd express-api && npx jest tests/client-core/ui.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ui.js**

Create `public/js/core/ui.js` — full file with escapeHtml (testable), showToast, showConfirm, showScreen, registerScreen (DOM-dependent, tested via Playwright):

```js
/**
 * Generic UI helpers for admin-style panels.
 *
 * DOM shapes (class names, element IDs) are identical to the original
 * inline admin panel code so Playwright selectors keep working.
 *
 * showToast, showConfirm, showScreen operate on the DOM directly.
 * escapeHtml is a pure function, unit-tested independently.
 */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// --- Toast ---
let _toastTimer = null;

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className = `toast ${type} visible`;
  _toastTimer = setTimeout(
    () => toast.classList.remove('visible'),
    type === 'error' ? 7000 : 4000,
  );
}

// --- Screen switcher ---
const _screens = new Map();

function registerScreen(name, element) {
  _screens.set(name, element);
}

function showScreen(name) {
  for (const el of _screens.values()) el.classList.remove('active');
  _screens.get(name)?.classList.add('active');
}

// --- Confirm dialog ---
function showConfirm(title, message) {
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
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml, showToast, showConfirm, showScreen, registerScreen };
}
export { escapeHtml, showToast, showConfirm, showScreen, registerScreen };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd express-api && npx jest tests/client-core/ui.test.js --verbose`
Expected: ALL PASS (6 tests)

### Task 4: core/api.js — implementation

**Files:**
- Create: `public/js/core/api.js`

- [ ] **Step 1: Create api.js**

Create `public/js/core/api.js` — copy the exact `apiCall` logic from `public/admin/index.html:5313-5338` plus the `resetAbortController` function from the design spec. Include the dual CJS/ESM export pattern.

Key code: see `.project/plans/2026-04-11-admin-panel-restructure-design.md` § `core/api.js` for the full implementation. Copy it verbatim. The function signatures are:

```js
export function configure({ apiBase, getToken })
export function resetAbortController()
export async function apiCall(method, path, body, { signal, skipTabAbort } = {})
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "require('./public/js/core/api.js'); console.log('OK')"`
Expected: `OK`

### Task 5: core/tabs.js — implementation

**Files:**
- Create: `public/js/core/tabs.js`

- [ ] **Step 1: Create tabs.js**

Create `public/js/core/tabs.js` — full implementation from the design spec including `configure`, `register`, `show`, `getActiveTab`, `setPanelVisibility`. Import `resetAbortController` from `./api.js`.

Key code: see design spec § `core/tabs.js` for the full implementation including the `setPanelVisibility` function that handles the asymmetric Users/AuditLog/other-panels DOM toggling.

- [ ] **Step 2: Verify it parses**

Run: `node -e "require('./public/js/core/tabs.js'); console.log('OK')"`
Expected: `OK`

### Task 6: admin/js/main.js — implementation

**Files:**
- Create: `public/admin/js/main.js`

- [ ] **Step 1: Create main.js**

Create `public/admin/js/main.js` — the admin entry point from the design spec. Imports all core modules, creates the admin store, configures Firebase Auth (modular SDK v11.6.0 via CDN), configures api and tabs with the panel map, and wires `onAuthStateChanged` with `createAuthStateHandler({ requireClaim: 'admin' })`.

Key code: see design spec § `public/admin/js/main.js` for the full implementation.

**Important:** This file will NOT import tab modules yet (PR B handles that). For now it only wires core infrastructure.

- [ ] **Step 2: Verify it parses (won't fully run without browser, but syntax check)**

Run: `node --check public/admin/js/main.js` (will fail on ESM import syntax from CDN — expected for browser-only code)

### Task 7: Run existing tests — verify zero regressions

- [ ] **Step 1: Run full Express test suite**

Run: `cd express-api && npx jest --silent`
Expected: 4097+ tests pass (including the 3 new client-core test files)

- [ ] **Step 2: Commit A1**

```bash
git add public/js/core/ public/admin/js/main.js express-api/tests/client-core/
git commit -m "feat(admin): add core ES modules + admin entry point (A1, no HTML changes)

Create the shared module infrastructure for the admin panel restructure:

- public/js/core/state.js: createStore factory with EventTarget-based reactivity
- public/js/core/auth.js: SDK-agnostic createAuthStateHandler for claim checking
- public/js/core/api.js: apiCall wrapper with per-tab AbortController
- public/js/core/ui.js: showToast, showConfirm, showScreen, escapeHtml
- public/js/core/tabs.js: generic tab switcher with panel ID map
- public/admin/js/main.js: admin entry point (Firebase Auth, store, tab config)

These files exist but are NOT yet wired into index.html — that happens
in commits A2 and A3. Zero regression risk: no existing code is changed.

Unit tests added for pure functions: createStore (7), createAuthStateHandler (5),
escapeHtml (6). Total: 18 new tests."
```

---

## Commit A2 — Wire main.js into index.html (coexistence)

### Task 8: Add `<script>` tag for main.js

**Files:**
- Modify: `public/admin/index.html:5057`

- [ ] **Step 1: Add the new script tag BEFORE the existing inline block**

Find line 5057 (`<script src="config.js"></script>`) and add main.js after it:

```html
<script src="config.js"></script>
<script type="module" src="js/main.js"></script>
<script type="module">
```

Both main.js AND the inline block now run. The inline block still has its own `showToast`, `apiCall`, etc. definitions which shadow the imports. No behavior change.

- [ ] **Step 2: Run Playwright admin tests locally (chromium only)**

Run: `API_BASE_URL=http://localhost:3000 WEB_BASE_URL=http://localhost:8888 ADMIN_EMAIL=claude-test@shytalk.dev ADMIN_PASSWORD=localdev123 TEST_API_KEY=local-test-key npx playwright test tests/web/admin-panel.spec.ts tests/web/admin-login.spec.ts --project=chromium --reporter=list`

Expected: ALL PASS — inline block still has its own copies, main.js runs silently alongside

- [ ] **Step 3: Commit A2**

```bash
git add public/admin/index.html
git commit -m "feat(admin): wire main.js into index.html (A2, coexistence)

Add <script type=\"module\" src=\"js/main.js\"> before the existing inline
block. Both versions of the helpers now coexist — the inline definitions
shadow the module imports, so behavior is unchanged. This commit proves
main.js loads without errors alongside the existing code."
```

---

## Commit A3 — Replace inline helpers with imports

### Task 9: Replace inline function definitions with imports

**Files:**
- Modify: `public/admin/index.html:5058-6110` (approximately)

- [ ] **Step 1: Add imports at the top of the inline `<script type="module">` block**

Replace the following inline definitions with imports. At the very top of the inline block (after the opening `<script type="module">` tag), add:

```js
// ── Imports from extracted core modules ──────────────────────────
// These replace the inline function definitions that were here before.
// PR B will move the remaining tab-specific code into tabs/*.js files.
import { createStore } from '/js/core/state.js';
import { createAuthStateHandler } from '/js/core/auth.js';
import { apiCall, configure as configureApi, resetAbortController } from '/js/core/api.js';
import { showToast, showConfirm, showScreen, registerScreen, escapeHtml } from '/js/core/ui.js';
import { configure as configureTabs, register as registerTab, show as showTab, getActiveTab } from '/js/core/tabs.js';
```

- [ ] **Step 2: Delete the following inline function definitions**

Remove these functions/blocks from the inline script (they're now imported):

1. `function escapeHtml(s)` — find and delete (any location)
2. `function showScreen(name)` — lines ~5195-5198
3. `function showToast(msg, type)` — lines ~5202-5207 plus `let toastTimer`
4. `function showConfirm(title, message)` — lines ~8179-8198
5. `async function apiCall(method, path, body, opts)` — lines ~5313-5338 plus `let tabAbortController`
6. Firebase Auth init block (lines ~5060-5090: `initializeApp`, `getAuth`, `connectAuthEmulator`, the `const app/auth` declarations) — now in main.js
7. `onAuthStateChanged(auth, async (user) => { ... })` at lines ~5210-5230 — now in main.js
8. `function switchTab(tab)` — lines ~6031-6105

**Do NOT delete:**
- The `const $ = ...` / `const $$ = ...` shorthand selectors
- Any tab-specific functions (loadReports, loadGifts, etc.)
- Any DOM element references (`const giftsPanel = ...`)
- Any event listener registrations

- [ ] **Step 3: Make remaining inline code use the imported names**

The remaining inline code already uses `showToast(...)`, `apiCall(...)`, `showConfirm(...)`, `switchTab(...)` by name. Since these are now imported at the top of the same `<script type="module">` block, they resolve correctly. No renaming needed.

Where the inline code calls `switchTab("users")`, it will now call the imported `showTab("users")` from core/tabs.js. So: **rename all `switchTab(` calls to `showTab(` in the remaining inline code** (there are ~22 call sites).

- [ ] **Step 4: Run Playwright admin tests locally (chromium only — full admin suite)**

Run: `bash local/test-playwright.sh tests/web/admin-*.spec.ts --project=chromium`

Expected: ALL PASS — same DOM, same class names, same behavior. Only the function definitions moved files.

- [ ] **Step 5: Run full Express test suite**

Run: `cd express-api && npx jest --silent`
Expected: 4097+ tests pass

- [ ] **Step 6: Commit A3**

```bash
git add public/admin/index.html
git commit -m "refactor(admin): replace inline helpers with core module imports (A3)

Remove ~1,500 lines of inline function definitions (showToast, showConfirm,
showScreen, apiCall, switchTab, escapeHtml, Firebase Auth init) and replace
them with ES module imports from public/js/core/*.js.

The remaining inline code (~8,000 lines of tab-specific logic) now uses
the imported helpers. PR B will extract those tabs into separate files.

All Playwright admin tests pass unchanged — DOM shapes, class names, IDs,
and data-attributes are identical."
```

---

## Ship PR A

### Task 10: Push + open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/admin-panel-restructure-pr-a
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "refactor(admin): extract core ES modules from inline script (PR A)" \
  --body "## Summary
PR A of 3 for the admin panel restructure (#41).

Extracts ~1,500 lines of shared helper functions from the 9,500-line inline
\`<script type=\"module\">\` in \`public/admin/index.html\` into reusable ES
modules at \`public/js/core/\`.

## New modules
- \`public/js/core/state.js\` — createStore factory
- \`public/js/core/auth.js\` — SDK-agnostic auth handler
- \`public/js/core/api.js\` — apiCall with per-tab AbortController
- \`public/js/core/ui.js\` — showToast, showConfirm, showScreen, escapeHtml
- \`public/js/core/tabs.js\` — generic tab switcher
- \`public/admin/js/main.js\` — admin entry point

## Test plan
- [x] 18 new unit tests (createStore, createAuthStateHandler, escapeHtml)
- [ ] Full Playwright admin suite (all 5 browsers)
- [ ] SonarCloud quality gate
- [ ] Manual QA on dev

## Design
See \`.project/plans/2026-04-11-admin-panel-restructure-design.md\`"
```

### Task 11: Monitor CI

- [ ] **Step 1: Wait for CI to complete**

Watch for: Lint, Build & Test, SonarCloud, Playwright (5 browsers), Android E2E, PR Gate

- [ ] **Step 2: Fix any failures, push fixes, re-monitor**

### Task 12: Deploy to dev + smoke test

- [ ] **Step 1: Deploy to dev from branch**

```bash
gh workflow run deploy-dev.yml --ref=feat/admin-panel-restructure-pr-a -f web=true -f backend=false -f playwright=true
```

- [ ] **Step 2: Smoke test dev**

```bash
curl -s -o /dev/null -w "%{http_code}" https://dev.shytalk.shyden.co.uk/admin/
curl -s https://dev.shytalk.shyden.co.uk/admin/js/main.js | head -5
```

### Task 13: Merge + deploy to prod

- [ ] **Step 1: Manual QA pass (2 clean runs)**
- [ ] **Step 2: Merge**

```bash
gh pr merge <PR_NUMBER> --merge
```

- [ ] **Step 3: Monitor Release workflow**
- [ ] **Step 4: Deploy to prod**

```bash
gh workflow run deploy-prod.yml -f release-tag=<TAG> -f web=true -f backend=false
```

- [ ] **Step 5: Verify prod**

```bash
curl -s -o /dev/null -w "%{http_code}" https://shytalk.shyden.co.uk/admin/
curl -s https://shytalk.shyden.co.uk/admin/js/main.js | head -5
```

---

## Execution Order

Tasks 1-7 (core modules + tests + commit A1) are the foundation.
Task 8 (wire main.js + commit A2) requires A1.
Task 9 (replace inline helpers + commit A3) requires A2.
Tasks 10-13 (ship) require A3.

Recommended: sequential execution, Tasks 1 → 13.
