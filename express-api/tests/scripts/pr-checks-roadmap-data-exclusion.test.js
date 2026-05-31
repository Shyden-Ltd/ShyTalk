/**
 * pr-checks.yml — public/roadmap-data.json exclusion (META fix).
 *
 * Triggered by: 2026-05-31 observation that PR #933 (--retry N flag)
 * paid ~45min of Playwright CI time even though the only "public/"
 * change was an auto-bump of public/roadmap-data.json by the
 * pre-commit hook .husky/pre-commit (it regenerates the file via
 * `node scripts/generate-roadmap-json.js` on every commit).
 *
 * Root cause: pr-checks.yml's detect-changes step's case statement
 * had `public/*) WEB=true ;;` as a catch-all, so any commit that
 * brushed against public/ (including the auto-bumped JSON) would
 * trigger the full playwright-web pipeline.
 *
 * Fix: explicit exclusion before the generic catch-all:
 *   public/roadmap-data.json) ;;   # data-only, doesn't affect web
 *   public/*.md) WEB=true ;;
 *   public/*) WEB=true ;;
 *
 * This test pins the exclusion behaviorally — runs the production
 * case statement against synthetic file lists in a real bash shell.
 * Without the fix, the first test would fail (WEB=true on the auto-
 * bumped JSON). With the fix, WEB stays false on roadmap-data.json
 * alone, but still triggers on other public/* paths.
 *
 * Saves ~40min CI per PR that auto-bumps roadmap-data.json (which
 * is every PR, since the hook is unconditional).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

/**
 * Extract a step's `run:` block by exact `      - name: <stepName>`
 * match at the canonical 6-space step indent. Mirror of the helper
 * in pr-checks-app-changed-split.test.js — duplicated rather than
 * shared so each pr-checks-* test file is self-contained, but kept
 * BYTE-IDENTICAL so a refactor to a shared module is one mechanical
 * replacement away.
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === stepHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find step "${stepName}" in workflow file. ` +
        'Step was renamed, removed, or indentation changed (helper ' +
        'requires 6-space step indent) — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches.map((i) => i + 1).join(', ')}.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trimEnd();
    if (trimmed.startsWith('      - name:')) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Extract the case-statement body from the detect-changes step and
 * run it against a synthetic file list in a real bash shell. Returns
 * the resulting flag values as an object. Behavioral pin — exercises
 * the EXACT classification logic the runner sees.
 */
function classifyFiles(yamlText, files) {
  const stepBlock = extractStep(yamlText, 'Detect changed paths');
  const caseMatch = stepBlock.match(/case "\$file" in([\s\S]*?)esac/);
  if (!caseMatch) {
    throw new Error('Could not find case statement in detect-changes step');
  }
  const caseBody = caseMatch[1];
  const flagsInit =
    'ANDROID_APP=false IOS_APP=false APP=false BACKEND=false WEB=false ' +
    'INTEGRATION=false QA_RUNNER_DRIVERS=false OTHER=false';
  const fileList = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
  const script = `
set -e
${flagsInit}
for file in ${fileList}; do
  case "$file" in${caseBody}esac
done
echo "ANDROID_APP=$ANDROID_APP"
echo "IOS_APP=$IOS_APP"
echo "APP=$APP"
echo "BACKEND=$BACKEND"
echo "WEB=$WEB"
echo "INTEGRATION=$INTEGRATION"
echo "QA_RUNNER_DRIVERS=$QA_RUNNER_DRIVERS"
echo "OTHER=$OTHER"
`;
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const result = {};
  for (const line of out.trim().split('\n')) {
    const [k, v] = line.split('=');
    result[k] = v;
  }
  return result;
}

