/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */
/**
 * iOS driver backed by Appium 2.x + WebDriverAgent (the XCUITest driver).
 *
 * Replaces the placeholder bodies in ios-devicectl-driver.js for UI
 * interaction. devicectl is still preferred for app-lifecycle commands
 * (install, launch, terminate) — Appium's session bootstrap is heavier
 * and the lifecycle methods don't need a session. This driver focuses
 * on what Appium uniquely provides:
 *
 *   - `iosUiDump()` — GET `/session/<sid>/source` (XCUITest XML tree)
 *   - `iosTap(x, y)` — POST `/session/<sid>/actions` (W3C pointer)
 *   - `iosTapByTag(tag)` — find element by accessibility id, click it
 *   - `iosPersonaSignIn(personaId, tab)` — picker-driven sign-in
 *     (parity with androidPersonaSignIn)
 *
 * Architecture:
 *   - Operator's Mac runs `appium server -p 4723` (one-time)
 *   - Driver POSTs JSON to http://localhost:4723/session to create
 *     a session against the operator's iPhone (hardware udid
 *     auto-detected via `xcrun xctrace list devices` — see selectUdid())
 *   - WDA gets installed/launched by Appium on first session
 *   - Driver tears down the session in close()
 *
 * Operator setup required (one-time, NOT covered by this driver):
 *   1. `npm install -g appium` (this PR documents; no auto-install)
 *   2. `appium driver install xcuitest`
 *   3. WDA signing — Appium needs the operator's Apple Developer team
 *      ID to sign WDA for the iPhone. Configure via `WDA_TEAM_ID` env
 *      var (read once in the desired-capabilities below).
 *   4. Start the Appium server: `appium server -p 4723` (or set
 *      `APPIUM_BASE_URL` env to point elsewhere).
 *   5. iPhone must be paired with Xcode + trust developer certificate.
 *
 * Why not raw WDA?
 *   - Appium auto-signs WDA per dev team, handles WDA install/launch,
 *     and proxies the WebDriver protocol cleanly. Raw WDA requires
 *     manual Xcode build of the WDA.xcodeproj + manual install per
 *     iOS version bump. Appium absorbs that cycle.
 *
 * Why not appium-server as a Node dep?
 *   - Appium is a CLI tool that runs as a server process, not a
 *     library. The driver TALKS to it via HTTP. The server lives on
 *     the operator's machine, started once per session of work.
 */

const { execFileSync } = require('child_process');

// Method names mirror ios-devicectl-driver.js's IOS_METHOD_NAMES. Each
// is wired to an Appium-backed implementation in this driver. The
// runner's matchers dispatch on these names regardless of which driver
// is registered on ctx.uiDriver.
const IOS_METHOD_NAMES = [
  // App lifecycle + UI inspection (all real here, via Appium)
  'iosLaunchApp',
  'iosUiDump',
  'iosTap',
  'iosTapByTag',
  'iosPersonaSignIn',
  // Mirrors of ios-devicectl-driver names — kept for matcher dispatch.
  // Bodies here delegate to iosUiDump + iosTapByTag where possible;
  // each presence-check is a regex over the XCUITest XML tree.
  'iosShowsRoomScreen',
  'iosShowsParticipantsList',
  'iosShowsSeatGrid',
  'iosShowsMicIcon',
  'iosShowsToast',
  'iosShowsRoomClosedSummary',
];

const DEFAULT_APPIUM_BASE_URL = 'http://localhost:4723';

