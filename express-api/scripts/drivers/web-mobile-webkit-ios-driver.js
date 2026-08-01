/**
 * Web driver: Chrome iOS / Firefox iOS / Edge iOS — WebKit wrappers via
 * Appium safari context.
 *
 * App Store policy mandates every iOS browser use WebKit (the same
 * engine Mobile Safari uses). Chrome iOS / Firefox iOS / Edge iOS are
 * functionally WebKit wrappers — they ship distinct UI chrome (URL bar,
 * tabs, sync) but their page rendering is identical to Safari.
 *
 * From a matrix-completeness standpoint each is its own browser slug
 * — the OPERATOR's matrix lists them separately — but the transport is
 * the same Appium session pattern as web-mobile-safari-ios-driver.js,
 * just with `appium:bundleId` set to the per-browser app bundle.
 *
 * Strategy
 * --------
 * 1. Bootstrap an Appium XCUITest session with `bundleId: <browser>`
 *    (no `browserName: safari` — that would launch Safari instead).
 * 2. Wait for the launched browser app to load.
 * 3. Switch to the webview context (XCUITest exposes the WebKit Remote
 *    Inspector view as `WEBVIEW_<n>`).
 * 4. From webview context, the W3C `/url` + `/execute/sync` endpoints
 *    drive the WebKit content the same way as Safari.
 *
 * Method-naming contract: mirrors web-mobile-safari-ios-driver.js. The
 * runner doesn't care which iOS browser app it's driving — they all
 * produce identical WebKit-rendered pages.
 *
 * Local-matrix only — operator policy 2026-05-30 keeps dev/prod to
 * Chromium-only-plus-Chrome-on-Android.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');
const { boundedFetch, SESSION_TIMEOUT_MS } = require('./device-io-timeout');
const { createSurfaceBreaker } = require('./surface-circuit-breaker');

// Reuse ios-appium-driver's selectUdid for device-selection parity with
// the other iOS drivers (Safari + native app).
const REPO_ROOT_DRIVERS = path.resolve(__dirname);
const { selectUdid } = require(path.join(REPO_ROOT_DRIVERS, 'ios-appium-driver'));

const DEFAULT_APPIUM_BASE_URL = 'http://localhost:4723';

/**
 * Per-browser bundle IDs. These are the App Store identifiers for the
 * iOS apps. If Apple changes one (rare — App Store IDs are sticky),
 * update this map.
 *
 * `appName` is the operator-facing string used in error messages so the
 * setup hint makes sense ("Open Chrome iOS + grant permissions").
 */
const WEBKIT_BROWSERS = {
  chrome: {
    bundleId: 'com.google.chrome.ios',
    appName: 'Chrome iOS',
  },
  firefox: {
    bundleId: 'org.mozilla.ios.Firefox',
    appName: 'Firefox iOS',
  },
  edge: {
    bundleId: 'com.microsoft.msedge.ios',
    appName: 'Edge iOS',
  },
};

function isSupportedBrowser(browser) {
  return Object.prototype.hasOwnProperty.call(WEBKIT_BROWSERS, browser);
}

function supportedBrowsersList() {
  return Object.keys(WEBKIT_BROWSERS).sort();
}

/**
 * Driver factory.
 *
 *   const driver = await createMobileWebkitIosDriver({ browser: 'chrome', baseURL });
 *   await driver.webRefreshRoomsList('Alice');
 *   await driver.close();
 *
 * Required:
 *   browser — one of 'chrome' / 'firefox' / 'edge'.
 *
 * Injectable deps (test-only):
 *   fetchImpl, selectUdidImpl, udid (bypasses selectUdid).
 */
