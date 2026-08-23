/**
 * Reading the Android screen through a warm server instead of a cold one
 * (SHY-0447).
 *
 * Measured on the real OnePlus, 2026-08-23:
 *
 *   uiautomator dump          2332ms
 *   UiAutomator2 /source        65ms      36x
 *
 * `uiautomator dump` spawns a fresh instrumentation for every single call, and
 * a J38 walk made 78 of them — 182 seconds, 86% of the run. It is the same
 * cost on the Android launcher as inside ShyTalk, so it is the tool, not the
 * app. iOS was never slow this way because WebDriverAgent is a server that
 * stays up.
 *
 * Only the READ moves. Taps and swipes stay on adb, which is proven and is not
 * where the time goes.
 */

const {
  createAndroidSourceSession,
  ANDROID_SOURCE_UNAVAILABLE,
} = require('../../../scripts/drivers/android-source-session');

/** A stand-in Appium that records what was asked of it. */
function fakeAppium({ sourceReplies = [], sessionFails = false } = {}) {
  const calls = [];
  let killed = false;
  return {
    calls,
    get killed() {
      return killed;
    },
    async request(method, path, _body) {
      calls.push(`${method} ${path}`);
      if (path === '/session' && method === 'POST') {
        if (sessionFails) throw new Error('Could not find a driver for automationName');
        return { sessionId: 'sess-1' };
      }
      if (path.endsWith('/source')) {
        const next = sourceReplies.shift();
        if (next instanceof Error) throw next;
        return next ?? '<hierarchy><node text="hi" /></hierarchy>';
      }
      if (method === 'DELETE') {
        killed = true;
        return {};
      }
      return {};
    },
  };
}

describe('createAndroidSourceSession', () => {
  test('reads the screen over one warm session, not a new one each time', async () => {
    const appium = fakeAppium();
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    await s.dumpXml();
    await s.dumpXml();
    await s.dumpXml();

    // One session created, three reads. The whole point: the cost of standing
    // the server up is paid once, not 78 times.
    expect(appium.calls.filter((c) => c === 'POST /session')).toHaveLength(1);
    expect(appium.calls.filter((c) => c.endsWith('/source'))).toHaveLength(3);
  });

  test('an Appium that cannot serve Android returns null rather than throwing', async () => {
    // The runner must still work on a machine without the driver installed.
    const appium = fakeAppium({ sessionFails: true });
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    expect(s).toBeNull();
  });

  test('a reply that is not a hierarchy is a failure, not an empty screen', async () => {
    // An empty node list reads to every caller as "the element is absent",
    // which is indistinguishable from "the read failed" — the same trap the
    // iOS dump guards against.
    const appium = fakeAppium({ sourceReplies: ['<html>Appium error page</html>'] });
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    await expect(s.dumpXml()).rejects.toThrow(/hierarchy/i);
  });

  test('a dead session is rebuilt once and the read retried', async () => {
    const appium = fakeAppium({
      sourceReplies: [new Error('socket hang up'), '<hierarchy><node text="back" /></hierarchy>'],
    });
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    const xml = await s.dumpXml();
    expect(xml).toContain('back');
    expect(appium.calls.filter((c) => c === 'POST /session')).toHaveLength(2);
  });

  test('an ordinary failure is not mistaken for a dead session', async () => {
    const appium = fakeAppium({ sourceReplies: [new Error('something specific went wrong')] });
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    await expect(s.dumpXml()).rejects.toThrow(/something specific/);
    expect(appium.calls.filter((c) => c === 'POST /session')).toHaveLength(1);
  });

  test('closing ends the session, so the next run does not collide with it', async () => {
    const appium = fakeAppium();
    const s = await createAndroidSourceSession({ serial: 'S1', request: appium.request });
    await s.close();
    expect(appium.killed).toBe(true);
  });

  test('the unavailable reason is a sentence somebody can act on', () => {
    // Falling back silently would hide a 36x regression behind a green run.
    expect(ANDROID_SOURCE_UNAVAILABLE).toMatch(/appium driver install uiautomator2/);
  });
});
