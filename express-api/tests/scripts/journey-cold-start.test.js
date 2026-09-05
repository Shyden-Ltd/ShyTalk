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
  watchForText,
  revokedColdStart,
  SESSION_ENDED_TEXT,
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
  test('an overlay Home presents on arrival means the room list was drawn', () => {
    // On the real phone the first cold launch after sign-in showed
    // `dailyReward_dialog` alone: uiautomator dumps the dialog window and
    // hides the tabs beneath. The calendar is only ever presented over Home,
    // so it IS the room list, with a sheet on top -- not a splash, not a
    // spinner, and not "nothing drawn yet" (2026-09-04, run 2).
    expect(classifyFirstFrame(parseNodes(androidXml(['dailyReward_dialog'])))).toBe('main');
    expect(classifyFirstFrame(parseNodes(iosXml(['dailyReward_claimButton'])))).toBe('main');
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
  test('the LAST confirm line is the decision when the app logs two', () => {
    // An offline launch logs the failed refresh first and its verdict second;
    // run 5 on the OnePlus read the first and called a transport failure a
    // dead session.
    const lines = [
      'D ColdStartSequencer: immediate: destination=Main (no I/O)',
      'D ColdStartSequencer: confirm: refresh FAILED; sessionAlive=true',
      'D ColdStartSequencer: confirm: transport failure, staying unverified',
    ];
    expect(summarizeLaunchLog(lines).confirm).toBe(
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
    // The real class with its three adb-facing methods replaced by functions
    // that remember what they were asked -- plain assignments, the way the
    // sibling driver tests replace `_post`, so SHY-0108's test-double count
    // stays where it is.
    const recording = (answers = {}) => {
      const d = new AndroidJourneyDevice('SERIAL');
      const calls = { shell: [], adbRun: [], reverse: [] };
      d.shell = (args) => {
        calls.shell.push(args);
        return answers.shell ? answers.shell(args) : '';
      };
      d.adbRun = (args) => {
        calls.adbRun.push(args);
        return '';
      };
      d.reverse = (port) => {
        calls.reverse.push(port);
      };
      return { d, calls };
    };
    test('clearAppLog empties logcat and readAppLog reads one tag back', async () => {
      const { d, calls } = recording({
        shell: (args) =>
          args.startsWith('logcat -d')
            ? '09-04 D ColdStartSequencer: immediate: destination=Main (no I/O)\n\n'
            : '',
      });
      await d.clearAppLog();
      const lines = await d.readAppLog('ColdStartSequencer');
      expect(calls.shell).toEqual(['logcat -c', 'logcat -d -s ColdStartSequencer:V']);
      expect(lines).toEqual(['09-04 D ColdStartSequencer: immediate: destination=Main (no I/O)']);
    });
    test('setOffline(true) cuts every route the app has to this machine', async () => {
      const { d, calls } = recording();
      await d.setOffline(true, { reversePorts: [3000, 9099] });
      // The stack's tunnels alone: `--remove-all` would also cut the reverse
      // socket scrcpy records through.
      expect(calls.adbRun).toEqual(['reverse --remove tcp:3000', 'reverse --remove tcp:9099']);
      // Wi-Fi only: toggling mobile data raises a system "Turn on mobile
      // data?" dialog on the OnePlus that covers the app (run 7).
      expect(calls.shell).toEqual(['svc wifi disable']);
      expect(calls.reverse).toEqual([]);
    });
    test('setOffline(false) restores Wi-Fi AND the tunnels it removed', async () => {
      const { d, calls } = recording();
      await d.setOffline(false, { reversePorts: [3000, 9099] });
      expect(calls.shell).toEqual(['svc wifi enable']);
      expect(calls.reverse).toEqual([3000, 9099]);
    });
  });

  describe('iOS', () => {
    test('the launch log is read from the persisted device archive, from the clock mark clearAppLog took', async () => {
      const d = ios();
      const ran = [];
      // The phone's own clock at clearAppLog(); the device stamps its log with
      // it, so the mark must come from the phone, not the Mac.
      const MARK = 1757050000.25;
      const stamp = (offsetSeconds) => {
        const iso = new Date((MARK + offsetSeconds) * 1000).toISOString();
        return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000+0000`;
      };
      const before = `${stamp(-1)} 0x1 Default 0x0 501 0 iosApp: D/ColdStartSequencer: from the previous launch`;
      const wanted = `${stamp(2)} 0x1 Default 0x0 501 0 iosApp: D/ColdStartSequencer: immediate: destination=Main (no I/O)`;
      const other = `${stamp(3)} 0x1 Default 0x0 501 0 iosApp: something else`;
      d._run = (bin, args) => {
        ran.push([bin, args]);
        if (bin === 'ideviceinfo') return `${MARK}\n`;
        if (bin === '/usr/bin/log') return `${before}\n${wanted}\n${other}\n`;
        return '';
      };
      await d.clearAppLog();
      expect(ran).toEqual([
        ['ideviceinfo', ['-u', TEST_HARDWARE_UDID, '-k', 'TimeIntervalSince1970']],
      ]);

      const lines = await d.readAppLog('ColdStartSequencer');
      // Only the tagged line stamped AFTER the mark: the archive holds the
      // previous launch too, and idevicesyslog's own start-time is coarse.
      expect(lines).toEqual([wanted]);
      const [, archive, untar, show] = ran;
      expect(archive[0]).toBe('idevicesyslog');
      expect(archive[1]).toEqual([
        '-u',
        TEST_HARDWARE_UDID,
        'archive',
        expect.stringMatching(/device-log\.tar$/),
        '--start-time',
        String(Math.floor(MARK) - 2),
      ]);
      expect(untar[0]).toBe('tar');
      expect(show[0]).toBe('/usr/bin/log');
      // The process is the Xcode target's executable, `iosApp`; a capture
      // filtered on the display name returned nothing from the app.
      expect(show[1]).toEqual(
        expect.arrayContaining(['--archive', '--predicate', 'process == "iosApp"', '--start']),
      );
      expect(show[1][show[1].indexOf('--start') + 1]).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
    test('clearAppLog refuses a device clock it cannot read', async () => {
      const d = ios();
      d._run = () => 'nonsense';
      await expect(d.clearAppLog()).rejects.toThrow(/device clock: "nonsense"/);
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

    // ── The switch is not there the instant Settings is activated (2026-09-05) ─
    //
    // On the iPhone, `activate_app` for Settings returns before WebDriverAgent's
    // snapshot has moved off ShyTalk: an `/element` lookup 131 ms later misses
    // (404), the same lookup 1.5 s later finds the switch. J40 on the iPhone
    // reached the offline step for the first time at run 5 and died right
    // there, outside any step, with nothing but "POST /element -> 404".
    const NOT_FOUND = new Error(
      'POST /element -> 404: An element could not be located on the page using the given search parameters.',
    );
    const isAirplaneLookup = (p, body) =>
      p === '/element' && /airplaneMode|Airplane Mode/.test(String(body?.value));
    const iosWaiting = () =>
      createIosJourneyDevice({
        udid: 'A'.repeat(36),
        hardwareUdid: TEST_HARDWARE_UDID,
        bundleId: 'com.example',
        offlineSwitchWaitMs: 40,
        offlineSettleMs: 40,
      });

    // ── A tap on the switch can miss, and its value can lag (2026-09-05, run 6) ─
    //
    // With the lookup race fixed, J40 died one line later: "Airplane Mode reads
    // 0 after the tap; wanted 1". The walk video's last frame shows Settings
    // still sliding in with the switch off: the tap landed on a screen in
    // motion and missed, and the value was judged the instant after the tap.
    // The switch now gets a settle window to report the new value, and a tap
    // that missed is repeated once; the second miss is the failure.
    const switchThatFlipsOnTap = (d, flipOnTap, { staleReadsAfterTap = 0 } = {}) => {
      const clicks = [];
      let value = '0';
      let staleReadsLeft = 0;
      d._post = async (p, body) => {
        if (isAirplaneLookup(p, body)) return { ELEMENT: 'sw1' };
        if (p === '/element/sw1/click') {
          clicks.push(body);
          if (clicks.length === flipOnTap) value = value === '0' ? '1' : '0';
          staleReadsLeft = staleReadsAfterTap;
        }
        return {};
      };
      d._get = async (p) => {
        if (p !== '/element/sw1/attribute/value') return null;
        if (staleReadsLeft > 0) {
          staleReadsLeft -= 1;
          return value === '0' ? '1' : '0';
        }
        return value;
      };
      return { clicks, current: () => value };
    };
    test('setOffline lets a tapped switch settle: a stale value right after the tap is polled, not judged', async () => {
      const d = iosWaiting();
      const sw = switchThatFlipsOnTap(d, 1, { staleReadsAfterTap: 2 });
      await d.setOffline(true);
      expect(sw.clicks).toHaveLength(1);
      expect(sw.current()).toBe('1');
    });
    test('setOffline taps once more when the first tap misses', async () => {
      const d = iosWaiting();
      const sw = switchThatFlipsOnTap(d, 2);
      await d.setOffline(true);
      expect(sw.clicks).toHaveLength(2);
      expect(sw.current()).toBe('1');
    });
    test('setOffline stops after the second miss, names both taps, and still comes back to the app', async () => {
      const d = iosWaiting();
      const activated = [];
      const sw = switchThatFlipsOnTap(d, Infinity);
      const post = d._post;
      d._post = async (p, body) => {
        if (p === '/appium/device/activate_app') activated.push(body.bundleId);
        return post(p, body);
      };
      await expect(d.setOffline(true)).rejects.toThrow(/reads 0 after 2 taps; wanted 1/);
      expect(sw.clicks).toHaveLength(2);
      expect(activated).toEqual(['com.apple.Preferences', 'com.example']);
    });

    test('setOffline waits for Settings to draw the Airplane Mode switch instead of failing on the first miss', async () => {
      const d = iosWaiting();
      const posts = [];
      let lookups = 0;
      let switchValue = '0';
      d._post = async (p, body) => {
        posts.push([p, body]);
        if (isAirplaneLookup(p, body)) {
          lookups += 1;
          if (lookups < 3) throw NOT_FOUND;
          return { ELEMENT: 'sw1' };
        }
        if (p === '/element/sw1/click') switchValue = switchValue === '0' ? '1' : '0';
        return {};
      };
      d._get = async (p) => (p === '/element/sw1/attribute/value' ? switchValue : null);
      await d.setOffline(true);
      expect(lookups).toBeGreaterThanOrEqual(3);
      expect(switchValue).toBe('1');
      // The switch's accessibility identifier is stable across locales; a UK
      // phone labels it "Aeroplane Mode". The label alone would miss it.
      const [, lookup] = posts.find(([p, b]) => isAirplaneLookup(p, b));
      expect(lookup.value).toMatch(/name == 'com\.apple\.settings\.airplaneMode'/);
      expect(posts[posts.length - 1]).toEqual([
        '/appium/device/activate_app',
        { bundleId: 'com.example' },
      ]);
    });

    test('setOffline names the Settings screen when the switch never appears', async () => {
      const d = iosWaiting();
      const posts = [];
      d._post = async (p, body) => {
        posts.push([p, body]);
        if (isAirplaneLookup(p, body)) throw NOT_FOUND;
        if (p === '/element') return { ELEMENT: 'nav1' };
        return {};
      };
      d._get = async (p) => (p === '/element/nav1/attribute/name' ? 'Developer' : null);
      await expect(d.setOffline(true)).rejects.toThrow(
        /no Airplane Mode switch within 40ms; the screen open in Settings is "Developer"/,
      );
      // Still comes back to the app under test, as the contract says.
      expect(posts[posts.length - 1]).toEqual([
        '/appium/device/activate_app',
        { bundleId: 'com.example' },
      ]);
    });

    test('setOffline lets a lost WebDriverAgent session surface instead of polling past it', async () => {
      const d = iosWaiting();
      d._post = async (p, body) => {
        if (isAirplaneLookup(p, body)) throw new Error('fetch failed: ECONNREFUSED');
        return {};
      };
      d._get = async () => null;
      await expect(d.setOffline(true)).rejects.toThrow(/ECONNREFUSED/);
    });
  });
});

// ── The revoked launch's redirect message (2026-09-05) ─────────────────────
//
// On the OnePlus the snackbar "Your session has ended. Please sign in again."
// was in the kept first frame, yet the step that asserted it went red: it
// read the screen only after the launch step's screenshots and `advanceUntil`,
// ~5.6 s after launch, and the snackbar lives ~4 s. A transient message has
// to be asserted on the frames read WHILE it can exist — the seam is the
// launch, not a screen that has already moved on.

const SNACKBAR = 'Your session has ended';
const mainTree = androidXml(['main_roomsTab']);
const mainWithSnackbar =
  '<hierarchy>' +
  '<node resource-id="main_roomsTab" bounds="[0,0][100,100]" clickable="true" />' +
  '<node text="Your session has ended. Please sign in again." bounds="[0,900][100,1000]" />' +
  '</hierarchy>';
const signInTree = androidXml(['persona_picker_open']);

/** A fake phone whose successive reads walk `trees` (the last one repeats). */
const showing = (initial) => {
  let trees = initial;
  let i = 0;
  return {
    reads: 0,
    aliveChecks: [],
    show(next) {
      trees = next;
      i = 0;
    },
    async dumpXml() {
      this.reads += 1;
      return trees[Math.min(i++, trees.length - 1)];
    },
    // The runner asks whether the app process survived the redirect before it
    // reads the launch log (SHY-0500 run 5: a relaunched app read as a pass).
    async assertAppAlive(pkg, label) {
      this.aliveChecks.push([pkg, label]);
      return { pid: 1 };
    },
  };
};

describe('watchForText — a transient message, asserted on the frames read while it can exist', () => {
  test('a message already on the seed frame costs no read at all', async () => {
    const device = showing([mainTree]);
    const r = await watchForText(device, SNACKBAR, 500, { seed: parseNodes(mainWithSnackbar) });
    expect(r.seen).toBe(true);
    expect(r.reads).toBe(0);
    expect(device.reads).toBe(0);
  });

  test('a message that appears on a later frame is seen, and the read that saw it is counted', async () => {
    const device = showing([mainTree, mainTree, mainWithSnackbar]);
    const r = await watchForText(device, SNACKBAR, 5000, { seed: parseNodes(mainTree) });
    expect(r.seen).toBe(true);
    expect(r.reads).toBe(3);
    expect(r.afterMs).toBeGreaterThanOrEqual(0);
  });

  test('a message that never appears is reported, not thrown — the caller says what it means', async () => {
    const device = showing([mainTree]);
    const r = await watchForText(device, SNACKBAR, 300);
    expect(r.seen).toBe(false);
    expect(r.reads).toBeGreaterThanOrEqual(1);
  });
});

describe('revokedColdStart — the redirect is proven on the frames read while the message exists', () => {
  const launchFrame = {
    kind: 'main',
    nodes: parseNodes(mainTree),
    afterMs: 120,
    shot: 'J40-first-frame-revoked.png',
  };
  const fakeReporter = (onStepEnd) => ({
    steps: [],
    async step(_device, name, fn) {
      let result;
      try {
        result = await fn();
      } catch (error) {
        this.steps.push({ name, error });
        throw error;
      }
      this.steps.push({ name, result });
      onStepEnd(this.steps.length);
    },
  });
  const pieces = (device) => ({
    coldLaunch: async () => launchFrame,
    launchLog: async () => ({
      immediate: 'Main',
      confirm: 'confirm: refresh FAILED; sessionAlive=false',
    }),
    expectLog: (log, immediate, confirmRe) => {
      if (log.immediate !== immediate || !confirmRe.test(log.confirm))
        throw new Error(`log mismatch: ${JSON.stringify(log)}`);
    },
    drawnFirst: async (frame, expected) => `${expected} drawn ${frame.afterMs}ms after launch`,
    device,
  });

  test('passes when the message is on a frame read right after the launch, before sign-in is reached', async () => {
    // The phone: room list, then the snackbar over it, and (after the launch
    // step ends) the persona picker — the message is GONE by then.
    const device = showing([mainTree, mainWithSnackbar]);
    const reporter = fakeReporter((n) => {
      if (n === 1) device.show([signInTree]);
    });

    await revokedColdStart(device, reporter, {
      ...pieces(device),
      pkg: 'com.example',
      watchMs: 5000,
    });

    expect(reporter.steps.map((s) => s.name)).toEqual([
      'Revoked on the server: the room list is STILL what is drawn first',
      'Revoked: sent back to sign-in AND told why',
    ]);
    // The process is checked once, after the redirect, before the log is read.
    expect(device.aliveChecks).toEqual([['com.example', 'after the revoked-session redirect']]);
    expect(reporter.steps[0].result).toContain('J40-first-frame-revoked.png');
    expect(reporter.steps[1].result).toContain(SESSION_ENDED_TEXT);
    expect(reporter.steps[1].result).toMatch(/on read \d+/);
  });

  test('fails the "told why" step, naming the text and the reads, when the message never appears', async () => {
    const device = showing([mainTree]);
    const reporter = fakeReporter((n) => {
      if (n === 1) device.show([signInTree]);
    });

    await expect(
      revokedColdStart(device, reporter, { ...pieces(device), watchMs: 300 }),
    ).rejects.toThrow(/"Your session has ended" never appeared on the \d+ frames? read/);

    expect(reporter.steps[0].result).toBeDefined();
    expect(reporter.steps[1].error).toBeDefined();
    // A dead process would have been reported as a death, not as "never told
    // why": the liveness check runs before the verdict on the message.
    expect(device.aliveChecks).toHaveLength(1);
  });
});
