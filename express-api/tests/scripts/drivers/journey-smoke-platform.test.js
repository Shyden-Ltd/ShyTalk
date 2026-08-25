/**
 * J-SMOKE's reset step, on each platform (SHY-0446).
 *
 * It called `device.uninstall(...)` unconditionally and died in 0.7s on the
 * iPhone with "device.uninstall is not a function" — the first of eight
 * journeys to fail there.
 *
 * The iOS app cannot be reinstalled from the runner: it is built with this
 * Mac's LAN address baked in by scripts/dev/ios-local-install.sh, because an
 * iPhone has no `adb reverse`. So the step does not do it — and, just as
 * importantly, does not CLAIM to. A report reading "Clean reinstall ✓" for a
 * phone that was never reinstalled is worse than the crash.
 */

const { buildJourneys } = require('../../../scripts/device-journey-runner');

/** Collects what a journey's steps are called and what they return. */
function recordingReporter() {
  const steps = [];
  return {
    steps,
    async step(_device, label, run) {
      steps.push({ label, detail: await run() });
    },
  };
}

const smokeOf = (ctx) => buildJourneys(ctx).find((j) => j.id === 'J-SMOKE');

const ctx = (over) => ({
  pkg: 'com.shyden.shytalk.local',
  apkAbs: '/tmp/app.apk',
  reset: true,
  db: null,
  ...over,
});

describe('J-SMOKE reset step', () => {
  test('Android really does uninstall and install', async () => {
    const calls = [];
    const device = {
      kind: 'android',
      uninstall: (p) => calls.push(['uninstall', p]),
      install: (p) => {
        calls.push(['install', p]);
        return 'Performing Streamed Install\nSuccess';
      },
      forceStop: async () => {},
      launch: () => {},
    };
    const reporter = recordingReporter();
    // Only the reset step is under test; the launch/SignIn steps need a phone.
    await expect(smokeOf(ctx()).run(device, reporter)).rejects.toBeDefined();
    expect(calls).toEqual([
      ['uninstall', 'com.shyden.shytalk.local'],
      ['install', '/tmp/app.apk'],
    ]);
    expect(reporter.steps[0].label).toMatch(/Clean reinstall/);
    expect(reporter.steps[0].detail).toBe('Success');
  });

  test('iOS neither reinstalls nor pretends it did', async () => {
    const calls = [];
    const device = {
      kind: 'ios',
      uninstall: async (p) => {
        calls.push(['uninstall', p]);
        throw new Error('should never be called on iOS');
      },
      install: async (p) => {
        calls.push(['install', p]);
        throw new Error('should never be called on iOS');
      },
      forceStop: async () => {},
      launch: () => {},
    };
    const reporter = recordingReporter();
    await expect(smokeOf(ctx()).run(device, reporter)).rejects.toBeDefined();

    expect(calls).toEqual([]);
    // The label must not claim a reinstall happened...
    expect(reporter.steps[0].label).not.toMatch(/Clean reinstall/);
    // ...and the detail must say why, so a reader is not left guessing.
    expect(reporter.steps[0].detail).toMatch(/NOT performed on iOS/);
    expect(reporter.steps[0].detail).toMatch(/ios-local-install\.sh/);
  });

  test('--no-reset skips the step entirely on both platforms', async () => {
    for (const kind of ['android', 'ios']) {
      const reporter = recordingReporter();
      const device = { kind, forceStop: async () => {}, launch: () => {} };
      await expect(smokeOf(ctx({ reset: false })).run(device, reporter)).rejects.toBeDefined();
      expect(reporter.steps.map((s) => s.label).join()).not.toMatch(/reinstall/i);
    }
  });
});
