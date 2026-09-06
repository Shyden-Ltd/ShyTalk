/**
 * ios-journey-device-timeouts.test.js
 *
 * SHY-0451 — the iPhone stall that survived five hypotheses.
 *
 * Roughly once per fourteen-journey run, exactly ONE journey took 310-415
 * seconds while every other took 20-28. A different journey each time, and it
 * usually passed. Two fixes were shipped against it and neither moved it:
 *
 *   COMMAND_TIMEOUT_MS   bounded every WDA command at 20s, then 10s   persisted
 *   DUMP_RETRY_BUDGET_MS bounded one screen read at 45s, then 10s     persisted
 *
 * Both docstrings still claimed the stall. The arithmetic fitted (7 x 45s =
 * 315s vs a measured 312,193ms) and the fit was a coincidence.
 *
 * What neither bound covered is the thing `COMMAND_TIMEOUT_MS` explicitly
 * excluded, in writing:
 *
 *     "NOT applied to session creation, which legitimately takes minutes
 *      while WebDriverAgent builds and installs (appium:wdaLaunchTimeout)."
 *
 * `_get` and `_post` DO carry `AbortSignal.timeout(COMMAND_TIMEOUT_MS)` — but
 * both open with `await this._session()`, which sits OUTSIDE that signal and
 * whose own `fetch` had no signal at all. So the most expensive operation the
 * driver performs was the one operation nothing bounded, and it was reached
 * from inside calls the code believed were capped at ten seconds.
 *
 * That is the whole stall. `withSessionRecovery` answers a dead WebDriverAgent
 * by clearing `_sessionId` and re-running the operation; the re-run calls
 * `_session()`, and because WDA has just died Appium must RELAUNCH it — the
 * `appium:wdaLaunchTimeout: 180000` path. One of those, unbounded, inside a
 * recovery ladder that can run two of them, is 310-415 seconds exactly.
 *
 * It explains every part of the signature the five ruled-out hypotheses could
 * not: once per run (a WDA death is rare), a different journey each time (not
 * journey-specific), usually passes (recovery works, just slowly), and
 * concentrated in `signOutFlow` (the most command-dense stretch, so the most
 * likely to be holding the ball when WDA dies).
 *
 * A previous session DID measure `_session()` — "17 per run, 4.6-5.7s each" —
 * and cleared it. That is the HEALTHY case. A once-per-run outlier is exactly
 * what an average hides.
 *
 * These tests use a REAL http server that accepts the connection and never
 * answers, which is what Appium looks like while it is relaunching
 * WebDriverAgent. Real socket, real fetch, real timeout — no mocks, because
 * the defect lives in whether a signal reaches a real request.
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const http = require('node:http');

const {
  IosDevice,
  SESSION_COLD_TIMEOUT_MS,
  SESSION_RECOVERY_TIMEOUT_MS,
  SETTINGS_TIMEOUT_MS,
  QUIT_TIMEOUT_MS,
} = require('../../../scripts/drivers/ios-journey-device');

const CORE_DEVICE_UUID = 'CEB70A3C-894C-471F-A1BA-6DBCB874CFB4';
const HARDWARE_UDID = '00008150-000954D90A20401C';

/** Well under any real bound, so a wired timeout makes these tests quick. */
const TEST_TIMEOUT_MS = 300;

/**
 * A real Appium-shaped server whose routes are decided per test.
 *
 * `onRequest` returning false means "accept the connection and never answer" —
 * the wedged-WebDriverAgent case. Anything it writes itself is the healthy one.
 */
