/**
 * driver-surface-report.test.js
 *
 * Tests the survey tool (express-api/scripts/driver-surface-report.js)
 * that surfaces driver method-count divergences across the matrix.
 * Closes gap B5 — the report itself IS the "investigation" that gap
 * requested; these tests pin its output shape so a future driver-set
 * change can be inspected by diffing two runs.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/driver-surface-report.js');

const { discoverDrivers, buildReport, formatTable, formatJson, formatUsage } = require(SCRIPT_PATH);

// ── Pure helpers ───────────────────────────────────────────────────

describe('discoverDrivers', () => {
  test('returns >= 11 drivers; exact count pinned by EXPECTED_COUNTS (14 files − 3 helpers)', () => {
    expect(discoverDrivers().length).toBeGreaterThanOrEqual(11);
  });

  test('excludes helper modules (android-cdp-helpers, ios-driver-loader, driver-screenshot-helper)', () => {
    const names = discoverDrivers().map((d) => d.name);
    expect(names).not.toContain('android-cdp-helpers');
    expect(names).not.toContain('ios-driver-loader');
    expect(names).not.toContain('driver-screenshot-helper');
  });

  test('result entries have name + full (absolute path)', () => {
    const sample = discoverDrivers()[0];
    expect(typeof sample.name).toBe('string');
    expect(path.isAbsolute(sample.full)).toBe(true);
  });
});

describe('buildReport', () => {
  test('returns one entry per discovered driver', () => {
    expect(buildReport().length).toBe(discoverDrivers().length);
  });

  test('every entry has name, count, methods array', () => {
    for (const entry of buildReport()) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.count).toBe('number');
      expect(Array.isArray(entry.methods)).toBe(true);
      expect(entry.count).toBe(entry.methods.length);
    }
  });

  test('total method count across drivers > 50 (sanity: matrix has real surface)', () => {
    const total = buildReport().reduce((a, e) => a + e.count, 0);
    expect(total).toBeGreaterThan(50);
  });
});

describe('formatTable', () => {
  test('returns a multi-line string with header + footer', () => {
    const text = formatTable(buildReport());
    expect(text).toMatch(/\| Driver/);
    expect(text).toMatch(/\| Count/);
    expect(text).toMatch(/Surface stats:/);
  });

  test('footer reports total / avg / min / max', () => {
    const text = formatTable(buildReport());
    expect(text).toMatch(/total methods/);
    expect(text).toMatch(/avg /);
    expect(text).toMatch(/min /);
    expect(text).toMatch(/max /);
  });

  test('rows sorted by count descending (largest first)', () => {
    const fakeReport = [
      { name: 'small', count: 2, methods: [] },
      { name: 'big', count: 50, methods: [] },
      { name: 'mid', count: 10, methods: [] },
    ];
    const text = formatTable(fakeReport);
    const lines = text.split('\n').filter((l) => /\| \w/.test(l));
    // First data row should be 'big' (50), next 'mid' (10), then 'small' (2).
    expect(lines[1]).toMatch(/big/);
    expect(lines[2]).toMatch(/mid/);
    expect(lines[3]).toMatch(/small/);
  });

  test('empty report degrades gracefully (no NaN min/max)', () => {
    const text = formatTable([]);
    expect(text).toMatch(/0 drivers/);
    expect(text).toMatch(/min 0/);
    expect(text).toMatch(/max 0/);
  });
});

describe('formatJson', () => {
  test('returns a parseable JSON array of report entries', () => {
    const json = formatJson(buildReport());
    expect(() => JSON.parse(json)).not.toThrow();
    expect(Array.isArray(JSON.parse(json))).toBe(true);
  });
});

describe('formatUsage', () => {
  test('mentions --json and --help', () => {
    const text = formatUsage();
    expect(text).toMatch(/--json/);
    expect(text).toMatch(/--help/);
  });
});

// ── CLI integration ───────────────────────────────────────────────

function runCli(args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('CLI integration', () => {
  test('default (no args) prints the table + exits 0', () => {
    const r = runCli();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\| Driver /);
    expect(r.stdout).toMatch(/Surface stats:/);
  });

  test('--json emits a JSON array + exits 0', () => {
    const r = runCli(['--json']);
    expect(r.status).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('--help exits 0 with usage text', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('-h is an alias for --help', () => {
    const r = runCli(['-h']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });
});
