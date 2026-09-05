const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  launchedProcessId,
  findRunningProcess,
  parseCrashReport,
  crashReportTimestampMs,
  summarizeCrashReport,
  formatCrashSummary,
  findCrashReportsSince,
  describeAppDeath,
} = require('../../scripts/drivers/ios-crash-report');

// Real device output, trimmed: the 2026-09-05 10:27:48 (+07:00) SIGABRT of the
// local build on the iPhone (SHY-0523), the `devicectl device info processes`
// listing taken while pid 1648 was running, and the `devicectl device process
// launch --json-output` result for that same process.
const FIXTURES = path.join(__dirname, 'fixtures', 'ios-crash');
const REPORT_FILE = 'iosApp-2026-09-05-102748.ips';
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const jsonFixture = (name) => JSON.parse(readFixture(name));
const CRASH_AT_MS = Date.parse('2026-09-05T10:27:48.000+07:00');

describe('launchedProcessId', () => {
  test('reads the pid devicectl reports for a launch', () => {
    expect(launchedProcessId(jsonFixture('devicectl-launch.json'))).toBe(1648);
  });

  test('refuses a launch result without a pid, quoting devicectl own failure reason', () => {
    const failed = {
      error: {
        code: 10002,
        userInfo: {
          NSLocalizedFailureReason: { string: 'The requested application x.y is not installed.' },
        },
      },
    };
    expect(() => launchedProcessId(failed)).toThrow(/not installed/);
    expect(() => launchedProcessId({ result: {} })).toThrow(/no process identifier/);
    expect(() => launchedProcessId(null)).toThrow(/no process identifier/);
  });
});

describe('findRunningProcess', () => {
  const processes = jsonFixture('devicectl-processes.json');

  test('finds the app by the executable basename and returns its pid', () => {
    expect(findRunningProcess(processes, 'iosApp')).toEqual({
      pid: 1648,
      executable: expect.stringMatching(/\/iosApp\.app\/iosApp$/),
    });
  });

  test('matches the whole basename, not a prefix of it', () => {
    // The listing carries a decoy `iosAppHelper` (pid 999).
    expect(findRunningProcess(processes, 'iosApp').pid).not.toBe(999);
    expect(findRunningProcess(processes, 'iosAppHelper').pid).toBe(999);
  });

  test('returns null when the app is not running', () => {
    expect(findRunningProcess(processes, 'NotInstalledApp')).toBeNull();
    expect(findRunningProcess({ result: { runningProcesses: [] } }, 'iosApp')).toBeNull();
  });

  test('refuses a listing without runningProcesses instead of reporting "not running"', () => {
    // A malformed listing must never read as "the app is dead".
    expect(() => findRunningProcess({ result: {} }, 'iosApp')).toThrow(/runningProcesses/);
    expect(() => findRunningProcess(null, 'iosApp')).toThrow(/runningProcesses/);
  });
});

describe('parseCrashReport / crashReportTimestampMs', () => {
  test('splits the header line from the body and parses both', () => {
    const { header, body } = parseCrashReport(readFixture(REPORT_FILE));
    expect(header.app_name).toBe('iosApp');
    expect(header.bundleID).toBe('com.shyden.shytalk');
    expect(body.pid).toBe(1645);
  });

  test('turns the header timestamp (local time with a numeric zone) into epoch ms', () => {
    expect(crashReportTimestampMs({ timestamp: '2026-09-05 10:27:48.00 +0700' })).toBe(CRASH_AT_MS);
    expect(crashReportTimestampMs({ timestamp: '2026-01-02 00:00:00 -0130' })).toBe(
      Date.parse('2026-01-02T00:00:00-01:30'),
    );
  });

  test('rejects a header without a parsable timestamp', () => {
    expect(() => crashReportTimestampMs({ timestamp: 'yesterday' })).toThrow(/timestamp/);
    expect(() => crashReportTimestampMs({})).toThrow(/timestamp/);
  });

  test('rejects text that is not a two-part .ips report', () => {
    expect(() => parseCrashReport('{"app_name":"iosApp"}')).toThrow(/\.ips/);
    expect(() => parseCrashReport('{"app_name":"iosApp"}\nnot json')).toThrow(/\.ips/);
    expect(() => parseCrashReport('')).toThrow(/\.ips/);
  });
});

