/* global document */
/**
 * Web driver: Mobile Edge on Android via CDP-over-adb.
 *
 * Mobile Edge is Microsoft's Chromium fork. It exposes the same CDP
 * unix socket pattern as Chrome — just under a different socket name.
 * Reuses the shared `bootstrapAdbForward` helper from
 * `android-cdp-helpers.js` with Edge's socket name. Mechanically
 * identical to web-mobile-samsung-android-driver.js modulo the socket
 * + operator-hint strings.
 *
 * Wire-up
 * -------
 * 1. Operator enables USB debugging on the Android device.
 * 2. Operator opens Mobile Edge → Settings → "About Microsoft Edge"
 *    → tap the version 5 times to surface developer mode → enable
 *    "USB Web Debugging". One-time per device.
 * 3. Driver runs `adb forward tcp:<port>
 *    localabstract:com.microsoft.emmx_devtools_remote`.
 * 4. Driver calls `playwright.chromium.connectOverCDP(endpointURL)` —
 *    works because Mobile Edge IS Chromium under the hood.
 *
 * Method-naming contract: mirrors web-mobile-chrome-android-driver.js
 * (and through it, the desktop web driver). Runner matchers swap
 * transparently.
 *
 * Local-matrix only — operator policy 2026-05-30 keeps dev/prod to
 * Chromium-only-plus-Chrome-on-Android.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');
const { bootstrapAdbForward } = require('./android-cdp-helpers');

const EDGE_CDP_SOCKET = 'com.microsoft.emmx_devtools_remote';

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
 * Driver factory. Mirrors createMobileSamsungAndroidDriver — same
 * injectable deps, same method surface, just routes through Edge's
 * CDP socket.
 */
async function createMobileEdgeAndroidDriver({
  baseURL = 'http://localhost:8888',
  adbPath,
  execFileSync,
  playwrightImpl,
  pickPort,
} = {}) {
  const { port, removeForward } = await bootstrapAdbForward({
    socketName: EDGE_CDP_SOCKET,
    browserNameHint: 'Microsoft Edge',
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
      `[mobile-edge-android-driver] connectOverCDP(${endpointURL}) failed: ${e.message}. Confirm Mobile Edge is open on the device + "USB Web Debugging" is enabled in its Developer Settings (tap About-Edge version 5 times).`,
      { cause: e },
    );
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    removeForward();
    await browser.close().catch(() => {});
    throw new Error(
      '[mobile-edge-android-driver] CDP returned 0 contexts — Mobile Edge may be in InPrivate mode only. Switch to a normal tab + retry.',
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

  driver.webRefreshRoomsList = async (name) => {
    try {
      const page = await pageFor(name);
      await page.goto(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-edge-android-driver] webRefreshRoomsList(${name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  driver.webUiDump = async () => {
    try {
      const page = await pageFor('default');
      if (!page.url() || page.url() === 'about:blank')
        await page.goto(`${baseURL.replace(/\/$/, '')}/`);
      // Note: await before return so the try/catch actually catches a
      // rejected evaluate.
      return await page.evaluate(() => document.body.innerText || '');
    } catch (e) {
      console.error(`[mobile-edge-android-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  // takeScreenshot — gap C3. Delegates to shared helper.
  driver.takeScreenshot = async (outputDir) =>
    require('./driver-screenshot-helper').takeScreenshotForPages(
      pages,
      outputDir,
      'mobile-edge-android',
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
      /* best-effort */
    }
    removeForward();
  };

  return driver;
}

// Canonical method surface — pinned by driver-contract.test.js.
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump', 'takeScreenshot'];

function listMethods() {
  return [...new Set(WEB_MOBILE_METHOD_NAMES)].sort();
}

module.exports = {
  EDGE_CDP_SOCKET,
  createMobileEdgeAndroidDriver,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
};
