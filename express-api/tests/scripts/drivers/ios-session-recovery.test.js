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
  const device = () => createIosJourneyDevice({ udid: 'A'.repeat(36), bundleId: 'com.example' });

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
    _get: 'raw transport — the retry wraps whole operations, not single calls',
    _post: 'raw transport',
    _session: 'raw transport',
    ensureSession: 'ESTABLISHES the session — recovering it would be circular',
    install: 'never reaches WDA — refuses by design, see SHY-0446',
    uninstall: 'never reaches WDA — refuses by design, see SHY-0446',
  };

  /** How to invoke each command that must recover. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shy-ios-rec-'));
  const CALLS = {
    tapElement: (d) => d.tapElement('support_send'),
    tapElementByLabel: (d) => d.tapElementByLabel('Sign Out'),
    typeText: (d) => d.typeText('support_input', 'hello'),
    tap: (d) => d.tap(100, 200),
    swipe: (d) => d.swipe(100, 800, 100, 200),
    screencap: (d) => d.screencap(path.join(tmp, 'shot.png')),
    measure: (d) => d.measure(),
  };

  const commands = Object.getOwnPropertyNames(
    Object.getPrototypeOf(createIosJourneyDevice({ udid: 'A'.repeat(36), bundleId: 'x' })),
  ).filter((name) => !(name in NOT_A_SESSION_COMMAND));

  test('the call table covers every command the prototype exposes', () => {
    // The guard on the guard. A new WDA command lands here first, so it cannot
    // be added without someone deciding whether it needs recovery.
    const uncovered = commands.filter((c) => !(c in CALLS));
    expect({ uncovered }).toEqual({ uncovered: [] });
  });

  /** A device whose transport dies once with a session-lost error, then works. */
  function deviceThatLosesWdaOnce() {
    const d = createIosJourneyDevice({ udid: 'A'.repeat(36), bundleId: 'com.example' });
    d._sessionId = 'dead-session';
    let failed = false;
    const reply = (routePath) => {
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

  test('an element that is absent still fails, and is not retried away', async () => {
    // The recovery must not become a way for a missing control to pass.
    const d = createIosJourneyDevice({ udid: 'A'.repeat(36), bundleId: 'com.example' });
    let calls = 0;
    d._post = async () => {
      calls += 1;
      throw new Error('POST /element -> 404: An element could not be located on the page');
    };
    await expect(d.tapElement('nope')).rejects.toThrow(/could not be located/);
    expect(calls).toBe(1);
  });
});