async function startServer(onRequest) {
  const held = [];
  const server = http.createServer((req, res) => {
    // Held so `close()` cannot block on a socket the test deliberately hung.
    held.push(res);
    onRequest(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const res of held) res.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const buildAgainst = (baseUrl, over = {}) => {
  const device = new IosDevice({
    coreDeviceUuid: CORE_DEVICE_UUID,
    hardwareUdid: HARDWARE_UDID,
    bundleId: 'com.shyden.shytalk.local',
    appiumBaseUrl: baseUrl,
    sessionColdTimeoutMs: TEST_TIMEOUT_MS,
    sessionRecoveryTimeoutMs: TEST_TIMEOUT_MS,
    settingsTimeoutMs: TEST_TIMEOUT_MS,
    quitTimeoutMs: TEST_TIMEOUT_MS,
    ...over,
  });
  // Before a reopen the driver asks devicectl whether the app is still running
  // (SHY-0500: a lost session must not relaunch a crashed app). These tests
  // are about the SOCKET, so the app is reported alive without a phone.
  device._listProcesses = () => ({
    result: {
      runningProcesses: [{ executable: 'file:///Bundle/iosApp.app/iosApp', processIdentifier: 1 }],
    },
  });
  return device;
};

/** The healthy answer to POST /session. */
const respondWithSession = (res, sessionId = 'sess-1') => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ value: { sessionId } }));
};

