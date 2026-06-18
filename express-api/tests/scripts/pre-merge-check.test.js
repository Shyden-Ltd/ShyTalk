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

function run(dir, { skipCi = true } = {}) {
  const args = skipCi ? ['42', '--skip-ci-check'] : ['99999999'];
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
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

  test('a status-flip commit touching the story + SHY-INDEX.md is review-neutral', () => {
    const { dir, b } = cleanRepo();
    // The real "flip to In Review" commit touches the SHY story AND SHY-INDEX.md;
    // both are story-tracking docs under .project/stories/ → review-neutral.
    writeStory(dir, 'In Review', b);
    fs.writeFileSync(path.join(dir, '.project/stories/SHY-INDEX.md'), '| SHY-0999 | In Review |\n');
    commit(dir, 'flip status + index row (story docs only)');
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

  test('REFUSES when Reviewed-up-to is not a real commit (no silent bypass)', () => {
    const dir = init();
    fs.writeFileSync(path.join(dir, 'code.js'), 'x\n');
    writeStory(dir, 'In Review', '0000000000000000000000000000000000000000');
    commit(dir, 'code + story with bogus marker');
    const { code, stdout, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stdout).not.toContain('PRE-MERGE-CHECK: OK');
    expect(stderr).toMatch(/not a valid commit/);
  });

  test('REFUSES on a Done story (only In Review passes the local gate)', () => {
    const dir = init();
    writeStory(dir, 'Done', 'deadbeef');
    commit(dir, 'done story');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/In Review/);
  });

  test('REFUSES on a Cancelled story', () => {
    const dir = init();
    writeStory(dir, 'Cancelled', 'deadbeef');
    commit(dir, 'cancelled story');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/In Review/);
  });

  test('REFUSES on a Draft story', () => {
    const dir = init();
    writeStory(dir, 'Draft', null);
    commit(dir, 'draft story');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/In Review/);
  });

  test('checks EVERY story marker — refuses if any story has unreviewed commits (multi-story)', () => {
    const dir = init();
    const base = git(dir, ['rev-parse', 'HEAD']); // main commit (loose marker target)
    fs.writeFileSync(path.join(dir, 'code.js'), 'x\n');
    writeStory(dir, 'In Review', 'P'); // SHY-0999-x.md
    fs.writeFileSync(
      path.join(dir, '.project/stories/SHY-0998-y.md'),
      `---\nid: SHY-0998\nstatus: In Review\n---\n\n## Notes\nReviewed-up-to: P\n`,
    );
    const x = commit(dir, 'code + two stories'); // touches code.js (non-story)
    // SHY-0999 gets a TIGHT marker (x, clean); SHY-0998 a LOOSE one (base) that
    // must catch the unreviewed code in commit X. A last-writer-wins check would
    // honour only one marker and could wrongly pass; checking EVERY marker refuses.
    writeStory(dir, 'In Review', x);
    fs.writeFileSync(
      path.join(dir, '.project/stories/SHY-0998-y.md'),
      `---\nid: SHY-0998\nstatus: In Review\n---\n\n## Notes\nReviewed-up-to: ${base}\n`,
    );
    commit(dir, 'bump markers (story-only)');
    const { code, stdout } = run(dir);
    expect(code).not.toBe(0); // SHY-0998's marker catches the unreviewed code commit
    expect(stdout).not.toContain('PRE-MERGE-CHECK: OK');
  });

  test('REFUSES (Gate 2) when CI cannot be confirmed green — no --skip-ci-check, no PR', () => {
    // Status + re-review pass; the gh check then runs against a repo with no
    // GitHub remote / a non-existent PR → gh fails → refuse. No auth needed.
    const { dir } = cleanRepo();
    const { code, stdout } = run(dir, { skipCi: false });
    expect(code).not.toBe(0);
    expect(stdout).not.toContain('PRE-MERGE-CHECK: OK');
  });
});
