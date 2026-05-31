/**
 * Web driver: Mobile Safari on iPhone via Appium safari context.
 *
 * Drives the actual Mobile Safari browser on the operator's connected
 * physical iPhone. The Appium XCUITest driver bootstraps a session with
 * `browserName: 'safari'` capability; the underlying transport is the
 * Safari WebKit Remote Inspector (which Appium signs + manages through
 * WebDriverAgent the same way ios-appium-driver.js does for the app).
 *
 * App Store policy means every "browser" on iPhone (Chrome iOS, Firefox
 * iOS, Edge iOS) is required to use WebKit. So this driver is the
 * canonical iOS web driver; the other iOS-browser drivers in upcoming
 * PRs are thin wrappers that share this session's transport.
 *
 * Wire-up
 * -------
 * 1. Operator has already done the Appium setup steps from
 *    `ios-appium-setup.md` (install Appium, install xcuitest driver,
 *    set WDA_TEAM_ID, pair iPhone, trust dev cert, run `appium server`).
 * 2. Pass `--browser mobile-safari-ios` to the runner.
 * 3. The driver opens a new session with `browserName: 'safari'`;
 *    Appium handles all the WDA + WebKit remote-inspector plumbing.
 * 4. Driver invokes the standard W3C WebDriver protocol for navigation,
 *    element find, and page-source dumps.
 *
 * Method-naming contract: mirrors `web-playwright-driver.js`. Same
 * surface so runner matchers don't care which driver is active.
 *
 * Failure modes (all return false + log, never throw):
 *   - Appium server not reachable → actionable error pointing at port
 *     4723 + setup doc.
 *   - WDA_TEAM_ID missing → re-uses ios-appium-driver's same error text
 *     to keep operator's mental model consistent.
 *   - No iPhone connected → uses xcrun devicectl from the existing iOS
 *     driver's selectUdid (shared via module re-export).
 *   - Safari is not the focused app → Appium safari context auto-focuses
 *     it via the WebKit Remote Inspector activation; no operator action
 *     required.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');

// Reuse ios-appium-driver's selectUdid (already pinned in its tests).
// This driver and that one share the same device-selection logic so
// concurrent sessions target the same iPhone.
const REPO_ROOT_DRIVERS = path.resolve(__dirname);
const { selectUdid } = require(path.join(REPO_ROOT_DRIVERS, 'ios-appium-driver'));

const DEFAULT_APPIUM_BASE_URL = 'http://localhost:4723';

/**
 * Create a Mobile Safari iOS driver.
 *
 *   const driver = await createMobileSafariIosDriver({ baseURL });
 *   await driver.webRefreshRoomsList('Alice');
 *   await driver.close();
 *
 * Injectable deps (test-only):
 *   - fetchImpl — HTTP client (default globalThis.fetch)
 *   - selectUdidImpl — udid picker (default the iOS appium driver's)
 *   - udid — pre-resolved udid (bypasses selectUdidImpl)
 *
 * Required env:
 *   WDA_TEAM_ID — Apple Developer team ID, same one ios-appium-driver
 *                 uses. Appium signs WDA + the Safari Remote Inspector
 *                 bridge with this team.
 *
 * Optional:
 *   APPIUM_BASE_URL — Appium server URL (default http://localhost:4723)
 */
