/**
 * build-debug-dev-secret-leak.unit.test.js
 *
 * Pins that scripts/ios/build-debug-dev.sh NEVER prints the persona
 * password to its output. The script used `set -x` around the
 * xcodebuild invocation to show the operator the command line — but
 * bash's xtrace expands `$PW`, so the REAL dev persona password landed
 * verbatim in stderr and in every captured build log (nohup logs,
 * session transcripts, CI captures).
 *
 * Unit-test location (*.unit.test.js): xcodebuild/xcrun are PATH-shimmed
 * (the repo's established shell-script test pattern — see
 * check-node-version.test.js) because a real 12-minute device build is
 * not inducible in Jest. The contract under test is pure script
 * behaviour: what the script prints vs what it passes to its child.
 *
 * Two-sided pin:
 *   1. the canary password must NOT appear in stdout/stderr (the leak)
 *   2. the canary MUST still reach xcodebuild's argv (guards against
 *      "fixing" the leak by dropping the injection, which would ship a
 *      picker that can't sign in)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/ios/build-debug-dev.sh');

const CANARY = 'leak-canary-9f3b7a2e11-password';

function makeShimDir(argvSink) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-shims-'));
  // xcodebuild shim: records argv, fabricates the .app dir the script's
  // post-build check expects (parsed from -derivedDataPath), exits 0.
  fs.writeFileSync(
    path.join(dir, 'xcodebuild'),
    [
      '#!/bin/bash',
      `printf '%s\\n' "$@" >> ${JSON.stringify(argvSink)}`,
      'derived=""',
      'prev=""',
      'for a in "$@"; do',
      '  if [ "$prev" = "-derivedDataPath" ]; then derived="$a"; fi',
      '  prev="$a"',
      'done',
      'if [ -n "$derived" ]; then',
      '  mkdir -p "$derived/Build/Products/Debug-Dev-iphoneos/iosApp.app"',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  // xcrun shim: the devicectl install step must not touch a real device.
  fs.writeFileSync(path.join(dir, 'xcrun'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return dir;
}

describe('build-debug-dev.sh — persona password never leaks to output', () => {
  let envFile;
  let shimDir;
  let argvSink;
  let result;

  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-env-'));
    envFile = path.join(tmp, 'dev-personas.env');
    fs.writeFileSync(envFile, `PERSONAS_PASSWORD=${CANARY}\n`, { mode: 0o600 });
    argvSink = path.join(tmp, 'xcodebuild-argv.txt');
    shimDir = makeShimDir(argvSink);
    result = spawnSync('/bin/bash', [SCRIPT, 'FAKE-UDID-0001'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH}`,
        SHYTALK_DEV_PERSONAS_ENV: envFile,
      },
      timeout: 20000,
    });
  });

  afterAll(() => {
    // The script hardcodes its derived-data dir inside the repo; drop the
    // fabricated products so no build artifact lingers.
    fs.rmSync(path.join(REPO_ROOT, 'build/ios-debug-dev'), { recursive: true, force: true });
  });

  test('script completes against the shimmed toolchain', () => {
    expect(result.status).toBe(0);
  });

  test('the password appears NOWHERE in stdout or stderr', () => {
    expect(result.stdout).not.toContain(CANARY);
    expect(result.stderr).not.toContain(CANARY);
  });

  test('the printed build invocation shows a redacted password marker instead', () => {
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/DEV_QA_PERSONAS_PASSWORD=<redacted>/);
  });

  test('the real password still reaches xcodebuild argv (redaction must not break injection)', () => {
    const argv = fs.readFileSync(argvSink, 'utf8');
    expect(argv).toContain(`DEV_QA_PERSONAS_PASSWORD=${CANARY}`);
  });
});
