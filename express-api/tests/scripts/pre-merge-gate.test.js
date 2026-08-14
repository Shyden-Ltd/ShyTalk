/* eslint-disable sonarjs/no-os-command-from-path --
 * This test spawns hardcoded binaries (`git`, `node`) with literal argv to drive
 * the REAL Gate-1 guard against REAL throwaway git repos — no user-controlled
 * command and no PATH manipulation. Matches the sibling check-no-new-stubs /
 * check-story-frontmatter test convention. */
/**
 * pre-merge-gate.test.js — SHY-0127 (pre-merge gate hardening), Gate 1.
 *
 * Drives the REAL scripts/check-pr-story-status.js against a REAL temp git repo
 * (no mocks — per CLAUDE.md § No Stubs the guard logic is exercised against real
 * git + real files). The script finds any SHY-XXXX story .md in the PR diff and
 * requires its frontmatter status to be In Review / Done / Cancelled before the
 * PR can merge; it skips when no story is in the diff or the PR is a draft.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-pr-story-status.js');

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * Build a temp repo: `baseChanges` are committed on `main`, then a `feature`
 * branch applies `featureChanges`. This lets a test distinguish an ADDED story
 * (no base) from a MODIFIED/RENAMED one (story committed on main first).
 */
function makeRepoBase(baseChanges, featureChanges) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0127-gate1-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t.co']);
  git(dir, ['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, '.project/stories'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  baseChanges(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  featureChanges(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'work']);
  return dir;
}

/** ADDED-only convenience: nothing on main, `changes` applied on feature. */
function makeRepo(changes) {
  return makeRepoBase(() => {}, changes);
}

const story = (status) =>
  `---\nid: SHY-0999\nstatus: ${status}\nowner: claude\ncreated: 2026-06-18\npriority: P1\neffort: S\ntype: infra\nroadmap_ids: []\npr:\n---\n\n# SHY-0999: x\n`;

/** Run the gate; return { code, stderr }. */
function run(dir, env = {}) {
  try {
    execFileSync('node', [SCRIPT], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, BASE_SHA: 'main', HEAD_SHA: 'feature', ...env },
    });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr) };
  }
}

describe('SHY-0127 Gate 1 — story must be In Review before merge', () => {
  test('FAILS when a diffed story is still In Progress', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Progress')),
    );
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/SHY-0999-x\.md/);
    expect(stderr).toMatch(/In Review/);
  });

  test('PASSES when a newly-ADDED story is Draft (SHY-0131 filing exemption)', () => {
    // Filing a brand-new story is legitimately Draft — it has not been picked
    // up for implementation, so it must be mergeable to the backlog.
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('Draft')),
    );
    expect(run(dir).code).toBe(0);
  });

  test('FAILS when an EXISTING (modified) story is still Draft (SHY-0131 — exemption is add-only)', () => {
    // The add-only exemption must NOT apply to a modification: a Draft story
    // already on main that a PR edits still trips the gate (no SHY-0120 hole).
    const dir = makeRepoBase(
      (d) => fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('Draft')),
      (d) =>
        fs.writeFileSync(
          path.join(d, '.project/stories/SHY-0999-x.md'),
          `${story('Draft')}\n- refined a line\n`,
        ),
    );
    expect(run(dir).code).not.toBe(0);
  });

  test('FAILS when a newly-ADDED story is In Progress (only Draft is exempt at filing)', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Progress')),
    );
    expect(run(dir).code).not.toBe(0);
  });

  test('PASSES an added Draft but FAILS a co-added In-Progress story (mixed)', () => {
    const dir = makeRepo((d) => {
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('Draft'));
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0998-y.md'), story('In Progress'));
    });
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/SHY-0998-y\.md/);
  });

  test('FAILS a RENAMED story left Draft (rename is not a fresh add)', () => {
    const dir = makeRepoBase(
      (d) => fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Review')),
      (d) => {
        git(d, ['mv', '.project/stories/SHY-0999-x.md', '.project/stories/SHY-0999-z.md']);
        fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-z.md'), story('Draft'));
      },
    );
    expect(run(dir).code).not.toBe(0);
  });

  test('PASSES when the diffed story is In Review', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Review')),
    );
    expect(run(dir).code).toBe(0);
  });

  test('PASSES when the diffed story is Done', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('Done')),
    );
    expect(run(dir).code).toBe(0);
  });

  test('PASSES when the diffed story is Cancelled', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('Cancelled')),
    );
    expect(run(dir).code).toBe(0);
  });

  test('SKIPS (exit 0) when no story .md is in the diff', () => {
    const dir = makeRepo((d) => fs.writeFileSync(path.join(d, 'README.md'), 'changed\n'));
    expect(run(dir).code).toBe(0);
  });

  test('SKIPS (exit 0) a draft PR even if the story is In Progress', () => {
    const dir = makeRepo((d) =>
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Progress')),
    );
    expect(run(dir, { IS_DRAFT: 'true' }).code).toBe(0);
  });

  test('FAILS when one of several diffed stories is not In Review', () => {
    const dir = makeRepo((d) => {
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0999-x.md'), story('In Review'));
      fs.writeFileSync(path.join(d, '.project/stories/SHY-0998-y.md'), story('In Progress'));
    });
    const { code, stderr } = run(dir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/SHY-0998-y\.md/);
  });
});

describe('SHY-0127 Gate 1 — wired into the required PR Gate aggregation', () => {
  const yml = fs.readFileSync(
    path.resolve(__dirname, '../../../.github/workflows/pr-checks.yml'),
    'utf8',
  );

  test('defines a pre-merge-gate job that runs the status script', () => {
    expect(yml).toMatch(/^ {2}pre-merge-gate:/m);
    expect(yml).toContain('node scripts/check-pr-story-status.js');
  });

  test('pre-merge-gate is in the PR Gate needs list and the result-eval loop', () => {
    expect(yml).toMatch(/needs: \[detect-changes, pre-merge-gate,/);
    expect(yml).toContain('"${{ needs.pre-merge-gate.result }}"');
  });
});