describe('pr-checks.yml — public/roadmap-data.json exclusion', () => {
  let yamlText;
  beforeAll(() => {
    yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
  });

  test('public/roadmap-data.json alone does NOT trigger WEB', () => {
    // Core invariant: the auto-bumped JSON must not cascade into the
    // 40-min Playwright pipeline. Without the exclusion, the generic
    // `public/*) WEB=true` case would fire.
    const r = classifyFiles(yamlText, ['public/roadmap-data.json']);
    expect(r.WEB).toBe('false');
  });

  test('public/index.html still triggers WEB (no over-exclusion)', () => {
    // The exclusion must be PRECISE — only roadmap-data.json. Other
    // public/ files (CSS, JS, HTML) still trigger Playwright as
    // they should.
    const r = classifyFiles(yamlText, ['public/index.html']);
    expect(r.WEB).toBe('true');
  });

  test('public/about.md (markdown) still triggers WEB', () => {
    // The .md branch must remain ordered AFTER the roadmap-data.json
    // exclusion (shell case is first-match) so markdown docs still
    // trigger Playwright.
    const r = classifyFiles(yamlText, ['public/about.md']);
    expect(r.WEB).toBe('true');
  });

  test('public/js/some-script.js still triggers WEB (bash * matches across /)', () => {
    // Nested paths under public/ trigger WEB via the catch-all. Note:
    // bash `case` glob `*` IS greedy and matches `/` (verified
    // empirically with `bash -c 'case "public/js/x.js" in public/*) ...'`).
    // This differs from filesystem glob behaviour — documented here
    // because a code-reviewer assumed otherwise on 2026-05-31 and the
    // assumption was empirically wrong. Pin the actual semantics.
    const r = classifyFiles(yamlText, ['public/js/seasonal-theme.js']);
    expect(r.WEB).toBe('true');
  });

  test('public/roadmap-data.json.bak (similar name) still triggers WEB (exact-match boundary)', () => {
    // Boundary pin: the exclusion is an EXACT literal match, not a
    // glob. A future maintainer who widens it to `public/roadmap-data*`
    // would accidentally exclude backup/temp files too. This test
    // surfaces that drift immediately by asserting the literal-only
    // semantic.
    const r = classifyFiles(yamlText, ['public/roadmap-data.json.bak']);
    expect(r.WEB).toBe('true');
  });

  test('public/roadmap-data.json2 (digit suffix) still triggers WEB', () => {
    // Companion to .bak test: any character after the literal path
    // is NOT excluded.
    const r = classifyFiles(yamlText, ['public/roadmap-data.json2']);
    expect(r.WEB).toBe('true');
  });

  test('runner change + auto-bumped roadmap-data.json → BACKEND only, NO WEB', () => {
    // The exact failure scenario from PR #933: a commit touches the
    // runner script + auto-bumps the JSON. WEB must NOT trigger so
    // playwright-web doesn't run unnecessarily. Saves ~40min CI.
    const r = classifyFiles(yamlText, [
      'express-api/scripts/manual-qa-runner.js',
      'public/roadmap-data.json',
    ]);
    expect(r.WEB).toBe('false');
    expect(r.BACKEND).toBe('true');
  });

  test('driver change + auto-bumped roadmap-data.json → QA_RUNNER_DRIVERS+BACKEND, NO WEB', () => {
    // Same scenario for driver-touching PRs: roadmap auto-bump must
    // not trigger Playwright on top of the qa-runner-driver-checks
    // workflow that already runs for these PRs.
    const r = classifyFiles(yamlText, [
      'express-api/scripts/drivers/web-playwright-driver.js',
      'public/roadmap-data.json',
    ]);
    expect(r.WEB).toBe('false');
    expect(r.BACKEND).toBe('true');
    expect(r.QA_RUNNER_DRIVERS).toBe('true');
  });

  test('explicit web change + auto-bumped roadmap-data.json → WEB still triggers', () => {
    // A real frontend change paired with the auto-bumped JSON: the
    // real change wins (case sets WEB=true on the .html file even
    // though roadmap-data.json hits the no-op branch first per the
    // per-file loop semantics).
    const r = classifyFiles(yamlText, ['public/index.html', 'public/roadmap-data.json']);
    expect(r.WEB).toBe('true');
  });

  test('YAML structural pin — exclusion appears BEFORE the catch-all', () => {
    // First-match-wins semantic of shell `case` requires the specific
    // exclusion to precede the generic public/*) WEB=true line. If
    // the order is ever swapped, the exclusion becomes dead code.
    const stepBlock = extractStep(yamlText, 'Detect changed paths');
    const exclusionIdx = stepBlock.indexOf('public/roadmap-data.json)');
    const catchAllIdx = stepBlock.indexOf('public/*) WEB=true');
    expect(exclusionIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(exclusionIdx).toBeLessThan(catchAllIdx);
  });
});
