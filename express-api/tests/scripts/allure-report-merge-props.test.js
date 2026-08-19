/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Merge environment.properties" shell block extracted from
 * allure-report.yml against REAL fixture files — no user-controlled
 * command, no doubles of any kind (the block touches only the filesystem).
 * Matches the allure-report-metadata-count.test.js convention. */
/**
 * allure-report-merge-props.test.js — SHY-0191.
 *
 * The shellcheck resurrection rewrote two sed pipelines in the "Merge
 * environment.properties from all test suites" step into pure parameter
 * expansions (SC2001) and the lone `> "$MERGED"` into `: > "$MERGED"`
 * (SC2188). The story's AC promises byte-identical observable behavior —
 * this file PROVES it by executing the real extracted block against real
 * fixture trees and asserting the merged file's exact content: suite ids
 * dot-joined from the directory path, leading whitespace stripped, blank
 * lines skipped, `=` preserved inside values, and the output file
 * truncated before writing.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');
const STEP_NAME = 'Merge environment.properties from all test suites';

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

/** Lay down a fixture tree of environment.properties files and run the
 * REAL merge block over it under GitHub's default bash flags. */
function runMergeStep(fixtures, { preSeedMerged = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-merge-'));
  for (const [rel, content] of Object.entries(fixtures)) {
    const p = path.join(dir, 'allure-results-all', rel, 'environment.properties');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const mergedPath = path.join(dir, 'allure-results-all/environment.properties');
  fs.mkdirSync(path.dirname(mergedPath), { recursive: true });
  if (preSeedMerged !== null) fs.writeFileSync(mergedPath, preSeedMerged);
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const script = 'set -eo pipefail\n' + extractRunBlock(yaml, STEP_NAME);
  execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  return fs.readFileSync(mergedPath, 'utf8');
}

describe('allure-report.yml "Merge environment.properties" — executed block behavior (SHY-0191)', () => {
  test('extraction sanity: the block contains the truncate + suite-derivation lines', () => {
    const block = extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
    expect(block).toMatch(/: > "\$MERGED"/);
    expect(block).toMatch(/SUITE=/);
  });

  test('suite ids are dot-joined from the directory path (single and nested)', () => {
    const merged = runMergeStep({
      'android-e2e': 'PLATFORM=android\n',
      'web/chromium': 'BROWSER=chromium\n',
      // three segments: kills a global→first-only slash-replace mutant
      'ios/safari/tablet': 'FORM=tablet\n',
    });
    expect(merged).toContain('android-e2e.PLATFORM=android');
    expect(merged).toContain('web.chromium.BROWSER=chromium');
    expect(merged).toContain('ios.safari.tablet.FORM=tablet');
  });

  test('leading whitespace is stripped, blank/whitespace-only lines are skipped, = survives in values', () => {
    const merged = runMergeStep({
      suiteA: '  INDENTED=kept\n\n   \n\tTABBED=alsokept\nURL=http://x?a=b&c=d\n',
    });
    expect(merged).toContain('suiteA.INDENTED=kept');
    expect(merged).toContain('suiteA.TABBED=alsokept');
    // cut -d= -f2- keeps everything after the FIRST = — embedded = intact
    expect(merged).toContain('suiteA.URL=http://x?a=b&c=d');
    // exactly the three data lines — nothing produced for the blank lines
    const lines = merged.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  test('the merged file is truncated first (stale content cannot leak through)', () => {
    const merged = runMergeStep({ suiteA: 'K=v\n' }, { preSeedMerged: 'STALE=junk\n' });
    expect(merged).not.toContain('STALE');
    expect(merged.split('\n').filter(Boolean)).toEqual(['suiteA.K=v']);
  });

  test('files merge in sorted path order (deterministic output)', () => {
    const merged = runMergeStep({
      zeta: 'Z=1\n',
      alpha: 'A=1\n',
    });
    const lines = merged.split('\n').filter(Boolean);
    expect(lines).toEqual(['alpha.A=1', 'zeta.Z=1']);
  });
});
