/**
 * Static assertions on .github/workflows/sync-roadmap-data.yml.
 *
 * Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md (original)
 *       .project/stories/SHY-0063-fix-sync-roadmap-signed-commits.md (this refactor)
 *
 * Why static rather than dispatch-and-observe: actionlint catches YAML syntax;
 * these assertions cover the specific contract bits that would silently regress
 * (loop guard, App-token shape, GraphQL mutation, no plain `git push`).
 *
 * Dispatch verification is the *separate* gate that blocks SHY-0063 from Done
 * per [[feedback-workflow-verify-by-running]] STRENGTHENED rule — neither this
 * file nor any static checker substitutes for that.
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

  test('loop-guard skips re-fire by either the default bot OR the Release App bot (SHY-0063)', () => {
    // SHY-0063: createCommitOnBranch records github.actor as the Release App
    // (shytalk-release-bot[bot]) — NOT github-actions[bot]. Without this dual
    // guard the App's own commit-back would re-trigger this workflow on push.
    expect(content).toMatch(/if:[ \t]+github\.actor[ \t]*!=[ \t]*['"]github-actions\[bot\]['"]/);
    expect(content).toMatch(/github\.actor[ \t]*!=[ \t]*['"]shytalk-release-bot\[bot\]['"]/);
    // Both conditions joined by `&&` (AND) — either bot alone must short-circuit.
    // Bounded character class (no [\s\S]* greedy wildcard — avoids sonarjs/slow-regex
    // catastrophic-backtracking risk while still asserting the `&&` joiner is present
    // immediately between the two actor-name string literals).
    expect(content).toMatch(
      /github-actions\[bot\]['"][ \t]+&&[ \t]+github\.actor[ \t]*!=[ \t]*['"]shytalk-release-bot\[bot\]/,
    );
  });

  test('permissions: contents: write (scoped, not full repo write)', () => {
    expect(content).toMatch(/permissions:[ \t]*\n[ \t]+contents:[ \t]+write/);
    expect(content).not.toMatch(/actions:[ \t]+write/);
    expect(content).not.toMatch(/pages:[ \t]+write/);
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

  test('SHY-0063: mints a Release App token via actions/create-github-app-token (SHA-pinned)', () => {
    // Locks the specific known-good SHA. Paired with the cross-workflow
    // parity test below so a unilateral bump (e.g. Dependabot on only one
    // file) fails fast in CI rather than silently desynchronising the two
    // main-mutating workflows.
    expect(content).toMatch(
      /uses:\s*actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1\s*#\s*v3\.2\.0/,
    );
  });

  test('SHY-0063: create-github-app-token SHA matches release.yml exactly (cross-workflow parity)', () => {
    // C1 from reviewer (a0530c52e4032cb9a): the single-workflow assertion
    // above doesn't catch a future drift where only one of the two
    // workflows gets its App-token action bumped. This test reads BOTH
    // workflow YAMLs + asserts identical SHAs. If release.yml moves to a
    // newer SHA without sync-roadmap-data.yml getting the same bump (or
    // vice-versa), this test fails — forcing the bump to be atomic.
    const releaseYmlPath = path.join(REPO_ROOT, '.github/workflows/release.yml');
    const releaseContent = fs.readFileSync(releaseYmlPath, 'utf8');
    const extract = (src) => {
      const m = src.match(/actions\/create-github-app-token@([0-9a-f]{40})/);
      return m ? m[1] : null;
    };
    const syncSha = extract(content);
    const releaseSha = extract(releaseContent);
    expect(syncSha).not.toBeNull();
    expect(releaseSha).not.toBeNull();
    expect(syncSha).toBe(releaseSha);
  });

  test('SHY-0063: App-token step references RELEASE_APP_ID + RELEASE_APP_PRIVATE_KEY secrets', () => {
    expect(content).toMatch(/client-id:\s*\$\{\{\s*secrets\.RELEASE_APP_ID\s*\}\}/);
    expect(content).toMatch(/private-key:\s*\$\{\{\s*secrets\.RELEASE_APP_PRIVATE_KEY\s*\}\}/);
  });

  test('SHY-0063: checkout uses App token (not default GITHUB_TOKEN) so blame attribution stays coherent', () => {
    // The App identity should own the entire checkout-regen-commit chain.
    // Mixing GITHUB_TOKEN for checkout + App token for commit would make
    // any git operation between them attribute to the bot, not the App.
    expect(content).toMatch(/token:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
    expect(content).not.toMatch(/token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  test('SHY-0063: commit-back uses createCommitOnBranch GraphQL mutation (not git push)', () => {
    // The whole point of SHY-0063: the previous `git push origin HEAD:main`
    // is rejected by branch protection's required_signatures rule. GraphQL
    // createCommitOnBranch produces a server-side App-signed commit that
    // satisfies the signature requirement.
    expect(content).toMatch(/createCommitOnBranch/);
    expect(content).toMatch(/gh api graphql/);
  });

  test('SHY-0063: NO plain git push origin HEAD:main remains anywhere', () => {
    // Belt-and-braces alongside the createCommitOnBranch assertion above:
    // the broken commit-back form must be FULLY excised, not coexist.
    expect(content).not.toMatch(/git push origin HEAD:main/);
    expect(content).not.toMatch(/git push origin main/);
  });

  test('SHY-0063: NO local git commit step (signed commits come from the mutation, not local config)', () => {
    // git commit locally would produce an UNSIGNED commit. Even if a later
    // push step were rule-bypassed, the required_signatures rule would still
    // reject it. The mutation is the ONLY signed-commit path from CI.
    expect(content).not.toMatch(/git config user\.name 'github-actions\[bot\]'/);
    expect(content).not.toMatch(/^[ \t]*git commit -m/m);
  });

  test('SHY-0063: mutation uses expectedHeadOid for optimistic concurrency', () => {
    // If main advances between checkout and mutation, expectedHeadOid makes
    // the mutation fail LOUD rather than overwriting the concurrent commit.
    // The next `push: main` event re-triggers the workflow against new HEAD.
    expect(content).toMatch(/expectedHeadOid/);
    expect(content).toMatch(/git rev-parse HEAD|PARENT_SHA/);
  });

  test('SHY-0063: mutation payload uses jq --rawfile + @base64 for safe content encoding', () => {
    // Matches release.yml:365-373 pattern — avoids JSON-escape pitfalls for
    // file content containing quotes/newlines/control chars. @base64 is
    // RFC-4648 standard which GraphQL accepts without padding/newline issues.
    expect(content).toMatch(/jq -n[\s\S]{0,800}--rawfile[\s\S]{0,900}@base64/);
  });

  test('SHY-0064: payload built in a single jq -n invocation (no --argjson additions chaining)', () => {
    // Reason: at the current SHY-corpus size (~177KB JSON → ~237KB base64),
    // the prior two-step pattern `ADDITIONS=$(jq -n ...) ; PAYLOAD=$(jq -n
    // --argjson additions "$ADDITIONS" ...)` exceeded Linux's effective
    // ARG_MAX when the second jq received $ADDITIONS as argv. Fix:
    // construct additions inline within ONE jq filter via `($c1|@base64)`
    // so only the final PAYLOAD bash variable holds the large content,
    // and PAYLOAD is piped to gh via stdin (no argv limit).
    expect(content).not.toMatch(/--argjson\s+additions/);
    expect(content).not.toMatch(/ADDITIONS=\$\(jq/);
    // Confirm exactly one `jq -n` in the commit-back step's run block.
    // Other jq calls (like the `jq -r '.data...'` response parser) use
    // `jq -r`, not `jq -n`, so this count is unambiguous.
    const jqNullInputMatches = content.match(/jq -n\b/g) || [];
    expect(jqNullInputMatches.length).toBe(1);
  });

  test('SHY-0063: payload commits exactly one file path: public/roadmap-data.json', () => {
    // Sync's contract is ONLY public/roadmap-data.json. Any other path in the
    // additions array would be a contract violation (workflow secretly editing
    // other files). The Node regen script only writes this one file.
    const additionsMatch = content.match(/additions[\s\S]{0,600}?roadmap-data\.json/);
    expect(additionsMatch).not.toBeNull();
    // No other file path should appear within the same additions construction.
    if (additionsMatch) {
      const block = additionsMatch[0];
      expect(block).not.toMatch(/build\.gradle/);
      expect(block).not.toMatch(/internal\.txt/);
      expect(block).not.toMatch(/default\.txt/);
    }
  });

  test('runs the sync script via node (not bash) with no shell interpolation of untrusted input', () => {
    expect(content).toMatch(/run:[ \t]+node scripts\/sync-shy-to-roadmap-data\.mjs/);
    expect(content).not.toMatch(/\$\{\{[ \t]*github\.event\./);
    expect(content).not.toMatch(/\$\{\{[ \t]*github\.head_ref/);
  });

  test('SHY-0063: commit message is the documented chore(roadmap) form', () => {
    expect(content).toMatch(/chore\(roadmap\): sync roadmap-data\.json from SHY corpus/);
  });

  test('concurrency group is per-ref (no cross-PR serialisation)', () => {
    expect(content).toMatch(/group:\s*sync-roadmap-data-\$\{\{\s*github\.ref\s*\}\}/);
    expect(content).toMatch(/cancel-in-progress:\s*false/);
  });

  test('timeout-minutes is set (no unbounded jobs)', () => {
    expect(content).toMatch(/timeout-minutes:\s*\d+/);
  });

  test('no shell:true in run blocks (defense-in-depth)', () => {
    expect(content).not.toMatch(/shell:[ \t]*['"]?true['"]?/);
  });

  test('commit-back step has `git diff --quiet` no-op guard (I4 from SHY-0038 review preserved)', () => {
    // Without this, every workflow run would invoke createCommitOnBranch
    // unnecessarily (mutation latency + audit-log noise for empty diffs).
    expect(content).toMatch(/git diff --quiet public\/roadmap-data\.json/);
    expect(content).toMatch(/no changes/);
  });

  test('SHY-0063 (I1 from reviewer): file-absent guard precedes the diff (avoids cryptic set -euo exit)', () => {
    // If the regen script silently fails without producing the file, the
    // subsequent `git diff --quiet <path>` exits non-zero on a missing path
    // and set -euo pipefail kills the run with no useful diagnostic. The
    // existence check produces an actionable ::error:: log instead.
    expect(content).toMatch(/if\s*\[\s*!\s*-f\s+public\/roadmap-data\.json\s*\]/);
    expect(content).toMatch(/was not produced by the sync script/);
  });

  test('SHY-0063: no echo / set -x near the App token env (secret hygiene)', () => {
    // Defensive: ensure the App token isn't trivially leaked in logs.
    // Search for any line containing GH_TOKEN env block followed by echo $GH_TOKEN.
    expect(content).not.toMatch(/echo\s+["']?\$\{?GH_TOKEN/);
    expect(content).not.toMatch(/echo\s+["']?\$\{?\{\s*steps\.app-token\.outputs\.token/);
    expect(content).not.toMatch(/^[ \t]*set -x/m);
  });

  test('SHY-0063: response sanity-check guards against null commit OID', () => {
    // Matches release.yml:391-395 — if the mutation succeeds at the HTTP layer
    // but returns no commit (anomalous; defensively guarded), exit 1 with the
    // response printed via jq.
    expect(content).toMatch(/COMMIT_OID/);
    expect(content).toMatch(/if\s*\[\s*-z\s*"?\$\{?COMMIT_OID\}?"?\s*\]/);
  });

  test('SHY-0063: writes a step-summary audit record (replaces former git-log audit trail)', () => {
    // Per release.yml's SHY-0034 architect risk #5 pattern: the workflow's
    // $GITHUB_STEP_SUMMARY block is the canonical record of who-synced-what-when
    // when the commit lands directly on main without a PR.
    expect(content).toMatch(/GITHUB_STEP_SUMMARY/);
  });
});