async function createMobileWebkitIosDriver({
  browser,
  baseURL = 'http://localhost:8888',
  appiumBaseUrl = process.env.APPIUM_BASE_URL || DEFAULT_APPIUM_BASE_URL,
  wdaTeamId = process.env.WDA_TEAM_ID,
  udid: preferredUdid,
  fetchImpl: rawFetch = globalThis.fetch,
  selectUdidImpl = selectUdid,
} = {}) {
  // BOUNDED — see device-io-timeout.js. Appium calls here carried no
  // timeout, and Node's fetch waits forever, so a dead WebDriverAgent
  // session hung this cell until the two-hour cell timeout.
  // Bounded AND breakered. The bound stops one call hanging forever; the
  // breaker stops the CELL grinding through hundreds of 30-second timeouts
  // once the surface is provably gone. Run 20260801-113726-local did exactly
  // that after Appium destroyed the session.
  const surfaceBreaker = createSurfaceBreaker({ label: 'mobile-webkit-ios' });
  const boundedRawFetch = boundedFetch(rawFetch, { label: 'mobile-webkit-ios' });
  const fetchImpl = (url, init) => surfaceBreaker.run(() => boundedRawFetch(url, init));
  if (!isSupportedBrowser(browser)) {
    throw new Error(
      `createMobileWebkitIosDriver: browser "${browser}" is not supported. Use one of: ${supportedBrowsersList().join(', ')}.`,
    );
  }
  const { bundleId, appName } = WEBKIT_BROWSERS[browser];

  // Cheap env validation FIRST, device probe second: a no-device
  // environment (CI, phone unplugged) must surface the missing env var,
  // not a misleading "no physical iPhone" for what is a config gap —
  // and the probe shells out to xcrun, so failing early is also faster.
  if (!wdaTeamId) {
    throw new Error(
      `createMobileWebkitIosDriver(${browser}): WDA_TEAM_ID env var is required. This is the operator's Apple Developer team ID — Appium uses it to sign WebDriverAgent + the WebKit Remote Inspector bridge.`,
    );
  }
  const udid = selectUdidImpl(preferredUdid);
  if (!udid) {
    // Stable `code` → matrix-dispatch isInitError skips (not fails) on no-device.
    throw Object.assign(
      new Error(
        `createMobileWebkitIosDriver(${browser}): no physical iPhone found via \`xcrun xctrace list devices\`. Connect + trust the device (it may show under "Devices Offline" on iOS 26/27 — still usable).`,
      ),
      { code: 'DRIVER_INIT_FAILED' },
    );
  }

  let _sessionId = null;

  async function ensureSession() {
    if (_sessionId) return _sessionId;
    const caps = {
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          // Appium DESTROYS a session after `newCommandTimeout` seconds with
          // no command, and the default is SIXTY. A journey scenario routinely
          // spends longer than that between device calls — it seeds Firestore,
          // calls the API, waits on assertions — so the session was being
          // killed mid-scenario through no fault of the device, and every call
          // afterwards failed. Measured on run 20260801-113726-local: the iOS
          // cell spent the rest of the run timing out at 30s per call against
          // a session that no longer existed.
          //
          // 0 means "never expire": the cell owns the device for the whole
          // run, and the driver's close() is what should end the session.
          'appium:newCommandTimeout': 0,
          'appium:automationName': 'XCUITest',
          'appium:udid': udid,
          // Launch the specific browser app via bundleId — distinct
          // from Safari's `browserName: 'safari'` capability. Once the
          // app is up we switch to its webview context.
          'appium:bundleId': bundleId,
          // "Apple Development" is the modern signing-cert name; "Apple
          // Developer" matches no certificate and fails the WDA rebuild
          // with xcodebuild code 65 (live-proven 2026-07-12; parity with
          // ios-appium-driver's identical fix).
          'appium:xcodeSigningId': 'Apple Development',
          'appium:xcodeOrgId': wdaTeamId,
          // Reuse the installed WDA by default; IOS_FORCE_NEW_WDA=true
          // forces a fresh build+install after a signing/config change
          // (else Appium launches the stale WDA → "connection refused
          // to port 8100"). Same contract as ios-appium-driver.
          'appium:useNewWDA': process.env.IOS_FORCE_NEW_WDA === 'true',
          'appium:noReset': true,
          // Auto-launch the app (default true, explicit for clarity).
          'appium:autoLaunch': true,
        },
      },
    };
    const r = await fetchImpl(`${appiumBaseUrl}/session`, {
      // WDA install/launch is legitimately slow on a cold device.
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caps),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(
        `Appium /session failed (${r.status}) for ${appName}: ${errText.slice(0, 500)}. Confirm the Appium server is on ${appiumBaseUrl}, the xcuitest driver is installed, and ${appName} is installed on the iPhone.`,
      );
    }
    const body = await r.json();
    _sessionId = body.value?.sessionId || body.sessionId;
    if (!_sessionId) {
      throw new Error(
        `Appium /session for ${appName} returned no sessionId: ${JSON.stringify(body).slice(0, 500)}`,
      );
    }
    return _sessionId;
  }

  /**
   * Switch to the first available WebKit webview context. iOS browsers
   * expose their WebKit page as a `WEBVIEW_<n>` context once a page is
   * loaded — listing /contexts and picking the first non-`NATIVE_APP`.
   *
   * Called automatically before any web operation; cached so subsequent
   * web ops don't re-switch.
   */
  let _onWebviewContext = false;
  async function ensureWebviewContext() {
    if (_onWebviewContext) return;
    const sid = await ensureSession();
    const ctxResp = await fetchImpl(`${appiumBaseUrl}/session/${sid}/contexts`);
    if (!ctxResp.ok) {
      throw new Error(
        `Appium /contexts failed (${ctxResp.status}) for ${appName}: ${(await ctxResp.text()).slice(0, 300)}`,
      );
    }
    const ctxBody = await ctxResp.json();
    const contexts = Array.isArray(ctxBody.value) ? ctxBody.value : [];
    const webview = contexts.find((c) => c.startsWith('WEBVIEW_'));
    if (!webview) {
      throw new Error(
        `Appium /contexts for ${appName} returned no WEBVIEW_ context (got [${contexts.join(', ')}]). ${appName} may not have loaded any page yet; navigate first or grant developer-mode permission in iPhone Settings → Safari → Advanced → Web Inspector ON.`,
      );
    }
    const switchResp = await fetchImpl(`${appiumBaseUrl}/session/${sid}/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: webview }),
    });
    if (!switchResp.ok) {
      throw new Error(
        `Appium context switch to ${webview} failed (${switchResp.status}) for ${appName}: ${(await switchResp.text()).slice(0, 300)}`,
      );
    }
    _onWebviewContext = true;
  }

  async function navigateTo(url) {
    const sid = await ensureSession();
    await ensureWebviewContext();
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      throw new Error(
        `Appium /url failed (${r.status}) for ${appName} → ${url}: ${(await r.text()).slice(0, 300)}`,
      );
    }
  }

  async function getPageText() {
    const sid = await ensureSession();
    await ensureWebviewContext();
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/execute/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        script: 'return document.body.innerText || "";',
        args: [],
      }),
    });
    if (!r.ok) {
      throw new Error(
        `Appium /execute/sync failed (${r.status}) for ${appName}: ${(await r.text()).slice(0, 300)}`,
      );
    }
    const body = await r.json();
    return body.value || '';
  }

  const driver = {
    _browser: browser,
    _bundleId: bundleId,
    _appName: appName,
    _udid: udid,
    _appiumBaseUrl: appiumBaseUrl,
    _baseURL: baseURL,
  };

  driver.webRefreshRoomsList = async (_name) => {
    try {
      await navigateTo(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-webkit-ios-driver(${browser})] webRefreshRoomsList(${_name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  driver.webUiDump = async () => {
    try {
      return await getPageText();
    } catch (e) {
      console.error(`[mobile-webkit-ios-driver(${browser})] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  // takeScreenshot — gap C3. Uses Appium's screenshot endpoint.
  // Browser name is part of the slug (mobile-<browser>-ios) so each
  // browser-app variant gets a distinct artifact filename.
  driver.takeScreenshot = async (outputDir) =>
    require('./driver-screenshot-helper').takeScreenshotViaAppium({
      appiumBaseUrl,
      sessionId: _sessionId,
      fetchImpl,
      outputDir,
      slug: `mobile-${browser}-ios`,
    });

  driver.close = async () => {
    if (!_sessionId) return;
    try {
      await fetchImpl(`${appiumBaseUrl}/session/${_sessionId}`, { method: 'DELETE' });
    } catch (_e) {
      /* best-effort */
    }
    _sessionId = null;
    _onWebviewContext = false;
  };

  // SHY-0259 second pass: the shared web surface. Built on this driver's own
  // Appium /execute/sync channel, so every web method the corpus calls works
  // here too instead of failing as `not configured`.
  require('./web-common-methods').attachCommonWebMethods(driver, {
    slug: 'mobile-webkit-ios',
    baseURL,
    navigate: async (u) => {
      try {
        await navigateTo(u);
        return true;
      } catch (e) {
        console.error('[mobile-webkit-ios] navigate failed: ' + e.message);
        return false;
      }
    },
    evaluate: async (src, arg) => {
      const sid = await ensureSession();
      const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/execute/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'return (' + src + ').apply(null, arguments);',
          args: [arg],
        }),
      });
      if (!r.ok) throw new Error(`execute/sync ${r.status}`);
      const body = await r.json();
      return body.value;
    },
  });

  return driver;
}

// Canonical method surface — pinned by driver-contract.test.js.
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump', 'takeScreenshot'];

function listMethods() {
  return [...new Set(WEB_MOBILE_METHOD_NAMES)].sort();
}

module.exports = {
  DEFAULT_APPIUM_BASE_URL,
  WEBKIT_BROWSERS,
  isSupportedBrowser,
  supportedBrowsersList,
  createMobileWebkitIosDriver,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
};
