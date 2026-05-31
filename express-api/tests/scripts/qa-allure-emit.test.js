/**
 * qa-allure-emit.test.js
 *
 * Tests the matrix-report → Allure-results converter (gap C2). Covers:
 *   - Pure helpers (cellToAllure, buildAllureResults, uuidFor)
 *   - Outcome → Allure status mapping (pass/fail/timeout/skip)
 *   - statusDetails.message present on non-passed outcomes
 *   - UUID determinism (same browser+startMs → same uuid)
 *   - UUID divergence (different browsers OR runs → different uuids)
 *   - Cursor advancement across cells (sequential start times)
 *   - CLI integration (writes files, exit codes, --help)
 *   - readReport rejects non-matrix-report JSON
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/qa-allure-emit.js');

const {
  cellToAllure,
  buildAllureResults,
  formatUsage,
  readReport,
  uuidFor,
  OUTCOME_TO_STATUS,
} = require(SCRIPT_PATH);

// ── cellToAllure ────────────────────────────────────────────────

describe('cellToAllure — pure helper', () => {
  test('passed outcome → status: passed, no statusDetails', () => {
    const r = cellToAllure({ browser: 'chromium', outcome: 'pass', durationMs: 1000 }, 1000000);
    expect(r.status).toBe('passed');
    expect(r.statusDetails).toBeUndefined();
  });

  test('failed outcome → status: failed, statusDetails.message present', () => {
    const r = cellToAllure(
      { browser: 'firefox', outcome: 'fail', durationMs: 2000, error: 'assertion failed' },
      1000000,
    );
    expect(r.status).toBe('failed');
    expect(r.statusDetails.message).toBe('assertion failed');
  });

  test('timeout outcome → status: broken (distinguishes from failed)', () => {
    // Allure has separate "broken" for environmental failures
    // (timeouts, crashes) vs "failed" for assertion failures.
    const r = cellToAllure(
      { browser: 'webkit', outcome: 'timeout', durationMs: 60000, error: 'cell timed out' },
      1000000,
    );
    expect(r.status).toBe('broken');
    expect(r.statusDetails.message).toBe('cell timed out');
  });

  test('skip outcome → status: skipped', () => {
    const r = cellToAllure(
      { browser: 'mobile-safari-ios', outcome: 'skip', durationMs: 0, error: 'no iPhone' },
      1000000,
    );
    expect(r.status).toBe('skipped');
    expect(r.statusDetails.message).toBe('no iPhone');
  });

  test('unknown outcome → status: broken (defensive fallback)', () => {
    const r = cellToAllure({ browser: 'a', outcome: 'whatever', durationMs: 0 }, 1000000);
    expect(r.status).toBe('broken');
  });

  test('start + stop computed from cellStartMs + durationMs', () => {
    const r = cellToAllure({ browser: 'a', outcome: 'pass', durationMs: 500 }, 1234000);
    expect(r.start).toBe(1234000);
    expect(r.stop).toBe(1234500);
  });

  test('non-finite durationMs defaults to 0 for stop computation', () => {
    const r = cellToAllure({ browser: 'a', outcome: 'pass', durationMs: NaN }, 1000000);
    expect(r.stop).toBe(1000000);
  });

  test('labels include suite=qa-matrix and host=ci', () => {
    const r = cellToAllure({ browser: 'a', outcome: 'pass', durationMs: 0 }, 0);
    expect(r.labels).toEqual(
      expect.arrayContaining([
        { name: 'suite', value: 'qa-matrix' },
        { name: 'host', value: 'ci' },
      ]),
    );
  });

  test('fullName = qa-matrix.<browser>', () => {
    const r = cellToAllure({ browser: 'mobile-chrome-android', outcome: 'pass', durationMs: 0 }, 0);
    expect(r.fullName).toBe('qa-matrix.mobile-chrome-android');
  });

  test('historyId equals uuid (stable for trend analysis)', () => {
    const r = cellToAllure({ browser: 'a', outcome: 'pass', durationMs: 0 }, 0);
    expect(r.historyId).toBe(r.uuid);
  });

  test('statusDetails omitted when outcome is pass even if cell.error present', () => {
    // Edge: error field set on pass outcome (shouldn't happen, but
    // defensively pin the no-false-alarm behavior).
    const r = cellToAllure(
      { browser: 'a', outcome: 'pass', durationMs: 0, error: 'leftover error' },
      0,
    );
    expect(r.statusDetails).toBeUndefined();
  });
});

// ── uuidFor ─────────────────────────────────────────────────────

describe('uuidFor — deterministic per (browser, runStartMs)', () => {
  test('same browser + startMs → same uuid (idempotent)', () => {
    expect(uuidFor('chromium', 1000000)).toBe(uuidFor('chromium', 1000000));
  });

  test('different browsers → different uuids (same startMs)', () => {
    expect(uuidFor('chromium', 1000000)).not.toBe(uuidFor('firefox', 1000000));
  });

  test('different startMs → different uuids (same browser)', () => {
    expect(uuidFor('chromium', 1000000)).not.toBe(uuidFor('chromium', 2000000));
  });

  test('uuid follows 8-4-4-4-12 hex format', () => {
    const id = uuidFor('chromium', 1000000);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ── buildAllureResults ─────────────────────────────────────────

describe('buildAllureResults — cursor advancement', () => {
  test('cells get sequential start times based on cumulative duration', () => {
    const report = {
      cells: [
        { browser: 'a', outcome: 'pass', durationMs: 1000 },
        { browser: 'b', outcome: 'pass', durationMs: 500 },
        { browser: 'c', outcome: 'pass', durationMs: 2000 },
      ],
    };
    const results = buildAllureResults(report, { runStartMs: 10000 });
    expect(results[0].start).toBe(10000);
    expect(results[0].stop).toBe(11000);
    expect(results[1].start).toBe(11000);
    expect(results[1].stop).toBe(11500);
    expect(results[2].start).toBe(11500);
    expect(results[2].stop).toBe(13500);
  });

  test('throws on non-report input (no cells array)', () => {
    expect(() => buildAllureResults({ totally: 'unrelated' })).toThrow(/not a matrix report/);
  });

  test('throws on null input', () => {
    expect(() => buildAllureResults(null)).toThrow(/not a matrix report/);
  });

  test('empty cells array yields empty results array', () => {
    const r = buildAllureResults({ cells: [] }, { runStartMs: 0 });
    expect(r).toEqual([]);
  });

  test('non-finite durationMs in cursor advance treated as 0', () => {
    const report = {
      cells: [
        { browser: 'a', outcome: 'pass', durationMs: NaN },
        { browser: 'b', outcome: 'pass', durationMs: 100 },
      ],
    };
    const r = buildAllureResults(report, { runStartMs: 1000 });
    expect(r[0].start).toBe(1000);
    expect(r[1].start).toBe(1000); // NaN treated as 0, cursor doesn't advance
    expect(r[1].stop).toBe(1100);
  });

  test('default runStartMs uses Date.now()', () => {
    const before = Date.now();
    const r = buildAllureResults({ cells: [{ browser: 'a', outcome: 'pass', durationMs: 0 }] });
    const after = Date.now();
    expect(r[0].start).toBeGreaterThanOrEqual(before);
    expect(r[0].start).toBeLessThanOrEqual(after);
  });
});

// ── OUTCOME_TO_STATUS mapping ──────────────────────────────────

describe('OUTCOME_TO_STATUS mapping', () => {
  test('all 4 matrix outcomes mapped', () => {
    expect(OUTCOME_TO_STATUS.pass).toBe('passed');
    expect(OUTCOME_TO_STATUS.fail).toBe('failed');
    expect(OUTCOME_TO_STATUS.timeout).toBe('broken');
    expect(OUTCOME_TO_STATUS.skip).toBe('skipped');
  });

  test('exactly 4 entries (drift-catch — new matrix outcome added → forces update)', () => {
    expect(Object.keys(OUTCOME_TO_STATUS).sort()).toEqual(['fail', 'pass', 'skip', 'timeout']);
  });
});

// ── formatUsage / readReport ────────────────────────────────────

describe('formatUsage', () => {
  test('mentions report.json, -o, --help, allure generate', () => {
    const text = formatUsage();
    expect(text).toMatch(/<report\.json>/);
    expect(text).toMatch(/-o/);
    expect(text).toMatch(/--help/);
    expect(text).toMatch(/allure generate/);
  });
});

describe('readReport', () => {
  test('throws on non-report JSON', () => {
    const tmp = path.join(os.tmpdir(), `qa-allure-not-report-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ whatever: 1 }));
    try {
      expect(() => readReport(tmp)).toThrow(/not a matrix report/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ── CLI integration ─────────────────────────────────────────────

let tmpSeq = 0;
function writeReportFile(reportObj) {
  tmpSeq += 1;
  const file = path.join(
    os.tmpdir(),
    `qa-allure-report-${process.pid}-${Date.now()}-${tmpSeq}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(reportObj));
  return file;
}

function runCli(args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('CLI integration', () => {
  test('no args → exits 2 with usage', () => {
    const r = runCli();
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('--help → exits 0 with usage', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('valid report → writes N result files to output dir', () => {
    const report = writeReportFile({
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 1000 },
        { browser: 'firefox', outcome: 'fail', durationMs: 2000, error: 'boom' },
      ],
    });
    const outDir = path.join(os.tmpdir(), `qa-allure-out-${process.pid}-${Date.now()}`);
    try {
      const r = runCli([report, '-o', outDir]);
      expect(r.status).toBe(0);
      const files = fs.readdirSync(outDir).filter((f) => f.endsWith('-result.json'));
      expect(files).toHaveLength(2);
      const allureRecords = files.map((f) =>
        JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')),
      );
      const statuses = allureRecords.map((r2) => r2.status).sort();
      expect(statuses).toEqual(['failed', 'passed']);
    } finally {
      fs.unlinkSync(report);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });

  test('missing -o → exits 2', () => {
    const report = writeReportFile({ cells: [] });
    try {
      const r = runCli([report]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/-o/);
    } finally {
      fs.unlinkSync(report);
    }
  });

  test('non-report JSON → exits 1 with actionable error', () => {
    const tmp = path.join(os.tmpdir(), `qa-allure-bad-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ whatever: 1 }));
    const outDir = path.join(os.tmpdir(), `qa-allure-out-bad-${process.pid}-${Date.now()}`);
    try {
      const r = runCli([tmp, '-o', outDir]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not a matrix report/);
    } finally {
      fs.unlinkSync(tmp);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });
});
