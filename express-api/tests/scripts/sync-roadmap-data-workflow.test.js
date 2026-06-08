/**
 * Static assertions on .github/workflows/sync-roadmap-data.yml.
 *
 * Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md AC.
 *
 * Why static rather than dispatch-and-observe: actionlint catches YAML syntax;
 * dispatch happens in CI on the post-merge push. These assertions cover the
 * specific contract bits that would silently regress (loop guard, path filter,
 * permissions scope, SHA-pinning).
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/sync-roadmap-data.yml');

describe('.github/workflows/sync-roadmap-data.yml', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('workflow file exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  test('has push trigger scoped to .project/stories/** + sync files', () => {
    expect(content).toMatch(/^on:/m);
    expect(content).toMatch(/push:/);
    expect(content).toMatch(/branches:\s*\[\s*main\s*\]/);
    expect(content).toMatch(/\.project\/stories\/\*\*/);
    expect(content).toMatch(/scripts\/sync-shy-to-roadmap-data\.mjs/);
  });

  test('has workflow_dispatch trigger for hand-firing pre-merge', () => {
    expect(content).toMatch(/workflow_dispatch:/);
  });

  test('loop-guard: if: github.actor != github-actions[bot]', () => {
    // C1-equivalent: actor-check prevents the bot from triggering itself.
    expect(content).toMatch(/if:\s*github\.actor\s*!=\s*['"]github-actions\[bot\]['"]/);
  });

  test('permissions: contents: write (scoped, not full repo write)', () => {
    // Bounded-width character classes ([ \t]) avoid sonarjs/slow-regex (\s* can backtrack).
    expect(content).toMatch(/permissions:[ \t]*\n[ \t]+contents:[ \t]+write/);
    // Must NOT have broader permissions like `actions: write` or `pages: write`.
    // (Whitelisting `contents: write` only is what this PR's threat-model needs.)
    expect(content).not.toMatch(/actions:[ \t]+write/);
    expect(content).not.toMatch(/pages:[ \t]+write/);
    // Linear scan: count distinct ': write' permission keys; only `contents: write` is allowed.
    const writePerms = content.match(/^[ \t]+[a-z-]+:[ \t]+write\b/gm) || [];
    const nonContents = writePerms.filter((line) => !/contents:[ \t]+write/.test(line));
    expect(nonContents).toEqual([]);
  });

  test('runs on github-hosted ubuntu (no self-hosted per [[feedback-no-self-hosted-runners]])', () => {
    expect(content).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(content).not.toMatch(/runs-on:.*self-hosted/);
  });

  test('actions/checkout is SHA-pinned (40-char hex + # vN comment)', () => {
    expect(content).toMatch(/uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v\d+/);
  });

  test('actions/setup-node is SHA-pinned (40-char hex + # vN comment)', () => {
    expect(content).toMatch(/uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v\d+/);
  });

  test('runs the sync script via node (not bash) with no shell interpolation of untrusted input', () => {
    expect(content).toMatch(/run:[ \t]+node scripts\/sync-shy-to-roadmap-data\.mjs/);
    // No ${{ github.event.* }} or ${{ github.head_ref }} anywhere — these are the documented
    // command-injection vectors per the security-guidance hook. Whole-file linear scan
    // (avoids sonarjs/slow-regex backtracking risk from the previous run-block grouping regex).
    expect(content).not.toMatch(/\$\{\{[ \t]*github\.event\./);
    expect(content).not.toMatch(/\$\{\{[ \t]*github\.head_ref/);
  });

  test('commit-back uses bot identity (github-actions[bot] noreply email)', () => {
    expect(content).toMatch(/user\.name 'github-actions\[bot\]'/);
    expect(content).toMatch(/41898282\+github-actions\[bot\]@users\.noreply\.github\.com/);
  });

  test('commit message is the documented chore(roadmap) form', () => {
    expect(content).toMatch(/chore\(roadmap\): sync roadmap-data\.json from SHY corpus/);
  });

  test('concurrency group is per-ref (no cross-PR serialisation)', () => {
    expect(content).toMatch(/group:\s*sync-roadmap-data-\$\{\{\s*github\.ref\s*\}\}/);
    // Sync must NOT cancel-in-progress mid-commit (would leave repo in
    // inconsistent state mid-push).
    expect(content).toMatch(/cancel-in-progress:\s*false/);
  });

  test('timeout-minutes is set (no unbounded jobs)', () => {
    expect(content).toMatch(/timeout-minutes:\s*\d+/);
  });

  test('no shell:true in run blocks (defense-in-depth)', () => {
    expect(content).not.toMatch(/shell:[ \t]*['"]?true['"]?/);
  });

  test('commit-back step has `git diff --quiet` no-op guard (I4 from review)', () => {
    // Without this, every workflow run would commit even when nothing changed,
    // triggering every downstream workflow that reacts to main pushes.
    expect(content).toMatch(/git diff --quiet public\/roadmap-data\.json/);
    expect(content).toMatch(/no changes/);
  });

  test('commit-back step rebases on main before push (C1 from review — concurrent-push safety)', () => {
    // Concurrent push from Dependabot / release.yml / lint.yml between this
    // workflow's checkout and its push would otherwise fail with non-fast-forward.
    expect(content).toMatch(/git pull --rebase[^\n]*origin main/);
  });
});
