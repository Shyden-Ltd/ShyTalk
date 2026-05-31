/* global document */
/**
 * Web driver: Mobile Chrome on Android via CDP-over-adb.
 *
 * Drives the actual Chrome browser running on the operator's connected
 * Android device — not Playwright's "Pixel 5 emulation" (which is just
 * desktop Chromium with mobile UA/viewport). That distinction matters
 * for the matrix-completeness rule: local validation requires real
 * Android × Mobile Chrome coverage, not a fake.
 *
 * Wire-up
 * -------
 * 1. Operator enables USB debugging on the Android device.
 * 2. Operator enables Chrome → chrome://flags → "Enable command line on
 *    non-rooted devices" + restarts Chrome (one-time per device).
 *    Alternative: open Chrome → settings → Developer options → enable
 *    "USB Web debugging".
 * 3. Driver runs `adb forward tcp:<port> localabstract:chrome_devtools_remote`
 *    so localhost:<port> tunnels into Chrome's CDP socket on the device.
 * 4. Driver calls `playwright.chromium.connectOverCDP(endpointURL)` to
 *    attach Playwright to the remote browser.
 * 5. Driver uses Playwright's Page API the same way as web-playwright-
 *    driver.js — methods are pin-compatible so the runner can swap.
 *
 * Method-naming contract: mirrors `web-playwright-driver.js`. The runner
 * doesn't care which driver it gets — they expose the same surface so
 * scenarios run unchanged across Mac × {chromium, firefox, webkit, edge}
 * and Android × Mobile Chrome.
 *
 * Failure modes (all return false + log, never throw):
 *   - adb not on PATH → "adb not found; install platform-tools"
 *   - no device attached → "no Android device; check `adb devices`"
 *   - Chrome not running on device → "Chrome not running; launch it
 *     manually + enable USB Web debugging"
 *   - CDP port already forwarded by another tool → use SO_REUSEPORT
 *     pattern: pick next free port, log the chosen port.
 *
 * The driver uses `execFileSync('/usr/bin/adb', ...)` on macOS;
 * platform-tools is installed at a fixed Apple-Homebrew location.
 * Tests inject a custom `adbPath` so cross-platform CI doesn't require
 * a real adb.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');

// Shared CDP-over-adb plumbing extracted to android-cdp-helpers.js so
// the Samsung Internet + Mobile Edge drivers can reuse it without
// copy-paste. The re-exports below preserve backwards-compat for
// anything that imports these symbols from this driver directly.
const {
  KNOWN_ADB_PATHS,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward: bootstrapAdbForwardImpl,
} = require('./android-cdp-helpers');

/**
 * Thin wrapper around the shared bootstrap that pins Chrome's
 * `chrome_devtools_remote` socket name. Other Android browsers (Samsung
 * Internet, Mobile Edge) call the shared helper with their own socket
 * names.
 *
 * Kept as a separate exported symbol so existing test imports of
 * `bootstrapAdbForward` from this module continue to work unchanged.
 */
async function bootstrapAdbForward(opts = {}) {
  return bootstrapAdbForwardImpl({
    socketName: 'chrome_devtools_remote',
    browserNameHint: 'Chrome',
    ...opts,
  });
}

let _playwright;
function loadPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = require('playwright');
    return _playwright;
  } catch (bareErr) {
    if (bareErr.code !== 'MODULE_NOT_FOUND') throw bareErr;
  }
  const repoRoot = path.resolve(__dirname, '../../..');
  const playwrightPath = path.join(repoRoot, 'node_modules', 'playwright');
  _playwright = require(playwrightPath);
  return _playwright;
}

/**
 * Driver factory.
 *
 *   const driver = await createMobileChromeAndroidDriver({ baseURL });
 *   ctx.webDriver = driver;
 *   await driver.webRefreshRoomsList('Alice');
 *   await driver.close();
 *
 * Injectable deps (test-only):
 *   - adbPath, execFileSync — replace adb interaction
 *   - playwrightImpl — replace playwright module
 *   - pickPort — deterministic port selection
 */
