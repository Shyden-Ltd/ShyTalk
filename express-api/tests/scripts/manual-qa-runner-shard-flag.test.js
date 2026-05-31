/**
 * manual-qa-runner-shard-flag.test.js
 *
 * Tests the `--shard X/Y` flag (gap A5). Verifies:
 *   - --shard X/Y parses correctly + validates (X >= 1, Y >= 1, X <= Y,
 *     both integers)
 *   - shardCells helper: contiguous slicing
 *     `floor((X-1)*M/N) : floor(X*M/N)` for any M cells / N shards
 *   - composes with --filter (filter applied first, then shard)
 *   - composes with --dry-run (preview shows post-shard cells)
 *   - --shard is documented in formatUsage with composition hint
 *   - --shard is stripped from per-cell argv
 *   - --shard exits 2 on malformed input (non-integer, out-of-range,
 *     wrong format)
 *
 * Shard semantics: 1-indexed, X/Y means shard X of Y total. Empty
 * shards are impossible with the floor-based formula on cells.length >= 1,
 * unless N > M (more shards than cells) in which case the last few
 * shards may be empty (operator's mistake; not an error per se).
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

// ── shardCells pure helper ──────────────────────────────────────

describe('shardCells — pure helper', () => {
  let shardCells;
  beforeAll(() => {
    shardCells = require(RUNNER_PATH).shardCells;
  });

  test('shard 1/1 returns all cells (degenerate case)', () => {
    expect(shardCells(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  test('shard 1/2 of 12 cells = first 6', () => {
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(shardCells(cells, 1, 2)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  test('shard 2/2 of 12 cells = last 6', () => {
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(shardCells(cells, 2, 2)).toEqual(['c6', 'c7', 'c8', 'c9', 'c10', 'c11']);
  });

  test('shard 1/3 of 12 cells = first 4', () => {
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(shardCells(cells, 1, 3)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  test('shard 2/3 of 12 cells = middle 4', () => {
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(shardCells(cells, 2, 3)).toEqual(['c4', 'c5', 'c6', 'c7']);
  });

  test('shard 3/3 of 12 cells = last 4', () => {
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(shardCells(cells, 3, 3)).toEqual(['c8', 'c9', 'c10', 'c11']);
  });

  test('uneven split (12 cells / 5 shards) distributes without empty shards', () => {
    // floor((X-1)*M/N) : floor(X*M/N) — beats Jest's ceil-based approach
    // for uneven splits because ceil leaves the last shard empty when
    // ceil(M/N)*N > M. This pin documents the chosen formula.
    const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const shards = [1, 2, 3, 4, 5].map((x) => shardCells(cells, x, 5));
    // 12/5: floor distributes as 2+2+3+2+3 = 12
    expect(shards.map((s) => s.length)).toEqual([2, 2, 3, 2, 3]);
    // Union of all shards equals the original cell list (no gaps, no overlap).
    expect([].concat(...shards)).toEqual(cells);
  });

  test('shard X/Y > cells (more shards than cells) → some shards empty', () => {
    // Operator with --shard 5/10 on 3 cells gets:
    //   1/10: floor(0/10*3)=0 : floor(1/10*3)=0 → []
    //   2/10: floor(1/10*3)=0 : floor(2/10*3)=0 → []
    //   3/10: floor(2/10*3)=0 : floor(3/10*3)=0 → []
    //   4/10: floor(3/10*3)=0 : floor(4/10*3)=1 → [c0]
    //   5/10: floor(4/10*3)=1 : floor(5/10*3)=1 → []
    //   ...
    // Allowed — operator's CI config sized too large; not an error.
    const cells = ['c0', 'c1', 'c2'];
    expect(shardCells(cells, 1, 10)).toEqual([]);
    expect(shardCells(cells, 4, 10)).toEqual(['c0']);
  });

  test('preserves input cell order', () => {
    // Operator expects shards to mirror the source order — no
    // round-robin or hash shuffling.
    const cells = ['z', 'b', 'm', 'a', 'q'];
    expect(shardCells(cells, 1, 2)).toEqual(['z', 'b']);
    expect(shardCells(cells, 2, 2)).toEqual(['m', 'a', 'q']);
  });

  test('throws on shardIndex < 1', () => {
    expect(() => shardCells(['a'], 0, 2)).toThrow(/shard index must be >= 1/);
  });

  test('throws on shardCount < 1', () => {
    expect(() => shardCells(['a'], 1, 0)).toThrow(/shard count must be >= 1/);
  });

  test('throws on shardIndex > shardCount', () => {
    expect(() => shardCells(['a'], 3, 2)).toThrow(/shard index .* must be <= shard count/);
  });

  test('throws on non-integer shardIndex', () => {
    expect(() => shardCells(['a'], 1.5, 2)).toThrow(/shard index must be an integer/);
  });

  test('throws on non-integer shardCount', () => {
    expect(() => shardCells(['a'], 1, 2.5)).toThrow(/shard count must be an integer/);
  });
});

// ── formatUsage drift-catch ──────────────────────────────────────

describe('--shard — formatUsage drift-catch', () => {
  test('--shard X/Y is documented with composition hint', () => {
    const { formatUsage } = require(RUNNER_PATH);
    const usage = formatUsage();
    expect(usage).toMatch(/--shard <X>\/<Y>|--shard X\/Y/);
    expect(usage).toMatch(/CI parallelism|split.*matrix|partition/i);
    // Composition with --filter is the key operational pattern.
    expect(usage).toMatch(/--filter/);
  });
});

// ── --shard argument validation (CLI) ───────────────────────────

describe('--shard — argument validation', () => {
  test('--shard malformed (no slash) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', '3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });

  test('--shard 0/3 (zero index) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', '0/3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });

  test('--shard 4/3 (index > count) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', '4/3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });

  test('--shard 1/0 (zero count) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', '1/0'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });

  test('--shard abc/3 (non-integer index) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', 'abc/3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });

  test('--shard 1/3 (valid) passes validation', () => {
    const r = runCli(['--matrix', '--target', 'local', '--shard', '1/3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.stderr).not.toMatch(/--shard.*invalid/);
  });

  test('--shard with NO following value (bare last arg) exits 2', () => {
    // Regression test for reviewer-flagged C1: parser sets
    // opts._shardRaw = undefined when --shard is the last token. Old
    // `!== undefined` guard would skip validation. Fixed by using
    // `'_shardRaw' in opts` (property exists even when value is
    // undefined). Pin: bare --shard must exit 2 with actionable error.
    const r = runCli(['--matrix', '--target', 'local', '--shard'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard requires a value/);
  });

  test('--dry-run --shard 4/3 (invalid range in dry-run) exits 2 with --shard prefix', () => {
    // Regression test for reviewer-flagged I1: --dry-run path consumed
    // shardIndex/shardCount via formatDryRunJson before validation ran.
    // Malformed --shard surfaced with the wrong "--filter:" prefix from
    // the dry-run try/catch. Fix: moved --shard validation BEFORE
    // the --dry-run short-circuit. Error message now uses correct
    // --shard prefix.
    const r = runCli(['--dry-run', '--target', 'local', '--shard', '4/3']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
    expect(r.stderr).not.toMatch(/--filter/);
  });

  test('--list --shard malformed exits 2 (--list also uses --shard validation order)', () => {
    // Sibling test: --list is another short-circuit path. --shard
    // validation must fire before --list too, so malformed --shard
    // gets a clean error rather than --list output with bad opts.
    const r = runCli(['--list', '--target', 'local', '--shard', '4/3']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--shard/);
  });
});

// ── --shard composition with --dry-run ──────────────────────────

describe('--shard — composition with --dry-run', () => {
  test('--dry-run --target local --shard 1/3 → first 4 cells', () => {
    // local allowlist = 12 cells; shard 1/3 = cells[0:4]
    const r = runCli(['--dry-run', '--target', 'local', '--shard', '1/3']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toHaveLength(4);
    expect(parsed.cells[0]).toBe('chromium');
  });

  test('--dry-run --target local --shard 3/3 → last 4 cells', () => {
    const r = runCli(['--dry-run', '--target', 'local', '--shard', '3/3']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toHaveLength(4);
  });

  test('--dry-run --target prod --shard 1/3 → chromium only (single cell)', () => {
    // prod allowlist = [chromium]; shard 1/3 of [chromium]:
    //   floor(0/3*1) : floor(1/3*1) = 0:0 → []
    // shard 2/3:
    //   floor(1/3*1) : floor(2/3*1) = 0:0 → []
    // shard 3/3:
    //   floor(2/3*1) : floor(3/3*1) = 0:1 → [chromium]
    const r = runCli(['--dry-run', '--target', 'prod', '--shard', '3/3']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual(['chromium']);
  });
});

// ── --shard composition with --filter ───────────────────────────

describe('--shard — composition with --filter', () => {
  test('--filter applied FIRST, then --shard (intersection)', () => {
    // --filter android gives 4 android cells; --shard 1/2 of those = first 2.
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'android', '--shard', '1/2']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toHaveLength(2);
    expect(parsed.cells.every((c) => c.includes('android'))).toBe(true);
  });

  test('--filter + --shard 2/2 → other half of filtered set', () => {
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'android', '--shard', '2/2']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toHaveLength(2);
    expect(parsed.cells.every((c) => c.includes('android'))).toBe(true);
  });
});

// ── --shard composition with --matrix ───────────────────────────

describe('--shard — composition with --matrix', () => {
  test('--matrix --shard 1/12 (single-cell shard) announces the shard log', () => {
    // shard 1/12 of 12 cells = first 1 cell. Assert the [shard] log
    // prefix + the shard ratio. Avoid coupling to allowlist order or
    // the count-of-N wording (those would break for non-semantic
    // reasons under reordering or format tweaks).
    const r = runCli(['--matrix', '--target', 'local', '--shard', '1/12'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.stdout).toMatch(/\[shard\] 1\/12/);
  });

  test('--dry-run --shard 1/12 confirms the cell name independently', () => {
    // Companion to the [shard] log test: --dry-run gives a JSON view
    // of the post-shard cells. Asserting on the JSON decouples the
    // cell-name check from the log-line wording.
    const r = runCli(['--dry-run', '--target', 'local', '--shard', '1/12']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual(['chromium']);
  });

  test('--matrix --shard with empty result → exits 0 "nothing to run"', () => {
    // prod has 1 cell; shard 1/3 of 1 cell = floor(0):floor(1/3) = 0:0 = empty
    const r = runCli(['--matrix', '--target', 'prod', '--shard', '1/3'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_PROD_API_KEY: 'fake',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\[shard\].*empty|nothing to run/);
  });

  test('--dry-run --target prod --shard 1/3 → cells: [] (silent-empty JSON contract)', () => {
    // Pin: --dry-run path does NOT log "[shard] empty"; it just emits
    // cells:[]. Operators parsing --dry-run JSON for CI should check
    // cells.length, not stdout. Documented contract — pin so a future
    // "improvement" that adds a warning key doesn't break parsing.
    const r = runCli(['--dry-run', '--target', 'prod', '--shard', '1/3']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual([]);
    expect(parsed.target).toBe('prod');
  });

  test('single-cell mode + --shard silently ignored (documented design)', () => {
    // Per design (mirrors --filter): --shard is a multi-cell subsetter.
    // Without --matrix/--check-drivers/--smoke, the cell is already
    // explicit, so --shard has no effect. Verify by checking the
    // failure (downstream MISSING_ENV) is NOT a --shard error AND
    // no [shard] log line appears in stdout.
    const r = runCli(['--target', 'local', '--shard', '1/3']);
    // Downstream MISSING_ENV will fire (no PERSONAS_PASSWORD); we
    // care that --shard was silently ignored, not the env error.
    expect(r.stderr).not.toMatch(/--shard requires|--shard <X>/);
    expect(r.stdout).not.toMatch(/\[shard\]/);
  });
});

// ── --shard is in PER_CELL_STRIP_FLAGS ──────────────────────────

describe('--shard — stripped from per-cell argv', () => {
  test('--shard X/Y is stripped along with its value', () => {
    const { stripPerCellFlags } = require(RUNNER_PATH);
    const result = stripPerCellFlags([
      '--target',
      'local',
      '--matrix',
      '--shard',
      '1/3',
      '--browser',
      'chromium',
    ]);
    expect(result).not.toContain('--shard');
    expect(result).not.toContain('1/3');
    expect(result).toEqual(['--target', 'local', '--browser', 'chromium']);
  });

  test('--shard is registered in PER_CELL_STRIP_FLAGS + PER_CELL_VALUE_FLAGS', () => {
    const { PER_CELL_STRIP_FLAGS, PER_CELL_VALUE_FLAGS } = require(RUNNER_PATH);
    expect(PER_CELL_STRIP_FLAGS.has('--shard')).toBe(true);
    expect(PER_CELL_VALUE_FLAGS.has('--shard')).toBe(true);
  });

  test('stripPerCellFlags handles bare --shard (no following value) without error', () => {
    // Edge: bare --shard at end of argv. stripPerCellFlags does
    // `i++` to skip the value, but if there is no value, the next-
    // iteration index check (`i < length`) prevents off-end read.
    // Verify: the bare --shard is dropped, no exception.
    const { stripPerCellFlags } = require(RUNNER_PATH);
    expect(() => stripPerCellFlags(['--target', 'local', '--shard'])).not.toThrow();
    const result = stripPerCellFlags(['--target', 'local', '--shard']);
    // The --shard token is dropped; --target local remains.
    expect(result).toEqual(['--target', 'local']);
  });
});