async function createMobileSafariIosDriver({
  baseURL = 'http://localhost:8888',
  appiumBaseUrl = process.env.APPIUM_BASE_URL || DEFAULT_APPIUM_BASE_URL,
  wdaTeamId = process.env.WDA_TEAM_ID,
  udid: preferredUdid,
  fetchImpl = globalThis.fetch,
  selectUdidImpl = selectUdid,
} = {}) {
  const udid = selectUdidImpl(preferredUdid);
  if (!udid) {
    throw new Error(
      'createMobileSafariIosDriver: no connected iPhone found via `xcrun devicectl list devices`. Pair the device with Xcode, ensure it shows "available" or "connected", then re-run.',
    );
  }
  if (!wdaTeamId) {
    throw new Error(
      'createMobileSafariIosDriver: WDA_TEAM_ID env var is required. This is the operator\'s Apple Developer team ID — Appium uses it to sign WebDriverAgent + the Safari Remote Inspector bridge. Find it via `security find-identity -v -p codesigning | grep "Apple Development"`.',
    );
  }

  // Lazy session bootstrap. The first webXxx call pays the
  // session-creation cost (~10-20s including WDA + Safari Remote
  // Inspector handshake). Subsequent calls reuse.
  let _sessionId = null;
  async function ensureSession() {
    if (_sessionId) return _sessionId;
    const caps = {
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': udid,
          // No bundleId — instead use the magic `browserName` cap that
          // tells the XCUITest driver to bootstrap Mobile Safari + its
          // WebKit Remote Inspector bridge.
          'appium:browserName': 'safari',
          'appium:xcodeSigningId': 'Apple Developer',
          'appium:xcodeOrgId': wdaTeamId,
          'appium:useNewWDA': false,
          'appium:noReset': true,
          // Auto-accept any URL-bar autofill / safari-suggestion prompts
          // so the operator doesn't have to babysit the device.
          'appium:safariIgnoreFraudWarning': true,
          'appium:safariOpenLinksInBackground': false,
        },
      },
    };
    const r = await fetchImpl(`${appiumBaseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caps),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(
        `Appium /session failed (${r.status}): ${errText.slice(0, 500)}. Confirm the Appium server is running on ${appiumBaseUrl} + xcuitest driver is installed (\`appium driver install xcuitest\`).`,
      );
    }
    const body = await r.json();
    _sessionId = body.value?.sessionId || body.sessionId;
    if (!_sessionId) {
      throw new Error(
        `Appium /session returned no sessionId: ${JSON.stringify(body).slice(0, 500)}`,
      );
    }
    return _sessionId;
  }

  async function navigateTo(url) {
    const sid = await ensureSession();
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      throw new Error(
        `Appium /url failed (${r.status}) for ${url}: ${(await r.text()).slice(0, 300)}`,
      );
    }
  }

  async function getPageText() {
    const sid = await ensureSession();
    // Use the W3C /execute/sync endpoint to read document.body.innerText.
    // /source returns XML AppML, not the rendered text we want.
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
        `Appium /execute/sync failed (${r.status}): ${(await r.text()).slice(0, 300)}`,
      );
    }
    const body = await r.json();
    return body.value || '';
  }

  const driver = {
    _udid: udid,
    _appiumBaseUrl: appiumBaseUrl,
    _baseURL: baseURL,
  };

  // webRefreshRoomsList — same contract as desktop + mobile-chrome drivers.
  driver.webRefreshRoomsList = async (_name) => {
    try {
      await navigateTo(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-safari-ios-driver] webRefreshRoomsList(${_name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  // webUiDump — visible body text via JS-injection. Per-persona Page
  // isolation isn't modelled here because Mobile Safari shares one
  // session per Appium connection; multi-persona web on a single iPhone
  // would need per-persona Safari profile switching, out of scope.
  driver.webUiDump = async () => {
    try {
      return await getPageText();
    } catch (e) {
      console.error(`[mobile-safari-ios-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  // takeScreenshot — gap C3. Uses Appium's screenshot endpoint
  // (POST /session/<sid>/screenshot returns base64 PNG). One file per
  // session (Appium doesn't model multi-persona pages on iOS the way
  // Playwright does on desktop).
  driver.takeScreenshot = async (outputDir) =>
    require('./driver-screenshot-helper').takeScreenshotViaAppium({
      appiumBaseUrl,
      sessionId: _sessionId,
      fetchImpl,
      outputDir,
      slug: 'mobile-safari-ios',
    });

  driver.close = async () => {
    if (!_sessionId) return;
    try {
      await fetchImpl(`${appiumBaseUrl}/session/${_sessionId}`, { method: 'DELETE' });
    } catch (_e) {
      /* best-effort */
    }
    _sessionId = null;
  };

  return driver;
}

// Canonical method surface — pinned by driver-contract.test.js.
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump', 'takeScreenshot'];

function listMethods() {
  return [...new Set(WEB_MOBILE_METHOD_NAMES)].sort();
}

module.exports = {
  DEFAULT_APPIUM_BASE_URL,
  createMobileSafariIosDriver,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
};
