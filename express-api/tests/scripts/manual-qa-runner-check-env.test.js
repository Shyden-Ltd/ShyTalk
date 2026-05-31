/**
 * manual-qa-runner-check-env.test.js
 *
 * CLI integration tests for the `--check-env` flag (gap G3). Verifies:
 *   - --check-env runs the diagnostic + exits 0 when env is complete
 *   - --check-env exits 1 when env is incomplete (a check fails)
 *   - --check-env runs BEFORE the env-validation block (so it works
 *     without PERSONAS_PASSWORD set)
 *   - --check-env is documented in formatUsage() (drift-catch)
 *   - --help / --version / --list / --dry-run all win over --check-env
 *     (consistent precedence chain)
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

function runCli(args, env = {}) {
  // Strip the credentials from process.env FIRST, THEN apply the caller's
  // env overrides. The earlier --help/--list/--dry-run tests use the same
  // shape and don't need credentials so the order doesn't matter there —
  // but --check-env tests inject FIREBASE_DEV_API_KEY etc to verify the
  // ok=true path. If the delete ran AFTER the spread, those injections
  // would be silently removed and the diagnostic would always report
  // "not set".
  const baseEnv = { ...process.env };
  delete baseEnv.PERSONAS_PASSWORD;
  delete baseEnv.FIREBASE_DEV_API_KEY;
  delete baseEnv.FIREBASE_LOCAL_API_KEY;
  delete baseEnv.FIREBASE_PROD_API_KEY;
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: 10000,
  });
}

describe('CLI integration — --check-env', () => {
  test('--check-env exits 1 when PERSONAS_PASSWORD is missing', () => {
    const r = runCli(['--check-env']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/✗ PERSONAS_PASSWORD/);
  });

  test('--check-env exits 1 when FIREBASE_<TARGET>_API_KEY is missing', () => {
    const r = runCli(['--check-env', '--target', 'dev'], { PERSONAS_PASSWORD: 'fake' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/✗ FIREBASE_DEV_API_KEY/);
  });

  test('--check-env exits 0 when all required vars are set', () => {
    const r = runCli(['--check-env', '--target', 'dev'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_DEV_API_KEY: 'fake',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/All 4 checks passed/);
  });

  test('--check-env defaults to target=dev when --target absent', () => {
    const r = runCli(['--check-env']);
    expect(r.stdout).toMatch(/FIREBASE_DEV_API_KEY/);
  });

  test('--check-env --target local checks FIREBASE_LOCAL_API_KEY', () => {
    const r = runCli(['--check-env', '--target', 'local']);
    expect(r.stdout).toMatch(/FIREBASE_LOCAL_API_KEY/);
  });

  test('--check-env --target prod checks FIREBASE_PROD_API_KEY', () => {
    const r = runCli(['--check-env', '--target', 'prod']);
    expect(r.stdout).toMatch(/FIREBASE_PROD_API_KEY/);
  });

  test('--check-env is documented in formatUsage', () => {
    const { formatUsage } = require(RUNNER_PATH);
    expect(formatUsage()).toMatch(/--check-env\b/);
  });

  test('--check-env runs without crashing when no env vars at all are set', () => {
    // The whole point of a diagnostic — it should never crash, only
    // report what's missing.
    const r = runCli(['--check-env']);
    expect(r.status).not.toBe(null); // didn't time out
    expect(r.stdout).toMatch(/Env health check:/);
  });
});

describe('CLI integration — --check-env flag-combination precedence', () => {
  test('--help wins over --check-env', () => {
    const r = runCli(['--help', '--check-env']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).not.toMatch(/Env health check/);
  });

  test('--version wins over --check-env', () => {
    const r = runCli(['--version', '--check-env']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/manual-qa-runner /);
    expect(r.stdout).not.toMatch(/Env health check/);
  });

  test('--list wins over --check-env', () => {
    const r = runCli(['--list', '--check-env']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"supported"/);
  });

  test('--dry-run wins over --check-env', () => {
    const r = runCli(['--dry-run', '--check-env']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"cells"/);
  });
});
