/**
 * An app that DIES must fail the step loudly — never be relaunched in silence.
 *
 * iPhone, J40 step 8, 2026-09-05 (SHY-0500 / SHY-0523): the revoked-session
 * redirect drew, the app aborted 218ms later (a Firestore listener denied by
 * rules, Kotlin/Native `abort()`), the next WebDriverAgent call failed with the
 * "session lost" shape, and the recovery path opened a new session — which on
 * XCUITest LAUNCHES the app when nothing is running. The journey then judged
 * the SECOND launch's first frame and passed. pid 1645 crashed; pid 1648 was
 * what the step looked at.
 *
 * The process side is the tell: the pid `devicectl device process launch`
 * reported is gone, no `iosApp` runs, and a crash report newer than the launch
 * is on the device. These tests drive that logic with the device's real JSON
 * shapes (fixtures under tests/drivers/fixtures/ios-crash) and no phone: the
 * three shell-outs are the only things replaced.
 */

const fs = require('node:fs');
const path = require('node:path');

const { createIosJourneyDevice } = require('../../../scripts/drivers/ios-journey-device');
const { AppProcessDiedError } = require('../../../scripts/drivers/app-process-death');

// The HARDWARE udid, passed explicitly: an absent one is resolved through
// `xcrun xctrace`, which must never be a unit test's dependency.
const TEST_HARDWARE_UDID = '00008150-000954D90A20401C';
const FIXTURES = path.join(__dirname, '..', '..', 'drivers', 'fixtures', 'ios-crash');
const REPORT_FILE = 'iosApp-2026-09-05-102748.ips';
const REPORT = fs.readFileSync(path.join(FIXTURES, REPORT_FILE), 'utf8');
const LAUNCH_JSON = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'devicectl-launch.json'), 'utf8'),
);
const CRASH_AT_MS = Date.parse('2026-09-05T10:27:48.000+07:00');
const APP_EXECUTABLE = 'file:///private/var/containers/Bundle/Application/X/iosApp.app/iosApp';
const PKG = 'com.shyden.shytalk.local'; // the runner's package name; iOS knows its own bundle

const listing = (...pids) => ({
  result: {
    runningProcesses: pids.map((pid) => ({ executable: APP_EXECUTABLE, processIdentifier: pid })),
  },
});

const sessionLost = () =>
  new Error('POST /screenshot -> 500: Could not proxy command: socket hang up');

/**
 * A driver whose device boundaries are scripted: `running` is what the
 * process listing shows, `pulls[i]` says whether the i-th crash-report pull
 * delivers the fixture report.
 */
const built = [];
afterEach(() => {
  // A death leaves its pulled crash report on disk on purpose (the path is in
  // the error); a test run must not leave those behind.
  for (const d of built.splice(0)) {
    if (d._scratch) fs.rmSync(d._scratch, { recursive: true, force: true });
  }
});

