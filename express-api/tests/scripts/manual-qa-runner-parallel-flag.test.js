/**
 * manual-qa-runner-parallel-flag.test.js
 *
 * Tests the `--parallel` flag (SHY-0095 parallel-dispatch second half).
 * Verifies:
 *   - --parallel parses and surfaces in the --dry-run preview
 *     (parallel: true/false) so operators can confirm dispatch mode
 *     before a run
 *   - --parallel is documented in formatUsage with the
 *     per-device-serial / cross-device-parallel semantics
 *   - --parallel is stripped from per-cell argv (boolean strip — the
 *     token after it survives)
 *   - buildRunMatrixOptions maps parsed opts onto the runMatrix option
 *     shape (parallel included, defaults preserved)
 *
 * CLI assertions spawn the REAL runner binary (no doubles), mirroring
 * manual-qa-runner-shard-flag.test.js conventions.
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

describe('--parallel in the --dry-run preview', () => {
  test('--dry-run --matrix --parallel prints parallel: true', () => {
    const res = runCli(['--dry-run', '--matrix', '--parallel', '--target', 'local']);
    expect(res.status).toBe(0);
    const preview = JSON.parse(res.stdout);
    expect(preview.parallel).toBe(true);
  });

  test('--dry-run --matrix without --parallel prints parallel: false', () => {
    const res = runCli(['--dry-run', '--matrix', '--target', 'local']);
    expect(res.status).toBe(0);
    const preview = JSON.parse(res.stdout);
    expect(preview.parallel).toBe(false);
  });

  test('dry-run cells are unaffected by --parallel (same set, same order)', () => {
    const serial = JSON.parse(runCli(['--dry-run', '--matrix', '--target', 'local']).stdout);
    const parallel = JSON.parse(
      runCli(['--dry-run', '--matrix', '--parallel', '--target', 'local']).stdout,
    );
    expect(parallel.cells).toEqual(serial.cells);
  });
});

describe('--parallel in formatUsage', () => {
  test('--help documents --parallel with the per-device-serial semantics', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/--parallel/);
    expect(res.stdout).toMatch(/per-device-serial|same device|one cell per device/i);
  });
});

describe('--parallel per-cell argv discipline', () => {
  let stripPerCellFlags;
  let PER_CELL_STRIP_FLAGS;
  let PER_CELL_VALUE_FLAGS;
  beforeAll(() => {
    const exported = require('../../scripts/manual-qa-runner');
    stripPerCellFlags = exported.stripPerCellFlags;
    PER_CELL_STRIP_FLAGS = exported.PER_CELL_STRIP_FLAGS;
    PER_CELL_VALUE_FLAGS = exported.PER_CELL_VALUE_FLAGS;
  });

  test('PER_CELL_STRIP_FLAGS contains --parallel', () => {
    expect(PER_CELL_STRIP_FLAGS.has('--parallel')).toBe(true);
  });

  test('--parallel is a boolean strip flag (not value-consuming)', () => {
    expect(PER_CELL_VALUE_FLAGS.has('--parallel')).toBe(false);
  });

  test('stripPerCellFlags removes --parallel and keeps the following token', () => {
    expect(stripPerCellFlags(['--parallel', '--target', 'local'])).toEqual(['--target', 'local']);
    expect(stripPerCellFlags(['--matrix', '--parallel', 'chromium'])).toEqual(['chromium']);
  });
});

describe('buildRunMatrixOptions — opts → runMatrix option mapping', () => {
  let buildRunMatrixOptions;
  beforeAll(() => {
    buildRunMatrixOptions = require('../../scripts/manual-qa-runner').buildRunMatrixOptions;
  });

  test('maps allowed browsers + every gate + parallel through', () => {
    const result = buildRunMatrixOptions({
      allowed: ['chromium', 'mobile-safari-ios'],
      opts: { failFast: true, bailAfter: 2, retry: 1, parallel: true },
    });
    expect(result).toEqual({
      browsers: ['chromium', 'mobile-safari-ios'],
      failFast: true,
      bailAfter: 2,
      retry: 1,
      parallel: true,
      bailScope: 'matrix',
    });
  });

  test('defaults: no flags → sequential dispatch with zeroed gates', () => {
    const result = buildRunMatrixOptions({ allowed: ['chromium'], opts: {} });
    expect(result).toEqual({
      browsers: ['chromium'],
      failFast: false,
      bailAfter: 0,
      retry: 0,
      parallel: false,
      bailScope: 'matrix',
    });
  });

  test('negative bailAfter and retry clamp to 0 (spawnSync-era semantics preserved)', () => {
    const result = buildRunMatrixOptions({
      allowed: ['chromium'],
      opts: { bailAfter: -3, retry: -1 },
    });
    expect(result.bailAfter).toBe(0);
    expect(result.retry).toBe(0);
  });

  // --bail-scope: see the "bailScope" describe in matrix-dispatch.test.js for why
  // a Mac-group bail must not skip the iPhone's cells.
  test('--bail-scope resource is passed straight through', () => {
    const result = buildRunMatrixOptions({
      allowed: ['chromium'],
      opts: { bailScope: 'resource' },
    });
    expect(result.bailScope).toBe('resource');
  });

  test('bailScope defaults to matrix, so an un-flagged run gates exactly as before', () => {
    expect(buildRunMatrixOptions({ allowed: ['chromium'], opts: {} }).bailScope).toBe('matrix');
  });

  test('an unrecognised --bail-scope is passed through so runMatrix can reject it', () => {
    // Validation lives in ONE place (runMatrix). Silently normalising a typo here
    // would restore whole-matrix gating without telling anyone.
    expect(
      buildRunMatrixOptions({ allowed: ['chromium'], opts: { bailScope: 'nonsense' } }).bailScope,
    ).toBe('nonsense');
  });
});
