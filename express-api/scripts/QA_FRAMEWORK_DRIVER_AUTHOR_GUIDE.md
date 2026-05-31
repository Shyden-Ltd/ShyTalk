# QA Framework — Driver Author Guide

How to add a new driver to the 12-cell matrix. If you're already
familiar with the existing drivers, the contract test
(`tests/scripts/drivers/driver-contract.test.js`) is the
machine-checkable summary; this doc explains the conventions and
why they exist.

For the architecture context, read
[`QA_FRAMEWORK_ARCHITECTURE.md`](./QA_FRAMEWORK_ARCHITECTURE.md) first.

---

## What "a driver" means here

A driver is a Node module that wraps a single
(browser × platform) target — e.g. "Chrome on Android via CDP-over-adb",
or "Safari on iOS via Appium". The runner instantiates the driver
once per scenario subprocess (in `--matrix` mode, that's once per
cell), invokes methods on it to fulfil step matchers, then closes
it.

Drivers are NOT shared across cells. Each cell gets its own process,
its own driver instance, its own teardown. This keeps cells
independent — a hung Appium session in one cell can't poison the
next.

---

## The contract (machine-checked)

Every file matching `express-api/scripts/drivers/*-driver.js` MUST:

1. **Load without environment variables.** Drivers that read
   `process.env.X` at module-top break `--check-drivers` silently.
   Read env vars _inside_ the factory function (or later), not at
   require-time. The contract test
   (`tests/scripts/drivers/driver-contract.test.js`) clears all
   `PERSONAS_*` / `FIREBASE_*` / `APPIUM_*` / `ANDROID_*` / `IOS_*`
   env vars before `require()`-ing and asserts the module loads.

2. **Export a factory function.** Name must start with `create` —
   the contract test searches `Object.entries(mod)` for the first
   `typeof === 'function'` whose `.name` starts with `create`.
   Examples: `createWebDriver`, `createMobileChromeAndroidDriver`,
   `createIosDriver`.

3. **Export `listMethods()`.** A function returning the canonical
   list of method names this driver implements (sorted, deduped).
   Example:

   ```js
   function listMethods() {
     return [...new Set(WEB_METHOD_NAMES)].sort();
   }
   ```

4. **Export a `*_METHOD_NAMES` constant.** An array of method names
   matching `listMethods()` (as a set after dedup + sort). The
   constant + the function are intentionally redundant — keeping
   them in sync is enforced by the contract test, so drift is
   impossible.

If your driver is a helper module (no factory, no `listMethods`),
name it WITHOUT `-driver.js` suffix and add it to the contract
test's `HELPER_FILES` exclusion set (e.g.
`android-cdp-helpers.js`, `ios-driver-loader.js`).

---

## Step-by-step: adding "Chrome on Windows" as a new cell

A realistic walk-through. Suppose we want to add a desktop-Chromium
cell that runs against the Edge channel on Windows. Slug:
`mobile-chrome-windows-driver` (silly name; this is illustrative).

### 1. Add the slug to the allowlist

`express-api/scripts/browser-allowlist.js`:

```js
const MOBILE_BROWSERS = [
  // ...existing entries...
  'mobile-chrome-windows', // NEW
];

const TARGET_BROWSER_ALLOWLIST = {
  local: [...DESKTOP_BROWSERS, ...MOBILE_BROWSERS],
  dev: ['chromium', 'mobile-chrome-android', 'mobile-chrome-windows'], // NEW
  prod: ['chromium'],
};
```

The local target picks up the new slug for free via spread; dev/prod
are explicit lists you choose to include it in (or not, based on
matrix policy).

### 2. Create the driver

`express-api/scripts/drivers/mobile-chrome-windows-driver.js`:

```js
// Canonical method surface — what the runner can ask this driver
// to do. Pinned by driver-contract.test.js.
const MOBILE_CHROME_WINDOWS_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump'];

function listMethods() {
  return [...new Set(MOBILE_CHROME_WINDOWS_METHOD_NAMES)].sort();
}

async function createMobileChromeWindowsDriver({ baseURL = 'http://localhost:8888' } = {}) {
  // Lazy import — only loaded when the driver is instantiated, not at
  // require-time. Keeps --check-drivers fast and doesn't crash if the
  // toolchain is missing (the require itself will throw, which the
  // health-check classifies as 'skip' — acceptable in CI without the tool).
  const someChromeRemoteControlLib = require('some-remote-chrome-lib');

  const conn = await someChromeRemoteControlLib.connect({ host: 'windows-host.local' });

  const driver = {
    webRefreshRoomsList: async () => {
      await conn.navigate(`${baseURL}/rooms`);
      return true;
    },
    webUiDump: async () => {
      return conn.evaluate(() => document.body.innerText || '');
    },
    close: async () => {
      try {
        await conn.close();
      } catch (_e) {
        /* best-effort */
      }
    },
  };
  return driver;
}

module.exports = {
  createMobileChromeWindowsDriver,
  listMethods,
  MOBILE_CHROME_WINDOWS_METHOD_NAMES,
};
```

