/**
 * matrix-cell-logs.test.js
 *
 * Tests for the per-cell log capture helpers used by the runner's
 * `--report-dir` flag.
 *
 * Coverage areas:
 *   - resolveCellLogPath: join + extension, input validation
 *   - ensureReportDir: idempotent mkdir-p, input validation
 *   - formatCellLog: header banner shape, missing fields, nowIso default
 *   - writeCellLog: invokes fs.writeFileSync with the formatted body
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const { resolveCellLogPath, ensureReportDir, formatCellLog, writeCellLog } = require(
  path.join(REPO_ROOT, 'express-api/scripts/matrix-cell-logs'),
);

// resolveCellLogPath ────────────────────────────────────────────────

describe('resolveCellLogPath', () => {
  test('joins dir + <browser>.log', () => {
    expect(resolveCellLogPath('/tmp/reports', 'chromium')).toBe('/tmp/reports/chromium.log');
  });

  test('preserves hyphenated mobile browser slugs', () => {
    expect(resolveCellLogPath('/tmp/reports', 'mobile-chrome-android')).toBe(
      '/tmp/reports/mobile-chrome-android.log',
    );
  });

  test('handles relative dirs', () => {
    expect(resolveCellLogPath('reports/run-1', 'webkit')).toBe('reports/run-1/webkit.log');
  });

  test.each([null, undefined, '', 0])('throws when dir is %p', (dir) => {
    expect(() => resolveCellLogPath(dir, 'chromium')).toThrow(/dir.*is required/);
  });

  test.each([null, undefined, '', 0])('throws when browser is %p', (browser) => {
    expect(() => resolveCellLogPath('/tmp', browser)).toThrow(/browser.*is required/);
  });
});

// ensureReportDir ──────────────────────────────────────────────────

describe('ensureReportDir', () => {
  test('invokes fs.mkdirSync with { recursive: true }', () => {
    const mkdirSync = jest.fn();
    const fsImpl = { mkdirSync };
    ensureReportDir('/tmp/reports', fsImpl);
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/reports', { recursive: true });
  });

  test('returns the dir path so callers can chain', () => {
    const fsImpl = { mkdirSync: jest.fn() };
    expect(ensureReportDir('/tmp/reports', fsImpl)).toBe('/tmp/reports');
  });

  test.each([null, undefined, '', 0])('throws when dir is %p', (dir) => {
    const fsImpl = { mkdirSync: jest.fn() };
    expect(() => ensureReportDir(dir, fsImpl)).toThrow(/dir.*is required/);
  });
});

// formatCellLog ────────────────────────────────────────────────────

describe('formatCellLog', () => {
  test('header banner includes browser + outcome + durationMs', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'pass', durationMs: 842 },
      body: 'subprocess output',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/^## browser=chromium outcome=pass durationMs=842/);
  });

  test('header includes startedAt from cell or nowIso', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'pass', durationMs: 100 },
      body: 'x',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/## startedAt=2026-05-30T18:42:00.000Z/);
  });

  test('cell.startedAt preferred over nowIso when present', () => {
    const text = formatCellLog({
      cell: {
        browser: 'chromium',
        outcome: 'pass',
        durationMs: 100,
        startedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'x',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/## startedAt=2026-01-01T00:00:00.000Z/);
    expect(text).not.toMatch(/2026-05-30T18:42/);
  });

  test('header + body separator line is "## --"', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'pass', durationMs: 100 },
      body: 'output',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/\n## --\n/);
  });

  test('body appears after the separator', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'fail', durationMs: 50 },
      body: 'AssertionError: expected 5',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    const parts = text.split('\n## --\n');
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe('AssertionError: expected 5');
  });

  test('missing outcome surfaces "unknown"', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', durationMs: 100 },
      body: '',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/outcome=unknown/);
  });

  test('missing durationMs surfaces 0', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'pass' },
      body: '',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text).toMatch(/durationMs=0/);
  });

  test('empty body still produces a well-formed header (no crash)', () => {
    const text = formatCellLog({
      cell: { browser: 'chromium', outcome: 'pass', durationMs: 100 },
      body: '',
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(text.split('\n')).toHaveLength(4); // 3 header lines + 1 empty body
  });

  test('nowIso default produces a real ISO when omitted', () => {
    const text = formatCellLog({
      cell: { browser: 'c', outcome: 'pass', durationMs: 1 },
      body: 'x',
    });
    expect(text).toMatch(/## startedAt=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// writeCellLog ─────────────────────────────────────────────────────

describe('writeCellLog', () => {
  test('writes the formatted log to <dir>/<browser>.log', () => {
    const writeFileSync = jest.fn();
    const fsImpl = { writeFileSync };
    const filePath = writeCellLog({
      dir: '/tmp/reports',
      cell: { browser: 'chromium', outcome: 'pass', durationMs: 100 },
      body: 'output',
      fsImpl,
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(filePath).toBe('/tmp/reports/chromium.log');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = writeFileSync.mock.calls[0];
    expect(path).toBe('/tmp/reports/chromium.log');
    expect(content).toMatch(/## browser=chromium outcome=pass/);
    expect(content).toMatch(/\noutput$/);
  });

  test('forwards the cell.startedAt into the header', () => {
    const writeFileSync = jest.fn();
    const fsImpl = { writeFileSync };
    writeCellLog({
      dir: '/tmp/reports',
      cell: {
        browser: 'firefox',
        outcome: 'fail',
        durationMs: 200,
        startedAt: '2026-04-01T12:00:00.000Z',
      },
      body: 'AssertionError',
      fsImpl,
    });
    const content = writeFileSync.mock.calls[0][1];
    expect(content).toMatch(/## startedAt=2026-04-01T12:00:00.000Z/);
  });

  test('empty body still triggers a write (skeleton-only log file)', () => {
    const writeFileSync = jest.fn();
    const fsImpl = { writeFileSync };
    writeCellLog({
      dir: '/tmp/reports',
      cell: { browser: 'webkit', outcome: 'skip', durationMs: 0 },
      body: '',
      fsImpl,
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const content = writeFileSync.mock.calls[0][1];
    expect(content).toMatch(/outcome=skip/);
  });
});
