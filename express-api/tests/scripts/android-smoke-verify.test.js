/**
 * scripts/ci/android-smoke-verify.sh — Android boot smoke verification.
 *
 * SHY-0084. Extracted from deploy-prod.yml's inline `script:` because
 * reactivecircus/android-emulator-runner executes `script` via /usr/bin/sh
 * (dash on Ubuntu runners), where the original block's bash-only constructs —
 * `set -o pipefail`, `shopt -s nullglob`, and arrays — abort immediately with
 *   /usr/bin/sh: 1: set: Illegal option -o pipefail
 *   ##[error]The process '/usr/bin/sh' failed with exit code 2
 * (observed on prod run 27286731472, 2026-06-10: the emulator BOOTED, then the
 * verification script died on its first line). A committed bash file runs under
 * bash regardless of the action's default shell, AND is unit-testable here with
 * a stubbed `adb` on PATH — exercising every create/launch/foreground/crash
 * branch at the value level, not just "it runs".
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/ci/android-smoke-verify.sh');

// `dumpsys activity activities` resumed-activity lines (the PRIMARY foreground
// signal, reliable on API 33) — one WITH the app id (foreground), one with the
// launcher (app backgrounded).
const RESUMED_OK = 'mResumedActivity: ActivityRecord{a1b2 u0 com.shyden.shytalk/.MainActivity t42}';
const RESUMED_OTHER =
  'mResumedActivity: ActivityRecord{c3d4 u0 com.android.launcher3/.Launcher t1}';

// `dumpsys window` focus lines (the FALLBACK signal) — one WITH the app id, one
// without. On API 33 the legacy `dumpsys window windows` emitted NO mCurrentFocus
// at all (the prod-run-27411098883 false-fail); '' models that empty dump.
const FOCUS_OK = 'mCurrentFocus=Window{a1b2 u0 com.shyden.shytalk/com.shyden.shytalk.MainActivity}';
const FOCUS_OTHER = 'mCurrentFocus=Window{c3d4 u0 com.android.launcher3/.Launcher}';

// A normal successful `am start -W` block.
const AM_OK = 'Starting: Intent {...}\nStatus: ok\nActivity: com.shyden.shytalk/.MainActivity';
// Benign re-launch output — NOT a failure (the app was already running).
const AM_BENIGN_RELAUNCH =
  'Status: ok\nWarning: Activity not started, its current task has been brought to the front';

function writeAdbStub(binDir) {
  const adb = path.join(binDir, 'adb');
  fs.writeFileSync(
    adb,
    [
      '#!/usr/bin/env bash',
      '# Stub adb: branches on the subcommand, emits scenario output from env.',
      'if [ "$1" = "install" ]; then echo "Success"; exit "${STUB_INSTALL_RC:-0}"; fi',
      'if [ "$1" = "shell" ] && [ "$2" = "am" ]; then printf "%s\\n" "${STUB_AM_OUTPUT}"; exit 0; fi',
      // Subcommand-aware: `dumpsys activity activities` (the resumed-activity
      // read) vs `dumpsys window` (the focus fallback) return DIFFERENT output,
      // so a test can model API 33 — where the window dump is empty but the
      // activity manager still surfaces the resumed activity.
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "activity" ]; then printf "%s\\n" "${STUB_RESUMED}"; exit 0; fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "window" ]; then printf "%s\\n" "${STUB_FOCUS}"; exit 0; fi',
      'if [ "$1" = "logcat" ]; then printf "%s\\n" "${STUB_LOGCAT}"; exit 0; fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(adb, 0o755);
}

function run({
  apks = ['app-prod-debug.apk'],
  am = AM_OK,
  resumed = RESUMED_OK,
  focus = FOCUS_OK,
  logcat = '',
  installRc = '0',
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'android-smoke-'));
  const binDir = path.join(tmp, 'bin');
  const apkDir = path.join(tmp, 'debug-apk');
  fs.mkdirSync(binDir);
  fs.mkdirSync(apkDir);
  writeAdbStub(binDir);
  for (const a of apks) fs.writeFileSync(path.join(apkDir, a), 'dummy-apk');

  // Absolute interpreter path (not PATH-resolved) + $ADB pointed at an absolute
  // stub below = no command is resolved through a writable PATH, so this needs
  // no `sonarjs/no-os-command-from-path` suppression (cf. the file-level disable
  // the older shell-harness tests use).
  const res = spawnSync('/bin/bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Point the script's `$ADB` at the stub by ABSOLUTE path — no PATH
      // manipulation (sonarjs/no-os-command-from-path), mirroring `$GH` in
      // the sync-script tests.
      ADB: path.join(binDir, 'adb'),
      APK_DIR: apkDir,
      LOGCAT_FILE: path.join(tmp, 'runtime.log'),
      STUB_AM_OUTPUT: am,
      STUB_RESUMED: resumed,
      STUB_FOCUS: focus,
      STUB_LOGCAT: logcat,
      STUB_INSTALL_RC: installRc,
      // Collapse the post-launch settle sleeps so the suite stays fast + isolated.
      SMOKE_LAUNCH_WAIT: '0',
      SMOKE_FOREGROUND_WAIT: '0',
    },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return res;
}

describe('SHY-0084: android-smoke-verify.sh', () => {
  test('the script exists and is executable bash', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.readFileSync(SCRIPT, 'utf8')).toMatch(/^#!.*\bbash\b/);
  });

  test('it is POSIX-shell-INDEPENDENT: must NOT be the dash-breaking construct it replaces', () => {
    // The whole point of the extraction: it runs under bash, so it MAY use
    // bash features — but the action invokes it via `bash <file>`, never via
    // the dash `script:` path. Guard the regression: the file must declare a
    // bash shebang (asserted above) so a future "merge back inline" doesn't
    // resurrect the `set -o pipefail` under /usr/bin/sh failure.
    const body = fs.readFileSync(SCRIPT, 'utf8');
    expect(body).toMatch(/#!\/usr\/bin\/env bash/);
  });

  test('healthy app: one APK installs, launches, is foreground, no crash → exit 0', () => {
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('installs and launches successfully');
  });

  test('benign "already running" re-launch is NOT treated as a failure → exit 0', () => {
    const res = run({ am: AM_BENIGN_RELAUNCH });
    expect(res.status).toBe(0);
  });

  test('zero APKs in the artifact dir → exit 1 with a clear count', () => {
    const res = run({ apks: [] });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/Expected exactly one debug APK.*found 0/);
  });

  test('more than one APK → exit 1 with the actual count', () => {
    const res = run({ apks: ['a-debug.apk', 'b-debug.apk'] });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/Expected exactly one debug APK.*found 2/);
  });

  test('am start reports an error → exit 1', () => {
    const res = run({ am: 'Error type 3\nError: Activity class {…} does not exist.' });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('am start reported an error');
  });

  test('a lowercase adb transport error ("error: device offline") → exit 1', () => {
    // adb's transport layer emits lowercase `error:` (vs am's `Error type N`);
    // captured via 2>&1, it must still fail the smoke, not slip to a later step.
    const res = run({ am: 'error: device offline' });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('am start reported an error');
  });

  test('a non-zero `adb install` exit fails the smoke (pipefail honoured under bash)', () => {
    const res = run({ installRc: '1' });
    expect(res.status).not.toBe(0);
  });

  test('app is not the foreground activity → exit 1', () => {
    // Launcher is resumed (app backgrounded) AND the window fallback also shows
    // the launcher — neither source contains the app id, so the smoke fails.
    const res = run({ resumed: RESUMED_OTHER, focus: FOCUS_OTHER });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('not the foreground activity');
  });

  test('API 33: `dumpsys window` is empty but the resumed-activity read still passes → exit 0', () => {
    // Reproduces prod run 27411098883 (2026-06-12): on API 33 `dumpsys window
    // windows` emitted no mCurrentFocus, so the old window-only grep false-failed
    // a foreground app. The fix reads the resumed activity from the activity
    // manager FIRST, which still surfaces the app even when the window dump is blank.
    const res = run({ resumed: RESUMED_OK, focus: '' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('installs and launches successfully');
  });

  test('activity-manager read empty → falls back to window focus → exit 0', () => {
    // If `dumpsys activity activities` yields nothing (older/odd image), the
    // window-focus fallback (`dumpsys window`, not `window windows`) still
    // confirms the foreground app.
    const res = run({ resumed: '', focus: FOCUS_OK });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('installs and launches successfully');
  });

  test('a FATAL EXCEPTION in logcat → exit 1', () => {
    const res = run({
      logcat:
        '06-10 15:53:59.000  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main\n' +
        '06-10 15:53:59.000  1234  1234 E AndroidRuntime: java.lang.NullPointerException',
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('fatal crash');
  });

  test('a clean logcat (no FATAL EXCEPTION) → exit 0', () => {
    const res = run({ logcat: '06-10 15:54:00.000  1234 I AndroidRuntime: NOTE: app started' });
    expect(res.status).toBe(0);
  });
});
