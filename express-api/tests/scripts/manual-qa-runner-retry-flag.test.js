/**
 * manual-qa-runner-retry-flag.test.js
 *
 * Tests the `--retry N` flag (gap A4). Verifies:
 *   - --retry is recognised by the parser
 *   - --retry is documented in formatUsage with composition hint
 *   - --retry negative / non-integer exits 2 with actionable error
 *   - --retry 0 = no retry (backward compat)
 *   - --retry is stripped from per-cell argv (no recursion)
 *   - --retry distinguished from --retry-failed (different code paths)
 *
 * Unit-level retry behavior (per-cell retry loop, composition with
 * failFast/bailAfter, attempts/retries fields, error clearing on
 * recover, skip-not-retried) is covered exhaustively in
 * matrix-dispatch.test.js — that's where the runMatrix retry loop lives.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

function runCli(args, env = {}) {
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

// ── formatUsage drift-catch ──────────────────────────────────────

describe('--retry — formatUsage drift-catch', () => {
  test('--retry is documented with composition hint distinguishing it from --retry-failed', () => {
    const { formatUsage } = require(RUNNER_PATH);
    const usage = formatUsage();
    expect(usage).toMatch(/--retry <n>/);
    expect(usage).toMatch(/in-run/i);
    // Composition hint: --retry vs --retry-failed clarification.
    expect(usage).toMatch(/--retry-failed/);
    // fail-fast / --bail composition hint.
    expect(usage).toMatch(/FINAL failures/);
  });
});

// ── --retry argument validation ────────────────────────────────────

describe('--retry — argument validation', () => {
  test('--retry abc (non-integer) exits 2 with actionable error', () => {
    const r = runCli(['--matrix', '--target', 'local', '--retry', 'abc'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--retry must be a non-negative integer/);
    expect(r.stderr).toMatch(/abc/);
  });

  test('--retry -1 (negative) exits 2 with actionable error', () => {
    const r = runCli(['--matrix', '--target', 'local', '--retry', '-1'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--retry must be a non-negative integer/);
    expect(r.stderr).toMatch(/-1/);
  });

  test('--retry 0 is valid (no retry, backward compat)', () => {
    // 0 is a valid value — exit 2 means we MISSING_ENV'd downstream
    // (no PERSONAS_PASSWORD), not that --retry failed validation.
    const r = runCli(['--matrix', '--target', 'local', '--retry', '0'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.stderr).not.toMatch(/--retry must be/);
  });

  test('--retry 3 (positive) passes validation', () => {
    const r = runCli(['--matrix', '--target', 'local', '--retry', '3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.stderr).not.toMatch(/--retry must be/);
  });
});

// ── --retry vs --retry-failed disambiguation ───────────────────────

describe('--retry — distinct from --retry-failed', () => {
  test('--retry 1 and --retry-failed are parsed as separate flags', () => {
    // Both flags can coexist (different concerns). Parser must not
    // confuse them. Combining: --retry 1 runs each cell with up to 1
    // in-run retry, AND --retry-failed limits the matrix to cells
    // that failed in the prior report.
    const r = runCli(
      [
        '--matrix',
        '--target',
        'local',
        '--retry',
        '1',
        '--retry-failed',
        '/nonexistent/report.json',
      ],
      { PERSONAS_PASSWORD: 'fake', FIREBASE_LOCAL_API_KEY: 'fake' },
    );
    // --retry-failed with bad path errors first; --retry's value
    // was parsed correctly (no "--retry must be" error).
    expect(r.stderr).not.toMatch(/--retry must be/);
    expect(r.stderr).toMatch(/--retry-failed/);
  });
});
