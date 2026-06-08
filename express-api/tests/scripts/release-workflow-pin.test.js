/**
 * release.yml token + tag-only contract pin.
 *
 * Two historical incidents this file guards against:
 *
 * 1. v0.97.6 GITHUB_TOKEN trap (2026-05-25): PR #818's fix switched
 *    the release-PR step from the App token to GITHUB_TOKEN; PR opened
 *    but pr-checks.yml didn't fire (loop-prevention rule), and after
 *    auto-merge the release-tag.yml `push: main` trigger didn't fire
 *    either. v0.97.6 was bumped on main but no tag/Release was
 *    published. Fix: grant App `pull_requests: write` + switch back to
 *    App token.
 *
 * 2. SHY-0033 506-branch sprawl (2026-06-07): release.yml created
 *    `release/v${VERSION}-r${{ github.run_id }}` ephemeral branches
 *    that orphaned on every failed/cancelled run, contributing 6 to
 *    the 506-branch repo state. SHY-0034 (this PR) refactored
 *    release.yml to eliminate the ephemeral branch entirely — the
 *    GraphQL `createCommitOnBranch` mutation now targets `main`
 *    DIRECTLY via a `bypass_actors` entry on main's branch-protection
 *    ruleset (id 12613584) for the Release App. No PR is opened; no
 *    branch is created.
 *
 * This file pins the post-fix contract for BOTH incidents so a future
 * "simplification" — either switching back to GITHUB_TOKEN OR re-
 * introducing the release-branch ceremony — fails CI loudly.
 *
 * Coverage (across describe blocks):
 *   - `Generate app token` step (3 tests): pins actions/create-
 *     github-app-token@v3.2.0 SHA, uses `client-id` not deprecated
 *     `app-id`, references RELEASE_APP_ID + RELEASE_APP_PRIVATE_KEY
 *     secrets
 *   - `Create signed commit on main via GraphQL` step (3 tests):
 *     uses App token NOT GITHUB_TOKEN; targets `BRANCH="main"`;
 *     the GraphQL payload references `$branch` (which the bash sets
 *     to `main`)
 *   - SHY-0034 no-release-branches invariants (4 tests):
 *     no `BRANCH="release/v` literal anywhere in release.yml;
 *     no `gh pr create` for the release flow (the PR step was
 *     removed entirely); no `gh pr merge --auto --squash` for the
 *     release flow; no `git refs heads/release` ref-create call
 *   - `Guard against double-fired releases` step (1 test): uses
 *     App token, NOT GITHUB_TOKEN
 *   - `extractStep` helper error branches (4 tests): unknown step
 *     name throws, non-6-space step indent throws, ambiguous step
 *     name throws with all matched line numbers, CRLF line endings
 *     captured without bleed-through
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RELEASE_YAML_PATH = path.join(REPO_ROOT, '.github/workflows/release.yml');

/**
 * Extract a workflow step's full YAML block by its `- name:` header.
 * Mirror of the helper in ios-tests-build-cache.test.js — see that
 * file's docstring for the contract details (CRLF-safe, throws on
 * zero/ambiguous matches, requires 6-space step indent).
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
      `Ambiguous step name "${stepName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Use a more specific name or scope to a single job.`,
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

describe('release.yml — Release App token + tag-only (SHY-0034) contract', () => {
  let yamlText;
  // The actual step names in the workflow today (verified 2026-06-08
  // post SHY-0034 refactor):
  //   "Generate app token"
  //   "Create signed commit on main via GraphQL"
  //   "Guard against double-fired releases"
  // NOTE: "Open release PR" step was REMOVED in SHY-0034 (createCommitOnBranch
  // now targets main directly via App bypass actor; no PR is opened).
  let appTokenStep;
  let guardStep;
  let createCommitStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(RELEASE_YAML_PATH, 'utf8');
    appTokenStep = extractStep(yamlText, 'Generate app token');
    guardStep = extractStep(yamlText, 'Guard against double-fired releases');
    createCommitStep = extractStep(yamlText, 'Create signed commit on main via GraphQL');
  });

  describe('Generate app token step', () => {
    test('pins actions/create-github-app-token@v3.2.0 SHA', () => {
      expect(appTokenStep).toContain(
        'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
      );
    });

    test('uses `client-id` input (NOT deprecated `app-id`)', () => {
      // v3.x deprecated `app-id` in favour of `client-id`. The action
      // aliases both internally, but using the deprecated name emits
      // a CI warning — and the operator's warnings-are-failures rule
      // applies. Pin the non-deprecated form.
      expect(appTokenStep).toContain('client-id:');
      expect(appTokenStep).not.toContain('app-id:');
    });

    test('references RELEASE_APP_ID + RELEASE_APP_PRIVATE_KEY secrets', () => {
      expect(appTokenStep).toContain('secrets.RELEASE_APP_ID');
      expect(appTokenStep).toContain('secrets.RELEASE_APP_PRIVATE_KEY');
    });
  });

  describe('Create signed commit on main via GraphQL step', () => {
    test('uses the App token (NOT GITHUB_TOKEN)', () => {
      // The commit itself must be App-signed so it carries the App's
      // identity (visible in git log as the bot user). Using
      // GITHUB_TOKEN here would: (a) lose App signing, (b) trigger
      // the loop-prevention rule on release-tag.yml's push-to-main
      // trigger.
      expect(createCommitStep).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
      expect(createCommitStep).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });

    test('targets `BRANCH="main"` (SHY-0034: tag-only flow)', () => {
      // The mutation now targets main directly via the App's
      // bypass_actors entry on ruleset 12613584. NOT a release/v*
      // branch, NOT a per-run-ID branch. This is the load-bearing
      // assertion that catches a regression back to the ephemeral-
      // branch pattern from prior to SHY-0034.
      expect(createCommitStep).toContain('BRANCH="main"');
      expect(createCommitStep).not.toMatch(/BRANCH="release\/v/);
    });

    test('GraphQL payload references the BRANCH variable', () => {
      // Defensive: ensure the mutation actually USES the BRANCH var
      // we set above (i.e. someone didn't hard-code a different
      // branch name in the GraphQL query).
      expect(createCommitStep).toMatch(/branchName: \$branch/);
    });
  });

  describe('SHY-0034 no-release-branches invariants (file-level)', () => {
    test('no BRANCH="release/v literal anywhere in release.yml', () => {
      // Catches a regression where someone re-introduces the
      // ephemeral-branch pattern (e.g. via copy-paste from an old
      // version, or by reverting SHY-0034). The previous flow used
      // `BRANCH="release/v${VERSION}-r${{ github.run_id }}"` — this
      // pin asserts that literal pattern is gone.
      expect(yamlText).not.toMatch(/BRANCH="release\/v/);
    });

    test('no `gh pr create` in release.yml (PR-open step was removed)', () => {
      // The previous Open release PR step is gone entirely per
      // SHY-0034. createCommitOnBranch targets main directly, so no
      // PR is needed in the release flow.
      expect(yamlText).not.toMatch(/gh pr create/);
    });

    test('no `gh pr merge --auto --squash` in release.yml', () => {
      // The auto-merge invocation lived in the now-removed Open
      // release PR step. With no PR opened, no auto-merge needed.
      expect(yamlText).not.toMatch(/gh pr merge --auto --squash/);
    });

    test('no `git/refs` ref-create call for a release branch', () => {
      // The previous flow's branch-creation step was:
      //   gh api -X POST repos/.../git/refs -f ref=refs/heads/${BRANCH} ...
      // With BRANCH=main, that pattern is gone — main already exists.
      // This assertion catches a regression where someone re-adds
      // the ref-create step (e.g. for a different branch).
      expect(yamlText).not.toMatch(/POST.*git\/refs.*release/);
      expect(yamlText).not.toMatch(/ref=refs\/heads\/release/);
    });

    test('no OPEN_RELEASE_PRS guard variable (R2 reviewer test-gap)', () => {
      // The OPEN_RELEASE_PRS guard block was removed in SHY-0034
      // because no PRs are opened in the new flow. This pin catches
      // a regression where the variable name (or the surrounding
      // guard logic) is reintroduced by accident.
      expect(yamlText).not.toMatch(/OPEN_RELEASE_PRS/);
    });

    test('no pull-requests: write permission (R2 reviewer test-gap)', () => {
      // The `pull-requests: write` permission was needed for the
      // removed Open release PR step. With no PR opened, the
      // permission is dead. Least-privilege regression check.
      expect(yamlText).not.toMatch(/pull-requests:\s*write/);
    });
  });

  describe('Guard against double-fired releases step (R1 I-3)', () => {
    test('uses the App token (NOT GITHUB_TOKEN)', () => {
      // Post SHY-0034: the guard step's only API call is `git log -1`
      // (no `gh api` or `gh pr list` — the OPEN_RELEASE_PRS check was
      // removed since no PRs are opened in the tag-only flow). The
      // GH_TOKEN env var is preserved on the step so any future `gh`
      // call inherits the App identity from the same job's token —
      // GITHUB_TOKEN would lose App signing + trigger the loop-
      // prevention rule on downstream workflows.
      expect(guardStep).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
      expect(guardStep).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });
  });

  // R1 C-1: extractStep error-branch coverage matching the canonical
  // contract in ios-tests-build-cache.test.js. Without these, a
  // rename of any of the four pinned steps surfaces as a generic
  // `beforeAll` crash across every test in the file, with no
  // targeted diagnostic — the developer has to read four error
  // messages to know which step they renamed.
  describe('extractStep helper — error branches', () => {
    test('throws a clear error for unknown step names', () => {
      expect(() =>
        extractStep('jobs:\n  foo:\n    steps:\n      - name: Real\n', 'Nonexistent Step Name'),
      ).toThrow(/Could not find step "Nonexistent Step Name"/);
    });

    test('throws when YAML uses non-6-space step indentation', () => {
      const fourSpaceIndent = '    - name: Some Step\n      run: echo hi\n';
      expect(() => extractStep(fourSpaceIndent, 'Some Step')).toThrow(
        /Could not find step "Some Step"/,
      );
    });

    // R2 review test-gap fix: the canonical helper in
    // ios-tests-build-cache.test.js intentionally omits the
    // ambiguous-name branch because no step names duplicate across
    // jobs in ios-tests.yml today (documented at line 335-336
    // there). But release.yml is a different file with different
    // job structures, so the safer move is to actually test the
    // branch with a synthetic two-job YAML where the same step
    // name appears in both jobs — this exercises the contract
    // without depending on the current release.yml structure.
    test('throws on ambiguous step names (same step in two jobs)', () => {
      const ambiguous = [
        'jobs:',
        '  jobA:',
        '    steps:',
        '      - name: Shared Step',
        '        run: echo a',
        '  jobB:',
        '    steps:',
        '      - name: Shared Step',
        '        run: echo b',
      ].join('\n');
      expect(() => extractStep(ambiguous, 'Shared Step')).toThrow(
        /Ambiguous step name "Shared Step": found at lines \d+, \d+/,
      );
      // Also verify the recovery hint is present in the message —
      // helps developers fix it without having to read the helper's
      // source.
      expect(() => extractStep(ambiguous, 'Shared Step')).toThrow(
        /Use a more specific name or scope to a single job/,
      );
    });

    // Mirror of the canonical CRLF test in ios-tests-build-cache.test.js.
    // The blank line is placed INSIDE the First step's body — this is
    // the configuration that would expose a trimEnd regression. With
    // trimEnd the blank `\r` line trims to '' (length 0, fails the
    // column-0 guard), the loop continues, and `if: always()` is
    // captured. Without trimEnd, the loop breaks early.
    test('extractStep handles CRLF line endings without bleed-through', () => {
      const crlf = [
        'jobs:',
        '  build:',
        '    steps:',
        '      - name: First',
        '        run: echo a',
        '',
        '        if: always()',
        '      - name: Second',
        '        run: echo b',
        '',
      ].join('\r\n');
      const block = extractStep(crlf, 'First');
      expect(block).toContain('run: echo a');
      expect(block).toContain('if: always()');
      expect(block).not.toContain('Second');
      expect(block).not.toContain('echo b');
    });
  });
});
