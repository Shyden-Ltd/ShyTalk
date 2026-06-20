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
const { execFileSync, spawnSync } = require('node:child_process');
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

/** A repo with `setup(dir)` committed on `main`, then checked out to `feature` —
 * for tests that need a story to already EXIST on main (modified/renamed cases). */
function mainThenFeature(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0133-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t.co']);
  git(dir, ['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, '.project/stories'), { recursive: true });
  setup(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base on main']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  return dir;
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
  // spawnSync captures BOTH stdout and stderr regardless of exit code — the
  // success path emits a `filing exemption:` line on stderr (SHY-0133) that
  // execFileSync (which only returns stdout, and surfaces stderr solely via the
  // thrown error on non-zero exit) could not observe.
  const r = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: 'main' },
  });
  return { code: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
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

  // SHY-0133 — a newly-ADDED Draft story is a legitimate spec filing and is
  // EXEMPT (mirrors the SHY-0131 CI-gate exemption in check-pr-story-status.js).
  test('EXEMPTS a newly-ADDED Draft story (filing — SHY-0131 parity)', () => {
    const dir = init();
    writeStory(dir, 'Draft', null); // brand-new story file, added on the branch
    commit(dir, 'file new draft story');
    const { code, stdout, stderr } = run(dir);
    expect(code).toBe(0);
    expect(stdout).toContain('PRE-MERGE-CHECK: OK');
    expect(stderr).toMatch(/filing exemption/i);
    // UX AC — the checklist is honest for a filing-only PR: the status line names
    // the exemption, and the re-review line does NOT show an empty marker.
    expect(stdout).toContain('+ 1 newly-added Draft filing(s) exempt');
    expect(stdout).toContain('filing only — no implementation story to re-review');
    expect(stdout).not.toContain('Reviewed-up-to: )');
  });

  // SHY-0133 — multiple Draft filings in one PR (e.g. an EPIC's child stories):
  // the FILINGS counter pluralises and every filing is exempt.
  test('EXEMPTS multiple newly-added Draft filings (FILINGS=2)', () => {
    const dir = init();
    writeStory(dir, 'Draft', null); // SHY-0999-x.md
    fs.writeFileSync(
      path.join(dir, '.project/stories/SHY-0998-y.md'),
      `---\nid: SHY-0998\nstatus: Draft\n---\n\n# SHY-0998\n\n## Notes\n`,
    );
    commit(dir, 'file two draft stories');
    const { code, stdout } = run(dir);
    expect(code).toBe(0);
    expect(stdout).toContain('PRE-MERGE-CHECK: OK');
    expect(stdout).toContain('+ 2 newly-added Draft filing(s) exempt');
  });

  // SHY-0133 — the exemption is ADD-ONLY: a story that already exists and is
  // MODIFIED to Draft (a regression) is still refused.
  test('REFUSES a story MODIFIED to Draft (add-only exemption)', () => {
    const dir = mainThenFeature((d) => writeStory(d, 'In Review', 'deadbeef'));
    writeStory(dir, 'Draft', null); // MODIFIED to Draft on the branch (code M)
    commit(dir, 'regress story to draft');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/In Review/);
  });

  // SHY-0133 — the exemption is PER-STORY: a co-changed In-Review implementation
  // story is still fully gated (Gate 3) even when a Draft filing rides along.
  test('EXEMPTS the filing but still gates a co-changed In-Review story', () => {
    const dir = init();
    const base = git(dir, ['rev-parse', 'HEAD']);
    // Implementation story (In Review) + code, reviewed up to `base` (loose) so
    // the later code commit is unreviewed; plus a brand-new Draft filing.
    fs.writeFileSync(path.join(dir, 'code.js'), 'x\n');
    fs.writeFileSync(
      path.join(dir, '.project/stories/SHY-0998-impl.md'),
      `---\nid: SHY-0998\nstatus: In Review\n---\n\n## Notes\nReviewed-up-to: ${base}\n`,
    );
    writeStory(dir, 'Draft', null); // SHY-0999-x.md added as a Draft filing
    commit(dir, 'impl story + code + draft filing');
    const { code, stdout, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stdout).not.toContain('PRE-MERGE-CHECK: OK');
    // Must refuse for the IN-REVIEW story's unreviewed code — proving the filing
    // exemption did NOT short-circuit Gate-3 (before the fix it would refuse on
    // the Draft status instead).
    expect(stderr).toMatch(/unreviewed/i);
  });

  // SHY-0133 — a RENAMED Draft story has change-code R (not A), so it is NOT
  // filing-exempt; it is gated like any other change. A `git mv` of unchanged
  // content yields a deterministic R100 in --name-status.
  test('a RENAMED Draft story is gated, not filing-exempt (rename != add)', () => {
    const dir = mainThenFeature((d) =>
      fs.writeFileSync(
        path.join(d, '.project/stories/SHY-0997-old.md'),
        `---\nid: SHY-0997\nstatus: Draft\n---\n\n# SHY-0997\n\n## Notes\n`,
      ),
    );
    git(dir, ['mv', '.project/stories/SHY-0997-old.md', '.project/stories/SHY-0997-new.md']); // unchanged content → R100
    commit(dir, 'rename story file');
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0); // R + Draft is NOT the add-only exemption
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
