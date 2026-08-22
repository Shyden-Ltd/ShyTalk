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

const DEFAULT_APPIUM_BASE_URL = process.env.APPIUM_BASE_URL || 'http://localhost:4723';

/**
 * The connected iPhone's CoreDevice UUID, for `devicectl`.
 *
 * Deliberately NOT the hardware UDID that `xctrace` prints. The two identifiers
 * look alike and are not interchangeable — `ios-appium-driver.js` documents the
 * same trap from the other side, and mixing them produces a "device not found"
 * that reads like the phone is unplugged.
 */
function selectCoreDeviceUuid(preferred) {
  if (preferred) return preferred;
  let out;
  try {
    out = run('xcrun', ['devicectl', 'list', 'devices']);
  } catch {
    // No devicectl, or no phone. Null rather than a throw: the caller decides
    // whether an absent iPhone is fatal for the run it is doing.
    return null;
  }
  for (const line of out.split('\n')) {
    if (!/\bconnected\b/.test(line) || /simulated/.test(line)) continue;
    const m = /([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

class IosDevice {
  /**
   * @param {object} o
   * @param {string} o.udid        CoreDevice UUID (devicectl)
   * @param {string} o.bundleId    the app under test
   * @param {string} [o.appiumBaseUrl]
   */
  constructor({ udid, bundleId, appiumBaseUrl = DEFAULT_APPIUM_BASE_URL }) {
    this.kind = 'ios';
    this.serial = udid;
    this.bundleId = bundleId;
    this.appiumBaseUrl = appiumBaseUrl;
    this._sessionId = null;
    this._size = null;
  }

  async _session() {
    if (this._sessionId) return this._sessionId;
    const r = await fetch(`${this.appiumBaseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:udid': this.serial,
            'appium:bundleId': this.bundleId,
            // The app is already installed by scripts/dev/ios-local-install.sh
            // and pointed at this Mac's LAN address. Reinstalling here would
            // silently replace it with one built for a different host.
            'appium:noReset': true,
            'appium:newCommandTimeout': 300,
            'appium:wdaLaunchTimeout': 180000,
          },
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
    return sid;
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

  async tap(x, y) {
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
  }

  /**
   * A drag from one point to another.
   *
   * Present because the Android backend has it and journeys call it to bring a
   * control above the keyboard. A method one platform has and the other does
   * not is exactly how a shared journey stops being shared.
   */
  async swipe(x1, y1, x2, y2, ms = 400) {
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
    const el = await this._post('/element', { using: 'accessibility id', value: tag });
    const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
    if (!id) throw new Error(`no element with accessibility id "${tag}" to type into`);
    await this._post(`/element/${id}/click`, {});
    await this._post(`/element/${id}/value`, { text });
  }

  launch() {
    run('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      this.serial,
      this.bundleId,
    ]);
  }

  forceStop() {
    // Best-effort: devicectl has no "force stop", so the session terminates the
    // app instead. A failure here must not end the run — the next launch brings
    // it to the front either way.
    this._post('/appium/device/terminate_app', { bundleId: this.bundleId }).catch(() => {});
  }

  async screencap(absPath) {
    const b64 = await this._get('/screenshot');
    require('node:fs').writeFileSync(absPath, Buffer.from(String(b64), 'base64'));
  }

  size() {
    // Cached: the runner asks per swipe, and each call is a round trip.
    if (this._size) return this._size;
    this._size = { w: 1179, h: 2556 };
    return this._size;
  }

  async measure() {
    const r = await this._get('/window/rect').catch(() => null);
    if (r?.width && r?.height) this._size = { w: r.width, h: r.height };
    return this.size();
  }

  async quit() {
    if (!this._sessionId) return;
    await fetch(`${this.appiumBaseUrl}/session/${this._sessionId}`, { method: 'DELETE' }).catch(
      () => {},
    );
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
  'forceStop',
  'screencap',
  'size',
  'measure',
  'quit',
];

function listMethods() {
  return [...new Set(IOS_JOURNEY_METHOD_NAMES)].sort();
}

/**
 * Factory, matching the shape every other driver in this directory exports —
 * `create*` plus `listMethods` — so `--check-drivers` can discover it.
 */
function createIosJourneyDevice({ udid, bundleId, appiumBaseUrl } = {}) {
  const resolved = selectCoreDeviceUuid(udid);
  if (!resolved) {
    throw new Error(
      'No connected iPhone found (xcrun devicectl list devices). A SIMULATOR is not a ' +
        'substitute — SHY-0419 was invisible to everything except the real device.',
    );
  }
  return new IosDevice({
    udid: resolved,
    bundleId: bundleId || 'com.shyden.shytalk',
    ...(appiumBaseUrl ? { appiumBaseUrl } : {}),
  });
}

module.exports = {
  createIosJourneyDevice,
  listMethods,
  IosDevice,
  selectCoreDeviceUuid,
  IOS_JOURNEY_METHOD_NAMES,
};
