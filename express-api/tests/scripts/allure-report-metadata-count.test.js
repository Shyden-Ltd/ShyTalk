/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Write metadata.json" shell block extracted from allure-report.yml against
 * REAL suites.json fixtures — no user-controlled command, no PATH manipulation.
 * Matches the sibling pre-merge-check / check-no-new-stubs test convention. */
/**
 * allure-report-metadata-count.test.js — SHY-0127 (Gate-4-exposed CI bug).
 *
 * Gate-4 (backend ⇒ full gauntlet) made android-e2e + playwright-web run on a
 * backend PR for the first time; every test PASSED, which tripped a latent bug
 * in `.github/workflows/allure-report.yml`'s "Write metadata.json" step:
 *
 *     PASSED=$(grep -c '"status":"passed"' suites.json 2>/dev/null || echo 0)
 *     FAILED=$(grep -c '"status":"failed"\|"status":"broken"' ... || echo 0)
 *     TOTAL=$((PASSED + FAILED))
 *
 * `grep -c` prints the count (`0`) to stdout AND exits non-zero when there are
 * zero matching lines, so on an all-green run the `|| echo 0` ALSO fires and the
 * variable becomes the two-line string $'0\n0'. Under GitHub's default
 * `bash -eo pipefail` shell, `$((PASSED + FAILED))` then throws
 * "syntax error in expression (error token is \"0\")" and `set -e` aborts the
 * step — failing the allure-report job (hence PR Gate) precisely WHEN EVERYTHING
 * PASSES.
 *
 * This test runs the REAL extracted block (under `set -eo pipefail`, mirroring
 * GitHub's runner) against real suites.json fixtures and asserts the emitted
 * metadata.json. It is RED before the fix (all-green + zero-passed cases abort /
 * emit invalid JSON) and GREEN after (`VAR=$(...) || VAR=0`). No mocks — real
 * bash, real workflow code, real files.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');

/**
 * Extract the de-indented shell body of a named `run: |` step from a workflow.
 * GitHub strips the block's common leading indentation before executing, so we
 * strip the same 10-space `run: |` content indent to run byte-for-byte what CI
 * runs (heredoc terminators end up at column 0, as GitHub requires).
 */
function extractRunBlock(yaml, stepName) {
  const lines = yaml.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (nameIdx === -1) throw new Error(`step not found: ${stepName}`);
  let runIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    if (/^\s+run:\s*\|/.test(lines[i])) {
      runIdx = i;
      break;
    }
    if (/^\s{0,8}- name:/.test(lines[i])) break; // hit next step first
  }
  if (runIdx === -1) throw new Error(`run: | not found under "${stepName}"`);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    if (/^ {10}/.test(l)) {
      body.push(l.slice(10));
      continue;
    }
    break; // dedent below the run-block content indent → end of step
  }
  return body.join('\n');
}

/** Replace the `${{ ... }}` GitHub expressions with concrete test values. */
function materialize(block) {
  return block
    .replace(/\$\{\{\s*github\.run_id\s*\}\}/g, '123')
    .replace(/\$\{\{\s*github\.repository\s*\}\}/g, 'Shyden-Ltd/ShyTalk')
    .replace(/\$\{\{\s*inputs\.suite_name\s*\}\}/g, 'playwright')
    .replace(/\$\{\{\s*inputs\.report_env\s*\}\}/g, 'pr');
}

/** A faithful (line-per-status) allure suites.json fixture. The step counts
 * matching LINES, so one status object per line maps 1:1 to the emitted count. */
