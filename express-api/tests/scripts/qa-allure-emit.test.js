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

  test('skip without cell.error → no statusDetails (Allure renders cleanly)', () => {
    // Reviewer-flagged: skip cells without error field shouldn't
    // ship empty statusDetails — Allure renders the test differently
    // when statusDetails is present vs absent.
    const r = cellToAllure({ browser: 'a', outcome: 'skip', durationMs: 0 }, 0);
    expect(r.status).toBe('skipped');
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

  test('cellIndex disambiguates same browser+startMs (collision fix C1)', () => {
    // Reviewer-flagged: without cellIndex, two cells for the same
    // browser with zero/NaN-duration predecessors would share startMs
    // → identical UUID → writeAllureResults overwrites. Index in
    // the hash prevents collision.
    expect(uuidFor('chromium', 1000000, 0)).not.toBe(uuidFor('chromium', 1000000, 1));
  });
});

// ── UUID collision regression (C1 production fix) ──────────────

describe('buildAllureResults — UUID collision prevention (C1)', () => {
  test('two cells for same browser with zero-duration predecessors get distinct UUIDs', () => {
    const report = {
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 0 },
        { browser: 'chromium', outcome: 'fail', durationMs: 0, error: 'second run' },
      ],
    };
    const results = buildAllureResults(report, { runStartMs: 1000 });
    expect(results).toHaveLength(2);
    expect(results[0].uuid).not.toBe(results[1].uuid);
  });

  test('two cells for same browser with NaN-duration predecessors also get distinct UUIDs', () => {
    const report = {
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: NaN },
        { browser: 'chromium', outcome: 'pass', durationMs: NaN },
      ],
    };
    const results = buildAllureResults(report, { runStartMs: 1000 });
    expect(results[0].uuid).not.toBe(results[1].uuid);
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

  test('throws SyntaxError on malformed (non-JSON) file content', () => {
    // Reviewer-flagged (C2): readReport's JSON.parse path had no
    // direct test. Pin: SyntaxError propagates (caller wraps with
    // process.exit(1) in main).
    const tmp = path.join(os.tmpdir(), `qa-allure-bad-json-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, 'not json at all {{{');
    try {
      expect(() => readReport(tmp)).toThrow(SyntaxError);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ── writeAllureResults — direct unit tests (I3) ────────────────

describe('writeAllureResults — direct unit tests', () => {
  const { writeAllureResults } = require(SCRIPT_PATH);

  test('returns the count of files written', () => {
    const outDir = path.join(os.tmpdir(), `qa-allure-unit-${process.pid}-${Date.now()}`);
    try {
      const results = buildAllureResults({
        cells: [
          { browser: 'a', outcome: 'pass', durationMs: 100 },
          { browser: 'b', outcome: 'pass', durationMs: 100 },
        ],
      });
      const count = writeAllureResults(results, outDir);
      expect(count).toBe(2);
    } finally {
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });

  test('creates output directory if it does not exist (recursive mkdir)', () => {
    const outDir = path.join(
      os.tmpdir(),
      `qa-allure-mkdir-${process.pid}-${Date.now()}/nested/dir`,
    );
    try {
      writeAllureResults([{ uuid: 'test-uuid', name: 'x' }], outDir);
      expect(fs.existsSync(outDir)).toBe(true);
    } finally {
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });

  test('written files parse as valid JSON with expected uuid key', () => {
    const outDir = path.join(os.tmpdir(), `qa-allure-roundtrip-${process.pid}-${Date.now()}`);
    try {
      const results = buildAllureResults({
        cells: [{ browser: 'chromium', outcome: 'pass', durationMs: 1000 }],
      });
      writeAllureResults(results, outDir);
      const files = fs.readdirSync(outDir).filter((f) => f.endsWith('-result.json'));
      expect(files).toHaveLength(1);
      const content = JSON.parse(fs.readFileSync(path.join(outDir, files[0]), 'utf8'));
      expect(content.uuid).toBe(results[0].uuid);
      expect(content.name).toBe('chromium');
      expect(content.status).toBe('passed');
    } finally {
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
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

  test('malformed JSON file → exits 1 with actionable stderr (C2)', () => {
    // Reviewer-flagged: SyntaxError path was uncovered. Operator
    // passing a non-JSON file (e.g. junit XML by mistake) should
    // get a clear error, not a raw V8 parser message.
    const tmp = path.join(os.tmpdir(), `qa-allure-malformed-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, 'definitely not JSON {{{');
    const outDir = path.join(os.tmpdir(), `qa-allure-out-mal-${process.pid}-${Date.now()}`);
    try {
      const r = runCli([tmp, '-o', outDir]);
      expect(r.status).toBe(1);
      // stderr should contain "qa-allure-emit failed:" prefix from main's catch
      expect(r.stderr).toMatch(/qa-allure-emit failed/);
    } finally {
      fs.unlinkSync(tmp);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });

  test('-h short form exits 0 with usage (I1)', () => {
    const r = runCli(['-h']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('--output long form is accepted (I1)', () => {
    const report = writeReportFile({
      cells: [{ browser: 'a', outcome: 'pass', durationMs: 100 }],
    });
    const outDir = path.join(os.tmpdir(), `qa-allure-longform-${process.pid}-${Date.now()}`);
    try {
      const r = runCli([report, '--output', outDir]);
      expect(r.status).toBe(0);
      expect(fs.readdirSync(outDir).filter((f) => f.endsWith('-result.json'))).toHaveLength(1);
    } finally {
      fs.unlinkSync(report);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });

  test('two positional args → exits 2 (I2)', () => {
    const reportA = writeReportFile({ cells: [] });
    const reportB = writeReportFile({ cells: [] });
    const outDir = path.join(os.tmpdir(), `qa-allure-2pos-${process.pid}-${Date.now()}`);
    try {
      const r = runCli([reportA, reportB, '-o', outDir]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/exactly one positional/);
    } finally {
      fs.unlinkSync(reportA);
      fs.unlinkSync(reportB);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
    }
  });
});