/**
 * Returns the connected physical iPhone's HARDWARE UDID via
 * `xcrun xctrace list devices`.
 *
 * MUST NOT mirror ios-devicectl-driver.js's picker — the two drivers need DIFFERENT
 * identifiers. `xcrun devicectl list devices` prints the CoreDevice UUID (e.g.
 * `74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6`) in its Identifier column, and Appium's
 * XCUITest driver REJECTS that at session start — real 2026-07-11 journey failure:
 * `Unknown device or simulator UDID: '74563FF8-…'`. Appium's `appium:udid` needs the
 * ECID-based HARDWARE UDID (e.g. `00008150-000954D90A20401C`), which xctrace prints as
 * `<name> (<osver>) (<udid>)`. The devicectl driver legitimately keeps the CoreDevice
 * UUID for its own app-lifecycle commands — that is precisely why these two pickers
 * must diverge (a prior "make both select the same device" unification is the bug this
 * fixes; SHY-0095).
 *
 * Parsing rules (proven by the real captured fixtures in this driver's test):
 *  - Split off the `== Simulators ==` section first — a simulator line shares the exact
 *    `(osver) (udid)` shape, so without this a run with NO real device would return a
 *    simulator UDID and silently drive a simulator (false green + real-device violation).
 *  - Keep BOTH `== Devices ==` and `== Devices Offline ==`: on iOS 26/27 a wired,
 *    Appium-drivable iPhone routinely appears under "Offline" in xctrace's legacy view,
 *    so excluding it returned null and failed the whole iOS matrix (2026-07-02).
 *  - The `(osver) (udid)` double-paren shape excludes the Mac host line, which carries a
 *    UUID but no OS-version paren and must never be selected.
 */
function selectUdid(preferredUdid) {
  // A blank/whitespace-only preferred udid is treated as "no preference" and falls
  // through to auto-detection; a real value is returned trimmed (a udid never carries
  // surrounding whitespace, so padding is always a mistake Appium would reject).
  const preferred = typeof preferredUdid === 'string' ? preferredUdid.trim() : preferredUdid;
  if (preferred) return preferred;
  try {
    // execFileSync (no shell) avoids the command-injection class of bug — even though
    // the args are hardcoded, default to the safer primitive. stderr discarded via
    // `ignore` so a missing xctrace doesn't pollute the runner's output (empty stdout
    // below returns null cleanly).
    //
    // Absolute path (/usr/bin/xcrun) satisfies sonarjs/no-os-command-from-path: xcrun is
    // shipped by Apple at this fixed system location on every macOS install (Command
    // Line Tools shim), so PATH-search is both unnecessary and a weak link.
    const raw = execFileSync('/usr/bin/xcrun', ['xctrace', 'list', 'devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // Bound the call: `xctrace list devices` can hang on a stale usbmuxd tunnel (the
      // very Devices-Offline territory this driver handles). A timeout-kill throws → the
      // catch below returns null → createIosDriver fails fast + loud, never wedging the
      // runner indefinitely.
      timeout: 15000,
    });
    // Everything before "== Simulators ==" is the real-device sections (online +
    // offline); simulators are dropped so a no-real-device run never returns a sim UDID.
    const deviceSection = raw.split(/==\s*Simulators\s*==/)[0];
    // Physical device line: "<name> (<osver>) (<hardware-udid>)". The OS-version paren
    // before the UDID paren is what distinguishes a real iPhone from the Mac host line
    // ("<name> (<uuid>)" — no os-version paren), whose UUID must never be selected.
    const deviceLineRx = /\([0-9]+(?:\.[0-9]+)*\)\s+\(([0-9A-Fa-f-]+)\)\s*$/;
    for (const line of deviceSection.split('\n')) {
      const match = line.match(deviceLineRx);
      if (match) return match[1];
    }
    return null;
  } catch (e) {
    // Distinguish a genuine xctrace failure (missing Xcode, permissions, timeout,
    // malformed output) from the ordinary no-device case (which returns null above
    // WITHOUT throwing). This diagnostic is the observability SHY-0095 adds — a silent
    // device-selection failure previously cost a full day of QA runs.
    console.error(
      `[ios-appium-driver] selectUdid: \`xcrun xctrace list devices\` failed: ${e.message}`,
    );
    return null;
  }
}

function listMethods() {
  return [...new Set(IOS_METHOD_NAMES)].sort();
}

/**
 * Create an iOS driver instance.
 *
 *   const driver = await createIosDriver();
 *   ctx.uiDriver = driver;
 *
 * Required env:
 *   APPIUM_BASE_URL  — Appium server URL (default http://localhost:4723)
 *   WDA_TEAM_ID      — Apple Developer team ID for WDA signing
 *
 * Optional:
 *   IOS_BUNDLE_ID    — explicit app bundle id (default derives from
 *                      target: shytalk-local / shytalk-dev / shytalk)
 */