async function createMobileChromeAndroidDriver({
  baseURL = 'http://localhost:8888',
  adbPath,
  execFileSync,
  playwrightImpl,
  pickPort,
} = {}) {
  const { port, removeForward } = await bootstrapAdbForward({
    adbPath,
    execFileSync,
    pickPort,
  });

  const pw = playwrightImpl || loadPlaywright();
  const endpointURL = `http://127.0.0.1:${port}`;
  let browser;
  try {
    browser = await pw.chromium.connectOverCDP(endpointURL);
  } catch (e) {
    removeForward();
    throw new Error(
      `[mobile-chrome-android-driver] connectOverCDP(${endpointURL}) failed: ${e.message}. Confirm Chrome is open on the device + chrome://inspect/#devices lists it from your Mac.`,
      { cause: e },
    );
  }

  // CDP-attached browsers expose the existing tabs as contexts. We don't
  // create new ones (Mobile Chrome can have at most one window of tabs;
  // a new BrowserContext is silently ignored). Per-persona isolation is
  // approximated by per-persona Page within the existing context — good
  // enough for j09's single-persona web flows; future PR can stretch
  // this once we have multi-persona web Android scenarios.
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    removeForward();
    await browser.close().catch(() => {});
    throw new Error(
      '[mobile-chrome-android-driver] CDP returned 0 contexts — Chrome may be in incognito-only mode. Switch to a normal tab + retry.',
    );
  }
  const ctx = contexts[0];

  const pages = new Map();

  async function pageFor(name) {
    if (pages.has(name)) return pages.get(name);
    const page = await ctx.newPage();
    pages.set(name, page);
    return page;
  }

  const driver = {
    _browser: browser,
    _ctx: ctx,
    _port: port,
    _baseURL: baseURL,
    _pages: pages,
    pageFor,
  };

  // webRefreshRoomsList — same contract as the desktop web driver.
  driver.webRefreshRoomsList = async (name) => {
    try {
      const page = await pageFor(name);
      await page.goto(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-chrome-android-driver] webRefreshRoomsList(${name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  // webUiDump — visible text content for assertion matchers. Same shape
  // as the desktop driver so matchers can swap drivers transparently.
  driver.webUiDump = async () => {
    try {
      const page = await pageFor('default');
      if (!page.url() || page.url() === 'about:blank')
        await page.goto(`${baseURL.replace(/\/$/, '')}/`);
      // Note: await before return so the try/catch actually catches a
      // rejected evaluate (a bare `return page.evaluate(...)` escapes
      // the catch since the rejection happens after this function's
      // microtask boundary).
      return await page.evaluate(() => document.body.innerText || '');
    } catch (e) {
      console.error(`[mobile-chrome-android-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  // takeScreenshot — gap C3. Delegates to shared helper.
  driver.takeScreenshot = async (outputDir) =>
    require('./driver-screenshot-helper').takeScreenshotForPages(
      pages,
      outputDir,
      'mobile-chrome-android',
    );

  driver.close = async () => {
    for (const p of pages.values()) {
      try {
        await p.close();
      } catch (_e) {
        /* best-effort */
      }
    }
    try {
      await browser.close();
    } catch (_e) {
      /* best-effort — CDP-attached close can race with device-side teardown */
    }
    removeForward();
  };

  return driver;
}

// Canonical method surface — the runner-vocabulary methods this driver
// implements (close() is intentionally excluded; it's lifecycle, not a
// runner step-binding). Pinned by tests/scripts/drivers/driver-contract.test.js.
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump', 'takeScreenshot'];

function listMethods() {
  return [...new Set(WEB_MOBILE_METHOD_NAMES)].sort();
}

module.exports = {
  KNOWN_ADB_PATHS,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward,
  createMobileChromeAndroidDriver,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
};
