/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. Same exemption
   as android-adb-driver.js, for the same reason. */
/**
 * An iPhone that looks exactly like the Android `Device` the journey runner
 * drives — SHY-0396.
 *
 * ## Why this exists
 *
 * `device-journey-runner.js` was Android-only: its `Device` class shells out to
 * `adb` and its journeys call `tapId` / `waitForId` / `waitForText` against
 * uiautomator dumps. iOS had driver PRIMITIVES (`ios-appium-driver.js` can tap,
 * dump and sign in) but nothing that ran a journey, so every iOS walk was driven
 * by hand — slowly, unrepeatably, and testing whatever the person driving
 * happened to remember to check.
 *
 * That is how two platforms drift. SHY-0419 is the standing example: the Send
 * button sat under the keyboard on iPhone while unit tests, the web suite and
 * two Android walks were all green.
 *
 * ## The shape of the fix
 *
 * ONE journey definition, TWO device backends. This class exposes the same
 * surface the runner's helpers already use — `dumpXml()`, `tap(x, y)`,
 * `launch()`, `forceStop()`, `screencap(path)`, `size()`, `typeText()` — so a
 * journey written once asserts the same things on both phones. A platform
 * difference then shows up as a FAILING STEP rather than as a walk nobody ran.
 *
 * The one genuinely different piece is the accessibility tree: uiautomator emits
 * `<node resource-id bounds="[x,y][x,y]">` and XCUITest emits
 * `<XCUIElementTypeButton name label x y width height>`. Both are normalised to
 * the runner's node shape by `parseNodes`, which is why everything above it can
 * stay platform-agnostic.
 *
 * ## Requirements
 *
 *   - Appium running (default http://localhost:4723) with the XCUITest driver
 *   - WebDriverAgentRunner installed on the phone
 *   - a REAL iPhone. Never a simulator: the operator's rule, and SHY-0419 is why.
 */

const { execFileSync, spawn } = require('node:child_process');

/**
 * Run a command with an ARGUMENT ARRAY, never a shell string.
 *
 * The UDID can arrive from a CLI flag, so interpolating it into a shell command
 * is a real injection surface rather than a theoretical one. `execFileSync`
 * spawns the binary directly, so no shell is involved and metacharacters in an
 * argument stay data.
 */
const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' });

/**
 * The app's PROCESS name in the device syslog: the Xcode target's executable,
 * `iosApp` -- not the display name ("ShyTalk") and not the bundle id. A
 * capture filtered on "ShyTalk" returned three lines and none of them the
 * app's (2026-09-04); the same launch unfiltered showed 3,688 lines from
 * `iosApp(...)`.
 */
const IOS_APP_PROCESS_NAME = 'iosApp';

// Reused, never re-implemented. This is the same retry policy the Android
// dumps use, it is unit-tested with an injected delay, and reusing it keeps
// ONE retry policy across both platforms instead of two that can drift.
const { dumpWithRetry } = require('./ui-dump-retry');
const { selectUdid } = require('./ios-appium-driver');

const DEFAULT_APPIUM_BASE_URL = process.env.APPIUM_BASE_URL || 'http://localhost:4723';

/**
 * The connected iPhone's CoreDevice UUID, for `devicectl`.
 *
 * Deliberately NOT the hardware UDID that `xctrace` prints. The two identifiers
 * look alike and are not interchangeable — `ios-appium-driver.js` documents the
 * same trap from the other side, and mixing them produces a "device not found"
 * that reads like the phone is unplugged.
 */
/**
 * Shapes of failure that mean the Appium/WebDriverAgent SESSION is gone, as
 * opposed to the command having a legitimate negative answer (SHY-0446).
 *
 * WDA dies. It died mid-`click` during the iPhone runs and the journey
 * reported "SignIn not reached" over a dump showing the app sitting happily on
 * Home — a product failure that never happened. Recovering needs knowing which
 * failures are worth reconnecting for.
 *
 * The list is deliberately SPECIFIC. `An element could not be located` is
 * Appium's ordinary answer for a control that has not appeared yet, and the
 * journeys ask that question constantly; classifying it as a session death
 * would rebuild the session on every ordinary miss, turn a 200ms "not yet"
 * into a full app relaunch, and hide genuine absences behind a retry.
 */
const SESSION_LOST_SIGNATURES = [
  'socket hang up',
  'could not proxy command',
  'invalid session id',
  'session is either terminated or not started',
  'econnrefused',
  'econnreset',
  'epipe',
  'the requested resource could not be found',
];

function isSessionLost(error) {
  const message = typeof error === 'string' ? error : (error && error.message) || '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return SESSION_LOST_SIGNATURES.some((sig) => lower.includes(sig));
}