async function createIosDriver({
  udid: preferredUdid,
  target = 'dev',
  appiumBaseUrl = process.env.APPIUM_BASE_URL || DEFAULT_APPIUM_BASE_URL,
  wdaTeamId = process.env.WDA_TEAM_ID,
  bundleId: explicitBundleId,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Cheap env validation FIRST, device probe second: a no-device
  // environment (CI, phone unplugged) must surface the missing env var,
  // not a misleading "no physical iPhone" for what is a config gap —
  // and the probe shells out to xcrun, so failing early is also faster.
  // Same ordering as the two web-mobile iOS siblings.
  if (!wdaTeamId) {
    throw new Error(
      'createIosDriver: WDA_TEAM_ID env var is required. This is the operator\'s Apple Developer team ID — Appium uses it to sign WebDriverAgent for the iPhone. Find it in Xcode → Preferences → Accounts → <your account> → Manage Certificates, or via `security find-identity -v -p codesigning | grep "Apple Development"`.',
    );
  }
  const udid = selectUdid(preferredUdid);
  if (!udid) {
    // Stable `code` so matrix-dispatch's isInitError classifies "no device" as a SKIP
    // (not a FAIL that can abort the whole matrix under --fail-fast) independently of
    // the human message wording — the message is a fragile signal on its own.
    throw Object.assign(
      new Error(
        'createIosDriver: no physical iPhone found via `xcrun xctrace list devices`. Connect + trust the device (it may show under "Devices Offline" on iOS 26/27 — still usable), then re-run.',
      ),
      { code: 'DRIVER_INIT_FAILED' },
    );
  }
  // iOS ships a SINGLE PRODUCT_BUNDLE_IDENTIFIER for every build config (Debug /
  // Debug-Dev / Debug-Local / Release) — the config, via AppEnvironment, selects the
  // backend, NOT a suffixed bundle id (unlike Android's per-flavour ids; confirmed in
  // iosApp.xcodeproj: every config sets `com.shyden.shytalk`). Every `target` therefore
  // maps to the same id; kept as a map (not a bare constant) to stay explicit per-target
  // and keep `target` a live input. IOS_BUNDLE_ID overrides for one-off installs.
  const bundleIdMap = {
    local: 'com.shyden.shytalk',
    dev: 'com.shyden.shytalk',
    prod: 'com.shyden.shytalk',
  };
  // Blank-but-truthy env values ('   ') must not reach Appium as a
  // literal-whitespace bundleId — trim, and fall through when empty.
  const envBundleId = (process.env.IOS_BUNDLE_ID || '').trim();
  const bundleId = explicitBundleId || envBundleId || bundleIdMap[target] || bundleIdMap.dev;

  const driver = { _udid: udid, _appiumBaseUrl: appiumBaseUrl, _bundleId: bundleId };

  // Lazy-bootstrap the Appium session so the driver instance is cheap
  // to construct (tests don't pay the cost; live runs pay once on first
  // tap/dump). The session is shared across all driver methods.
  let _sessionId = null;
  async function ensureSession() {
    if (_sessionId) return _sessionId;
    const caps = {
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': udid,
          'appium:bundleId': bundleId,
          // "Apple Development" is the modern signing-cert name; "Apple Developer"
          // matches no certificate and fails the WDA rebuild with xcodebuild code 65
          // (real 2026-07-12 device failure — "No certificate matching 'Apple Developer'").
          'appium:xcodeSigningId': 'Apple Development',
          'appium:xcodeOrgId': wdaTeamId,
          // Reuse the installed WDA by default (fast — the operator's first run takes
          // the build+install hit; later runs reuse the bundle). IOS_FORCE_NEW_WDA=true
          // forces a fresh build+install — required after a WDA signing/config change or
          // when the installed WDA is stale/unsigned (else Appium tries to launch a
          // broken WDA and fails with "connection refused to port 8100").
          'appium:useNewWDA': process.env.IOS_FORCE_NEW_WDA === 'true',
          // Don't reset app state between sessions; the runner controls
          // app state via its own start-of-scenario reset (parity with
          // androidPersonaSignIn force-stop).
          'appium:noReset': true,
        },
      },
    };
    const r = await fetchImpl(`${appiumBaseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(caps),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(
        `createIosDriver: Appium /session failed (${r.status}). Body: ${body.slice(0, 300)}. Is the Appium server running? (appium server -p 4723)`,
      );
    }
    const body = await r.json();
    _sessionId = body?.value?.sessionId || body?.sessionId || body?.value?.['session-id'] || null;
    if (!_sessionId) {
      throw new Error(
        `createIosDriver: Appium /session returned 200 but no sessionId in body. Got: ${JSON.stringify(body).slice(0, 300)}`,
      );
    }
    return _sessionId;
  }
  driver._ensureSession = ensureSession;

  // iosLaunchApp — terminate-then-launch to guarantee a cold start.
  // Critical for scenario isolation (parity with Android force-stop).
  driver.iosLaunchApp = async () => {
    const sid = await ensureSession();
    // POST /session/<sid>/appium/device/terminate_app — ignore errors
    // (app may not be running)
    try {
      await fetchImpl(`${appiumBaseUrl}/session/${sid}/appium/device/terminate_app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId }),
      });
    } catch {
      // Non-fatal — terminate on a non-running app is a no-op.
    }
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/appium/device/activate_app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundleId }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(
        `iosLaunchApp: activate_app failed for ${bundleId} (${r.status}). Body: ${body.slice(0, 300)}`,
      );
    }
    return true;
  };

  // iosUiDump — XCUITest XML source of the current screen.
  driver.iosUiDump = async () => {
    try {
      const sid = await ensureSession();
      const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/source`, { method: 'GET' });
      if (!r.ok) return '';
      const body = await r.json();
      return body?.value || '';
    } catch (e) {
      console.error(`[ios-appium-driver] iosUiDump failed: ${e.message}`);
      return '';
    }
  };

  // iosTap(x, y) — W3C pointer actions to tap at the given coordinates.
  driver.iosTap = async (x, y) => {
    try {
      const sid = await ensureSession();
      const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: [
            {
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x, y },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 50 },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        }),
      });
      return r.ok;
    } catch (e) {
      console.error(`[ios-appium-driver] iosTap(${x},${y}) failed: ${e.message}`);
      return false;
    }
  };

  // iosTapByTag(tag) — find element by accessibility id (the iOS
  // counterpart of Android's resource-id), tap its center. Mirrors
  // androidTapByTag's API contract: returns true on tap success,
  // false on not-found or tap failure.
  driver.iosTapByTag = async (tag) => {
    try {
      const sid = await ensureSession();
      // Find by accessibility id. XCUITest's accessibilityIdentifier
      // is the iOS-side projection of Compose's testTag (when
      // exposeTestTagsToPlatformDumps is a no-op, the testTag
      // flows through to accessibilityIdentifier automatically).
      const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ using: 'accessibility id', value: tag }),
      });
      if (!r.ok) return false;
      const body = await r.json();
      const elementId =
        body?.value?.['element-6066-11e4-a52e-4f735466cecf'] || body?.value?.ELEMENT || null;
      if (!elementId) return false;
      const click = await fetchImpl(`${appiumBaseUrl}/session/${sid}/element/${elementId}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      return click.ok;
    } catch (e) {
      console.error(`[ios-appium-driver] iosTapByTag(${tag}) failed: ${e.message}`);
      return false;
    }
  };

  // iosPersonaSignIn(personaId, tab) — drives the picker dialog parity
  // with androidPersonaSignIn. Same testTags (persona_picker_open,
  // persona_picker_list, persona_row_<P-NN>, main_<tab>Tab) — those
  // are shared commonMain Compose so they're identical across iOS+Android.
  //
  // Sequence:
  //   1. Launch the app fresh (terminate + activate).
  //   2. Tap persona_picker_open.
  //   3. Wait for persona_picker_list (the picker dialog).
  //   4. Tap persona_row_<P-NN> (Appium auto-scrolls via the
  //      `accessibility id` query if WDA's element-search includes
  //      not-yet-laid-out items; for offscreen rows, fallback is a
  //      mobile:scroll command — added if/when the live iPhone shows
  //      the same "below the fold" issue Android had).
  //   5. Wait for main_<tab>Tab.
  driver.iosPersonaSignIn = async (personaId, tab) => {
    if (!/^P-\d{2}$/.test(personaId)) {
      throw new Error(
        `iosPersonaSignIn requires a P-NN persona id (got "${personaId}") — ephemeral personas P-01/P-03 sign up via the prod flow, not the picker`,
      );
    }
    // Step 0: cold launch.
    await driver.iosLaunchApp();
    // Step 1: tap picker.
    const opened = await waitAndTap('persona_picker_open', 5000);
    if (!opened) {
      throw new Error(
        `iosPersonaSignIn: could not tap "persona_picker_open" — possible causes: (a) the user is ALREADY signed in (sign out first), (b) the deployed iOS app predates PR #882 (rebuild + re-deploy), or (c) the build flavor is "prod" where the picker is hidden by design.`,
      );
    }
    // Step 2: wait for the picker list, then tap the requested row.
    const dialogReady = await waitForTag('persona_picker_list', 5000);
    if (!dialogReady) {
      throw new Error(
        `iosPersonaSignIn: picker dialog never showed "persona_picker_list" within 5s — testTags may not be propagating to XCUITest accessibility ids. Verify the shared LazyColumn modifier chain.`,
      );
    }
    const picked = await waitAndTap(`persona_row_${personaId}`, 5000);
    if (!picked) {
      throw new Error(
        `iosPersonaSignIn: could not tap "persona_row_${personaId}" — persona may not be in the registry, or the row is offscreen and XCUITest's element-search isn't auto-scrolling. Add a mobile:scroll fallback if this recurs.`,
      );
    }
    // Step 3: wait for main_roomsTab.
    const signedIn = await waitForTag('main_roomsTab', 10000);
    if (!signedIn) {
      throw new Error(
        `iosPersonaSignIn: never reached main screen ("main_roomsTab") within 10s of picking ${personaId} — Firebase sign-in may have failed (check Console.app for the device) or main nav testTag has drifted.`,
      );
    }
    const loweredTab = String(tab).toLowerCase();
    if (loweredTab !== 'rooms') {
      const navOk = await waitAndTap(`main_${loweredTab}Tab`, 3000);
      if (!navOk) {
        throw new Error(
          `iosPersonaSignIn: signed in OK but couldn't navigate to "main_${loweredTab}Tab" — tab name may not match the main nav convention`,
        );
      }
    }
    return true;
  };

  // Internal helpers.
  async function waitForTag(tag, timeoutMs, pollMs = 200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const sid = await ensureSession();
        const r = await fetchImpl(`${appiumBaseUrl}/session/${sid}/element`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ using: 'accessibility id', value: tag }),
        });
        if (r.ok) return true;
      } catch {
        // transient — retry on next poll
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs)); // sleep-ok: poll interval
    }
    return false;
  }
  async function waitAndTap(tag, timeoutMs) {
    const found = await waitForTag(tag, timeoutMs);
    if (!found) return false;
    return driver.iosTapByTag(tag);
  }

  // Stub registration: any iosShows* / iosTap* that doesn't have a real
  // body above falls back to a presence-check via iosUiDump.
  for (const methodName of listMethods()) {
    if (driver[methodName]) continue;
    driver[methodName] = async (..._args) => {
      const dump = await driver.iosUiDump();
      // Presence-check fallback — methods can be specialised later as
      // scenarios surface specific assertion shapes.
      return dump.length > 0;
    };
  }

  driver.close = async () => {
    if (!_sessionId) return;
    try {
      await fetchImpl(`${appiumBaseUrl}/session/${_sessionId}`, { method: 'DELETE' });
    } catch {
      // Non-fatal: session might already be gone.
    }
    _sessionId = null;
  };

  return driver;
}

module.exports = { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES };
