'use strict';

/**
 * SHY-0500 — the cold-start journey (J40) proves, on a phone, what the unit
 * tests prove in a JVM: the app draws its first screen from local facts and
 * confirms the session BEHIND that screen.
 *
 * The pure pieces are asserted here. The launch itself, the revocation and the
 * network cut are asserted by running the journey on both phones.
 */

const path = require('node:path');

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'device-journey-runner.js');
const {
  AndroidJourneyDevice,
  buildJourneys,
  classifyFirstFrame,
  summarizeLaunchLog,
  openApp,
  firstAppFrame,
  uiOps,
  parseNodes,
} = require(RUNNER);
const { createIosJourneyDevice } = require('../../scripts/drivers/ios-journey-device');

const TEST_HARDWARE_UDID = '00008150-000954D90A20401C';

const androidXml = (ids) =>
  `<hierarchy>${ids
    .map((id) => `<node resource-id="${id}" bounds="[0,0][100,100]" clickable="true" />`)
    .join('')}</hierarchy>`;

const iosXml = (names) =>
  `<XCUIElementTypeApplication>${names
    .map(
      (n) =>
        `<XCUIElementTypeOther name="${n}" x="0" y="0" width="100" height="100" enabled="true" />`,
    )
    .join('')}</XCUIElementTypeApplication>`;

describe('classifyFirstFrame — what the app drew', () => {
  test('a main tab means the room list was drawn', () => {
    expect(classifyFirstFrame(parseNodes(androidXml(['main_roomsTab'])))).toBe('main');
  });
  test('the persona picker means the sign-in screen was drawn', () => {
    expect(classifyFirstFrame(parseNodes(androidXml(['persona_picker_open'])))).toBe('signIn');
  });
  test('neither means the app has not drawn anything of its own yet', () => {
    expect(classifyFirstFrame(parseNodes(androidXml(['some_launcher_thing'])))).toBe('blank');
    expect(classifyFirstFrame([])).toBe('blank');
  });
  test('reads the iOS tree by the same rule', () => {
    expect(classifyFirstFrame(parseNodes(iosXml(['main_profileTab'])))).toBe('main');
    expect(classifyFirstFrame(parseNodes(iosXml(['persona_picker_open'])))).toBe('signIn');
  });
});

describe('summarizeLaunchLog — which launch path the app took, from its own log', () => {
  test('parses the Android logcat shape', () => {
    const lines = [
      '09-04 00:55:01.123 12345 12345 D ColdStartSequencer: immediate: destination=Main (no I/O)',
      '09-04 00:55:01.900 12345 12345 D ColdStartSequencer: confirmed: claim refreshed, reads starting',
    ];
    expect(summarizeLaunchLog(lines)).toEqual({
      immediate: 'Main',
      confirm: 'confirmed: claim refreshed, reads starting',
    });
  });
  test('parses the iOS syslog shape', () => {
    const lines = [
      'Sep  4 00:55:01 Seans-iPhone ShyTalk(Foundation)[512] <Notice>: D/ColdStartSequencer: immediate: destination=SignIn (no I/O)',
    ];
    expect(summarizeLaunchLog(lines)).toEqual({ immediate: 'SignIn', confirm: null });
  });
  test('a dead session and a transport failure are told apart', () => {
    const dead = ['D ColdStartSequencer: confirm: refresh FAILED; sessionAlive=false'];
    const offline = ['D ColdStartSequencer: confirm: transport failure, staying unverified'];
    expect(summarizeLaunchLog(dead).confirm).toBe('confirm: refresh FAILED; sessionAlive=false');
    expect(summarizeLaunchLog(offline).confirm).toBe(
      'confirm: transport failure, staying unverified',
    );
  });
  test('an empty or unrelated log yields nothing rather than a guess', () => {
    expect(summarizeLaunchLog([])).toEqual({ immediate: null, confirm: null });
    expect(summarizeLaunchLog(['D SomethingElse: immediate: destination=Main'])).toEqual({
      immediate: null,
      confirm: null,
    });
  });
  test('only the LAST launch counts when the buffer holds two', () => {
    const lines = [
      'D ColdStartSequencer: immediate: destination=Main (no I/O)',
      'D ColdStartSequencer: confirmed: claim refreshed, reads starting',
      'D ColdStartSequencer: immediate: destination=SignIn (no I/O)',
    ];
    expect(summarizeLaunchLog(lines)).toEqual({ immediate: 'SignIn', confirm: null });
  });
});

describe('openApp — opening the app is the action under test, so it counts', () => {
  test('launches the package and credits one UI operation', async () => {
    const calls = [];
    const device = { launch: (pkg) => calls.push(pkg) };
    const before = uiOps.count;
    await openApp(device, 'com.shyden.shytalk.local');
    expect(calls).toEqual(['com.shyden.shytalk.local']);
    expect(uiOps.count).toBe(before + 1);
  });
});

describe('firstAppFrame — the first tree the app itself draws', () => {
  const deviceShowing = (trees) => {
    let i = 0;
    return {
      dumpXml: async () => trees[Math.min(i++, trees.length - 1)],
    };
  };
  test('skips frames that are not the app and reports the first one that is', async () => {
    const device = deviceShowing([
      androidXml(['launcher_thing']),
      androidXml(['launcher_thing']),
      androidXml(['main_roomsTab']),
    ]);
    const frame = await firstAppFrame(device, 5000);
    expect(frame.kind).toBe('main');
    expect(frame.afterMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(frame.nodes)).toBe(true);
  });
  test('gives up with a message naming the timeout, not a silent blank', async () => {
    const device = deviceShowing([androidXml(['launcher_thing'])]);
    await expect(firstAppFrame(device, 120)).rejects.toThrow(/120ms/);
  });
});

describe('J40 is in the corpus and says what it is', () => {
  const built = buildJourneys({ reset: false, pkg: 'com.shyden.shytalk.local' });
  const j40 = built.find((j) => j.id === 'J40');
  test('declared as a UI journey about SHY-0500', () => {
    expect(j40).toBeDefined();
    expect(j40.kind).toBe('ui');
    expect(j40.title).toMatch(/SHY-0500/);
    expect(j40.title).toMatch(/cold start/i);
  });
  test('runs only where a session can be revoked from the outside', () => {
    // Revocation goes through Firebase Admin against the emulator; dev has no
    // such handle from a laptop, so the journey says so and is skipped there
    // rather than failing on a step it cannot perform (the SHY-0488 shape).
    expect(j40.requiresLocalState).toBe(true);
  });
});

describe('the launch log and the network are device operations on BOTH backends', () => {
  const ios = () =>
    createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
  test.each(['clearAppLog', 'readAppLog', 'setOffline'])('%s exists on both', (name) => {
    expect(typeof AndroidJourneyDevice.prototype[name]).toBe('function');
    expect(typeof Object.getPrototypeOf(ios())[name]).toBe('function');
  });

  describe('Android', () => {
    let shell;
    let reverse;
    beforeEach(() => {
      shell = jest.spyOn(AndroidJourneyDevice.prototype, 'shell').mockImplementation(() => '');
      reverse = jest.spyOn(AndroidJourneyDevice.prototype, 'reverse').mockImplementation(() => '');
    });
    afterEach(() => {
      shell.mockRestore();
      reverse.mockRestore();
    });
    test('clearAppLog empties logcat and readAppLog reads one tag back', async () => {
      const d = new AndroidJourneyDevice('SERIAL');
      shell.mockImplementation((args) =>
        args.startsWith('logcat -d')
          ? '09-04 D ColdStartSequencer: immediate: destination=Main (no I/O)\n\n'
          : '',
      );
      await d.clearAppLog();
      const lines = await d.readAppLog('ColdStartSequencer');
      expect(shell.mock.calls.map((c) => c[0])).toEqual([
        'logcat -c',
        'logcat -d -s ColdStartSequencer:V',
      ]);
      expect(lines).toEqual(['09-04 D ColdStartSequencer: immediate: destination=Main (no I/O)']);
    });
    test('setOffline(true) cuts every route the app has to this machine', async () => {
      const d = new AndroidJourneyDevice('SERIAL');
      const run = jest.spyOn(d, 'adbRun').mockImplementation(() => '');
      await d.setOffline(true, { reversePorts: [3000, 9099] });
      expect(run.mock.calls.map((c) => c[0])).toEqual(['reverse --remove-all']);
      expect(shell.mock.calls.map((c) => c[0])).toEqual(['svc wifi disable', 'svc data disable']);
      expect(reverse).not.toHaveBeenCalled();
    });
    test('setOffline(false) restores the radios AND the tunnels it removed', async () => {
      const d = new AndroidJourneyDevice('SERIAL');
      jest.spyOn(d, 'adbRun').mockImplementation(() => '');
      await d.setOffline(false, { reversePorts: [3000, 9099] });
      expect(shell.mock.calls.map((c) => c[0])).toEqual(['svc wifi enable', 'svc data enable']);
      expect(reverse.mock.calls.map((c) => c[0])).toEqual([3000, 9099]);
    });
  });

  describe('iOS', () => {
    test('the launch log is captured from the device syslog for the app process', async () => {
      const d = ios();
      const spawned = [];
      const listeners = [];
      d._spawn = (bin, args) => {
        spawned.push([bin, args]);
        return {
          stdout: { on: (ev, cb) => ev === 'data' && listeners.push(cb) },
          stderr: { on: () => {} },
          on: () => {},
          kill: () => {
            spawned.push(['kill']);
          },
        };
      };
      await d.clearAppLog();
      expect(spawned[0][0]).toBe('idevicesyslog');
      expect(spawned[0][1]).toEqual(['-u', TEST_HARDWARE_UDID, '-p', 'ShyTalk']);
      listeners.forEach((cb) =>
        cb(
          Buffer.from(
            'Sep 4 ShyTalk[1] <Notice>: D/ColdStartSequencer: immediate: destination=Main (no I/O)\n' +
              'Sep 4 ShyTalk[1] <Notice>: something else\n',
          ),
        ),
      );
      const lines = await d.readAppLog('ColdStartSequencer');
      expect(lines).toEqual([
        'Sep 4 ShyTalk[1] <Notice>: D/ColdStartSequencer: immediate: destination=Main (no I/O)',
      ]);
      expect(spawned[spawned.length - 1]).toEqual(['kill']);
    });
    test('readAppLog before clearAppLog is a programming error, not an empty log', async () => {
      await expect(ios().readAppLog('ColdStartSequencer')).rejects.toThrow(/clearAppLog/);
    });
    test('setOffline drives the Airplane Mode switch in Settings and comes back', async () => {
      const d = ios();
      const posts = [];
      let switchValue = '0';
      d._post = async (p, body) => {
        posts.push([p, body]);
        if (p === '/element') return { ELEMENT: 'sw1' };
        if (p === '/element/sw1/click') switchValue = switchValue === '0' ? '1' : '0';
        return {};
      };
      d._get = async (p) => (p === '/element/sw1/attribute/value' ? switchValue : null);
      await d.setOffline(true);
      expect(posts[0]).toEqual([
        '/appium/device/activate_app',
        { bundleId: 'com.apple.Preferences' },
      ]);
      expect(
        posts.find(([p, b]) => p === '/element' && /Airplane Mode/.test(b.value)),
      ).toBeTruthy();
      expect(posts.some(([p]) => p === '/element/sw1/click')).toBe(true);
      expect(switchValue).toBe('1');
      expect(posts[posts.length - 1]).toEqual([
        '/appium/device/activate_app',
        { bundleId: 'com.example' },
      ]);
      // Already on: a second call must not toggle it back off.
      posts.length = 0;
      await d.setOffline(true);
      expect(posts.some(([p]) => p === '/element/sw1/click')).toBe(false);
      await d.setOffline(false);
      expect(switchValue).toBe('0');
    });
  });
});
