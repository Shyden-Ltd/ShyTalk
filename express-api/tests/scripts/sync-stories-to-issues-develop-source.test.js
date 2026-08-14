/**
 * SHY-0177: Board sync fires from main — develop-flow story changes never
 * reach the Projects board.
 *
 * The git-flow pivot (SHY-0161) made develop the integration branch, but
 * sync-stories-to-issues.yml still triggered on push-to-main, so the board
 * lagged develop by days. These pins hold the develop-source contract:
 *
 *   1. push trigger fires on develop (and NOT main) — develop ⊇ main for
 *      story files, and the equality body-hash has no version ordering, so
 *      a second source branch could regress the board backwards;
 *   2. concurrency is GLOBAL (one board ⇒ one sync at a time, any trigger);
 *   3. checkout pins ref develop — a workflow_dispatch clicked from main
 *      (the default branch) must not publish stale main content;
 *   4. the board-items.json sidecar commit-back targets develop, with
 *      expectedHeadOid resolved from the LIVE develop ref (busy branch;
 *      a checkout-time SHA goes stale mid-run) plus one head-race retry;
 *   5. the sidecar commit message keeps [skip ci] — load-bearing on
 *      develop, which (unlike main) has push-triggered workflows;
 *   6. issue-footer _Source: links point at blob/develop so cards for
 *      stories not yet promoted to main don't 404.
 *
 * Spec: .project/stories/SHY-0177-board-sync-develop-trigger.md
 *
 * Pure file-content pins (no doubles, no gh mock) — the behavioral proof of
 * the footer change lives in the run-the-real-script characterization
 * assertions in sync-stories-to-issues-board-fields.test.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'sync-stories-to-issues.yml');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-stories-to-issues.sh');

describe('SHY-0177: workflow syncs the board from develop', () => {
  let yaml;
  let script;

  beforeAll(() => {
    yaml = fs.readFileSync(WORKFLOW, 'utf8');
    script = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('push trigger fires on develop, not main', () => {
    // Exact-line pin: the sole push branch is develop. A `[main]` or
    // `[main, develop]` list must fail — a main trigger can regress the
    // board (equality body-hash, no version ordering).
    expect(yaml).toMatch(/^ {4}branches: \[develop\]$/m);
    const branchLines = yaml.split('\n').filter((l) => /^\s*branches:/.test(l));
    expect(branchLines).toEqual(['    branches: [develop]']);
  });

  test('concurrency group is global (no per-ref suffix) with cancel-in-progress false', () => {
    // One shared board ⇒ one sync at a time regardless of trigger ref.
    // The pre-SHY-0177 group `sync-stories-${{ github.ref }}` serialized
    // per-ref only, which lets a dispatch and a push mutate concurrently.
    expect(yaml).toMatch(/^ {2}group: sync-stories$/m);
    expect(yaml).not.toContain('group: sync-stories-${{ github.ref }}');
    expect(yaml).toMatch(/^ {2}cancel-in-progress: false$/m);
  });

  test('checkout pins ref develop (dispatch-from-main cannot publish stale content)', () => {
    // workflow_dispatch runs on the ref it is clicked from — main by
    // default. Pinning the checkout to develop makes every trigger sync
    // develop truth. Comment lines may sit between the with: keys.
    expect(yaml).toMatch(/fetch-depth: 1\n(?:[ \t]*#[^\n]*\n)*[ \t]+ref: develop$/m);
  });

  test('sidecar commit-back targets branch develop', () => {
    // The createCommitOnBranch mutation must land board-items.json on
    // develop — the branch the next sync checks out and reads it from.
    expect(yaml).toContain('--arg branch "develop"');
    expect(yaml).not.toContain('--arg branch "main"');
  });

  test('sidecar expectedHeadOid comes from the live develop ref with one head-race retry', () => {
    // develop is a busy integration branch: a PR merging during the ~2-3
    // min sync makes a checkout-HEAD expectedHeadOid stale and the
    // mutation fails. Resolve the live head at commit time and retry once
    // on a race; a second failure stays loud (exit 1 + logged responses).
    expect(yaml).toContain('git/ref/heads/develop');
    expect(yaml).toMatch(/for attempt in 1 2/);
    expect(yaml).not.toMatch(/PARENT_SHA=\$\(git rev-parse HEAD\)/);
  });

  test('sidecar commit-back fails loud after 2 exhausted attempts', () => {
    // AC (error paths): "a persistent failure is loud (exit 1 + response
    // logged)" — pin the exit-1 branch verbatim so a silent-swallow
    // refactor cannot slip through.
    expect(yaml).toMatch(
      /if \[ -z "\$OID" \]; then\n\s+echo "::error::sidecar createCommitOnBranch failed after 2 attempts \(responses above\)\."\n\s+exit 1\n\s+fi/,
    );
  });

  test('live head is re-resolved INSIDE the retry loop, not hoisted out', () => {
    // The whole point of the retry is a FRESH expectedHeadOid on attempt 2;
    // a hoisted LIVE_HEAD would retry with the same stale SHA and always
    // fail again. Slice the loop body and require the resolution inside it.
    const start = yaml.indexOf('for attempt in 1 2; do');
    expect(start).toBeGreaterThan(-1);
    const end = yaml.indexOf('\n          done', start);
    expect(end).toBeGreaterThan(start);
    const loopBody = yaml.slice(start, end);
    expect(loopBody).toContain(
      'LIVE_HEAD=$(gh api "repos/${{ github.repository }}/git/ref/heads/develop"',
    );
    expect(yaml.slice(0, start)).not.toContain('LIVE_HEAD=$(gh api');
  });

  test('loop breaks on first success (no redundant second commit)', () => {
    expect(yaml).toMatch(/if \[ -n "\$OID" \]; then\n\s+break\n\s+fi/);
  });

  test('each attempt logs the resolved live head; failures echo the raw response', () => {
    // AC (observability): the resolved head is visible per attempt, and a
    // failed attempt surfaces the raw GraphQL response before any retry.
    expect(yaml).toContain('echo "[sidecar] attempt ${attempt}: live develop head ${LIVE_HEAD}"');
    expect(yaml).toMatch(
      /::warning::sidecar createCommitOnBranch attempt \$\{attempt\} failed — raw response below\."\n\s+echo "\$RESPONSE"/,
    );
  });

  test('sidecar success path renders the step-summary table with the live head + new OID', () => {
    // The Actions-UI summary table is the only place a human sees which
    // live head the sidecar committed onto (heading now says develop).
    expect(yaml).toContain('## Board sidecar: signed commit on develop');
    expect(yaml).toContain('| **Parent (live develop head)** | \\`${LIVE_HEAD}\\` |');
    expect(yaml).toContain('echo "[sidecar] signed commit ${OID} (.project/board-items.json)"');
  });

  test('sidecar commit message retains [skip ci]', () => {
    // Regression pin (green from birth, deliberately): on main this tag was
    // belt-and-braces; on develop it is load-bearing — develop has
    // push-triggered workflows that the sidecar commit must not fire.
    expect(yaml).toMatch(/sync board-items\.json id-map \[skip ci\]/);
  });

  test('footer Source URL points at blob/develop', () => {
    // Board cards must link to the branch where story truth lives — a
    // blob/main link 404s for any story not yet promoted (e.g. a story
    // created and merged on develop the same day).
    expect(script).toContain('blob/develop/.project/stories');
    expect(script).not.toContain('blob/main');
  });
});