function suites({ passed = 0, failed = 0, broken = 0 } = {}) {
  const lines = [
    ...Array(passed).fill('{"uid":"p","status":"passed"}'),
    ...Array(failed).fill('{"uid":"f","status":"failed"}'),
    ...Array(broken).fill('{"uid":"b","status":"broken"}'),
  ];
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Run the REAL metadata step under GitHub's default bash flags. `suitesContent`
 * === null omits the file entirely (graceful-missing path). */
function runMetadataStep(suitesContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-meta-'));
  fs.mkdirSync(path.join(dir, 'allure-report/data'), { recursive: true });
  if (suitesContent !== null) {
    fs.writeFileSync(path.join(dir, 'allure-report/data/suites.json'), suitesContent);
  }
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  // Prepend `set -eo pipefail` — GitHub Actions runs `run:` bash steps with
  // `--noprofile --norc -eo pipefail`, which is what turns the arithmetic error
  // into an aborting failure. Reproduce it faithfully.
  const script = 'set -eo pipefail\n' + materialize(extractRunBlock(yaml, 'Write metadata.json'));
  let error = null;
  let stderr = '';
  try {
    execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    error = e;
    stderr = String(e.stderr || '');
  }
  const metaPath = path.join(dir, 'allure-report/metadata.json');
  const metaRaw = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : null;
  return { error, stderr, metaRaw };
}

describe('allure-report.yml "Write metadata.json" — SHY-0127 grep-count crash fix', () => {
  test('extraction sanity: the block contains the count + arithmetic lines', () => {
    const block = extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), 'Write metadata.json');
    expect(block).toMatch(/grep -c '"status":"passed"'/);
    expect(block).toMatch(/TOTAL=\$\(\(PASSED \+ FAILED\)\)/);
    expect(block).toMatch(/metadata\.json/);
  });

  test('regression guard: the count lines use `|| VAR=0`, never the double-zeroing `|| echo 0`', () => {
    // Belt-and-suspenders for the behavioral tests below: locks the FIX SHAPE so
    // a future refactor that reintroduces `grep -c ... || echo 0` (which appends
    // a second "0" line) is caught even if the de-indent extraction drifts.
    const block = extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), 'Write metadata.json');
    expect(block).not.toMatch(/grep -c[^\n]*\|\| echo 0/);
    expect(block).toMatch(/PASSED=\$\(grep -c[^\n]*\) \|\| PASSED=0/);
    expect(block).toMatch(/FAILED=\$\(grep -c[^\n]*\) \|\| FAILED=0/);
  });

  test('all-green run (zero failed/broken) emits valid metadata.json — no $((..)) crash', () => {
    // THE bug trigger: zero failed lines → FAILED double-zeros → arithmetic
    // syntax error → set -e aborts. RED before the fix.
    const { error, stderr, metaRaw } = runMetadataStep(suites({ passed: 3 }));
    expect(stderr).not.toMatch(/syntax error in expression/);
    expect(error).toBeNull();
    expect(metaRaw).not.toBeNull();
    const m = JSON.parse(metaRaw); // RED before fix: invalid JSON / file absent
    expect(m.passed).toBe(3);
    expect(m.failed).toBe(0);
    expect(m.total).toBe(3);
  });

  test('zero-passed run (only failures) emits valid metadata.json — covers the PASSED line too', () => {
    // Mirror trigger on the PASSED grep (zero passed lines → double-zero).
    const { error, stderr, metaRaw } = runMetadataStep(suites({ failed: 2 }));
    expect(stderr).not.toMatch(/syntax error in expression/);
    expect(error).toBeNull();
    const m = JSON.parse(metaRaw);
    expect(m.passed).toBe(0);
    expect(m.failed).toBe(2);
    expect(m.total).toBe(2);
  });

  test('mixed run counts failed + broken together', () => {
    const { error, metaRaw } = runMetadataStep(suites({ passed: 2, failed: 1, broken: 1 }));
    expect(error).toBeNull();
    const m = JSON.parse(metaRaw);
    expect(m.passed).toBe(2);
    expect(m.failed).toBe(2); // failed OR broken
    expect(m.total).toBe(4);
  });

  test('missing suites.json degrades gracefully to all-zero metadata', () => {
    const { error, metaRaw } = runMetadataStep(null);
    expect(error).toBeNull();
    const m = JSON.parse(metaRaw);
    expect(m.passed).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.total).toBe(0);
  });

  test('emitted metadata carries the materialized run identity fields', () => {
    const { metaRaw } = runMetadataStep(suites({ passed: 1 }));
    const m = JSON.parse(metaRaw);
    expect(m.suite).toBe('playwright');
    expect(m.env).toBe('pr');
    expect(m.runId).toBe('123');
    expect(m.runUrl).toContain('Shyden-Ltd/ShyTalk');
    expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
