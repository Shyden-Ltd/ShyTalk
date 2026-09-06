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

const fs = require('node:fs');
const path = require('node:path');

const {
  createAndroidSourceSession,
  normaliseUiAutomator2Source,
  ANDROID_SOURCE_UNAVAILABLE,
} = require('../../../scripts/drivers/android-source-session');
const { parseNodes, byId } = require('../../../scripts/device-journey-runner');

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

  test('an Appium that cannot serve Android returns null rather than throwing, and says why', async () => {
    // The runner must still work on a machine without the driver installed —
    // but the REASON must reach the operator. On 2026-09-05 every Android
    // read silently took 2.3 s for a whole run because the server had no
    // ANDROID_HOME; the 500 that said so was swallowed here.
    const appium = fakeAppium({ sessionFails: true });
    const said = [];
    const s = await createAndroidSourceSession({
      serial: 'S1',
      request: appium.request,
      log: (line) => said.push(line),
    });
    expect(s).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/UiAutomator2 session refused/);
    expect(said[0]).toMatch(/Could not find a driver for automationName/);
  });

  test("the refusal reason is Appium's own sentence, so a missing ANDROID_HOME reads as exactly that", async () => {
    const said = [];
    const request = async (method, path) => {
      if (method === 'POST' && path === '/session') {
        throw new Error(
          'POST /session -> 500: Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported',
        );
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    const s = await createAndroidSourceSession({
      serial: 'S1',
      request,
      log: (line) => said.push(line),
    });
    expect(s).toBeNull();
    expect(said[0]).toMatch(/ANDROID_HOME nor ANDROID_SDK_ROOT/);
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

describe('normaliseUiAutomator2Source', () => {
  // UiAutomator2 puts the CLASS in the tag name:
  //
  //   uiautomator dump   <node class="android.widget.Button" resource-id="x" .../>
  //   UiAutomator2       <android.widget.Button class="android.widget.Button" resource-id="x" .../>
  //
  // Everything else — resource-id, text, bounds, enabled, clickable — is
  // identical. Verified against the real phone on 2026-08-23: both readers
  // returned the SAME EIGHT ids on the same Home screen, Compose testTags
  // included.
  //
  // So the tag is renamed at the seam and `parseNodes` never learns there are
  // two formats. That keeps byId, byText, occluderOf, assertReachable and
  // every test built on them exactly as proven.

  const fixture = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'uiautomator2-source-sample.xml'),
    'utf8',
  );

  test('the fixture is real UiAutomator2 output, not a hand-made stand-in', () => {
    // The anchor. A fixture that drifted into `<node>` shape would make every
    // assertion below pass without testing anything.
    expect(fixture).toMatch(/<android\.[a-z]/);
    expect(fixture).toContain('<hierarchy');
  });

  test('parseNodes finds nothing in the raw format — which is the bug', () => {
    // This is what a real walk hit: "screen showed: (none)" with the phone
    // sitting on a perfectly good screen.
    expect(parseNodes(fixture, 'android')).toHaveLength(0);
  });

  test('after normalising, the Compose testTags are all there', () => {
    const nodes = parseNodes(normaliseUiAutomator2Source(fixture), 'android');
    expect(nodes.length).toBeGreaterThan(0);
    ['main_roomsTab', 'main_messagesTab', 'main_profileTab'].forEach((id) => {
      expect({ id, found: Boolean(byId(nodes, id)) }).toEqual({ id, found: true });
    });
  });

  test('bounds survive, so reachability and taps still work', () => {
    const nodes = parseNodes(normaliseUiAutomator2Source(fixture), 'android');
    const tab = byId(nodes, 'main_roomsTab');
    expect(tab.center).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(tab.bounds.x2).toBeGreaterThan(tab.bounds.x1);
    expect(tab.bounds.y2).toBeGreaterThan(tab.bounds.y1);
    // The class comes from the ATTRIBUTE, which both formats carry — renaming
    // the tag must not have cost it, because occluderOf reads it.
    expect(tab.cls).toMatch(/^android\./);
  });

  test('the hierarchy root is left alone', () => {
    expect(normaliseUiAutomator2Source(fixture)).toContain('<hierarchy');
  });

  test('output already in node form is returned untouched', () => {
    // The fallback path produces it, and normalising twice must be harmless.
    const already = '<hierarchy><node resource-id="a" bounds="[0,0][10,10]" /></hierarchy>';
    expect(normaliseUiAutomator2Source(already)).toBe(already);
  });
});

/**
 * SHY-0451, swept to the sibling platform.
 *
 * The iPhone stall was an Appium round trip with no timeout: `fetch` has no
 * default, so a wedged server holds the request until the OS gives up. Android
 * had never shown the symptom — its reads are 65ms and its Appium path is
 * healthier — but it had the identical unbounded call, so it was one bad day
 * away from the same once-per-run stall.
 *
 * A lesson found in one place applies everywhere; this pins it here so the
 * sweep cannot quietly come undone. See [[feedback-consistency-whole-project]].
 */
describe('the Android Appium round trip is bounded (SHY-0451 sweep)', () => {
  const http = require('node:http');
  const {
    createAndroidSourceSession,
    APPIUM_REQUEST_TIMEOUT_MS,
  } = require('../../../scripts/drivers/android-source-session');

  test('the budget is finite', () => {
    // The value it replaced was Infinity, which is the whole defect.
    expect(Number.isFinite(APPIUM_REQUEST_TIMEOUT_MS)).toBe(true);
    expect(APPIUM_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test('a server that never answers does not hang the read forever', async () => {
    // A REAL socket that is accepted and never written to — what a wedged
    // Appium actually looks like. No mock could prove a signal is attached.
    const held = [];
    const server = http.createServer((_req, res) => held.push(res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // No `request` override, so the REAL `httpRequest` runs — an injected
      // stand-in would prove nothing about whether a signal is attached.
      // Opening the session IS the round trip: it returns null when Appium
      // cannot serve, and the contract is that it RETURNS at all.
      await expect(
        createAndroidSourceSession({
          serial: 'no-such-device',
          appiumBaseUrl: baseUrl,
          requestTimeoutMs: 300,
        }),
      ).resolves.toBeNull();
    } finally {
      for (const res of held) res.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
    // Reaching this line at all is the assertion: an unbounded call never
    // returns, and jest kills the test instead.
  });
});
