/**
 * Recovering from a WebDriverAgent that dies mid-command (SHY-0446).
 *
 * Eight of the thirteen on-device journeys failed on the iPhone. The report
 * blamed the product — "SignIn not reached", a dump full of iOS home-screen
 * icons — and the actual error, once a run was instrumented, was:
 *
 *   POST /element/…/click -> 500: Could not proxy command to the remote
 *   server. Original error: socket hang up
 *
 * WDA had died. The dump taken at that moment shows the app sitting perfectly
 * happily on Home, so nothing was wrong with ShyTalk at all.
 *
 * `dumpXml` already survives this: it clears `_sessionId` on failure and
 * retries, and a fresh Appium session relaunches the app because
 * `appium:bundleId` is set. EVERY OTHER command — click, type, swipe,
 * screenshot — had neither. Worse, the dead session id stayed on the object,
 * so every later command failed too, which is why one WDA death took out a
 * whole journey and the next run then passed. That alternating pattern is the
 * signature.
 *
 * Two pieces, both pure enough to pin without a phone: WHICH failures mean the
 * session is gone, and WHAT to do about it.
 */

const {
  isSessionLost,
  createIosJourneyDevice,
} = require('../../../scripts/drivers/ios-journey-device');

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

describe('isSessionLost', () => {
  test('the failure that actually took the journeys out', () => {
    expect(
      isSessionLost(
        new Error(
          'POST /element/63000000-0000-0000-3E0E-000000000000/click -> 500: Could not proxy command to the remote server. Original error: socket hang up',
        ),
      ),
    ).toBe(true);
  });

  test('every shape of a session that is gone', () => {
    [
      'socket hang up',
      'Could not proxy command to the remote server',
      'invalid session id',
      'A session is either terminated or not started',
      'connect ECONNREFUSED 127.0.0.1:8100',
      'read ECONNRESET',
      'The requested resource could not be found, or a request was received using an HTTP method that is not supported',
    ].forEach((message) => {
      expect({ message, lost: isSessionLost(new Error(message)) }).toEqual({ message, lost: true });
    });
  });

  test('an element that is simply NOT THERE is not a dead session', () => {
    // The single most important case. This is Appium's normal answer for a
    // control that has not appeared yet, and the journeys ask that question
    // constantly. Treating it as a session death would tear down and rebuild
    // the session on every ordinary miss — turning a 200ms "not yet" into a
    // full relaunch, and hiding genuine absences behind a retry.
    [
      'POST /element -> 404: An element could not be located on the page using the given search parameters.',
      'no element with accessibility id "support_send" to tap',
      'tap target #persona_picker_open not found on screen',
    ].forEach((message) => {
      expect({ message, lost: isSessionLost(new Error(message)) }).toEqual({
        message,
        lost: false,
      });
    });
  });

  test('nothing to classify is not a dead session', () => {
    expect(isSessionLost(null)).toBe(false);
    expect(isSessionLost(undefined)).toBe(false);
    expect(isSessionLost(new Error(''))).toBe(false);
    expect(isSessionLost('socket hang up')).toBe(true); // a bare string still classifies
  });
});