describe('IosDevice bounds every request it makes (SHY-0451)', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('session creation gives up instead of hanging forever', async () => {
    // Accepts the socket, answers nothing. An unbounded fetch waits here until
    // the OS gives up — which is the stall, and is minutes, not seconds.
    server = await startServer(() => false);
    const device = buildAgainst(server.baseUrl);

    const started = Date.now();
    await expect(device.ensureSession()).rejects.toThrow(/session/i);
    // The REJECTION alone is not the contract — an unbounded fetch rejects too,
    // eventually. Landing inside the budget is the contract.
    expect(Date.now() - started).toBeLessThan(TEST_TIMEOUT_MS * 10);
  });

  test('a hung performance-settings call cannot hang session creation', async () => {
    // The session itself succeeds; the settings POST that runs inside
    // `_session()` is what wedges. It is best-effort, so the session must
    // still be usable — and must not have waited on it.
    server = await startServer((req, res) => {
      if (req.url === '/session') return respondWithSession(res);
      return false; // /session/:id/appium/settings never answers
    });
    const device = buildAgainst(server.baseUrl);

    const started = Date.now();
    await expect(device.ensureSession()).resolves.toBe('sess-1');
    expect(Date.now() - started).toBeLessThan(TEST_TIMEOUT_MS * 10);
  });

  test('teardown cannot hang on a wedged WebDriverAgent', async () => {
    // `quit()` walks EVERY session id it ever opened — 17 in a real run. One
    // unbounded DELETE per id against a wedged WDA is the whole run again.
    server = await startServer((req, res) => {
      if (req.url === '/session') return respondWithSession(res);
      if (req.method === 'DELETE') return false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: {} }));
    });
    const device = buildAgainst(server.baseUrl);
    await device.ensureSession();

    const started = Date.now();
    await expect(device.quit()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(TEST_TIMEOUT_MS * 10);
  });

  test('the RECOVERY branch uses the recovery budget, not the cold one', async () => {
    // The constant existing proves nothing about which branch reads it. This
    // is the seam the fix turns on: a cold budget wide enough for a WDA build
    // must NOT be what a mid-run reconnect waits on, because that is precisely
    // how a wedge came to cost minutes. See [[feedback-test-the-caller-not-the-helper]].
    let answered = 0;
    server = await startServer((req, res) => {
      if (req.url !== '/session') return false;
      // First session healthy; the reconnect after it hangs, as a wedged
      // WebDriverAgent does.
      if (answered++ === 0) return respondWithSession(res);
      return false;
    });
    const device = buildAgainst(server.baseUrl, {
      // Deliberately far apart: if the recovery read the COLD budget, this
      // test would sit for a minute and jest would kill it.
      sessionColdTimeoutMs: 60000,
      sessionRecoveryTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expect(device.ensureSession()).resolves.toBe('sess-1');

    // What `withSessionRecovery` does when WebDriverAgent dies underneath it.
    device._sessionId = null;

    const started = Date.now();
    await expect(device.ensureSession()).rejects.toThrow(/session/i);
    expect(Date.now() - started).toBeLessThan(TEST_TIMEOUT_MS * 10);
  });

  test('a RECOVERY session is bounded far tighter than a cold one', async () => {
    // The two cases are not the same. A cold start may legitimately build and
    // install WebDriverAgent; a recovery reconnects to one already installed,
    // measured at 4.6-5.7s. Giving the recovery the cold budget is what let a
    // wedge cost minutes, so a single flat bound would restore the defect.
    expect(SESSION_RECOVERY_TIMEOUT_MS).toBeLessThan(SESSION_COLD_TIMEOUT_MS);
  });

  test('a command that times out DROPS the session, so the next one reconnects', async () => {
    // `COMMAND_TIMEOUT_MS` promises this in writing — "the driver drops the
    // session on error, so the next attempt reconnects instead of queueing
    // behind the same dead one" — and the code did not do it. `_get`/`_post`
    // never cleared `_sessionId`, and an abort is not in
    // SESSION_LOST_SIGNATURES, so `withSessionRecovery` did not clear it
    // either. After one wedge, every later command in the journey queued
    // behind the same dead session and paid the full timeout again.
    let sessions = 0;
    server = await startServer((req, res) => {
      if (req.url === '/session') return respondWithSession(res, `sess-${++sessions}`);
      return false; // every command wedges
    });
    const device = buildAgainst(server.baseUrl, { commandTimeoutMs: TEST_TIMEOUT_MS });

    await expect(device.tap(10, 20)).rejects.toThrow();
    expect(device._sessionId).toBeNull();
  });

  test('a command the server ANSWERS keeps the session, even when it fails', async () => {
    // The discriminator is the TRANSPORT, not the verdict. A 404 means WDA is
    // alive and said no; throwing that session away would churn a healthy
    // session on every missing element — 5s of reconnect for a normal miss.
    server = await startServer((req, res) => {
      if (req.url === '/session') return respondWithSession(res);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: { message: 'An element could not be located' } }));
    });
    const device = buildAgainst(server.baseUrl, { commandTimeoutMs: TEST_TIMEOUT_MS });

    await expect(device.tapElement('nope')).rejects.toThrow(/could not be located/);
    expect(device._sessionId).toBe('sess-1');
  });

  test('a recovery failure names the error that KILLED the session, not just the second one', async () => {
    // J39, 2026-08-24: "tapElement(main_settingsButton) failed twice across a
    // WebDriverAgent restart: POST /element -> 404". The 404 is the REPLAY
    // failing on a screen that had already moved on. What actually killed the
    // session was the first error — and it was discarded, so the run could not
    // say why WebDriverAgent went away. A diagnostic that drops the cause
    // sends the next session hunting the symptom.
    const device = buildAgainst('http://127.0.0.1:1');
    device._sessionId = 'live';
    let call = 0;
    device._post = async () => {
      call += 1;
      if (call === 1) throw new Error('POST /element -> 500: socket hang up');
      throw new Error('POST /element -> 404: An element could not be located');
    };

    const error = await device.tapElement('main_settingsButton').catch((e) => e);
    // Both, and neither is optional: the first says WHY the session died, the
    // second is what the operator actually sees on the failed step.
    expect(error.message).toMatch(/socket hang up/);
    expect(error.message).toMatch(/could not be located/);
    expect(call).toBeGreaterThan(1);
  });

  test('a refused reconnect CLEARS the wedged session and tries once more', async () => {
    // SHY-0452. WebDriverAgent wedges about twice in twelve runs; the reconnect
    // is then refused and a journey is lost. The likeliest reason is the one
    // the story names: Appium is still holding the session that died, and a new
    // one queues behind it. Nothing had ever asked Appium to let go of it.
    //
    // So a refused RECONNECT now deletes the sessions this driver knows about
    // and asks once more, instead of failing on the first refusal.
    let sessions = 0;
    let deleted = 0;
    server = await startServer((req, res) => {
      if (req.method === 'DELETE') {
        deleted += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ value: null }));
      }
      if (req.url !== '/session') return false;
      sessions += 1;
      // 1: the cold session, healthy. 2: the reconnect, wedged.
      // 3: after the wedged session is cleared, healthy again.
      if (sessions === 2) return false;
      return respondWithSession(res, `sess-${sessions}`);
    });
    const device = buildAgainst(server.baseUrl);
    await expect(device.ensureSession()).resolves.toBe('sess-1');

    device._sessionId = null; // what withSessionRecovery does on a dead WDA
    await expect(device.ensureSession()).resolves.toBe('sess-3');
    expect(deleted).toBeGreaterThan(0);
  });

  test('a COLD session does not try to clear anything', async () => {
    // There is nothing to clear before the first session, and a DELETE against
    // a server that has never issued one is noise in the log at best.
    let deleted = 0;
    server = await startServer((req, res) => {
      if (req.method === 'DELETE') {
        deleted += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ value: null }));
      }
      return false; // the cold session never lands
    });
    const device = buildAgainst(server.baseUrl);
    await expect(device.ensureSession()).rejects.toThrow(/session/i);
    expect(deleted).toBe(0);
  });

  test('a reconnect that stays wedged still gives up', async () => {
    // The escalation is ONE extra attempt, not a loop. A WebDriverAgent that
    // will not come back must fail the step, not spin against the phone.
    let sessions = 0;
    server = await startServer((req, res) => {
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ value: null }));
      }
      if (req.url !== '/session') return false;
      sessions += 1;
      if (sessions === 1) return respondWithSession(res, 'sess-1');
      return false; // wedged, and stays wedged
    });
    const device = buildAgainst(server.baseUrl);
    await device.ensureSession();
    device._sessionId = null;

    await expect(device.ensureSession()).rejects.toThrow(/session/i);
    // 1 cold + 2 reconnect attempts, and no more.
    expect(sessions).toBe(3);
  });

  test('clearing the wedged sessions does not hand the NEXT one a cold budget', async () => {
    // The trap in the fix above. `isReconnect` was derived from "have we any
    // session ids", and releasing them empties that set — so the attempt after
    // a wedge recovery would look like a COLD start and wait the cold budget:
    // 210 seconds, which is the stall SHY-0451 exists to have removed.
    //
    // Having opened a session is a fact about the RUN, not about what is
    // currently held.
    let sessions = 0;
    server = await startServer((req, res) => {
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ value: null }));
      }
      if (req.url !== '/session') return false;
      sessions += 1;
      if (sessions === 1) return respondWithSession(res, 'sess-1');
      return false; // everything after the first wedges
    });
    const device = buildAgainst(server.baseUrl, {
      // Far apart, so reading the wrong one is unmissable rather than subtle.
      sessionColdTimeoutMs: 60000,
      sessionRecoveryTimeoutMs: TEST_TIMEOUT_MS,
    });
    await device.ensureSession();

    device._sessionId = null;
    await expect(device.ensureSession()).rejects.toThrow(/session/i);

    // The sessions were released by the attempt above. This one must STILL be
    // treated as a reconnect and give up fast, not wait out the cold budget.
    const started = Date.now();
    await expect(device.ensureSession()).rejects.toThrow(/reconnect/i);
    expect(Date.now() - started).toBeLessThan(TEST_TIMEOUT_MS * 20);
  });

  test('every budget the driver waits on is finite', () => {
    // Pins the defect itself: before SHY-0451 this budget did not exist, and
    // the value it stands in for was Infinity.
    for (const ms of [
      SESSION_COLD_TIMEOUT_MS,
      SESSION_RECOVERY_TIMEOUT_MS,
      SETTINGS_TIMEOUT_MS,
      QUIT_TIMEOUT_MS,
    ]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });
});
