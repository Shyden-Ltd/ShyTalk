/**
 * qa-html-report.test.js
 *
 * Tests the matrix-report → HTML converter (gap C1). Covers HTML
 * escaping, structural invariants, and CLI integration.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/qa-html-report.js');

const { escHtml, renderRow, renderHtml, formatUsage, readReport } = require(SCRIPT_PATH);

// ── escHtml ────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes the five XML-significant characters', () => {
    expect(escHtml('<script>alert("x&y\'z")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
    );
  });

  test('returns empty string for empty input', () => {
    expect(escHtml('')).toBe('');
  });

  test('coerces non-string input to string before escaping', () => {
    expect(escHtml(123)).toBe('123');
    expect(escHtml(null)).toBe('null');
  });
});

// ── renderRow ─────────────────────────────────────────────────────

describe('renderRow', () => {
  test('emits <tr> with browser, outcome, duration cells', () => {
    const html = renderRow({ browser: 'chromium', outcome: 'pass', durationMs: 1234 });
    expect(html).toMatch(/^<tr/);
    expect(html).toMatch(/chromium/);
    expect(html).toMatch(/pass/);
    expect(html).toMatch(/1234ms/);
  });

  test('error cell present when cell.error is set', () => {
    const html = renderRow({
      browser: 'firefox',
      outcome: 'fail',
      durationMs: 100,
      error: 'AssertionError: expected x',
    });
    expect(html).toMatch(/AssertionError: expected x/);
  });

  test('error cell is escaped (no raw HTML injection from error message)', () => {
    const html = renderRow({
      browser: 'chromium',
      outcome: 'fail',
      durationMs: 100,
      error: '<script>alert(1)</script>',
    });
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  test('browser slug is escaped (defense-in-depth — unlikely but possible)', () => {
    const html = renderRow({ browser: 'chrome<x>', outcome: 'pass', durationMs: 0 });
    expect(html).toMatch(/chrome&lt;x&gt;/);
  });

  test('uses outcome color (pass = green) in style', () => {
    const html = renderRow({ browser: 'a', outcome: 'pass', durationMs: 0 });
    expect(html).toMatch(/color:#1f7a1f/);
  });

  test('uses outcome color (fail = red) in style', () => {
    const html = renderRow({ browser: 'a', outcome: 'fail', durationMs: 0 });
    expect(html).toMatch(/color:#b22222/);
  });

  test('unknown outcome degrades to neutral color without throwing', () => {
    const html = renderRow({ browser: 'a', outcome: 'whatever', durationMs: 0 });
    expect(html).toMatch(/whatever/);
  });

  test('non-finite duration defaults to 0ms', () => {
    expect(renderRow({ browser: 'a', outcome: 'pass', durationMs: NaN })).toMatch(/0ms/);
  });
});

// ── renderHtml ────────────────────────────────────────────────────

describe('renderHtml', () => {
  const report = {
    cells: [
      { browser: 'chromium', outcome: 'pass', durationMs: 1000 },
      { browser: 'firefox', outcome: 'fail', durationMs: 2000, error: 'oops' },
    ],
    totals: { pass: 1, fail: 1, skip: 0, timeout: 0 },
    summary: '1 pass / 1 fail / 0 skip',
    ok: false,
  };

  test('emits a doctype + html/head/body structure', () => {
    const html = renderHtml(report);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<head>/);
    expect(html).toMatch(/<body>/);
  });

  test('inline CSS — no external <link> for stylesheets', () => {
    const html = renderHtml(report);
    expect(html).toMatch(/<style>/);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/);
  });

  test('no external scripts (no JS attack surface, no network calls)', () => {
    expect(renderHtml(report)).not.toMatch(/<script/);
  });

  test('PASS badge shown when ok=true', () => {
    expect(renderHtml({ ...report, ok: true })).toMatch(/badge-ok/);
  });

  test('FAIL badge shown when ok=false', () => {
    expect(renderHtml(report)).toMatch(/badge-fail/);
  });

  test('renders one row per cell', () => {
    const html = renderHtml(report);
    const trCount = (html.match(/<tr/g) || []).length;
    // 1 header + 2 data rows = 3 total
    expect(trCount).toBe(3);
  });

  test('includes totals footer', () => {
    expect(renderHtml(report)).toMatch(/1 pass \/ 1 fail \/ 0 skip \/ 0 timeout/);
  });

  test('empty cells array renders without crashing', () => {
    const html = renderHtml({ cells: [], totals: { pass: 0, fail: 0, skip: 0, timeout: 0 } });
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/0 pass/);
  });

  test('custom title used in <title> + <h1>', () => {
    const html = renderHtml(report, { title: 'My Custom Title' });
    expect(html).toMatch(/<title>My Custom Title<\/title>/);
    expect(html).toMatch(/<h1>My Custom Title/);
  });

  test('title is escaped', () => {
    const html = renderHtml(report, { title: '<x>' });
    expect(html).toMatch(/<title>&lt;x&gt;<\/title>/);
  });
});

// ── formatUsage / readReport ────────────────────────────────────

describe('formatUsage', () => {
  test('mentions <report.json>, -o, --help', () => {
    const text = formatUsage();
    expect(text).toMatch(/<report\.json>/);
    expect(text).toMatch(/-o/);
    expect(text).toMatch(/--help/);
  });
});

describe('readReport', () => {
  test('throws on non-report JSON', () => {
    const tmp = path.join(os.tmpdir(), `qa-html-not-report-${process.pid}-${Date.now()}.json`);
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
  const file = path.join(os.tmpdir(), `qa-html-report-${process.pid}-${Date.now()}-${tmpSeq}.json`);
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

  test('--help exits 0 with usage', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('valid report → exits 0 with HTML on stdout', () => {
    const report = writeReportFile({
      cells: [{ browser: 'chromium', outcome: 'pass', durationMs: 1000 }],
      totals: { pass: 1, fail: 0, skip: 0, timeout: 0 },
      summary: '1 pass',
      ok: true,
    });
    try {
      const r = runCli([report]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^<!DOCTYPE html>/);
      expect(r.stdout).toMatch(/chromium/);
    } finally {
      fs.unlinkSync(report);
    }
  });

  test('-o FILE writes to file + nothing on stdout', () => {
    const report = writeReportFile({
      cells: [{ browser: 'chromium', outcome: 'pass', durationMs: 0 }],
      totals: { pass: 1, fail: 0, skip: 0, timeout: 0 },
      summary: '',
      ok: true,
    });
    const outFile = path.join(os.tmpdir(), `qa-html-out-${process.pid}-${Date.now()}.html`);
    try {
      const r = runCli([report, '-o', outFile]);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(fs.readFileSync(outFile, 'utf8')).toMatch(/<!DOCTYPE html>/);
    } finally {
      fs.unlinkSync(report);
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    }
  });

  test('two positional args → exits 2 with error', () => {
    const a = writeReportFile({ cells: [] });
    const b = writeReportFile({ cells: [] });
    try {
      const r = runCli([a, b]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/exactly one positional/);
    } finally {
      fs.unlinkSync(a);
      fs.unlinkSync(b);
    }
  });
});