Key conventions:

- `close()` is on the driver but NOT in `*_METHOD_NAMES` — it's
  lifecycle, not a runner step-binding. Matches
  `web-playwright-driver` + every other driver in the repo.
- Errors in `close()` are swallowed silently (`/* best-effort */`).
  The runner can't do anything useful with a teardown error and
  it shouldn't fail an otherwise-passing scenario.
- Methods that the runner calls should return a value the matcher
  can assert (a boolean, a string, etc.). Return `false` or `''`
  on recoverable failure — let the matcher decide whether the
  scenario passes.

### 3. Wire the factory into the runner

`express-api/scripts/manual-qa-runner.js`, in `main()` near the
existing driver routing block (look for `createWebDriver` and the
mobile-chrome-android wiring):

```js
} else if (opts.browser === 'mobile-chrome-windows') {
  const { createMobileChromeWindowsDriver } = require('./drivers/mobile-chrome-windows-driver');
  webDriver = await createMobileChromeWindowsDriver({ baseURL });
  driverCleanup = () => webDriver.close();
}
```

The else-if chain is intentionally verbose — each cell has its own
import + bootstrap shape. Don't try to DRY this into a lookup table
unless you've thought hard about how driver-specific options
(per-cell flags, env-var requirements) would flow through.

### 4. Add a dedicated driver test

`express-api/tests/scripts/drivers/mobile-chrome-windows-driver.test.js`:

```js
// Mock the lazy-imported remote-chrome library so tests don't need
// the real toolchain. Pattern: jest.mock at the top, then require
// the driver factory inside each test (the mock is in place).
jest.mock('some-remote-chrome-lib', () => ({
  connect: jest.fn(async () => ({
    navigate: jest.fn(),
    evaluate: jest.fn(async () => 'sample text'),
    close: jest.fn(),
  })),
}));

const {
  createMobileChromeWindowsDriver,
  listMethods,
  MOBILE_CHROME_WINDOWS_METHOD_NAMES,
} = require('../../../scripts/drivers/mobile-chrome-windows-driver');

describe('listMethods', () => {
  test('returns sorted dedup of MOBILE_CHROME_WINDOWS_METHOD_NAMES', () => {
    expect(listMethods()).toEqual([...new Set(MOBILE_CHROME_WINDOWS_METHOD_NAMES)].sort());
  });
});

describe('createMobileChromeWindowsDriver', () => {
  test('webRefreshRoomsList navigates to /rooms', async () => {
    const d = await createMobileChromeWindowsDriver({ baseURL: 'http://x' });
    await expect(d.webRefreshRoomsList()).resolves.toBe(true);
  });
  // ... etc — one test per method, plus close()
});
```

The contract test (`driver-contract.test.js`) auto-discovers your
new file and adds its 5 conformance assertions on the next run.
No test-infra edits required.

### 5. (Optional) Update the manual-qa-runner help text

`formatUsage()` lists the supported `--browser` slugs. Add yours
to the list comment block. The drift-catch tests (in
`manual-qa-runner-help-version.test.js`) check that every long-form
flag in the parser appears in `formatUsage()` — they don't currently
enforce browser-slug coverage, but updating the help text is
operator-courtesy.

### 6. Run the test suite

```bash
cd express-api
npm test -- --testPathPattern 'drivers/'
```

You should see the contract test gain 5 new assertions for your
driver. Your unit test file should pass. Full suite (`npm test`)
should still pass with no regressions.

---

## Conventions that aren't enforced (yet)

These are conventions the existing drivers follow but the contract
test doesn't yet enforce. Follow them for consistency:

- **Bootstrap errors should be `Error` instances with descriptive
  messages.** The `driver-health-check.js` classifier groups errors
  by message content; messages like "no Android device attached"
  reliably map to `outcome: skip`, whereas generic
  `TypeError: undefined` maps to `outcome: fail`. Match the existing
  driver wording when possible.
- **Don't log to `console.log` from inside a driver.** Use
  `console.error` so per-cell stdio capture (`--report-dir`)
  separates diagnostic output from runner-level chatter.
- **Lazy-load heavy deps inside the factory.** `require('playwright')`
  at module top would slow every `require('./manual-qa-runner')`
  call (including from tests) by hundreds of milliseconds.

---

## When in doubt

- Read `web-mobile-chrome-android-driver.js` as the
  minimum-viable reference (small + complete).
- Read `web-playwright-driver.js` for the multi-browser-from-one-driver
  pattern.
- Read `ios-simctl-driver.js` for the device-discovery + UDID
  selection pattern.
- Read the contract test (`driver-contract.test.js`) for the exact
  machine-checked invariants.

When you've got something that loads + passes contract + has
per-method unit coverage, you're ready to PR.