function device({ launchedPid = 1645, running = [], pulls = [] } = {}) {
  const d = createIosJourneyDevice({
    udid: 'A'.repeat(36),
    hardwareUdid: TEST_HARDWARE_UDID,
    bundleId: 'com.shyden.shytalk',
    crashReportRetryMs: 0,
  });
  d._launchedPid = launchedPid;
  d._launchedAt = launchedPid ? CRASH_AT_MS - 7000 : null;
  d.listed = 0;
  d._listProcesses = () => {
    d.listed += 1;
    return listing(...running);
  };
  d.pullCount = 0;
  d._pullCrashReports = (dir) => {
    const deliver = pulls[d.pullCount] ?? false;
    d.pullCount += 1;
    if (!deliver) return;
    fs.mkdirSync(path.join(dir, 'Retired'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Retired', REPORT_FILE), REPORT);
  };
  built.push(d);
  return d;
}

describe('assertAppAlive', () => {
  test('the launched process still running is alive', async () => {
    const d = device({ running: [1645] });
    await expect(d.assertAppAlive(PKG, 'screencap')).resolves.toMatchObject({ pid: 1645 });
    expect(d.pullCount).toBe(0);
  });

  test('with no launch pid recorded, the running app is adopted as the process to watch', async () => {
    const d = device({ launchedPid: null, running: [1648] });
    await expect(d.assertAppAlive(PKG, 'screencap')).resolves.toMatchObject({ pid: 1648 });
    expect(d._launchedPid).toBe(1648);
  });

  test('a gone process with a crash report fails loudly: the pid, the signal, the Kotlin frame', async () => {
    const d = device({ running: [], pulls: [true] });
    const err = await d.assertAppAlive(PKG, 'screencap').catch((e) => e);
    expect(err).toBeInstanceOf(AppProcessDiedError);
    expect(err.message).toMatch(
      /^screencap: the app process died\. pid 1645 .* is gone and no iosApp process is running/,
    );
    expect(err.message).toMatch(/SIGABRT \(EXC_CRASH, Abort trap: 6\)/);
    expect(err.message).toMatch(/propagateExceptionFinalResort/);
    expect(err.message).toContain(REPORT_FILE);
    expect(d.pullCount).toBe(1);
  });

  test('a DIFFERENT app process running is a silent relaunch, not survival', async () => {
    const d = device({ running: [1648], pulls: [true] });
    await expect(d.assertAppAlive(PKG, 'tapElement(main_settingsButton)')).rejects.toThrow(
      /pid 1648\) is running now: something relaunched the app/,
    );
  });

  test('the crash report is asked for up to three times — the device files it a moment after the death', async () => {
    const d = device({ running: [], pulls: [false, false, true] });
    await expect(d.assertAppAlive(PKG, 'readTree')).rejects.toThrow(/SIGABRT/);
    expect(d.pullCount).toBe(3);
  });

  test('no report after three pulls is said as such, not invented', async () => {
    const d = device({ running: [], pulls: [false, false, false] });
    await expect(d.assertAppAlive(PKG, 'readTree')).rejects.toThrow(
      /No iosApp crash report newer than the launch/,
    );
    expect(d.pullCount).toBe(3);
  });

  test('a report OLDER than the launch (beyond clock skew) is not this death', async () => {
    const d = device({ running: [], pulls: [true, true, true] });
    d._launchedAt = CRASH_AT_MS + 120_000;
    await expect(d.assertAppAlive(PKG, 'readTree')).rejects.toThrow(
      /No iosApp crash report newer than the launch/,
    );
  });
});

describe('reopening a WebDriverAgent session never relaunches a dead app', () => {
  test('the first session of a run launches the app: nothing to check yet', async () => {
    const d = device({ launchedPid: null, running: [] });
    d._everOpened = false;
    await expect(d._refuseToRelaunchADeadApp()).resolves.toBeUndefined();
    expect(d.listed).toBe(0);
  });

  test('a session dropped ON PURPOSE by launch() is not a loss: no check on the cold-start hot path', async () => {
    const d = device({ running: [] });
    d._everOpened = true;
    d._sessionId = 'open';
    d._devicectlLaunch = () => LAUNCH_JSON;
    d._post = async () => {
      throw new Error('activate_app refused');
    };
    await d.launch();
    await expect(d._refuseToRelaunchADeadApp()).resolves.toBeUndefined();
    expect(d.listed).toBe(0);
    // The exemption is spent: the NEXT reopen is a loss and IS checked.
    await expect(d._refuseToRelaunchADeadApp()).rejects.toBeInstanceOf(AppProcessDiedError);
  });

  test('a reopen after a loss with the app gone is refused, so the crash is what the step reports', async () => {
    const d = device({ running: [], pulls: [true] });
    d._everOpened = true;
    const err = await d._session().catch((e) => e);
    expect(err).toBeInstanceOf(AppProcessDiedError);
    expect(err.message).toMatch(/^reopening the WebDriverAgent session: the app process died/);
  });

  test('a reopen after a loss with the app alive proceeds (the SHY-0446 recovery)', async () => {
    const d = device({ running: [1645] });
    d._everOpened = true;
    await expect(d._refuseToRelaunchADeadApp()).resolves.toBeUndefined();
    expect(d.listed).toBe(1);
  });
});

describe('withSessionRecovery when the app has died', () => {
  test('throws the death under the command name, with the lost session as its cause', async () => {
    const d = device({ running: [], pulls: [true] });
    d._sessionId = 'dead';
    d._everOpened = true;
    let calls = 0;
    const err = await d
      .withSessionRecovery('screencap', async () => {
        calls += 1;
        if (calls === 1) throw sessionLost();
        await d._session();
        return 'unreachable';
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppProcessDiedError);
    expect(err.message).toMatch(/^screencap: the app process died\. pid 1645/);
    expect(err.message).not.toMatch(/failed twice across a WebDriverAgent restart/);
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause.message).toMatch(/socket hang up/);
  });

  test('an ordinary failure never consults the process list', async () => {
    const d = device({ running: [] });
    d._sessionId = 'live';
    await expect(
      d.withSessionRecovery('tapElement', async () => {
        throw new Error('no such element');
      }),
    ).rejects.toThrow(/no such element/);
    expect(d.listed).toBe(0);
    expect(d._sessionId).toBe('live');
  });
});

describe('launch() records the process it started', () => {
  test('keeps the pid devicectl reported, and when', async () => {
    const d = device({ launchedPid: null });
    d._sessionId = null;
    d._devicectlLaunch = () => LAUNCH_JSON;
    const before = Date.now();
    await d.launch();
    expect(d._launchedPid).toBe(1648);
    expect(d._launchedAt).toBeGreaterThanOrEqual(before);
    expect(d._sessionId).toBeNull();
  });

  test('a launch that reports no process is an error carrying devicectl reason', async () => {
    const d = device({ launchedPid: null });
    d._sessionId = null;
    d._devicectlLaunch = () => ({
      error: {
        userInfo: {
          NSLocalizedFailureReason: { string: 'The requested application x is not installed.' },
        },
      },
    });
    await expect(d.launch()).rejects.toThrow(/not installed/);
    expect(d._launchedPid).toBeNull();
  });

  test('activate_app keeps the session and forgets the pid, which assertAppAlive re-adopts', async () => {
    const d = device({ running: [1700] });
    d._sessionId = 'open';
    d._post = async (route) => {
      if (route !== '/appium/device/activate_app') throw new Error(`unexpected ${route}`);
      return null;
    };
    await d.launch();
    expect(d._sessionId).toBe('open');
    expect(d._launchedPid).toBeNull();
    await expect(d.assertAppAlive(PKG, 'first read')).resolves.toMatchObject({ pid: 1700 });
    expect(d._launchedPid).toBe(1700);
  });
});
