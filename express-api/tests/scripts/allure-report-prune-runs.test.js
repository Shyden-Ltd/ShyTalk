/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Prune old runs" block extracted from allure-report.yml against REAL
 * fixture directory trees — no doubles. */
/**
 * allure-report-prune-runs.test.js — SHY-0191 R1 C2.
 *
 * The SC2012 fix rewrote the prune from `ls -1d | sort | head -n -N | xargs
 * rm -rf` to a NUL-safe pure-bash array walk (`find -print0 | sort -z`
 * into `read -d ''`, then `rm -rf --` the excess oldest entries). No
 * GNU-only flags — the block executes identically on ubuntu CI and on a
 * stock macOS dev box, which is what lets this file run the REAL block
 * everywhere. It asserts exactly which directories survive: retention of
 * the newest N, the fewer-than-N and exactly-N no-ops, NUL-safety for
 * awkward names, and the same-date prefix-pair ordering edge the review's
 * M2 raised (…run-99 vs …run-990 — the NUL suffix, like the old '/'
 * suffix, sorts below alphanumerics, so the shorter name still sorts
 * first).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');
const STEP_NAME = 'Prune old runs (keep last N)';

/** Same de-indenting extractor as allure-report-metadata-count.test.js. */
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
    if (/^\s{0,8}- name:/.test(lines[i])) break;
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
    break;
  }
  return body.join('\n');
}

/** Replace the `${{ ... }}` GitHub expressions with concrete test values. */
function materialize(block, maxRuns) {
  return block
    .replace(/\$\{\{\s*inputs\.suite_name\s*\}\}/g, 'playwright')
    .replace(/\$\{\{\s*inputs\.report_env\s*\}\}/g, 'pr')
    .replace(/\$\{\{\s*inputs\.max_history_runs\s*\}\}/g, String(maxRuns));
}

/** Lay down runs/ fixture dirs, execute the real prune block, return the
 * sorted list of surviving directory names. */
function runPrune(dirNames, maxRuns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-prune-'));
  const runsDir = path.join(dir, 'gh-pages/playwright/pr/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  for (const name of dirNames) {
    fs.mkdirSync(path.join(runsDir, name));
    fs.writeFileSync(path.join(runsDir, name, 'index.html'), 'x');
  }
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const script = 'set -eo pipefail\n' + materialize(extractRunBlock(yaml, STEP_NAME), maxRuns);
  execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  return fs.readdirSync(runsDir).sort();
}

const runName = (n) => `2026-07-${String(n).padStart(2, '0')}-run-${n * 11}`;

describe('allure-report.yml "Prune old runs" — executed block behavior (SHY-0191)', () => {
  test('keeps exactly the newest N and deletes the oldest, recursively', () => {
    const dirs = [1, 2, 3, 4, 5].map(runName); // date-sorted ascending
    const survivors = runPrune(dirs, 3);
    expect(survivors).toEqual([runName(3), runName(4), runName(5)].sort());
  });

  test('fewer than N runs — nothing is deleted', () => {
    const dirs = [1, 2].map(runName);
    expect(runPrune(dirs, 10)).toEqual(dirs.sort());
  });

  test('exactly N runs — nothing is deleted (boundary)', () => {
    const dirs = [1, 2, 3].map(runName);
    expect(runPrune(dirs, 3)).toEqual(dirs.sort());
  });

  test('NUL-delimited chain survives awkward directory names (spaces)', () => {
    const awkward = '2026-07-01-run-1 copy';
    const survivors = runPrune([awkward, ...[2, 3].map(runName)], 2);
    // the awkward name sorts oldest → it is the one deleted, cleanly
    expect(survivors).toEqual([runName(2), runName(3)].sort());
  });

  test('same-date prefix pair (run-99 vs run-990) keeps byte-sort order — M2 edge is moot', () => {
    const short = '2026-07-15-run-99';
    const long = '2026-07-15-run-990';
    const older = '2026-07-14-run-1';
    // keep 2 → the older dir is deleted; BOTH prefix-pair dirs survive,
    // proving the NUL suffix (like the old '/' suffix) sorts the shorter
    // name first and the retention boundary lands where it always did.
    const survivors = runPrune([older, short, long], 2);
    expect(survivors).toEqual([long, short].sort());
  });

  test('missing runs/ dir — the guarded step is a clean no-op', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-prune-'));
    const yaml = fs.readFileSync(WORKFLOW, 'utf8');
    const script = 'set -eo pipefail\n' + materialize(extractRunBlock(yaml, STEP_NAME), 10);
    // no gh-pages tree at all — must exit 0 without output errors
    expect(() =>
      execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
    ).not.toThrow();
  });
});
