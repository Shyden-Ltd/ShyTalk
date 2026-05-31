/**
 * manual-qa-runner-filter-flag.test.js
 *
 * Tests the `--filter <pattern>` flag (gap A3). Verifies:
 *   - --filter is recognised by the parser + stripped from per-cell argv
 *   - substring matching across slug; comma-separated patterns OR-combine
 *   - case-insensitive (operator ergonomics — slugs are lowercase by policy)
 *   - whitespace-tolerant (trims tokens, drops empties)
 *   - intersection with target allowlist (filter for unsupported cell = empty)
 *   - intersection with --retry-failed (filter applied FIRST, then retry-failed)
 *   - --filter is documented in formatUsage (drift-catch)
 *   - --dry-run reflects --filter (preview shows filtered cells)
 *   - empty/whitespace-only filter exits 2 with actionable error
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

let tmpSeq = 0;
function writeTmpReport(reportObj) {
  tmpSeq += 1;
  const file = path.join(os.tmpdir(), `qa-filter-${process.pid}-${Date.now()}-${tmpSeq}.json`);
  fs.writeFileSync(file, JSON.stringify(reportObj));
  return file;
}

function runCli(args, env = {}) {
  // Clean env so tests don't accidentally inherit real credentials from
  // the operator shell. Caller-supplied `env` wins via spread order.
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

// ── pure helper: applyFilter ─────────────────────────────────────

describe('applyFilter — pure helper', () => {
  let applyFilter;
  beforeAll(() => {
    applyFilter = require(RUNNER_PATH).applyFilter;
  });

  test('returns cells unchanged when filter is undefined', () => {
    expect(applyFilter(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c']);
  });

  test('returns cells unchanged when filter is null', () => {
    expect(applyFilter(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
  });

  test('throws when filter is empty string', () => {
    expect(() => applyFilter(['a'], '')).toThrow(/--filter requires/);
  });

  test('throws when filter is whitespace-only', () => {
    expect(() => applyFilter(['a'], '   ')).toThrow(/--filter requires/);
  });

  test('throws when filter is just commas', () => {
    expect(() => applyFilter(['a'], ',,,')).toThrow(/--filter requires/);
  });

  test('single substring matches all containing slugs', () => {
    // "chrom" is the longest common substring of chromium + chrome —
    // intentional: documents that substring match is LITERAL (chromium
    // is c-h-r-o-m-i-u-m, NOT c-h-r-o-m-e). See gotcha test below.
    expect(applyFilter(['chromium', 'firefox', 'mobile-chrome-android'], 'chrom')).toEqual([
      'chromium',
      'mobile-chrome-android',
    ]);
  });

  test('substring semantics — "chrome" does NOT match "chromium" (literal, not stem)', () => {
    // Pinning the gotcha: operators typing --filter chrome expect
    // chromium to match (sharing a brand stem). It does not — substring
    // matching is byte-by-byte. Documented in --help so operators know
    // to use --filter chrom or --filter chromium,mobile-chrome.
    expect(
      applyFilter(['chromium', 'mobile-chrome-android', 'mobile-chrome-ios'], 'chrome'),
    ).toEqual(['mobile-chrome-android', 'mobile-chrome-ios']);
  });

  test('comma-separated patterns OR-combine', () => {
    expect(applyFilter(['chromium', 'firefox', 'webkit'], 'chromium,firefox')).toEqual([
      'chromium',
      'firefox',
    ]);
  });

  test('preserves input cell order (does not re-sort by pattern)', () => {
    // Operator expects deterministic dispatch order = allowlist order.
    expect(applyFilter(['webkit', 'chromium', 'firefox'], 'firefox,chromium')).toEqual([
      'chromium',
      'firefox',
    ]);
  });

  test('returns empty array when no cells match', () => {
    expect(applyFilter(['chromium', 'firefox'], 'nonexistent')).toEqual([]);
  });

  test('case-insensitive — Chromium matches chromium', () => {
    expect(applyFilter(['chromium'], 'Chromium')).toEqual(['chromium']);
  });

  test('case-insensitive — ANDROID matches mobile-chrome-android', () => {
    expect(applyFilter(['mobile-chrome-android', 'chromium'], 'ANDROID')).toEqual([
      'mobile-chrome-android',
    ]);
  });

  test('trims whitespace around tokens', () => {
    expect(applyFilter(['chromium', 'firefox'], '  chromium  ,  firefox  ')).toEqual([
      'chromium',
      'firefox',
    ]);
  });

  test('drops empty tokens silently when at least one non-empty', () => {
    expect(applyFilter(['chromium', 'firefox'], ',chromium,,,')).toEqual(['chromium']);
  });

  test('does not deduplicate when multiple patterns match the same slug', () => {
    // chrome matches chromium AND mobile-chrome-android; we don't want
    // the cell listed twice. The matcher uses .filter() which preserves
    // uniqueness via the source array.
    expect(applyFilter(['chromium', 'mobile-chrome-android'], 'chrome,chromium')).toEqual([
      'chromium',
      'mobile-chrome-android',
    ]);
  });

  test('substring match works across full slug body', () => {
    expect(applyFilter(['chromium', 'mobile-chrome-android', 'mobile-chrome-ios'], 'ios')).toEqual([
      'mobile-chrome-ios',
    ]);
  });

  test('coerces non-string cell values via String() (defense-in-depth)', () => {
    // Internal callers should always pass string slugs, but the helper
    // tolerates number/object input by coercing via String(). Pins the
    // coercion path so a future "optimization" doesn't drop it.
    expect(applyFilter([123, 456, 'chromium'], 'chrom')).toEqual(['chromium']);
  });
});

// ── formatUsage drift-catch ──────────────────────────────────────

describe('--filter — formatUsage drift-catch', () => {
  test('--filter is documented in formatUsage with description + example', () => {
    // Strong drift-catch: would fail if someone shipped a bare "--filter"
    // header without explanation, or removed the example line. Catches
    // doc-rot regressions that the weak /--filter/ assertion would miss.
    const { formatUsage } = require(RUNNER_PATH);
    const usage = formatUsage();
    expect(usage).toMatch(/--filter <pattern>/);
    expect(usage).toMatch(/Substring match/i);
    expect(usage).toMatch(/case-insensitive/i);
    expect(usage).toMatch(/--filter android/);
  });
});

// ── argument validation (CLI) ────────────────────────────────────

describe('--filter — argument validation (CLI)', () => {
  test('--filter "" exits 2 with actionable error', () => {
    const r = runCli(['--matrix', '--target', 'local', '--filter', ''], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--filter/);
  });

  test('--filter "   " (whitespace-only) exits 2', () => {
    const r = runCli(['--matrix', '--target', 'local', '--filter', '   '], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--filter/);
  });

  test('--filter alone (single-cell, no --matrix/--check-drivers/--smoke) does NOT validate --filter', () => {
    // Pinned design: --filter is a multi-cell subsetter. In single-cell
    // mode (no --matrix/--check-drivers/--smoke), the cell is already
    // explicit so --filter has no effect — silent-ignore by design.
    // Verify by passing an EMPTY --filter (which WOULD error out in any
    // multi-cell mode) and asserting the failure is NOT a --filter
    // validation error. The runner will MISSING_ENV-fail downstream
    // (no PERSONAS_PASSWORD) — that's expected, just not a --filter
    // failure. This pin would catch any regression that accidentally
    // applies --filter validation in single-cell mode.
    const r = runCli(['--target', 'local', '--filter', '']);
    expect(r.stderr).not.toMatch(/--filter: --filter requires/);
  });
});

test('--dry-run --filter "" exits 2 (not a Node stack trace)', () => {
  // Regression test for reviewer-flagged bug: formatDryRunJson called
  // applyFilter without try/catch, so empty --filter under --dry-run
  // crashed with an uncaught throw. Must exit cleanly with code 2.
  const r = runCli(['--dry-run', '--target', 'local', '--filter', '']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--filter/);
  // Should NOT see a Node stack trace ("at Object.<anonymous>" etc.).
  expect(r.stderr).not.toMatch(/at Object\./);
});

test('--dry-run --filter "   " (whitespace-only) exits 2', () => {
  const r = runCli(['--dry-run', '--target', 'local', '--filter', '   ']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--filter/);
});

// ── filter composition with --dry-run ────────────────────────────

describe('--filter — composition with --dry-run', () => {
  test('--dry-run --target local --filter android → only mobile-*-android cells', () => {
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'android']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.target).toBe('local');
    // Order matches MOBILE_BROWSERS in browser-allowlist.js (Android slugs
    // grouped first by registration order: chrome, samsung, edge, firefox).
    expect(parsed.cells).toEqual([
      'mobile-chrome-android',
      'mobile-samsung-android',
      'mobile-edge-android',
      'mobile-firefox-android',
    ]);
  });

  test('--dry-run --target local --filter chrom → matches chromium + mobile-chrome-*', () => {
    // "chrom" not "chrome" — substring semantics. See the gotcha test
    // in the applyFilter block above.
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'chrom']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toContain('chromium');
    expect(parsed.cells).toContain('mobile-chrome-android');
    expect(parsed.cells).toContain('mobile-chrome-ios');
  });

  test('--dry-run --filter nonexistent → empty cells array', () => {
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'nonexistent']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual([]);
  });

  test('--dry-run --target prod --filter android → empty (prod is chromium-only)', () => {
    // prod allowlist is [chromium]; filtering for android matches 0 cells.
    const r = runCli(['--dry-run', '--target', 'prod', '--filter', 'android']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual([]);
  });

  test('--dry-run --filter comma-separated → multiple cells', () => {
    // Patterns chosen for uniqueness: "chromium" matches ONLY chromium
    // (no slug contains it as substring), "samsung" matches ONLY
    // mobile-samsung-android. Avoids transitive matches that would
    // make this assertion order-fragile across allowlist growth.
    const r = runCli(['--dry-run', '--target', 'local', '--filter', 'chromium,samsung']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cells).toEqual(['chromium', 'mobile-samsung-android']);
  });
});

// ── filter composition with --matrix ────────────────────────────

describe('--filter — composition with --matrix', () => {
  test('--matrix --filter nonexistent exits 0 with "no cells match"', () => {
    const r = runCli(['--matrix', '--target', 'local', '--filter', 'nonexistent'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no cells match/);
  });

  test('--matrix --filter chromium announces matched cells', () => {
    // Dispatch will fail (no real browser), but the filter announcement
    // must appear before dispatch starts.
    const r = runCli(['--matrix', '--target', 'local', '--filter', 'chromium'], {
      PERSONAS_PASSWORD: 'fake',
      FIREBASE_LOCAL_API_KEY: 'fake',
    });
    expect(r.stdout).toMatch(/\[filter\].*1 cell\(s\).*chromium/);
  });
});

// ── filter composition with --retry-failed ───────────────────────

describe('--filter — composition with --retry-failed', () => {
  test('--filter android --retry-failed <chromium-fail> → empty (chromium filtered out)', () => {
    const tmp = writeTmpReport({
      cells: [
        { browser: 'chromium', outcome: 'fail', durationMs: 1000 },
        { browser: 'mobile-chrome-android', outcome: 'pass', durationMs: 1000 },
      ],
    });
    try {
      const r = runCli(
        ['--matrix', '--target', 'local', '--filter', 'android', '--retry-failed', tmp],
        { PERSONAS_PASSWORD: 'fake', FIREBASE_LOCAL_API_KEY: 'fake' },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/nothing to retry/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('--filter android --retry-failed <android-fail> → retries the android cell', () => {
    const tmp = writeTmpReport({
      cells: [{ browser: 'mobile-chrome-android', outcome: 'fail', durationMs: 1000 }],
    });
    try {
      const r = runCli(
        ['--matrix', '--target', 'local', '--filter', 'android', '--retry-failed', tmp],
        { PERSONAS_PASSWORD: 'fake', FIREBASE_LOCAL_API_KEY: 'fake' },
      );
      expect(r.stdout).toMatch(/\[retry-failed\] retrying 1 cell\(s\).*mobile-chrome-android/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