const CORE_DEVICE_UUID = /([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i;

/**
 * Lines of `devicectl list devices` describing a REAL phone.
 *
 * `simulated` is dropped here rather than at each caller, because handing the
 * runner a simulator is the single worst outcome available: it would succeed,
 * and then prove nothing. SHY-0419 was invisible to everything except the real
 * device.
 */
function physicalDeviceLines(out) {
  return String(out || '')
    .split('\n')
    .filter((line) => /\bphysical\b/.test(line) && !/simulated/.test(line));
}

/** The phone with a LIVE tunnel, or null. */
function connectedPhoneIn(out) {
  for (const line of physicalDeviceLines(out)) {
    if (!/\bconnected\b/.test(line)) continue;
    const m = CORE_DEVICE_UUID.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * The phone whose tunnel is merely DORMANT — paired, or already connected.
 *
 * `unavailable` is excluded: devicectl knows of that device and cannot reach
 * it, so waking it is a timeout rather than a recovery.
 */
function pairedPhoneIn(out) {
  for (const line of physicalDeviceLines(out)) {
    if (/\bunavailable\b/.test(line)) continue;
    if (!/\bconnected\b/.test(line) && !/\bavailable\b/.test(line)) continue;
    const m = CORE_DEVICE_UUID.exec(line);
    if (m) return m[1];
  }
  return null;
}

function listDevicesOutput() {
  try {
    return run('xcrun', ['devicectl', 'list', 'devices']);
  } catch {
    // No devicectl, or no phone. Null rather than a throw: the caller decides
    // whether an absent iPhone is fatal for the run it is doing.
    return null;
  }
}

function selectCoreDeviceUuid(preferred) {
  if (preferred) return preferred;

  const out = listDevicesOutput();
  if (out === null) return null;

  const connected = connectedPhoneIn(out);
  if (connected) return connected;

  // Paired but dormant is NOT an absent phone.
  //
  // `list devices` reports the tunnel state at that instant, and CoreDevice
  // brings tunnels up on demand — so after a reboot, or simply after the phone
  // has been idle, a passive list says `available (paired)`. Requiring the word
  // `connected` made the runner stop with "No connected iPhone found" while the
  // phone sat plugged in, unlocked and paired, and blocked an entire platform's
  // evidence run on 2026-08-24.
  //
  // Asking devicectl for anything about the device opens the tunnel. The result
  // is discarded; establishing it is the whole point.
  const dormant = pairedPhoneIn(out);
  if (!dormant) return null;
  try {
    run('xcrun', ['devicectl', 'device', 'info', 'details', '--device', dormant]);
  } catch {
    // A wake that fails is not fatal by itself — the read below is what decides.
  }

  const after = listDevicesOutput();
  return after === null ? null : connectedPhoneIn(after);
}

/**
 * WebDriverAgent's MJPEG screen stream. Shared with
 * `journey-screen-recorder`, which records from it.
 */
const MJPEG_SERVER_PORT = 9100;

/**
 * How long any single WebDriverAgent command may take before it is abandoned.
 *
 * `fetch` has no default timeout, so a wedged WDA left the request open until
 * the OS gave up around 38 seconds -- and `dumpWithRetry` did that eight times.
 * That was offered as the ~313 second once-per-matrix stall; bounding commands
 * at 20s and then 10s did not move it, and the real cause was elsewhere
 * (SHY-0451). Commands still need a bound, and this is it.
 *
 * Generous against reality: a read is 300ms on a sparse screen and ~2.3s on the
 * busiest one measured. Ten seconds is four times the worst healthy case, so
 * anything reaching it is stuck. Failing fast is what makes the retry
 * worth having -- the driver drops the session on error, so the next attempt
 * reconnects instead of queueing behind the same dead one.
 *
 * Session creation has its own budgets and does NOT use this one — see
 * `SESSION_COLD_TIMEOUT_MS`. That exemption used to be unbounded, and it was
 * the whole of SHY-0451.
 */
const COMMAND_TIMEOUT_MS = 10000;

/**
 * How long a FIRST session may take before we stop waiting for Appium.
 *
 * A cold start legitimately builds and installs WebDriverAgent, which is what
 * `appium:wdaLaunchTimeout` (180s) is sized for. This sits just above it so
 * Appium's own limit is the one that speaks first and ours is a backstop —
 * a backstop that exists at all, which before SHY-0451 it did not.
 */
const SESSION_COLD_TIMEOUT_MS = 210000;

/**
 * How long a RECONNECT may take — and the fix for SHY-0451.
 *
 * These two cases are not the same operation and must not share a budget.
 * A recovery session reattaches to a WebDriverAgent already built and
 * installed; measured across a full matrix it is 4.6-5.7s, seventeen times a
 * run. Thirty seconds is roughly five times the worst healthy case, the same
 * ratio `COMMAND_TIMEOUT_MS` is drawn at.
 *
 * Giving the reconnect the COLD budget is exactly how a wedge came to cost
 * minutes: `withSessionRecovery` answers a dead WDA by clearing `_sessionId`
 * and re-running the operation, the re-run calls `_session()`, and Appium then
 * takes the RELAUNCH path — up to 180 unbounded seconds, reached from inside a
 * call the code believed was capped at ten. Twice in one `ensureAtSignIn`
 * ladder is the 310-415s that struck once per run.
 *
 * Failing here is not the end of anything: `ensureAtSignIn` catches it and
 * restarts the app through devicectl, which does not need Appium to be well.
 */
const SESSION_RECOVERY_TIMEOUT_MS = 30000;

/**
 * How long the best-effort performance-settings POST may take.
 *
 * It runs INSIDE `_session()`, after the session has been granted, so an
 * unbounded one hangs a session that had already succeeded — and it runs once
 * per session, seventeen times a run. Best-effort has to mean bounded, or it
 * only means "the failure is silent".
 */
const SETTINGS_TIMEOUT_MS = 5000;

/**
 * How long ONE session DELETE may take at teardown.
 *
 * `quit()` walks every session id ever opened, sequentially. Seventeen
 * unbounded DELETEs against a wedged WebDriverAgent is another whole run spent
 * after the last journey has already finished.
 */
const QUIT_TIMEOUT_MS = 5000;

/**
 * Above this, a session creation is reported rather than absorbed.
 *
 * Twice the measured healthy 4.6-5.7s. The point is not the threshold, it is
 * that the SLOW one gets a line of its own: SHY-0451 stayed hidden for two
 * fix attempts because seventeen healthy creations a run kept the average
 * innocent while one pathological creation carried the entire stall.
 */
const SESSION_SLOW_WARN_MS = 12000;

/**
 * How long ONE screen read may spend retrying before it gives up.
 *
 * The retry's attempt count was sized for Android, where a failed dump exits
 * immediately -- eight attempts there is about five seconds. On iOS a failed
 * attempt is a command that ran out of time, so eight of them is 166 seconds
 * for a single read.
 *
 * This was ALSO believed to be the ~312 second stall in `signOutFlow`, and the
 * arithmetic fitted well enough to be convincing -- 7 reads x a 45s budget is
 * 315s against a measured 312,193ms. It was a coincidence. The budget was cut
 * to 45s and then to 10s and the stall survived both; the cause was unbounded
 * session creation (SHY-0451, see `SESSION_RECOVERY_TIMEOUT_MS`).
 *
 * The budget is still right, and still small, because the multiplier is not the
 * retry -- it is the number of reads in the path. When WebDriverAgent wedges,
 * every dump costs the whole budget, and `signOutFlow` does about seven.
 *
 * Clearing the session between attempts does not help: a fresh session hits the
 * same wedged WDA. The only lever is to stop paying for it.
 *
 * Failing here is not the end of anything: `ensureAtSignIn` catches it and
 * restarts the app, which costs about 45 seconds and works.
 */
const DUMP_RETRY_BUDGET_MS = 10000;

class IosDevice {
  /**
   * An iPhone answers to TWO identifiers, and they are not interchangeable:
   *
   *   CoreDevice UUID  CEB70A3C-894C-471F-A1BA-6DBCB874CFB4  -> xcrun devicectl
   *   hardware UDID    00008150-000954D90A20401C             -> appium:udid
   *
   * Both are dash-separated hex, so a single `udid` field looks sufficient
   * and is not: Appium rejects the CoreDevice UUID outright with
   * `Unknown device or simulator UDID`, and devicectl rejects the hardware
   * one. This class therefore holds both, named for the tool that consumes
   * each, and refuses to be built with either missing.
   *
   * @param {object} o
   * @param {string} o.coreDeviceUuid  for `xcrun devicectl --device`
   * @param {string} o.hardwareUdid    for `appium:udid` (ECID-based)
   * @param {string} o.bundleId        the app under test
   * @param {string} [o.appiumBaseUrl]
   * @param {number} [o.sessionColdTimeoutMs] budget for the FIRST session
   * @param {number} [o.sessionRecoveryTimeoutMs] budget for a RECONNECT
   * @param {number} [o.settingsTimeoutMs] budget for the performance-settings POST
   * @param {number} [o.quitTimeoutMs] budget for one session DELETE at teardown
   */
  constructor({
    coreDeviceUuid,
    hardwareUdid,
    bundleId,
    appiumBaseUrl = DEFAULT_APPIUM_BASE_URL,
    // Injectable so the bounds can be PROVEN against a real hung socket in
    // milliseconds. A test that had to wait out the production values could
    // not be run, and a bound nobody runs is a bound nobody notices losing.
    commandTimeoutMs = COMMAND_TIMEOUT_MS,
    sessionColdTimeoutMs = SESSION_COLD_TIMEOUT_MS,
    sessionRecoveryTimeoutMs = SESSION_RECOVERY_TIMEOUT_MS,
    settingsTimeoutMs = SETTINGS_TIMEOUT_MS,
    quitTimeoutMs = QUIT_TIMEOUT_MS,
    // Injected so a test can READ what the driver said without patching the
    // console. The warnings below are part of the contract -- a tolerated
    // lost click, a retyped field -- and a contract has to be assertable.
    warn = console.warn,
  }) {
    // Validated at construction, not at first use. Appium's answer to
    // `appium:udid: undefined` is "Unknown device or simulator UDID:
    // 'undefined'", which reads as a hardware fault and sends you to the
    // cable rather than to this line.
    if (!coreDeviceUuid) {
      throw new Error('IosDevice needs a CoreDevice uuid (xcrun devicectl list devices)');
    }
    if (!hardwareUdid) {
      throw new Error('IosDevice needs a hardware udid (xcrun xctrace list devices / idevice_id)');
    }
    if (coreDeviceUuid === hardwareUdid) {
      throw new Error(
        `CoreDevice uuid and hardware udid are the same value ("${hardwareUdid}") — one ` +
          'detector has been used for both, which restores the bug where Appium was ' +
          'handed a CoreDevice UUID and refused every session.',
      );
    }
    this.kind = 'ios';
    // The syslog capture behind clearAppLog()/readAppLog(). `_spawn` is a
    // field so a test can hand in a fake process; the default is the real one.
    this._spawn = spawn;
    this._syslog = null;
    this.coreDeviceUuid = coreDeviceUuid;
    this.hardwareUdid = hardwareUdid;
    // `serial` is the runner-wide name for "the thing that identifies this
    // device to its control tool". For iOS that tool is devicectl.
    this.serial = coreDeviceUuid;
    this.bundleId = bundleId;
    this.appiumBaseUrl = appiumBaseUrl;
    this._sessionId = null;
    this._allSessionIds = new Set();
    // Separate from `_allSessionIds` on purpose. That set is what we currently
    // HOLD, and SHY-0452's recovery empties it; this is whether a session has
    // ever been granted, which is what decides cold-vs-reconnect. Deriving the
    // budget from the set meant the attempt after a wedge recovery looked
    // COLD and waited 210s — the stall SHY-0451 exists to have removed.
    this._everOpened = false;
    this._size = null;
    this._commandTimeoutMs = commandTimeoutMs;
    this._sessionColdTimeoutMs = sessionColdTimeoutMs;
    this._sessionRecoveryTimeoutMs = sessionRecoveryTimeoutMs;
    this._settingsTimeoutMs = settingsTimeoutMs;
    this._quitTimeoutMs = quitTimeoutMs;
    this._warn = warn;
  }

  /**
   * The W3C capabilities for a session.
   *
   * Split out from `_session()` so the identifier routing can be asserted
   * without a phone, an Appium server, or a mock of either.
   *
   * @returns {Record<string, unknown>}
   */
  capabilities() {
    return {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': this.hardwareUdid,
      'appium:bundleId': this.bundleId,
      // The app is already installed by scripts/dev/ios-local-install.sh and
      // pointed at this Mac's LAN address. Reinstalling here would silently
      // replace it with one built for a different host.
      'appium:noReset': true,
      'appium:newCommandTimeout': 300,
      'appium:wdaLaunchTimeout': 180000,
      // WebDriverAgent publishes the screen as MJPEG on this port while a
      // session is open; journey-screen-recorder reads it to record the iOS
      // walk. Stated explicitly so the recorder and the session agree on ONE
      // number instead of both falling back to a default that could drift.
      'appium:mjpegServerPort': MJPEG_SERVER_PORT,
    };
  }

  /**
   * Open the session, under a budget chosen by WHICH session this is.
   *
   * A first session may be building WebDriverAgent; a reconnect is reattaching
   * to one already installed. Before SHY-0451 neither was bounded at all, and
   * the reconnect — reached from inside `_get`/`_post`, whose 10s signal
   * covers only the request AFTER this returns — is where the once-per-run
   * 310-415s stall lived.
   */
  async _session() {
    if (this._sessionId) return this._sessionId;
    // A session has been opened before, so WebDriverAgent is installed and
    // this is a reattach, not a build.
    const isReconnect = this._everOpened;
    const budgetMs = isReconnect ? this._sessionRecoveryTimeoutMs : this._sessionColdTimeoutMs;
    const started = Date.now();

    const ask = () =>
      fetch(`${this.appiumBaseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilities: {
            // Built by capabilities(), so the identifier routing has exactly
            // one definition and can be asserted without a phone.
            alwaysMatch: this.capabilities(),
          },
        }),
        signal: AbortSignal.timeout(budgetMs),
      });

    let r;
    try {
      r = await ask();
    } catch (first) {
      // SHY-0452. A refused RECONNECT is not simply "the phone is gone" — the
      // likeliest reason is that Appium is still holding the session that
      // died, and this new one is queueing behind it. Nothing had ever asked
      // Appium to let go, so the wedge lasted as long as Appium's own
      // patience and cost a journey roughly twice in twelve runs.
      //
      // Only on a reconnect: before the first session there is nothing to
      // clear, and a DELETE against a server that has issued none is noise.
      //
      // ONE extra attempt. A WebDriverAgent that will not come back has to
      // fail the step rather than spin against the phone.
      if (!isReconnect) {
        throw this._sessionRefused(first, isReconnect, budgetMs);
      }
      this._warn(
        `[ios] reconnect refused after ${Date.now() - started}ms — releasing ` +
          `${this._allSessionIds.size} known session(s) and asking once more`,
      );
      await this._releaseKnownSessions();
      try {
        r = await ask();
      } catch (again) {
        throw this._sessionRefused(again, isReconnect, budgetMs);
      }
    }
    const body = await r.json().catch(() => ({}));
    const sid = body?.value?.sessionId || body?.sessionId;
    if (!sid) {
      throw new Error(
        `Appium refused a session: ${JSON.stringify(body?.value?.message || body).slice(0, 400)}`,
      );
    }
    this._sessionId = sid;
    // Every id ever opened, not just the current one. When WebDriverAgent dies
    // with the app, the dump-retry opens a REPLACEMENT session and the old id
    // is forgotten — so a teardown that closes only `_sessionId` orphans it.
    // Measured: 14 sessions created, 13 removed.
    this._allSessionIds.add(sid);
    this._everOpened = true;
    // Surfaced rather than averaged away. SHY-0451 hid inside a mean of
    // "4.6-5.7s, seventeen a run" because a once-per-run outlier does not move
    // a mean — so the OUTLIER is what gets printed.
    const tookMs = Date.now() - started;
    if (tookMs > SESSION_SLOW_WARN_MS) {
      this._warn(
        `[ios] ${isReconnect ? 'reconnect' : 'cold'} session took ${tookMs}ms ` +
          `(healthy is ~5000ms) — WebDriverAgent is struggling`,
      );
    }
    await this._applyPerformanceSettings(sid);
    return sid;
  }

  /**
   * The error a refused session raises.
   *
   * Named for whoever is reading a red matrix: the phone is fine, the cable is
   * fine, and Appium did not answer a SESSION request in time. Shared by both
   * attempts so the two paths cannot drift into saying different things about
   * the same failure.
   */
  _sessionRefused(cause, isReconnect, budgetMs) {
    return new Error(
      `Appium did not grant a ${isReconnect ? 'reconnect' : 'cold'} session within ` +
        `${budgetMs}ms (WebDriverAgent is probably wedged): ${cause.message}`,
      { cause },
    );
  }

  /**
   * Ask Appium to let go of every session this driver has opened.
   *
   * Best-effort and bounded, deliberately: this runs when things are ALREADY
   * wrong, and a teardown that hangs would replace the wedge it is trying to
   * clear. Each id is forgotten whether or not its DELETE succeeded — keeping
   * one we have asked to delete would mean asking again on the next wedge.
   */
  async _releaseKnownSessions() {
    for (const id of [...this._allSessionIds]) {
      await fetch(`${this.appiumBaseUrl}/session/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this._quitTimeoutMs),
      }).catch(() => {});
    }
    this._allSessionIds.clear();
    this._sessionId = null;
  }

  /**
   * Turn off WebDriverAgent's pre-snapshot waits.
   *
   * Reading the screen is ~80% of an iPhone run. Before every snapshot WDA
   * waits for the app to go idle and then for animations to cool off, and on a
   * walk that is doing something almost continuously, that wait IS the run.
   *
   * These go through the SETTINGS endpoint, not the session capabilities.
   * `appium:waitForIdleTimeout` as a capability is accepted, ignored, and reads
   * back `undefined` -- which is how a first attempt at this appeared to work
   * while changing nothing at all.
   *
   * Not fatal if it fails: a slower run is worth more than no run, and the
   * journey summary reports the per-dump cost either way, so a silent
   * regression here is visible in the next report rather than hidden.
   */
  async _applyPerformanceSettings(sessionId) {
    try {
      const res = await fetch(`${this.appiumBaseUrl}/session/${sessionId}/appium/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { waitForIdleTimeout: 0, animationCoolOffTimeout: 0 },
        }),
        // Bounded because this runs INSIDE `_session()`, after the session has
        // already been granted. Unbounded, it hangs a session that succeeded.
        signal: AbortSignal.timeout(this._settingsTimeoutMs),
      });
      if (!res.ok) {
        this._warn(`[ios] WDA settings refused (${res.status}); reads will be slower`);
      }
    } catch (e) {
      this._warn(`[ios] WDA settings could not be applied: ${e.message}`);
    }
  }

  /**
   * Open the Appium session if it is not already open.
   *
   * Public because the session has a SIDE EFFECT other code depends on:
   * WebDriverAgent only serves its MJPEG screen stream while a session
   * exists, and the recorder must connect after that, not before.
   *
   * @returns {Promise<string>} the session id
   */
  async ensureSession() {
    return this._session();
  }

  async _get(path) {
    const sid = await this._session();
    const r = await this._transport(`${this.appiumBaseUrl}/session/${sid}${path}`, {
      signal: AbortSignal.timeout(this._commandTimeoutMs),
    });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return (await r.json())?.value;
  }

  /**
   * One HTTP call to WebDriverAgent, dropping the session if the TRANSPORT
   * fails.
   *
   * `COMMAND_TIMEOUT_MS` has always promised this — "the driver drops the
   * session on error, so the next attempt reconnects instead of queueing
   * behind the same dead one" — and nothing did it. `_get`/`_post` never
   * cleared `_sessionId`, and an abort is not one of
   * `SESSION_LOST_SIGNATURES`, so `withSessionRecovery` did not clear it
   * either. One wedge therefore poisoned the REST of the journey: every later
   * command queued behind the same dead session and paid the full timeout
   * again.
   *
   * The discriminator is the transport, not the verdict. A 404 means WDA is
   * alive and said no, and throwing that session away would spend a five
   * second reconnect on every ordinary missing element.
   */
  async _transport(url, init) {
    try {
      return await fetch(url, init);
    } catch (e) {
      // The socket failed, so this session is not to be trusted. The next
      // command opens a fresh one — bounded, see SESSION_RECOVERY_TIMEOUT_MS.
      this._sessionId = null;
      throw e;
    }
  }

  async _post(path, body) {
    const sid = await this._session();
    const r = await this._transport(`${this.appiumBaseUrl}/session/${sid}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(this._commandTimeoutMs),
    });
    const parsed = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(
        `POST ${path} -> ${r.status}: ${String(parsed?.value?.message ?? '').slice(0, 300)}`,
      );
    }
    return parsed?.value;
  }

  /**
   * Run one device operation, surviving a WebDriverAgent that dies underneath
   * it (SHY-0446).
   *
   * `dumpXml` has always done this — it clears `_sessionId` and retries, and a
   * fresh session relaunches the app because `appium:bundleId` is set. Every
   * OTHER command had neither, so a single WDA death failed the step AND left
   * a dead session id on this object, which then failed everything after it.
   * One death took out a whole journey; the next run passed because it started
   * a new session. That alternating pass/fail is the signature, and it was
   * eight of thirteen journeys.
   *
   * The WHOLE operation is re-run, not the HTTP call inside it, because
   * element handles do not survive a session change: a retry has to re-resolve
   * the element it is about to click.
   *
   * ONE retry. A second death in a row is a real problem and the run should
   * say so rather than loop against a phone whose WDA is not coming back.
   *
   * Accepted, and stated rather than hidden: if WDA died AFTER acting on a
   * command but before answering, the retry repeats it. A proxy that cannot
   * reach WDA has almost certainly not delivered the command, and the
   * alternative — what this code did before — was to fail the run outright.
   */
  async withSessionRecovery(label, operation) {
    try {
      return await operation();
    } catch (e) {
      if (!isSessionLost(e)) throw e;
      // Clearing the id is what makes the next `_session()` reconnect and
      // bring the app back, rather than replay a handle that is already dead.
      this._sessionId = null;
      try {
        return await operation();
      } catch (again) {
        // BOTH errors, because they say different things and only one of them
        // is the cause. J39, 2026-08-24, reported only the second:
        //
        //   tapElement(main_settingsButton) failed twice across a
        //   WebDriverAgent restart: POST /element -> 404
        //
        // A 404 on the REPLAY means the first attempt had already worked and
        // the screen moved on — it says nothing about why WDA went away, and
        // the error that did was discarded here. A diagnostic that drops the
        // cause sends the next session hunting the symptom.
        throw new Error(
          `${label} failed twice across a WebDriverAgent restart. ` +
            `What lost the session: ${e.message} — the replay then failed with: ${again.message}`,
          { cause: again },
        );
      }
    }
  }

  /**
   * The XCUITest source tree. `parseNodes` normalises it.
   *
   * A response that is not a hierarchy THROWS rather than being returned, so
   * the retry treats "the dump came back as something else" the same as "the
   * dump command failed". Returning it instead would hand the caller an empty
   * node list, and the caller cannot tell that from "the element is absent".
   */
  async dumpXml() {
    const result = await dumpWithRetry(
      async () => {
        try {
          const xml = await this._get('/source');
          if (!xml || !String(xml).includes('XCUIElementType')) {
            throw new Error(`not an XCUITest hierarchy: ${String(xml).slice(0, 120) || '(empty)'}`);
          }
          return xml;
        } catch (e) {
          // A dropped session is recoverable; a dropped phone is not. Clearing
          // the id makes the next attempt reconnect rather than replay a dead
          // handle.
          this._sessionId = null;
          throw e;
        }
      },
      { deadlineMs: DUMP_RETRY_BUDGET_MS },
    );
    if (!result.ok) {
      throw new Error(
        `XCUITest source failed after ${result.attempts} attempts; last error: ${result.lastErr}`,
      );
    }
    return result.xml;
  }

  /**
   * Click an element by its accessibility identifier.
   *
   * This is the tap that should be used wherever a target has an id. Appium
   * resolves the element and clicks it in ONE server-side operation, so there
   * is no window in which the screen can move between "where is it" and "click
   * it" — which is the whole failure mode of tapping a remembered coordinate.
   *
   * `parseXcuiNodes` reads a node's id from the XCUITest `name` attribute,
   * which is the accessibility identifier, so `accessibility id` here matches
   * exactly what `byId` matches in the journeys.
   *
   * @param {string} tag accessibility identifier
   */
  /**
   * Press and hold an element.
   *
   * WebDriverAgent's own gesture endpoint rather than a synthesised touch
   * sequence: it takes the element, so it cannot drift if the row moves
   * between the look and the hold.
   *
   * Needed because reporting a message is a long press on its bubble, and
   * there is no button for it (SHY-0457).
   */
  async longPressElement(tag, durationSec = 0.6) {
    return this.withSessionRecovery(`longPressElement(${tag})`, async () => {
      const el = await this._post('/element', { using: 'accessibility id', value: tag });
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element with accessibility id "${tag}" to long-press`);
      await this._post(`/wda/element/${id}/touchAndHold`, { duration: durationSec });
    });
  }

  async tapElement(tag) {
    // Declared OUTSIDE the operation, so it survives the replay:
    // `withSessionRecovery` re-runs the operation, not this method. That is
    // what lets the second attempt know the first one already clicked.
    let clickIssued = false;
    return this.withSessionRecovery(`tapElement(${tag})`, async () => {
      // Looked up TWICE if the first look misses.
      //
      // `404: An element could not be located` here does not mean the control
      // is absent -- it means it was not there in the instant WebDriverAgent
      // looked. A screen that is still arriving, or a list finishing its
      // scroll, produces exactly that for a control the caller has just seen in
      // the tree. `withSessionRecovery` does not cover it, because nothing is
      // wrong with the session.
      //
      // Observed twice on 2026-08-24, on different controls
      // (`persona_row_P-02`, `main_settingsButton`), each failing a journey
      // that was otherwise fine.
      for (let attempt = 1; ; attempt++) {
        try {
          const el = await this._post('/element', { using: 'accessibility id', value: tag });
          const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
          if (!id) throw new Error(`no element with accessibility id "${tag}" to tap`);
          clickIssued = true;
          await this._post(`/element/${id}/click`, {});
          return;
        } catch (e) {
          const missed = /could not be located|no such element/i.test(e.message || '');
          if (missed && clickIssued) {
            // The control is GONE and we had already clicked it, which is what
            // a click that landed and then lost its answer looks like. J39
            // failed twice in six runs on 2026-08-24 doing exactly this: the
            // form had opened, and the replay hunted the button that opened it.
            //
            // Said out loud rather than swallowed. The journey's NEXT step is
            // what really decides, and when THAT is the step that fails this
            // line is how the log explains it.
            this._warn(
              `[ios] ${tag} is gone after a click whose answer was lost — treating the ` +
                'click as landed; the next step is what confirms it',
            );
            return;
          }
          if (!missed || attempt >= 2) throw e;
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    });
  }

  /**
   * Click an element by its visible LABEL.
   *
   * Not every control carries an accessibility identifier — the daily-reward
   * dialog's "Later" is matched by its text, and it has no id to ask for. A
   * predicate is Appium's answer to that, and it is still an ELEMENT click:
   * Appium resolves and clicks server-side, so nothing can move in between.
   *
   * Without this the dialog handlers fell back to coordinates on iOS even
   * though the backend can locate properly — which is how a reward calendar
   * survived a tap meant to dismiss it, and the walk then sat waiting for a
   * tab the dialog was covering.
   *
   * `name` is checked as well as `label` because XCUITest surfaces the
   * identifier under `name`, and a control may carry either.
   *
   * @param {string} label
   */
  /**
   * Dismisses the on-screen keyboard, best effort.
   *
   * A control behind the keyboard is invisible to every suite: it is in the
   * view tree with sane bounds, and a tap at its centre lands on a key. The
   * runner's `dismissKeyboard()` called this whenever the driver offered it —
   * and this driver did not, so on iOS the keyboard was never dismissed and
   * the guard silently did nothing (SHY-0457).
   *
   * Through `mobile: hideKeyboard`, the command Appium routes. The raw
   * WebDriverAgent endpoint (`/wda/keyboard/dismiss`) is one the xcuitest
   * driver proxies INTERNALLY; posted by a client it is Appium's own 404, on
   * every iOS version -- which the tolerance below read as "WDA would not
   * dismiss the keyboard" for weeks, until iOS 27.0's taller keyboard put the
   * send button under it and J07 tapped a key (SHY-0500, 2026-09-04).
   *
   * Still best effort: a keyboard that will not close is a worse screenshot,
   * not a failed journey. It warns instead of throwing, so the tolerance is
   * part of the output rather than a silence.
   */
  async hideKeyboard() {
    // The tolerance sits OUTSIDE withSessionRecovery, not inside it. Catching
    // within the callback swallows a DEAD SESSION before the recovery machinery
    // can see it, so the stale session id survives and every later command
    // fails too — one WDA death becoming a whole failed journey, which is the
    // defect that wrapper exists to prevent.
    try {
      return await this.withSessionRecovery('hideKeyboard()', async () => {
        await this._post('/execute/sync', {
          script: 'mobile: hideKeyboard',
          // The keys WebDriverAgent will tap to close it, in order tried; a
          // search field's keyboard says "search", a message field's "return".
          args: [{ keys: ['done', 'return', 'search', 'go', 'send'] }],
        });
        return true;
      });
    } catch (err) {
      this._warn(`[ios] hideKeyboard: WDA would not dismiss the keyboard (${err.message})`);
      return false;
    }
  }

  async tapElementByLabel(label) {
    const quoted = JSON.stringify(String(label));
    // Same class of defect as `tapElement`, and fixed the same way rather than
    // waiting for a journey to find it here too. A dialog's "Later" is exactly
    // the kind of control that STOPS EXISTING the moment it is pressed.
    let clickIssued = false;
    return this.withSessionRecovery(`tapElementByLabel(${quoted})`, async () => {
      let el;
      try {
        el = await this._post('/element', {
          using: '-ios predicate string',
          value: `label == ${quoted} OR name == ${quoted} OR value == ${quoted}`,
        });
      } catch (e) {
        if (clickIssued && /could not be located|no such element/i.test(e.message || '')) {
          this._warn(
            `[ios] ${quoted} is gone after a click whose answer was lost — treating the ` +
              'click as landed; the next step is what confirms it',
          );
          return;
        }
        throw e;
      }
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element labelled ${quoted} to tap`);
      clickIssued = true;
      await this._post(`/element/${id}/click`, {});
    });
  }

  /**
   * Tap a POINT. Reserved for gestures with no element behind them — dismissing
   * by tapping empty space, or a coordinate derived from a swipe. Anything with
   * an identifier should go through `tapElement`.
   */
  async tap(x, y) {
    return this.withSessionRecovery(`tap(${Math.round(x)},${Math.round(y)})`, async () => {
      await this._post('/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 60 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    });
  }

  /**
   * A drag from one point to another.
   *
   * Present because the Android backend has it and journeys call it to bring a
   * control above the keyboard. A method one platform has and the other does
   * not is exactly how a shared journey stops being shared.
   */
  async swipe(x1, y1, x2, y2, ms = 400) {
    return this.withSessionRecovery('swipe', async () => {
      await this._post('/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: Math.round(x1), y: Math.round(y1) },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: ms, x: Math.round(x2), y: Math.round(y2) },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    });
  }

  /**
   * Type into the element carrying `tag` as its accessibility identifier.
   *
   * Addressed by identifier rather than by tapping and typing blind: on iOS the
   * keyboard can steal focus from a field that is scrolled off, and text sent to
   * whatever happens to be focused is the kind of failure that looks like the
   * product dropped the input.
   */
  async typeText(tag, text, { clearFirst = false } = {}) {
    // Survives the replay, like `tapElement`'s `clickIssued` and for a sharper
    // reason: XCUITest's /value APPENDS keystrokes, it does not replace. When
    // the answer to a type is lost and `withSessionRecovery` re-runs the
    // operation, the text lands TWICE.
    //
    // J38, 2026-08-24: the field read "...since this morningJ38 run ...since
    // this morning" against a single typed sentence. That is worse than the
    // click case -- a replayed click fails loudly on a control that has gone,
    // and this one corrupts the field quietly and fails later, at an assertion
    // about content, pointing at the wrong thing entirely.
    let keysSent = false;
    return this.withSessionRecovery(`typeText(${tag})`, async () => {
      const el = await this._post('/element', { using: 'accessibility id', value: tag });
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element with accessibility id "${tag}" to type into`);
      await this._post(`/element/${id}/click`, {});
      if (clearFirst) {
        // The caller says the field may arrive PRE-FILLED. /value appends, so
        // without this the old contents survive and the new text is glued to
        // them — SHY-0456's room was created as "JR-CORE-<t1>JR-CORE-<t2>",
        // and the failure surfaced later as a database lookup finding nothing.
        // Still opt-in: J38 asserts that going back costs her nothing she
        // typed, so clearing unconditionally would erase content on purpose.
        await this._post(`/element/${id}/clear`, {});
      }
      if (keysSent) {
        // Only on the REPLAY. Journeys rely on typing ADDING to a field that
        // already holds something -- "going back costs her nothing she typed"
        // is a real J38 assertion -- so an unconditional clear would erase
        // content the caller meant to keep.
        this._warn(
          `[ios] retyping ${tag} after a type whose answer was lost — clearing first, ` +
            'because /value appends and the first attempt may have landed',
        );
        await this._post(`/element/${id}/clear`, {});
      }
      keysSent = true;
      await this._post(`/element/${id}/value`, { text });
    });
  }

  /**
   * Present so an unguarded call is a REFUSAL with a reason, not
   * "device.uninstall is not a function" twenty minutes into a run
   * (SHY-0446). That TypeError is exactly how J-SMOKE failed on the iPhone.
   *
   * They refuse rather than work, and deliberately. The iOS app is built with
   * THIS Mac's LAN address baked in by scripts/dev/ios-local-install.sh — an
   * iPhone has no `adb reverse` to fall back on — so reinstalling from the
   * runner would silently replace it with a build pointed at a different host,
   * and every later step would fail against a backend the phone cannot reach.
   */
  async uninstall(bundleId) {
    throw new Error(
      `refusing to uninstall ${bundleId} on iOS: the app is installed and pointed at this ` +
        `Mac's LAN address by scripts/dev/ios-local-install.sh, and the runner replacing it ` +
        `would leave the phone talking to the wrong host`,
    );
  }

  async install(appPath) {
    throw new Error(
      `refusing to install ${appPath} on iOS: use scripts/dev/ios-local-install.sh, which ` +
        `bakes in this Mac's LAN address; installing from the runner would leave the phone ` +
        `talking to the wrong host`,
    );
  }

  /**
   * Bring the app to the front, and make sure WebDriverAgent is looking at it.
   *
   * `forceStop` terminates the app through the Appium session, and the session
   * SURVIVES that — still attached to a process that no longer exists. Starting
   * the app again with devicectl left WDA reporting the SPRINGBOARD: every
   * subsequent `/source` came back as the iOS Home screen, forty app icons and
   * all, so the journey waited its full 45 seconds for a SignIn screen that was
   * running the whole time and reported "SignIn not reached".
   *
   * That also made those runs SLOW, not just red. The springboard is a far
   * bigger accessibility tree than any of our screens: reads cost ~1320ms while
   * dumping it, against ~480ms inside the app. A failing iPhone run spends its
   * whole budget photographing the home screen.
   *
   * `activate_app` asks WDA itself to foreground the bundle, so it re-attaches
   * rather than being told about it afterwards. devicectl remains the fallback
   * for when there is no session to ask -- and in that case the session id is
   * cleared, so the next command builds one against the running app.
   */
  async launch() {
    if (this._sessionId) {
      try {
        await this._post('/appium/device/activate_app', { bundleId: this.bundleId });
        return;
      } catch (_e) {
        // Fall through: the session is unusable, so drop it and start cold.
        this._sessionId = null;
      }
    }
    run('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      this.serial,
      this.bundleId,
    ]);
    // A session created BEFORE this launch is attached to the process that has
    // just been replaced. Dropping it makes the next command open one against
    // the app that is actually running.
    this._sessionId = null;
  }

  /**
   * Stop the app, and WAIT for it to be stopped.
   *
   * devicectl has no "force stop", so the Appium session terminates the app
   * instead — and that is an HTTP round trip, where Android's
   * `adb shell am force-stop` is synchronous. Firing it without awaiting made
   * the terminate land AFTER the `launch()` on the next line, killing the app
   * that had just been brought up and leaving the phone on the iOS Home
   * screen. A/B tested on the device, 2/2: no gap → home screen, 2s gap → app
   * in front.
   *
   * The journey then reported "SignIn or Home not reached" — a product that
   * would not load — when the driver had shot it in the back.
   *
   * Still best-effort: a terminate that fails (the app was not running) must
   * not end a run, because the next launch brings it to the front either way.
   * What changed is that the failure is now awaited rather than raced.
   */
  async forceStop() {
    try {
      await this._post('/appium/device/terminate_app', { bundleId: this.bundleId });
    } catch (_e) {
      /* already stopped, or no session — the next launch fixes it either way */
    }
  }

  async screencap(absPath) {
    return this.withSessionRecovery('screencap', async () => {
      const b64 = await this._get('/screenshot');
      require('node:fs').writeFileSync(absPath, Buffer.from(String(b64), 'base64'));
    });
  }

  /**
   * Start capturing the device log for the app's process.
   *
   * Kotlin/Native's `println` is the app's stdout, which iOS folds into the
   * unified log, and `idevicesyslog` streams that over USB -- no debugger
   * attached, which is what SHY-0500's observability criterion asks for.
   * "Clear" on iOS means "start from here": the syslog cannot be emptied, so
   * a fresh capture is what makes the next read hold only what follows. The
   * capture then runs until the next clear, or `quit()`; reads do not end it.
   */
  async clearAppLog() {
    this._stopSyslog();
    const child = this._spawn('idevicesyslog', [
      '-u',
      this.hardwareUdid,
      '-p',
      IOS_APP_PROCESS_NAME,
    ]);
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(String(d)));
    child.stderr.on('data', () => {});
    child.on('error', (e) => this._warn(`[ios] idevicesyslog: ${e.message}`));
    this._syslog = { child, chunks };
  }

  /**
   * The lines captured so far that carry `tag`.
   *
   * Leaves the capture running, the way a logcat dump can be taken again and
   * again: J40 reads the log once for the first frame and again for the
   * `confirm:` verdict of the same launch. This used to STOP the capture, so
   * the second read threw and anything the app logged after the first read
   * was never seen (review, 2026-09-04). Only [clearAppLog] starts over.
   */
  async readAppLog(tag) {
    if (!this._syslog) {
      throw new Error('readAppLog() before clearAppLog(): nothing was being captured');
    }
    return this._syslog.chunks
      .join('')
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.includes(tag));
  }

  _stopSyslog() {
    if (!this._syslog) return;
    try {
      this._syslog.child.kill();
    } catch (_e) {
      /* already gone */
    }
    this._syslog = null;
  }

  /**
   * Airplane Mode on, or off, through the Settings app (SHY-0500's offline
   * launch).
   *
   * Nothing toggles the radios of a real iPhone from a Mac: not devicectl,
   * not WebDriverAgent, not Appium. What a person does is open Settings and
   * flip the first switch, so that is what this does. WebDriverAgent keeps
   * answering over USB while the radios are off, which is what lets the
   * journey go on reading the screen. Always returns to the app under test,
   * even when the switch was not found.
   */
  async setOffline(on) {
    const SETTINGS = 'com.apple.Preferences';
    const want = on ? '1' : '0';
    return this.withSessionRecovery(`setOffline(${on})`, async () => {
      await this._post('/appium/device/activate_app', { bundleId: SETTINGS });
      try {
        const el = await this._post('/element', {
          using: '-ios predicate string',
          value:
            "type == 'XCUIElementTypeSwitch' AND " +
            "(label == 'Airplane Mode' OR name == 'Airplane Mode')",
        });
        const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
        if (!id) throw new Error('Settings showed no "Airplane Mode" switch');
        const current = String(await this._get(`/element/${id}/attribute/value`));
        if (current !== want) {
          await this._post(`/element/${id}/click`, {});
          const after = String(await this._get(`/element/${id}/attribute/value`));
          if (after !== want) {
            throw new Error(`Airplane Mode reads ${after} after the tap; wanted ${want}`);
          }
        }
      } finally {
        await this._post('/appium/device/activate_app', { bundleId: this.bundleId });
      }
    });
  }

  size() {
    // Cached: the runner asks per swipe, and each call is a round trip.
    if (this._size) return this._size;
    this._size = { w: 1179, h: 2556 };
    return this._size;
  }

  async measure() {
    // The `.catch` stays: a WDA that answers "no rect" is a legitimate, if
    // unhelpful, answer and the cached default carries the run. What it must
    // NOT swallow is a dead session — that used to leave the run measuring a
    // hardcoded screen size for a phone it had lost.
    const r = await this.withSessionRecovery('measure', async () =>
      this._get('/window/rect'),
    ).catch(() => null);
    if (r?.width && r?.height) this._size = { w: r.width, h: r.height };
    return this.size();
  }

  /**
   * Close EVERY session this device opened, not only the latest.
   *
   * A session is replaced, not reused, when WebDriverAgent dies with the app —
   * the dump-retry opens a fresh one and `_sessionId` moves on. Closing only
   * that leaves the superseded id behind to expire on `newCommandTimeout`, and
   * two runs inside that window collide. Same leak as the one that took out a
   * run with a "test runner failed to initialize", one level up.
   *
   * Best-effort per id: one refusal must not strand the rest.
   */
  async quit() {
    // A read no longer stops the capture, so the last one of the run is
    // still streaming here; without this an idevicesyslog outlives the run.
    this._stopSyslog();
    const ids = [...this._allSessionIds];
    if (this._sessionId) ids.push(this._sessionId);
    for (const id of new Set(ids)) {
      await fetch(`${this.appiumBaseUrl}/session/${id}`, {
        method: 'DELETE',
        // Seventeen ids, sequentially. Unbounded, a wedged WebDriverAgent
        // costs another whole run after the last journey has finished.
        signal: AbortSignal.timeout(this._quitTimeoutMs),
      }).catch(() => {});
    }
    this._allSessionIds.clear();
    this._sessionId = null;
  }
}

/**
 * The device-facing methods a journey may call on this adapter.
 *
 * Declared, not derived from the prototype: the point of the inventory is that
 * ADDING a capability is a deliberate edit here, so the two platform backends
 * can be compared line by line. A list generated by reflection would grow
 * silently and prove nothing about parity.
 */
const IOS_JOURNEY_METHOD_NAMES = [
  'dumpXml',
  'tap',
  'swipe',
  'typeText',
  'launch',
  'tapElement',
  'tapElementByLabel',
  'forceStop',
  'screencap',
  'size',
  'measure',
  'quit',
  'ensureSession',
];

function listMethods() {
  return [...new Set(IOS_JOURNEY_METHOD_NAMES)].sort();
}

/**
 * Factory, matching the shape every other driver in this directory exports —
 * `create*` plus `listMethods` — so `--check-drivers` can discover it.
 */
function createIosJourneyDevice({ udid, hardwareUdid, bundleId, appiumBaseUrl, warn } = {}) {
  const coreDeviceUuid = selectCoreDeviceUuid(udid);
  if (!coreDeviceUuid) {
    throw new Error(
      'No connected iPhone found (xcrun devicectl list devices). A SIMULATOR is not a ' +
        'substitute — SHY-0419 was invisible to everything except the real device.',
    );
  }
  // The SECOND identifier, from a different tool. `selectUdid` already owns
  // this detection for ios-appium-driver.js — including dropping the
  // simulator section and the Mac host line — so it is reused rather than
  // reimplemented; two detectors would be two things to keep correct.
  const resolvedHardware = selectUdid(hardwareUdid);
  if (!resolvedHardware) {
    throw new Error(
      'No hardware UDID found (xcrun xctrace list devices). Appium needs the ECID-based ' +
        'UDID; the CoreDevice UUID that devicectl reports is a DIFFERENT identifier and ' +
        'Appium rejects it with "Unknown device or simulator UDID".',
    );
  }
  return new IosDevice({
    coreDeviceUuid,
    hardwareUdid: resolvedHardware,
    bundleId: bundleId || 'com.shyden.shytalk',
    ...(appiumBaseUrl ? { appiumBaseUrl } : {}),
    // Passed through so the warnings stay assertable through the factory, which
    // is how every journey and every test builds this device.
    ...(warn ? { warn } : {}),
  });
}

module.exports = {
  createIosJourneyDevice,
  isSessionLost,
  listMethods,
  IosDevice,
  selectCoreDeviceUuid,
  connectedPhoneIn,
  pairedPhoneIn,
  IOS_JOURNEY_METHOD_NAMES,
  COMMAND_TIMEOUT_MS,
  SESSION_COLD_TIMEOUT_MS,
  SESSION_RECOVERY_TIMEOUT_MS,
  SETTINGS_TIMEOUT_MS,
  QUIT_TIMEOUT_MS,
};
