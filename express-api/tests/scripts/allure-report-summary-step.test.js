/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Post report URL in summary" block extracted from allure-report.yml —
 * no doubles; the block writes a real $GITHUB_STEP_SUMMARY file. */
/**
 * allure-report-summary-step.test.js — SHY-0191 R1 C2 (summary half).
 *
 * The SC2129 fix grouped three `>> "$GITHUB_STEP_SUMMARY"` echoes into one
 * `{ … } >>` block. This executes the real rewritten block and asserts the
 * summary file's exact content, so a grouping regression (dropped line,
 * broken brace, redirect landing on the wrong target) goes RED.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');
const STEP_NAME = 'Post report URL in summary';

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

function materialize(block) {
  return block
    .replace(/\$\{\{\s*github\.repository\s*\}\}/g, 'Shyden-Ltd/ShyTalk')
    .replace(/\$\{\{\s*inputs\.suite_name\s*\}\}/g, 'playwright')
    .replace(/\$\{\{\s*inputs\.report_env\s*\}\}/g, 'pr');
}

describe('allure-report.yml "Post report URL in summary" — executed block behavior (SHY-0191)', () => {
  test('the grouped block writes exactly the three summary lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-summary-'));
    const summaryFile = path.join(dir, 'step-summary');
    fs.writeFileSync(summaryFile, '');
    const yaml = fs.readFileSync(WORKFLOW, 'utf8');
    const script = 'set -eo pipefail\n' + materialize(extractRunBlock(yaml, STEP_NAME));
    execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summaryFile },
    });
    expect(fs.readFileSync(summaryFile, 'utf8')).toBe(
      '## Allure Report (playwright)\n' +
        '\n' +
        '[View Report](https://Shyden-Ltd.github.io/ShyTalk/playwright/pr/latest/)\n',
    );
  });
});
