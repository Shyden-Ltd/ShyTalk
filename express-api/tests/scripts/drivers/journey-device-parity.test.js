/**
 * The two journey backends, held to the same surface (SHY-0446).
 *
 * Eight of thirteen journeys failed on the iPhone, and one of them failed in
 * 0.7 seconds with:
 *
 *   J-SMOKE ▶ Clean reinstall … ✗ device.uninstall is not a function
 *
 * `uninstall` exists on the Android backend and not on the iOS one. Nothing
 * said so until a real phone ran the step — the journeys are written once and
 * run on two objects that were never required to match.
 *
 * This derives the requirement from the call sites themselves rather than from
 * a list someone maintains: every `device.X(` in the runner must be a method
 * BOTH backends have, or a call the runner has explicitly guarded. A method
 * added to one backend and called unguarded now reddens here instead of on a
 * phone twenty minutes into a run.
 */

const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', '..', '..', 'scripts', 'device-journey-runner.js');
const { AndroidJourneyDevice } = require(RUNNER);
const { createIosJourneyDevice } = require('../../../scripts/drivers/ios-journey-device');

/**
 * The HARDWARE udid, passed explicitly on purpose.
 *
 * `createIosJourneyDevice` resolves an absent one through
 * `xcrun xctrace list devices`. On a Mac with an iPhone plugged in that
 * SUCCEEDS, so these tests passed locally for the wrong reason -- they were
 * quietly depending on attached hardware -- and on ubuntu CI, where there is no
 * xcrun, the factory threw and every iOS driver suite failed to run.
 *
 * A unit test must not need a phone. Stating both identifiers means no
 * detection happens at all. It must DIFFER from the CoreDevice uuid: the
 * constructor rejects one value spent on both, which is the bug
 * ios-journey-device-udid.test.js exists for.
 */
const TEST_HARDWARE_UDID = '00008150-000954D90A20401C';

/**
 * Calls the runner makes on ONE platform on purpose, each with the guard that
 * makes it safe. The guard is named so this list cannot quietly become a
 * dumping ground for "it broke, add it here".
 */
const PLATFORM_SPECIFIC = {
  shell: "android-only; guarded by `device.kind === 'ios'` and by the android-only branch",
  reverse: "android-only; guarded by `opts.platform !== 'ios'` — an iPhone has no adb reverse",
  typeText: "ios-only; guarded by `device.kind === 'ios'`",
  tapElement: "ios-only; guarded by `typeof device.tapElement === 'function'`",
  tapElementByLabel: "ios-only; guarded by `typeof device.tapElementByLabel === 'function'`",
  quit: "ios-only; guarded by `typeof device.quit === 'function'`",
  measure: 'ios-only; called inside the ios branch of main()',
  attachSourceSession:
    'android-only; called inside the android branch of main(). iOS reads the screen over ' +
    'WebDriverAgent, which is already a warm server — this is Android catching up (SHY-0447)',
};

const androidMethods = () => {
  const d = new AndroidJourneyDevice('SERIAL');
  return new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(d)));
};
const iosMethods = () => {
  const d = createIosJourneyDevice({
    udid: 'A'.repeat(36),
    hardwareUdid: TEST_HARDWARE_UDID,
    bundleId: 'com.example',
  });
  return new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(d)));
};

function calledOnDevice() {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/\bdevice\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) names.add(m[1]);
  return names;
}

describe('journey device parity', () => {
  test('the call sites were actually found', () => {
    // The anchor. A regex that matches nothing would make every assertion
    // below pass vacuously, which is the classic way a source-derived guard
    // stops guarding.
    const called = calledOnDevice();
    expect(called.size).toBeGreaterThanOrEqual(10);
    expect(called.has('forceStop')).toBe(true);
    expect(called.has('dumpXml')).toBe(true);
  });

  test('every unguarded call exists on BOTH backends', () => {
    const android = androidMethods();
    const ios = iosMethods();
    const missing = [];
    for (const name of calledOnDevice()) {
      if (name in PLATFORM_SPECIFIC) continue;
      if (!android.has(name)) missing.push(`android is missing ${name}`);
      if (!ios.has(name)) missing.push(`ios is missing ${name}`);
    }
    expect({ missing }).toEqual({ missing: [] });
  });

  test('every platform-specific call is one a backend actually has', () => {
    // Stops the allowlist being used to wave away a typo. If neither backend
    // implements it, "it is platform-specific" is not the explanation.
    const android = androidMethods();
    const ios = iosMethods();
    const phantom = Object.keys(PLATFORM_SPECIFIC).filter(
      (name) => !android.has(name) && !ios.has(name),
    );
    expect({ phantom }).toEqual({ phantom: [] });
  });

  test('the allowlist has no entries the runner never calls', () => {
    // A stale exemption hides a call that has since become unguarded.
    const called = calledOnDevice();
    const unused = Object.keys(PLATFORM_SPECIFIC).filter((name) => !called.has(name));
    expect({ unused }).toEqual({ unused: [] });
  });

  test('install and uninstall REFUSE on iOS, naming the reason', async () => {
    // Both backends have them, so an unguarded call is a clear refusal rather
    // than "device.uninstall is not a function" twenty minutes into a run.
    // They refuse rather than work because the iOS app is built with this
    // Mac's LAN address baked in by scripts/dev/ios-local-install.sh --
    // reinstalling from the runner would silently replace it with a build
    // pointed at a different host.
    const ios = createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
    await expect(ios.uninstall('com.example')).rejects.toThrow(/ios-local-install/);
    await expect(ios.install('/tmp/whatever.app')).rejects.toThrow(/ios-local-install/);
  });

  test('both backends declare which platform they are', () => {
    // `device.kind === 'ios'` used to work by accident: only the iOS backend
    // set it, so the Android side was `undefined`. A check the other way round
    // would have been silently false everywhere.
    expect(new AndroidJourneyDevice('SERIAL').kind).toBe('android');
    expect(
      createIosJourneyDevice({
        udid: 'A'.repeat(36),
        hardwareUdid: TEST_HARDWARE_UDID,
        bundleId: 'x',
      }).kind,
    ).toBe('ios');
  });
});
