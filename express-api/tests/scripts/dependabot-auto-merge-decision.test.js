/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Determine if auto-mergeable" block extracted from
 * dependabot-auto-merge.yml — no doubles; the block reads env vars and
 * writes $GITHUB_OUTPUT, both real files/values here. */
/**
 * dependabot-auto-merge-decision.test.js — SHY-0191 R1 C1.
 *
 * The SC2034 fix deleted the unused DEP_TYPE binding and moved the two USED
 * metadata outputs into an env: block, leaving the decision `run:` block
 * fully env-driven (zero inline ${{ }}). That makes it directly executable:
 * this file runs the real extracted block per input combination and asserts
 * the exact $GITHUB_OUTPUT contents, so a future edit to the auto-merge
 * policy (branch reorder, spelling change, env-name typo) goes RED here.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/dependabot-auto-merge.yml');
const STEP_NAME = 'Determine if auto-mergeable';

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

/** Execute the real decision block with the given metadata values; return
 * the exact $GITHUB_OUTPUT contents. */
function decide(updateType, packageEcosystem) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-decision-'));
  const outFile = path.join(dir, 'github-output');
  fs.writeFileSync(outFile, '');
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const script = 'set -eo pipefail\n' + extractRunBlock(yaml, STEP_NAME);
  execFileSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      PATH: process.env.PATH,
      UPDATE_TYPE: updateType,
      PACKAGE_ECOSYSTEM: packageEcosystem,
      GITHUB_OUTPUT: outFile,
    },
  });
  return fs.readFileSync(outFile, 'utf8');
}

describe('dependabot-auto-merge.yml decision block — executed policy matrix (SHY-0191)', () => {
  test('structural: the two used metadata outputs are env-bound; DEP_TYPE is gone', () => {
    const yaml = fs.readFileSync(WORKFLOW, 'utf8');
    expect(yaml).toMatch(/UPDATE_TYPE:\s*\$\{\{\s*steps\.metadata\.outputs\.update-type\s*\}\}/);
    expect(yaml).toMatch(
      /PACKAGE_ECOSYSTEM:\s*\$\{\{\s*steps\.metadata\.outputs\.package-ecosystem\s*\}\}/,
    );
    // the unused binding must not come back as a live assignment (the
    // explanatory comment naming it is legal — line-anchored key form)
    expect(yaml).not.toMatch(/^[ \t]*DEP_TYPE[:=]/m);
    // no inline ${{ }} left inside this run block (injection hygiene)
    expect(extractRunBlock(yaml, STEP_NAME)).not.toContain('${{');
  });

  test.each([
    ['version-update:semver-patch', 'npm_and_yarn', 'merge=true\n'],
    ['version-update:semver-minor', 'gradle', 'merge=true\n'],
    ['version-update:semver-major', 'github_actions', 'merge=true\n'],
    ['version-update:semver-major', 'github-actions', 'merge=true\n'],
    ['version-update:semver-major', 'npm_and_yarn', 'merge=false\n'],
    ['', '', 'merge=false\n'],
  ])('UPDATE_TYPE=%s ECOSYSTEM=%s → %s', (updateType, ecosystem, expected) => {
    expect(decide(updateType, ecosystem)).toBe(expected);
  });
});
