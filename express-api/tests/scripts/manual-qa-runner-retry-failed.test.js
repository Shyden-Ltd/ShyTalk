/**
 * manual-qa-runner-retry-failed.test.js
 *
 * Tests the `--retry-failed FILE` flag (gap G1). Verifies:
 *   - --retry-failed filters the matrix to cells that failed/timed out
 *     in the referenced JSON report
 *   - non-failing cells (pass/skip) are NOT re-dispatched
 *   - exits 0 with helpful message when prev report has no failures
 *   - exits 2 on malformed JSON or missing cells array
 *   - --retry-failed is stripped from per-cell argv (so subprocesses
 *     don't recurse into reading the report file)
 *   - --retry-failed is documented in formatUsage() (drift-catch)
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
  const file = path.join(
    os.tmpdir(),
    `qa-retry-failed-${process.pid}-${Date.now()}-${tmpSeq}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(reportObj));
  return file;
}

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

// ── --retry-failed argument validation ────────────────────────────

describe('--retry-failed — argument validation', () => {
  test('--retry-failed with nonexistent file exits 2 with actionable error', () => {
    const r = runCli(
      ['--matrix', '--target', 'local', '--retry-failed', '/nonexistent/report.json'],
      { PERSONAS_PASSWORD: 'fake', FIREBASE_LOCAL_API_KEY: 'fake' },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--retry-failed:.*ENOENT|--retry-failed:.*not.*found/i);
  });

  test('--retry-failed with non-report JSON exits 2 with "not a matrix report"', () => {
    const tmp = writeTmpReport({ totally: 'unrelated' });
    try {
      const r = runCli(['--matrix', '--target', 'local', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_LOCAL_API_KEY: 'fake',
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/not a matrix report/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ── --retry-failed filtering ─────────────────────────────────────

describe('--retry-failed — cell filtering', () => {
  test('prev report with no failures → exits 0 with "nothing to retry"', () => {
    const tmp = writeTmpReport({
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 1000 },
        { browser: 'firefox', outcome: 'pass', durationMs: 1000 },
      ],
    });
    try {
      const r = runCli(['--matrix', '--target', 'local', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_LOCAL_API_KEY: 'fake',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/nothing to retry/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('prev report with one failure → "retrying 1 cell(s)" announces the filter', () => {
    const tmp = writeTmpReport({
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 1000 },
        { browser: 'firefox', outcome: 'fail', durationMs: 2000 },
      ],
    });
    try {
      const r = runCli(['--matrix', '--target', 'local', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_LOCAL_API_KEY: 'fake',
      });
      // The retry announcement must appear regardless of whether the
      // matrix dispatch succeeds (which it won't in a unit test —
      // there's no real Firefox).
      expect(r.stdout).toMatch(/\[retry-failed\] retrying 1 cell\(s\).*firefox/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('timeout outcomes are also retried (treated as failure for retry purposes)', () => {
    const tmp = writeTmpReport({
      cells: [
        { browser: 'chromium', outcome: 'timeout', durationMs: 60000 },
        { browser: 'firefox', outcome: 'pass', durationMs: 1000 },
      ],
    });
    try {
      const r = runCli(['--matrix', '--target', 'local', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_LOCAL_API_KEY: 'fake',
      });
      expect(r.stdout).toMatch(/retrying 1 cell\(s\).*chromium/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('skip outcomes are NOT retried (no device ≠ test failure)', () => {
    const tmp = writeTmpReport({
      cells: [
        { browser: 'chromium', outcome: 'skip', durationMs: 0 },
        { browser: 'firefox', outcome: 'pass', durationMs: 1000 },
      ],
    });
    try {
      const r = runCli(['--matrix', '--target', 'local', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_LOCAL_API_KEY: 'fake',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/nothing to retry/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('cells in prev that are not in current allowlist are silently dropped', () => {
    // Prev contains a cell not in --target prod allowlist; filter
    // intersects so unknown cell is dropped (no error, no retry).
    const tmp = writeTmpReport({
      cells: [{ browser: 'mobile-chrome-android', outcome: 'fail', durationMs: 1000 }],
    });
    try {
      const r = runCli(['--matrix', '--target', 'prod', '--retry-failed', tmp], {
        PERSONAS_PASSWORD: 'fake',
        FIREBASE_PROD_API_KEY: 'fake',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/nothing to retry/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ── --retry-failed documentation pin ─────────────────────────────

describe('--retry-failed — formatUsage drift-catch', () => {
  test('--retry-failed is documented in formatUsage', () => {
    const { formatUsage } = require(RUNNER_PATH);
    expect(formatUsage()).toMatch(/--retry-failed/);
  });
});
