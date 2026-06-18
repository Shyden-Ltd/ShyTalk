/* eslint-disable sonarjs/no-os-command-from-path --
 * This test spawns hardcoded binaries (`git`, `bash`) with literal argv to drive
 * the REAL Gates 2+3 script against REAL throwaway git repos — no user-controlled
 * command and no PATH manipulation. Matches the sibling check-no-new-stubs /
 * check-story-frontmatter test convention. */
/**
 * pre-merge-check.test.js — SHY-0127 Gates 2 + 3.
 *
 * Drives the REAL scripts/pre-merge-check.sh against a REAL temp git repo (no
 * mocks). `--skip-ci-check` exercises the status (Gate 1 local re-check) + the
 * re-review (Gate 3) logic for real without needing a live PR; the CI leg
 * (Gate 2) is `gh pr checks` and is covered by live use, not unit-faked.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../../scripts/pre-merge-check.sh');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeStory(dir, status, reviewedSha) {
  const marker = reviewedSha ? `\nReviewed-up-to: ${reviewedSha}\n` : '\n';
  fs.writeFileSync(
    path.join(dir, '.project/stories/SHY-0999-x.md'),
    `---\nid: SHY-0999\nstatus: ${status}\n---\n\n# SHY-0999\n\n## Notes${marker}`,
  );
}

function init() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0127-merge-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t.co']);
  git(dir, ['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, '.project/stories'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  return dir;
}

function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** A fully-clean, reviewed branch: code reviewed up to commit B, then a
 * story-only marker-bump commit C on top. */
function cleanRepo() {
  const dir = init();
  fs.writeFileSync(path.join(dir, 'code.js'), 'x\n');
  writeStory(dir, 'In Review', 'PLACEHOLDER');
  const b = commit(dir, 'code + story');
  writeStory(dir, 'In Review', b); // record the reviewed sha
  commit(dir, 'bump Reviewed-up-to marker');
  return { dir, b };
}

function run(dir) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, '42', '--skip-ci-check'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'main' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout), stderr: String(e.stderr) };
  }
}

describe('SHY-0127 Gates 2+3 — pre-merge-check.sh', () => {
  test('emits OK when status In Review + no unreviewed commits since the marker', () => {
    const { code, stdout } = run(cleanRepo().dir);
    expect(code).toBe(0);
    expect(stdout).toContain('PRE-MERGE-CHECK: OK');
  });

  test('a later story-.md-only commit is review-neutral (still OK)', () => {
    const { dir, b } = cleanRepo();
    writeStory(dir, 'In Review', b); // another story-only edit (e.g. a Notes line)
    fs.appendFileSync(path.join(dir, '.project/stories/SHY-0999-x.md'), '\n- note\n');
    commit(dir, 'story notes only');
    const { code, stdout } = run(dir);
    expect(code).toBe(0);
    expect(stdout).toContain('PRE-MERGE-CHECK: OK');
  });

  test('REFUSES when a code commit lands after the reviewed marker', () => {
    const { dir } = cleanRepo();
    fs.writeFileSync(path.join(dir, 'code2.js'), 'y\n');
    commit(dir, 'unreviewed code');
    const { code, stdout, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stdout).not.toContain('PRE-MERGE-CHECK: OK');
    expect(stderr).toMatch(/unreviewed/i);
  });

  test('REFUSES when the story is not In Review', () => {
    const dir = init();
    writeStory(dir, 'In Progress', 'deadbeef');
    commit(dir, 'story in progress');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/In Review/);
  });

  test('REFUSES when the story has no Reviewed-up-to marker', () => {
    const dir = init();
    writeStory(dir, 'In Review', null);
    commit(dir, 'story no marker');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Reviewed-up-to/);
  });

  test('REFUSES when no story .md changed on the branch', () => {
    const dir = init();
    fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n');
    commit(dir, 'no story');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/nothing to gate/);
  });
});