describe('withSessionRecovery', () => {
  const device = () =>
    createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });

  test('a call that works is not retried and is not slowed', async () => {
    const d = device();
    let calls = 0;
    const out = await d.withSessionRecovery('tap', async () => {
      calls += 1;
      return 'ok';
    });
    expect({ out, calls }).toEqual({ out: 'ok', calls: 1 });
  });

  test('a dead session is retried ONCE, after the session id is cleared', async () => {
    const d = device();
    d._sessionId = 'dead-session';
    const seenSessionIds = [];
    let calls = 0;
    const out = await d.withSessionRecovery('tapElement', async () => {
      calls += 1;
      seenSessionIds.push(d._sessionId);
      if (calls === 1)
        throw new Error('Could not proxy command to the remote server. socket hang up');
      return 'recovered';
    });
    expect(out).toBe('recovered');
    expect(calls).toBe(2);
    // The whole operation re-runs, not just the HTTP call: element handles do
    // not survive a session change, so a retry MUST re-resolve them.
    expect(seenSessionIds).toEqual(['dead-session', null]);
  });

  test('an ordinary failure is not retried and reaches the caller unchanged', async () => {
    const d = device();
    d._sessionId = 'live-session';
    let calls = 0;
    await expect(
      d.withSessionRecovery('tapElement', async () => {
        calls += 1;
        throw new Error('POST /element -> 404: An element could not be located on the page');
      }),
    ).rejects.toThrow(/could not be located/);
    expect(calls).toBe(1);
    expect(d._sessionId).toBe('live-session');
  });

  test('two deaths in a row is a real problem, and says which command', async () => {
    // Bounded on purpose. Retrying for ever against a phone whose WDA will not
    // come back turns a clear failure into a hang, and the run learns nothing.
    const d = device();
    let calls = 0;
    await expect(
      d.withSessionRecovery('tapElement(support_send)', async () => {
        calls += 1;
        throw new Error('socket hang up');
      }),
    ).rejects.toThrow(/tapElement\(support_send\)/);
    expect(calls).toBe(2);
  });

  test('the second failure keeps the original cause in the message', async () => {
    const d = device();
    await expect(
      d.withSessionRecovery('typeText', async () => {
        throw new Error(
          'Could not proxy command to the remote server. Original error: socket hang up',
        );
      }),
    ).rejects.toThrow(/socket hang up/);
  });
});

