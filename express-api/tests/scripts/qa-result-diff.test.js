/**
 * qa-result-diff.test.js
 *
 * Tests the matrix-result diff tool (gap C6). Covers the pure
 * `diffReports` categorisation logic + the CLI integration
 * (positional args, --json, --help, exit codes).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/qa-result-diff.js');

const { diffReports, formatTable, formatJson, formatUsage, readReport } = require(SCRIPT_PATH);

// ── diffReports — categorisation ──────────────────────────────────

function cell(browser, outcome, extra = {}) {
  return { browser, outcome, durationMs: 1000, ...extra };
}

function report(cells) {
  return { cells };
}

describe('diffReports — happy paths', () => {
  test('empty reports produce empty diff', () => {
    const d = diffReports(report([]), report([]));
    expect(d).toEqual({
      regressions: [],
      recoveries: [],
      unchanged: [],
      added: [],
      removed: [],
    });
  });

  test('all cells unchanged → empty regression/recovery, populated unchanged', () => {
    const prev = report([cell('chromium', 'pass'), cell('firefox', 'pass')]);
    const curr = report([cell('chromium', 'pass'), cell('firefox', 'pass')]);
    const d = diffReports(prev, curr);
    expect(d.regressions).toHaveLength(0);
    expect(d.recoveries).toHaveLength(0);
    expect(d.unchanged).toHaveLength(2);
  });
});

describe('diffReports — regressions', () => {
  test('pass → fail is a regression', () => {
    const prev = report([cell('chromium', 'pass')]);
    const curr = report([cell('chromium', 'fail')]);
    const d = diffReports(prev, curr);
    expect(d.regressions).toEqual([
      { browser: 'chromium', prevOutcome: 'pass', currOutcome: 'fail', currError: undefined },
    ]);
  });

  test('pass → timeout is a regression (hang counts as failure)', () => {
    const prev = report([cell('chromium', 'pass')]);
    const curr = report([cell('chromium', 'timeout')]);
    expect(diffReports(prev, curr).regressions).toHaveLength(1);
  });

  test('regression includes currError if present', () => {
    const prev = report([cell('chromium', 'pass')]);
    const curr = report([cell('chromium', 'fail', { error: 'AssertionError: expected x' })]);
    const d = diffReports(prev, curr);
    expect(d.regressions[0].currError).toBe('AssertionError: expected x');
  });
});

describe('diffReports — recoveries', () => {
  test('fail → pass is a recovery', () => {
    const prev = report([cell('chromium', 'fail')]);
    const curr = report([cell('chromium', 'pass')]);
    expect(diffReports(prev, curr).recoveries).toEqual([
      { browser: 'chromium', prevOutcome: 'fail', currOutcome: 'pass' },
    ]);
  });

  test('timeout → pass is a recovery (hang resolved)', () => {
    const prev = report([cell('chromium', 'timeout')]);
    const curr = report([cell('chromium', 'pass')]);
    expect(diffReports(prev, curr).recoveries).toHaveLength(1);
  });
});

describe('diffReports — added / removed cells', () => {
  test('cell only in curr → added', () => {
    const prev = report([cell('chromium', 'pass')]);
    const curr = report([cell('chromium', 'pass'), cell('firefox', 'pass')]);
    const d = diffReports(prev, curr);
    expect(d.added).toEqual([{ browser: 'firefox', currOutcome: 'pass' }]);
  });

  test('cell only in prev → removed', () => {
    const prev = report([cell('chromium', 'pass'), cell('firefox', 'pass')]);
    const curr = report([cell('chromium', 'pass')]);
    const d = diffReports(prev, curr);
    expect(d.removed).toEqual([{ browser: 'firefox', prevOutcome: 'pass' }]);
  });
});

describe('diffReports — neither regression nor recovery (edge transitions)', () => {
  test('pass → skip is not a regression (operator unplugged device)', () => {
    const prev = report([cell('chromium', 'pass')]);
    const curr = report([cell('chromium', 'skip')]);
    const d = diffReports(prev, curr);
    expect(d.regressions).toHaveLength(0);
    expect(d.unchanged).toHaveLength(1);
    expect(d.unchanged[0].outcome).toBe('pass → skip');
  });

  test('fail → skip is not a recovery', () => {
    const prev = report([cell('chromium', 'fail')]);
    const curr = report([cell('chromium', 'skip')]);
    const d = diffReports(prev, curr);
    expect(d.recoveries).toHaveLength(0);
    expect(d.unchanged[0].outcome).toBe('fail → skip');
  });
});

// ── format functions ──────────────────────────────────────────────

describe('formatTable', () => {
  test('clean diff → "No regressions ✓"', () => {
    const d = { regressions: [], recoveries: [], unchanged: [], added: [], removed: [] };
    expect(formatTable(d)).toMatch(/No regressions ✓/);
  });

  test('lists regressions with ✗ marker + outcome arrow', () => {
    const d = {
      regressions: [{ browser: 'chromium', prevOutcome: 'pass', currOutcome: 'fail' }],
      recoveries: [],
      unchanged: [],
      added: [],
      removed: [],
    };
    expect(formatTable(d)).toMatch(/✗ chromium: pass → fail/);
  });

  test('summary line includes all counts', () => {
    const d = {
      regressions: [{ browser: 'a', prevOutcome: 'pass', currOutcome: 'fail' }],
      recoveries: [{ browser: 'b', prevOutcome: 'fail', currOutcome: 'pass' }],
      unchanged: [],
      added: [{ browser: 'c', currOutcome: 'pass' }],
      removed: [{ browser: 'd', prevOutcome: 'pass' }],
    };
    const text = formatTable(d);
    expect(text).toMatch(/1 regression\(s\)/);
    expect(text).toMatch(/1 recovery\(ies\)/);
    expect(text).toMatch(/1 added/);
    expect(text).toMatch(/1 removed/);
  });
});

describe('formatJson', () => {
  test('returns a JSON-parseable string', () => {
    const d = { regressions: [], recoveries: [], unchanged: [], added: [], removed: [] };
    expect(() => JSON.parse(formatJson(d))).not.toThrow();
  });
});

describe('formatUsage', () => {
  test('mentions positional args + --json + --help', () => {
    const text = formatUsage();
    expect(text).toMatch(/prev\.json.*curr\.json/);
    expect(text).toMatch(/--json/);
    expect(text).toMatch(/--help/);
  });
});

// ── readReport ────────────────────────────────────────────────────

describe('readReport', () => {
  test('throws actionable error on non-report JSON (no cells array)', () => {
    const tmp = path.join(os.tmpdir(), `not-a-report-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ totally: 'unrelated' }));
    try {
      expect(() => readReport(tmp)).toThrow(/not a matrix report/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('throws on missing file (fs error bubbles up)', () => {
    expect(() => readReport('/nonexistent/path/x.json')).toThrow(/ENOENT/);
  });
});

// ── CLI integration ──────────────────────────────────────────────

let writeReportSeq = 0;
function writeReportFile(reportObj) {
  // Counter + pid + timestamp guarantees uniqueness across parallel
  // worker pids AND inside a single test run, without relying on
  // Math.random (sonarjs/pseudo-random warning) — which adds no real
  // safety for test-fixture filenames anyway.
  writeReportSeq += 1;
  const file = path.join(
    os.tmpdir(),
    `qa-report-${process.pid}-${Date.now()}-${writeReportSeq}.json`,
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
  let prevFile, currFile;
  afterEach(() => {
    for (const f of [prevFile, currFile]) {
      if (f && fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  test('no args → exits 2 with usage to stdout', () => {
    const r = runCli();
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('--help exits 0 with usage', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('clean diff (no regressions) exits 0', () => {
    prevFile = writeReportFile(report([cell('chromium', 'pass')]));
    currFile = writeReportFile(report([cell('chromium', 'pass')]));
    const r = runCli([prevFile, currFile]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No regressions/);
  });

  test('diff with regression exits 1', () => {
    prevFile = writeReportFile(report([cell('chromium', 'pass')]));
    currFile = writeReportFile(report([cell('chromium', 'fail')]));
    const r = runCli([prevFile, currFile]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Regressions \(1\)/);
  });

  test('--json emits JSON to stdout', () => {
    prevFile = writeReportFile(report([cell('chromium', 'pass')]));
    currFile = writeReportFile(report([cell('chromium', 'fail')]));
    const r = runCli([prevFile, currFile, '--json']);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    const parsed = JSON.parse(r.stdout);
    expect(parsed.regressions).toHaveLength(1);
  });

  test('only one positional arg → exits 2 with error', () => {
    prevFile = writeReportFile(report([]));
    const r = runCli([prevFile]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/exactly two positional args/);
  });
});
