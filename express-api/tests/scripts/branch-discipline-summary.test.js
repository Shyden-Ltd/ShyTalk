/**
 * branch-discipline-summary.test.js — SHY-0191 R1 C3.
 *
 * The SC2129 fix grouped both step-summary write runs in
 * branch-discipline-check.yml into `{ … } >> "$GITHUB_STEP_SUMMARY"`
 * blocks. The block shells out to `gh pr list`, so these are STRUCTURAL
 * pins (the invocation-form family, house style of the SHY-0127/0128 pin
 * files): both branches keep their grouped redirect, their key content
 * lines, and the stderr `::warning::`/`::notice::` annotation ORDERED
 * before its group.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/branch-discipline-check.yml');

describe('branch-discipline-check.yml grouped summaries — SHY-0191', () => {
  let yaml;
  beforeAll(() => {
    yaml = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('both branches write via ONE grouped redirect each (no per-line appends left)', () => {
    const groups = yaml.match(/} >> "\$GITHUB_STEP_SUMMARY"/g) || [];
    expect(groups).toHaveLength(2);
    // no stray single-echo append survives outside the two groups
    expect(yaml).not.toMatch(/^[ \t]*echo [^\n]*>> "\$GITHUB_STEP_SUMMARY"/m);
  });

  test('warning branch keeps its content: heading, count line, HARD-rule line, soft-fail note', () => {
    expect(yaml).toContain('echo "## ⚠️ Branch discipline warning"');
    expect(yaml).toContain(
      'echo "Contributor \\`@${AUTHOR}\\` has **${OTHER_COUNT}** other open PR(s)."',
    );
    expect(yaml).toContain('only ONE active branch at a time.');
    expect(yaml).toContain('a follow-up SHY will promote this to hard-fail.');
  });

  test('pass branch keeps its content: heading + no-other-PRs line', () => {
    expect(yaml).toContain('echo "## ✓ Branch discipline check passed"');
    expect(yaml).toContain('echo "Contributor \\`@${AUTHOR}\\` has no other open PRs."');
  });

  test('each stderr annotation still precedes its summary group', () => {
    const warnIdx = yaml.indexOf('::warning::Contributor');
    const warnGroupIdx = yaml.indexOf('"## ⚠️ Branch discipline warning"');
    const noticeIdx = yaml.indexOf('::notice::Contributor');
    const passGroupIdx = yaml.indexOf('"## ✓ Branch discipline check passed"');
    expect(warnIdx).toBeGreaterThan(-1);
    expect(warnIdx).toBeLessThan(warnGroupIdx);
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(passGroupIdx);
  });
});
