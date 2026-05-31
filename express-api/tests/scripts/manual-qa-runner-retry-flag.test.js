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

  test('--retry with no following token exits 2 (parseInt(undefined) = NaN)', () => {
    // Edge: argv terminates after `--retry`. parseInt(undefined, 10)
    // returns NaN; validation must catch it cleanly. Pinned so any
    // future "default to 0 on missing value" refactor surfaces the
    // semantic change.
    const r = runCli(['--matrix', '--target', 'local', '--retry'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--retry must be a non-negative integer/);
  });

  test('--retry 1.5 (float) is silently truncated to 1 by parseInt (documented behavior)', () => {
    // parseInt('1.5', 10) === 1. Validation passes (1 is a non-negative
    // integer). This matches --bail's behavior (also parseInt-based) and
    // is consistent across numeric flags. Operators typing 1.5 see the
    // matrix run with retry=1, not an error. Pin this so anyone
    // tightening it intentionally has to update the test.
    const r = runCli(['--matrix', '--target', 'local', '--retry', '1.5'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    // NOT a --retry validation error (1.5 → 1 is accepted).
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

// ── stripPerCellFlags — per-cell argv discipline ────────────────────

describe('stripPerCellFlags — exported helper', () => {
  let stripPerCellFlags;
  let PER_CELL_STRIP_FLAGS;
  let PER_CELL_VALUE_FLAGS;
  beforeAll(() => {
    const exports = require(RUNNER_PATH);
    stripPerCellFlags = exports.stripPerCellFlags;
    PER_CELL_STRIP_FLAGS = exports.PER_CELL_STRIP_FLAGS;
    PER_CELL_VALUE_FLAGS = exports.PER_CELL_VALUE_FLAGS;
  });

  test('--retry N is stripped along with its value', () => {
    // Both the flag token AND its numeric value must be absent from the
    // per-cell argv. Otherwise per-cell subprocesses would recurse
    // into their own retry handling (which they don't have because
    // they're single-cell paths).
    const result = stripPerCellFlags([
      '--target',
      'local',
      '--matrix',
      '--retry',
      '2',
      '--browser',
      'chromium',
    ]);
    expect(result).not.toContain('--retry');
    expect(result).not.toContain('2');
    expect(result).toEqual(['--target', 'local', '--browser', 'chromium']);
  });

  test('--matrix is stripped as boolean (no value consumed)', () => {
    // Regression pin: --matrix must NOT eat the next token.
    const result = stripPerCellFlags(['--matrix', '--target', 'local']);
    expect(result).toEqual(['--target', 'local']);
  });

  test('--filter is stripped with its value (PR #930 invariant)', () => {
    const result = stripPerCellFlags(['--matrix', '--filter', 'android', '--target', 'local']);
    expect(result).not.toContain('--filter');
    expect(result).not.toContain('android');
    expect(result).toEqual(['--target', 'local']);
  });

  test('--retry-failed is stripped with its value (PR #928 invariant)', () => {
    const result = stripPerCellFlags([
      '--matrix',
      '--retry-failed',
      '/tmp/report.json',
      '--target',
      'local',
    ]);
    expect(result).not.toContain('--retry-failed');
    expect(result).not.toContain('/tmp/report.json');
  });

  test('--report-format + --report-output + --report-dir all stripped with values', () => {
    const result = stripPerCellFlags([
      '--matrix',
      '--report-format',
      'json',
      '--report-output',
      '/tmp/x.json',
      '--report-dir',
      '/tmp/logs',
      '--target',
      'local',
    ]);
    expect(result).toEqual(['--target', 'local']);
  });

  test('non-strip flags pass through unchanged', () => {
    const result = stripPerCellFlags([
      '--target',
      'local',
      '--driver',
      'all',
      '--journey',
      'j01_signin',
      '--browser',
      'chromium',
    ]);
    // No matrix/strip flags → entire argv passes through.
    expect(result).toEqual([
      '--target',
      'local',
      '--driver',
      'all',
      '--journey',
      'j01_signin',
      '--browser',
      'chromium',
    ]);
  });

  test('PER_CELL_VALUE_FLAGS is a strict subset of PER_CELL_STRIP_FLAGS', () => {
    // Invariant: any value-bearing flag must also be in the strip set.
    // Pin so adding a new flag to one set without the other surfaces
    // immediately rather than silently breaking argv shape.
    for (const f of PER_CELL_VALUE_FLAGS) {
      expect(PER_CELL_STRIP_FLAGS.has(f)).toBe(true);
    }
  });

  test('PER_CELL_STRIP_FLAGS contains --retry (PR #933 invariant)', () => {
    // Drift-catch for this PR specifically: --retry MUST be in the
    // strip set. If a future "simplify" refactor removes it, the
    // per-cell argv would recurse into --retry handling.
    expect(PER_CELL_STRIP_FLAGS.has('--retry')).toBe(true);
    expect(PER_CELL_VALUE_FLAGS.has('--retry')).toBe(true);
  });
});
