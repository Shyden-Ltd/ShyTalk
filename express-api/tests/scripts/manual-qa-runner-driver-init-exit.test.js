/**
 * manual-qa-runner-driver-init-exit.test.js
 *
 * Pins the single-cell runner's crash exit-code contract (SHY-0095
 * inc-2). Before inc-2 EVERY main() crash exited 2, so a real `--matrix`
 * run could not tell a driver-init failure (no device / missing env)
 * apart from a genuine runtime error — both collapsed into 'fail'.
 * Now:
 *
 *   exit 2 — runtime error (RUNNER_CRASH)
 *   exit 3 — driver could not bootstrap (DRIVER_INIT_FAILED) → the
 *            matrix dispatcher rethrows and the cell classifies 'skip'
 *
 * REAL processes: both tests spawn the actual runner binary and induce
 * the actual failure (a genuinely missing WDA_TEAM_ID env var for the
 * init path; a genuinely nonexistent plan dir for the crash path). No
 * doubles.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

jest.setTimeout(30000);

function runCli(args, env = {}) {
  const baseEnv = { ...process.env };
  // A deliberately-clean slate: the induced conditions below must not be
  // rescued by this machine's real operator env.
  delete baseEnv.WDA_TEAM_ID;
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: 25000,
  });
}

const PASSING_ENV = {
  PERSONAS_PASSWORD: 'x'.repeat(24),
  FIREBASE_LOCAL_API_KEY: 'fake-local-key',
  FIREBASE_DATABASE_URL: 'http://localhost:9000?ns=demo-shytalk-default-rtdb',
};

describe('single-cell crash exit codes', () => {
  test('driver-init failure (WDA_TEAM_ID genuinely missing) exits 3 with DRIVER_INIT_FAILED on stderr', () => {
    const r = runCli(
      ['--target', 'local', '--driver', 'playwright', '--browser', 'mobile-safari-ios'],
      PASSING_ENV,
    );
    expect(r.stderr).toMatch(/DRIVER_INIT_FAILED/);
    expect(r.stderr).toMatch(/WDA_TEAM_ID env var is required/);
    expect(r.status).toBe(3);
  });

  test('non-init runtime crash (nonexistent plan dir) still exits 2 with RUNNER_CRASH', () => {
    const r = runCli(['--target', 'local', '--plan-dir', '/nonexistent/plan-dir-x9'], PASSING_ENV);
    expect(r.stderr).toMatch(/RUNNER_CRASH/);
    expect(r.stderr).not.toMatch(/DRIVER_INIT_FAILED/);
    expect(r.status).toBe(2);
  });
});
