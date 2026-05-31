/* global document */
/**
 * Web driver: Samsung Internet on Android via CDP-over-adb.
 *
 * Samsung Internet is the default browser on Samsung devices (~70% of
 * Android market share in some regions). It's a Chromium fork that
 * exposes the same Chrome DevTools Protocol unix socket pattern as
 * Chrome — just under a different socket name. Reuses the shared
 * `bootstrapAdbForward` helper from android-cdp-helpers.js with
 * Samsung's socket name.
 *
 * Wire-up
 * -------
 * 1. Operator enables USB debugging on the Android device.
 * 2. Operator opens Samsung Internet → menu → Settings → "Useful
 *    features" → "Web Browser Developer Settings" → enable "USB Debugging
 *    of WebViews". One-time per device.
 * 3. Driver runs `adb forward tcp:<port>
 *    localabstract:com.sec.android.app.sbrowser_devtools_remote` so
 *    localhost:<port> tunnels into Samsung Internet's CDP socket.
 * 4. Driver calls `playwright.chromium.connectOverCDP(endpointURL)` —
 *    works because Samsung Internet IS Chromium under the hood.
 *
 * Method-naming contract: mirrors web-mobile-chrome-android-driver.js
 * (and through it, the desktop web driver). Runner matchers swap
 * transparently.
 *
 * Local-matrix only — operator policy 2026-05-30 keeps dev/prod
 * matrices to Chromium-only-plus-Chrome-on-Android. Samsung is part of
 * the broader local cross-browser net.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');
const { bootstrapAdbForward } = require('./android-cdp-helpers');

const SAMSUNG_CDP_SOCKET = 'com.sec.android.app.sbrowser_devtools_remote';

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
 * Driver factory. Mirrors createMobileChromeAndroidDriver — same
 * injectable deps, same method surface, just routes through Samsung's
 * CDP socket.
 */
async function createMobileSamsungAndroidDriver({
  baseURL = 'http://localhost:8888',
  adbPath,
  execFileSync,
  playwrightImpl,
  pickPort,
} = {}) {
  const { port, removeForward } = await bootstrapAdbForward({
    socketName: SAMSUNG_CDP_SOCKET,
    browserNameHint: 'Samsung Internet',
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
      `[mobile-samsung-android-driver] connectOverCDP(${endpointURL}) failed: ${e.message}. Confirm Samsung Internet is open on the device + "USB Debugging of WebViews" is enabled in its Developer Settings.`,
      { cause: e },
    );
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    removeForward();
    await browser.close().catch(() => {});
    throw new Error(
      '[mobile-samsung-android-driver] CDP returned 0 contexts — Samsung Internet may be in Secret Mode only. Switch to a normal tab + retry.',
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
        `[mobile-samsung-android-driver] webRefreshRoomsList(${name}) failed: ${e.message}`,
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
      console.error(`[mobile-samsung-android-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

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
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump'];

function listMethods() {
  return [...new Set(WEB_MOBILE_METHOD_NAMES)].sort();
}

module.exports = {
  SAMSUNG_CDP_SOCKET,
  createMobileSamsungAndroidDriver,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
};