describe('summarizeCrashReport', () => {
  const summary = summarizeCrashReport(readFixture(REPORT_FILE));

  test('names the process, the signal and why it was terminated', () => {
    expect(summary).toMatchObject({
      app: 'iosApp',
      bundleId: 'com.shyden.shytalk',
      pid: 1645,
      timestampMs: CRASH_AT_MS,
      signal: 'SIGABRT',
      exceptionType: 'EXC_CRASH',
      terminationIndicator: 'Abort trap: 6',
      asi: 'libsystem_c.dylib: abort() called',
    });
  });

  test('keeps the faulting thread top frames and singles out the Kotlin ones', () => {
    expect(summary.frames.slice(0, 3)).toEqual(['__pthread_kill', 'pthread_kill', 'abort']);
    expect(summary.frames.length).toBeGreaterThanOrEqual(12);
    expect(summary.kotlinFrames[0]).toMatch(
      /^kfun:kotlinx\.coroutines\.internal#propagateExceptionFinalResort/,
    );
    expect(summary.kotlinFrames.some((f) => /terminateWithUnhandledException/.test(f))).toBe(false);
  });

  test('formats a one-paragraph summary a failing step can carry', () => {
    const text = formatCrashSummary(summary);
    expect(text).toMatch(/SIGABRT \(EXC_CRASH, Abort trap: 6\)/);
    expect(text).toMatch(/libsystem_c\.dylib: abort\(\) called/);
    expect(text).toMatch(/__pthread_kill/);
    expect(text).toMatch(/propagateExceptionFinalResort/);
    expect(text).not.toMatch(/\n/);
  });
});

describe('findCrashReportsSince', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-crash-report-test-'));
    // idevicecrashreport lands reports under Retired/ — mirror that layout.
    const retired = path.join(dir, 'Retired');
    fs.mkdirSync(retired);
    const report = readFixture(REPORT_FILE);
    fs.writeFileSync(path.join(retired, REPORT_FILE), report);
    fs.writeFileSync(
      path.join(retired, 'iosApp-2026-09-01-000000.ips'),
      report.replace('2026-09-05 10:27:48.00 +0700', '2026-09-01 00:00:00.00 +0700'),
    );
    fs.writeFileSync(
      path.join(retired, 'SpringBoard-2026-09-05-110000.ips'),
      report
        .replace('2026-09-05 10:27:48.00 +0700', '2026-09-05 11:00:00.00 +0700')
        .replace('"app_name": "iosApp"', '"app_name": "SpringBoard"')
        .replace('"app_name":"iosApp"', '"app_name":"SpringBoard"'),
    );
    fs.writeFileSync(path.join(retired, 'iosApp-2026-09-05-102748.txt'), 'not a report');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('returns only the app own reports written after the launch, newest first', () => {
    const launchedAt = CRASH_AT_MS - 7000;
    const found = findCrashReportsSince(dir, 'iosApp', launchedAt);
    expect(found.map((r) => path.basename(r.path))).toEqual([REPORT_FILE]);
    expect(found[0]).toMatchObject({ timestampMs: CRASH_AT_MS, pid: 1645 });
  });

  test('orders several reports newest first and ignores other apps', () => {
    const names = findCrashReportsSince(dir, 'iosApp', 0).map((r) => path.basename(r.path));
    expect(names).toEqual([REPORT_FILE, 'iosApp-2026-09-01-000000.ips']);
  });

  test('returns nothing when every report predates the launch', () => {
    expect(findCrashReportsSince(dir, 'iosApp', CRASH_AT_MS + 1)).toEqual([]);
  });

  test('returns nothing for a directory idevicecrashreport never wrote to', () => {
    expect(findCrashReportsSince(path.join(dir, 'never-created'), 'iosApp', 0)).toEqual([]);
  });
});

describe('describeAppDeath', () => {
  const launchedAt = CRASH_AT_MS - 7000;
  const summary = summarizeCrashReport(readFixture(REPORT_FILE));

  test('says the app died, where its crash report is, and how it died', () => {
    const text = describeAppDeath({
      launchedPid: 1645,
      launchedAt,
      running: null,
      report: { path: '/tmp/crash/Retired/' + REPORT_FILE, summary },
    });
    expect(text).toMatch(/^the app process died/);
    expect(text).toMatch(/pid 1645/);
    expect(text).toMatch(
      /lost its session because the app crashed, not because WebDriverAgent restarted/,
    );
    expect(text).toContain('/tmp/crash/Retired/' + REPORT_FILE);
    expect(text).toMatch(/SIGABRT/);
    expect(text).toMatch(/propagateExceptionFinalResort/);
  });

  test('says when a DIFFERENT process is running now, so a silent relaunch cannot pass as survival', () => {
    const text = describeAppDeath({
      launchedPid: 1645,
      launchedAt,
      running: { pid: 1648 },
      report: null,
    });
    expect(text).toMatch(/pid 1645 .* is gone/);
    expect(text).toMatch(/pid 1648/);
    expect(text).toMatch(/relaunched/);
  });

  test('says when no crash report exists rather than inventing a cause', () => {
    const text = describeAppDeath({
      launchedPid: 1645,
      launchedAt,
      running: null,
      report: null,
    });
    expect(text).toMatch(/no iosApp crash report newer than the launch/i);
    expect(text).toMatch(/idevicecrashreport/);
    expect(text).not.toMatch(/SIGABRT/);
  });

  test('covers the launch pid being unknown (app brought up by activate_app)', () => {
    const text = describeAppDeath({
      launchedPid: null,
      launchedAt: null,
      running: null,
      report: null,
    });
    expect(text).toMatch(/no iosApp process is running/);
    expect(text).not.toMatch(/pid null/);
  });
});
