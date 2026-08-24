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

const { execFileSync } = require('node:child_process');

/**
 * Run a command with an ARGUMENT ARRAY, never a shell string.
 *
 * The UDID can arrive from a CLI flag, so interpolating it into a shell command
 * is a real injection surface rather than a theoretical one. `execFileSync`
 * spawns the binary directly, so no shell is involved and metacharacters in an
 * argument stay data.
 */
const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' });

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
   */
  constructor({ coreDeviceUuid, hardwareUdid, bundleId, appiumBaseUrl = DEFAULT_APPIUM_BASE_URL }) {
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
    this.coreDeviceUuid = coreDeviceUuid;
    this.hardwareUdid = hardwareUdid;
    // `serial` is the runner-wide name for "the thing that identifies this
    // device to its control tool". For iOS that tool is devicectl.
    this.serial = coreDeviceUuid;
    this.bundleId = bundleId;
    this.appiumBaseUrl = appiumBaseUrl;
    this._sessionId = null;
    this._allSessionIds = new Set();
    this._size = null;
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

  async _session() {
    if (this._sessionId) return this._sessionId;
    const r = await fetch(`${this.appiumBaseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          // Built by capabilities(), so the identifier routing has exactly
          // one definition and can be asserted without a phone.
          alwaysMatch: this.capabilities(),
        },
      }),
    });
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
    await this._applyPerformanceSettings(sid);
    return sid;
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
      });
      if (!res.ok) {
        console.warn(`[ios] WDA settings refused (${res.status}); reads will be slower`);
      }
    } catch (e) {
      console.warn(`[ios] WDA settings could not be applied: ${e.message}`);
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
    const r = await fetch(`${this.appiumBaseUrl}/session/${sid}${path}`);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return (await r.json())?.value;
  }

  async _post(path, body) {
    const sid = await this._session();
    const r = await fetch(`${this.appiumBaseUrl}/session/${sid}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
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
        throw new Error(`${label} failed twice across a WebDriverAgent restart: ${again.message}`, {
          cause: again,
        });
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
    const result = await dumpWithRetry(async () => {
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
    });
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
  async tapElement(tag) {
    return this.withSessionRecovery(`tapElement(${tag})`, async () => {
      const el = await this._post('/element', { using: 'accessibility id', value: tag });
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element with accessibility id "${tag}" to tap`);
      await this._post(`/element/${id}/click`, {});
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
  async tapElementByLabel(label) {
    const quoted = JSON.stringify(String(label));
    return this.withSessionRecovery(`tapElementByLabel(${quoted})`, async () => {
      const el = await this._post('/element', {
        using: '-ios predicate string',
        value: `label == ${quoted} OR name == ${quoted} OR value == ${quoted}`,
      });
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element labelled ${quoted} to tap`);
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
  async typeText(tag, text) {
    return this.withSessionRecovery(`typeText(${tag})`, async () => {
      const el = await this._post('/element', { using: 'accessibility id', value: tag });
      const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
      if (!id) throw new Error(`no element with accessibility id "${tag}" to type into`);
      await this._post(`/element/${id}/click`, {});
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
    const ids = [...this._allSessionIds];
    if (this._sessionId) ids.push(this._sessionId);
    for (const id of new Set(ids)) {
      await fetch(`${this.appiumBaseUrl}/session/${id}`, { method: 'DELETE' }).catch(() => {});
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
function createIosJourneyDevice({ udid, hardwareUdid, bundleId, appiumBaseUrl } = {}) {
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
};