describe('every device command survives a WebDriverAgent restart', () => {
  // The CLASS, not the instance. `dumpXml` was protected and nothing else
  // was, which is how one WDA death took out eight journeys. The method list
  // is DERIVED from the prototype rather than typed out, so a command added
  // later fails this test until it is wrapped too.

  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');

  /**
   * Commands that legitimately do not talk to WDA over the session, with the
   * reason each is exempt. Anything not here MUST recover.
   */
  const NOT_A_SESSION_COMMAND = {
    constructor: 'not a command',
    capabilities: 'pure — builds the session payload',
    launch: 'devicectl, not WDA',
    size: 'cached locally',
    quit: 'tears the session DOWN; recovering into a new one would defeat it',
    forceStop: 'already best-effort; a terminate that fails is fine',
    dumpXml: 'has its own retry, older and stronger (it also retries a non-hierarchy reply)',
    withSessionRecovery: 'is the mechanism',
    _transport:
      'raw transport — it is what _get/_post call, and it is where the session ' +
      'is DROPPED on a socket failure so the next command reconnects. Wrapping ' +
      'it in the retry would retry single calls, which is what the retry ' +
      'deliberately does not do.',
    _get: 'raw transport — the retry wraps whole operations, not single calls',
    _post: 'raw transport',
    _session: 'raw transport',
    _sessionRefused:
      'pure — builds the error a refused session raises, and touches nothing. ' +
      'There is no operation here to retry.',
    _releaseKnownSessions:
      'tears sessions DOWN, like quit. It runs when things are ALREADY wrong — ' +
      'it is the SHY-0452 escalation for a wedged WebDriverAgent — so recovering ' +
      'it into a fresh session would defeat the thing it exists to do.',
    ensureSession: 'ESTABLISHES the session — recovering it would be circular',
    _applyPerformanceSettings:
      'runs INSIDE session establishment, on a session just granted — the same ' +
      'circularity as ensureSession. It calls fetch directly rather than through ' +
      '_get/_post, is best-effort by design, and swallows its own failure with a ' +
      'warning: a slower run is worth more than no run.',
    install: 'never reaches WDA — refuses by design, see SHY-0446',
    uninstall: 'never reaches WDA — refuses by design, see SHY-0446',
    clearAppLog:
      'never reaches WDA — it reads the device clock over USB as the mark for the next ' +
      'launch (SHY-0500); a lost WebDriverAgent session has nothing to do with the device log',
    readAppLog:
      'never reaches WDA — it pulls the persisted log archive over USB and reads the app ' +
      'process out of it from the mark',
    _runLogTool:
      'the USB log tools behind clearAppLog and readAppLog — a child process, not a session',
  };

  /** How to invoke each command that must recover. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shy-ios-rec-'));
  const CALLS = {
    tapElement: (d) => d.tapElement('support_send'),
    tapElementByLabel: (d) => d.tapElementByLabel('Sign Out'),
    longPressElement: (d) => d.longPressElement('room_message_1', 0.6),
    hideKeyboard: (d) => d.hideKeyboard(),
    typeText: (d) => d.typeText('support_input', 'hello'),
    tap: (d) => d.tap(100, 200),
    swipe: (d) => d.swipe(100, 800, 100, 200),
    screencap: (d) => d.screencap(path.join(tmp, 'shot.png')),
    measure: (d) => d.measure(),
    setOffline: (d) => d.setOffline(true),
  };

  const commands = Object.getOwnPropertyNames(
    Object.getPrototypeOf(
      createIosJourneyDevice({
        udid: 'A'.repeat(36),
        hardwareUdid: TEST_HARDWARE_UDID,
        bundleId: 'x',
      }),
    ),
  ).filter((name) => !(name in NOT_A_SESSION_COMMAND));

  /**
   * How each replayed command is made SAFE to run twice — or why it is not.
   *
   * `withSessionRecovery` re-runs the whole operation, so every command it
   * wraps can execute twice against the phone. That was documented as an
   * accepted risk, and on 2026-08-24 it cost three journeys in nine runs, in
   * two different shapes: a click replayed onto the screen it had already
   * opened (J39, loud), and a sentence typed twice into one field (J38,
   * silent). Fixing them one at a time is how the third one gets missed, so
   * the DECISION is what is pinned here.
   * See [[feedback-guard-the-class-not-the-instance]].
   */
  const REPLAY_SAFETY = {
    tapElement: 'a control that has GONE after a click we issued means the click landed',
    tapElementByLabel: 'same as tapElement — and dialog buttons are the likeliest to vanish',
    hideKeyboard:
      'idempotent — dismissing a keyboard that is already down is a no-op, and it swallows ' +
      'a WDA refusal rather than failing a journey over a cosmetic tidy-up',
    longPressElement:
      'same as tapElement, and more so: a long press that LANDED has opened a context ' +
      'menu over the element, so the replay cannot find it and fails loudly rather than ' +
      'pressing something the menu now covers',
    typeText: 'the replay CLEARS first, because XCUITest /value appends rather than replaces',
    tap: 'ACCEPTED: a coordinate carries no identity, so a replay cannot tell what it hit',
    swipe: 'ACCEPTED: a repeated scroll overshoots at worst, and the callers re-read after',
    screencap: 'idempotent — overwrites the same file',
    measure: 'idempotent — reads the window size',
    setOffline:
      'idempotent — it READS the Airplane Mode switch before touching it, so a replay ' +
      'after a lost answer flips nothing a second time',
  };

  test('every replayed command has DECIDED how it survives running twice', () => {
    // The guard that stops this being a list of three bugs someone fixed.
    // Non-vacuous first: an empty CALLS would make the filter below pass while
    // proving nothing. See [[feedback-source-scanning-guards-need-their-own-anchors]].
    expect(Object.keys(CALLS).length).toBeGreaterThan(0);
    const undecided = Object.keys(CALLS).filter((c) => !(c in REPLAY_SAFETY));
    expect({ undecided }).toEqual({ undecided: [] });
  });

  test('the call table covers every command the prototype exposes', () => {
    // The guard on the guard. A new WDA command lands here first, so it cannot
    // be added without someone deciding whether it needs recovery.
    const uncovered = commands.filter((c) => !(c in CALLS));
    expect({ uncovered }).toEqual({ uncovered: [] });
  });

  /**
   * What the driver said out loud during a test.
   *
   * The tolerances below are deliberately NOT silent, so a warning is part of
   * the contract and is asserted like any other output. Collected through the
   * driver's injected `warn` — a real function, not a patched console and not
   * a mock, which SHY-0108's stub guard rightly refuses.
   */
  let warnings = [];
  beforeEach(() => {
    warnings = [];
  });
  const warned = () => warnings.join(' ');
  /** A device that reports its warnings to this test instead of the terminal. */
  const speakingDevice = (over = {}) =>
    createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
      warn: (...args) => warnings.push(args.join(' ')),
      ...over,
    });

  /** A device whose transport dies once with a session-lost error, then works. */
  function deviceThatLosesWdaOnce() {
    const d = createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
    d._sessionId = 'dead-session';
    let failed = false;
    const reply = (routePath) => {
      // The Airplane Mode switch setOffline(true) reads: already on, so the
      // replay has nothing to flip.
      if (String(routePath).includes('/attribute/value')) return '1';
      if (String(routePath).includes('/element') && !String(routePath).includes('/click'))
        return { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
      if (String(routePath).includes('/screenshot')) return Buffer.from('png').toString('base64');
      if (String(routePath).includes('/window/rect')) return { width: 390, height: 844 };
      return {};
    };
    const transport = async (routePath) => {
      if (!failed) {
        failed = true;
        throw new Error(
          `POST ${routePath} -> 500: Could not proxy command to the remote server. Original error: socket hang up`,
        );
      }
      return reply(routePath);
    };
    d._post = transport;
    d._get = transport;
    d.calls = () => failed;
    return d;
  }

  commands.forEach((name) => {
    test(`${name} recovers instead of failing the journey`, async () => {
      const d = deviceThatLosesWdaOnce();
      await expect(CALLS[name](d)).resolves.not.toThrow();
      // The dead id must be gone, or every LATER command fails too — which is
      // what turned one WDA death into a whole failed journey.
      expect(d._sessionId).toBeNull();
    });
  });

  test('a click whose ANSWER was lost is not replayed onto the next screen', async () => {
    // J39, twice in six runs on 2026-08-24:
    //
    //   What lost the session: POST /element/B201.../click -> 500: Could not
    //   proxy command to the remote server. Original error: socket hang up
    //   — the replay then failed with: POST /element -> 404
    //
    // The on-screen tags proved the form had OPENED. The click landed;
    // WebDriverAgent died on the reply; the replay then hunted a control the
    // successful click had navigated away from, and failed a journey that had
    // actually done exactly what it was asked to do.
    //
    // `withSessionRecovery` documents this as accepted — "if WDA died AFTER
    // acting on a command but before answering, the retry repeats it" — and it
    // was, when the alternative was failing the run outright. The replay just
    // has to ask whether the first attempt already worked. A control that has
    // GONE after a lost click is the answer.
    const d = speakingDevice();
    d._sessionId = 'live';
    let clicked = 0;
    d._post = async (routePath) => {
      if (String(routePath).includes('/click')) {
        clicked += 1;
        // The click TAKES EFFECT, then the answer is lost.
        throw new Error(
          'POST /click -> 500: Could not proxy command to the remote server. ' +
            'Original error: socket hang up',
        );
      }
      // After the navigation the control no longer exists.
      if (clicked > 0) {
        throw new Error('POST /element -> 404: An element could not be located on the page');
      }
      return { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
    };

    await expect(d.tapElement('support_contactAnyway')).resolves.toBeUndefined();
    // Never silently: the journey's NEXT step is what really decides, and it
    // must be possible to see this in the log when that step is the one that
    // fails. See [[feedback-silent-guards-and-stringly-typed-contracts]].
    expect(warned()).toMatch(/support_contactAnyway/);
    // And the click is not repeated — replaying a landed click is the defect,
    // not the cure.
    expect(clicked).toBe(1);
  });

  test('the same holds for a click by LABEL, which is where dialogs live', async () => {
    // Fixed in the same sweep rather than waiting for a journey to find it
    // here too. A dialog's "Later" is precisely the control that STOPS
    // EXISTING the instant it is pressed, so a lost answer leaves the replay
    // hunting something that cannot be there.
    // See [[feedback-guard-the-class-not-the-instance]].
    const d = speakingDevice();
    d._sessionId = 'live';
    let clicked = 0;
    d._post = async (routePath) => {
      if (String(routePath).includes('/click')) {
        clicked += 1;
        throw new Error(
          'POST /click -> 500: Could not proxy command to the remote server. ' +
            'Original error: socket hang up',
        );
      }
      if (clicked > 0) {
        throw new Error('POST /element -> 404: An element could not be located on the page');
      }
      return { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
    };

    await expect(d.tapElementByLabel('Later')).resolves.toBeUndefined();
    expect(warned()).toMatch(/Later/);
    expect(clicked).toBe(1);
  });

  test('a control that was NEVER clicked still fails by label', async () => {
    // The tolerance is scoped to "we already clicked it". A label that was
    // never there must still be an error, or a typo'd dialog button becomes a
    // silent no-op that passes every run.
    const d = createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
    d._sessionId = 'live';
    d._post = async () => {
      throw new Error('POST /element -> 404: An element could not be located on the page');
    };
    await expect(d.tapElementByLabel('Nope')).rejects.toThrow(/could not be located/);
  });

  test('typing that lost its answer is REPLACED on the replay, not appended', async () => {
    // J38, run 8 of 9 on 2026-08-24, and the worst shape this defect takes:
    //
    //   the field says "J38 run ...since this morningJ38 run ...since this
    //   morning" but she typed "J38 run ...since this morning"
    //
    // XCUITest's /value APPENDS keystrokes; it does not replace. So when the
    // answer to a type is lost and withSessionRecovery replays the operation,
    // the text lands TWICE. That is worse than the click case: a click replay
    // fails loudly on a missing control, and this one silently corrupts the
    // field and fails later at an assertion about content.
    //
    // Clearing first makes the replay idempotent, so the field ends up with
    // what the caller asked for whether or not the first attempt landed --
    // and clearing is scoped to the REPLAY, because journeys rely on typing
    // adding to a field that already holds something.
    const d = speakingDevice();
    d._sessionId = 'live';
    const routes = [];
    let values = 0;
    d._post = async (routePath) => {
      routes.push(String(routePath));
      if (String(routePath).includes('/value')) {
        values += 1;
        // The keystrokes LAND, then the answer is lost.
        if (values === 1) {
          throw new Error(
            'POST /value -> 500: Could not proxy command to the remote server. ' +
              'Original error: socket hang up',
          );
        }
        return {};
      }
      if (String(routePath).includes('/element/')) return {};
      return { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
    };

    await expect(d.typeText('support_input', 'hello')).resolves.toBeUndefined();
    // The replay must CLEAR before it types again, or the field holds "hellohello".
    const clearIndex = routes.findIndex((r) => r.includes('/clear'));
    const secondValueIndex = routes.map((r) => r.includes('/value')).lastIndexOf(true);
    expect(clearIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(secondValueIndex);
  });

  test('a FIRST type does not clear, because journeys add to filled fields', async () => {
    // Scoped deliberately. "Going back costs her nothing she typed" is a real
    // J38 assertion: the field keeps its content across a navigation, and a
    // typeText that always cleared would erase it.
    const d = createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
    d._sessionId = 'live';
    const routes = [];
    d._post = async (routePath) => {
      routes.push(String(routePath));
      if (String(routePath).includes('/element/')) return {};
      return { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
    };
    await d.typeText('support_input', 'hello');
    expect(routes.some((r) => r.includes('/clear'))).toBe(false);
  });

  test('an element that is absent still fails, and the look is bounded', async () => {
    // The recovery must not become a way for a missing control to pass.
    //
    // `tapElement` deliberately looks TWICE: `404 could not be located` does not
    // mean the control is absent, it means WebDriverAgent did not see it in that
    // instant, which a screen still arriving produces for a control the caller
    // has just read from the tree. Observed twice on 2026-08-24, on
    // `persona_row_P-02` and `main_settingsButton`, each failing a journey that
    // was otherwise fine.
    //
    // So the contract this guards is NOT "exactly one look" — that was a
    // statement about the mechanism, and the mechanism changed on purpose. It is
    // that an absent control still FAILS, and that the looking is BOUNDED. Both
    // are asserted: an unbounded retry, or a miss that resolves, still reddens
    // this test. See [[feedback-assert-the-seam-not-the-sides]].
    const d = createIosJourneyDevice({
      udid: 'A'.repeat(36),
      hardwareUdid: TEST_HARDWARE_UDID,
      bundleId: 'com.example',
    });
    let calls = 0;
    d._post = async () => {
      calls += 1;
      throw new Error('POST /element -> 404: An element could not be located on the page');
    };
    await expect(d.tapElement('nope')).rejects.toThrow(/could not be located/);
    expect(calls).toBe(2);
  });
});
