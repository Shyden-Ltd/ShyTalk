/**
 * release.yml token + PR-open contract pin.
 *
 * Triggered by: release v0.97.6 (PR #835) bumped versionName + versionCode
 * on main but `release-tag.yml` never fired, so no `v0.97.6` git tag
 * + GitHub Release was published — leaving the latest published
 * release stuck at `v0.97.5` from 2026-05-03.
 *
 * Root cause: my prior fix in PR #818 (2026-05-24) switched the
 * `Open release PR` step's `GH_TOKEN` from the Release App token
 * (`steps.app-token.outputs.token`) to the workflow's built-in
 * `secrets.GITHUB_TOKEN`, because the App's installation didn't yet
 * grant `pull_requests: write`. That fix made the PR-open step succeed,
 * but introduced a NEW bug: GitHub's documented loop-prevention rule
 * says any action performed using `GITHUB_TOKEN` does NOT trigger
 * downstream workflows. Two consequences:
 *   1. The release PR's `pull_request: opened` event did NOT fire
 *      pr-checks.yml — observed on PR #835 (no CI ran until we pushed
 *      an empty commit at 10:54 BST on 2026-05-25).
 *   2. The auto-merge (also performed by `GITHUB_TOKEN` via the
 *      enabled auto-merge bot) means the squash-merge commit on main
 *      is authored by `GITHUB_TOKEN`, so the `push: branches: main`
 *      trigger on release-tag.yml does NOT fire. Every release since
 *      v0.97.5 has hit this trap.
 *
 * Fix: grant the Release App `pull_requests: write` in the GitHub App
 * settings UI (a one-time manual step performed by the operator), then
 * switch BOTH the PR-open step AND the auto-merge enable step back to
 * using the App token. With the permission in place, the App's identity
 * is what opens the PR and enables auto-merge, so downstream workflows
 * see a non-GITHUB_TOKEN event and fire normally.
 *
 * This test pins the post-fix contract so a future "simplification"
 * that switches back to `secrets.GITHUB_TOKEN` (because it looks
 * simpler / removes the App dependency) fails CI loudly with a clear
 * explanation, instead of silently re-introducing the publishing
 * outage we just experienced.
 *
 * Coverage (13 tests across 5 describe blocks):
 *   - `Generate app token` step (3 tests): pins actions/create-
 *     github-app-token@v3.2.0 SHA, uses `client-id` not deprecated
 *     `app-id`, references RELEASE_APP_ID + RELEASE_APP_PRIVATE_KEY
 *     secrets
 *   - `Create release branch and signed commit via GraphQL` step
 *     (1 test): uses App token, NOT GITHUB_TOKEN
 *   - `Open release PR` step (4 tests): uses App token NOT
 *     GITHUB_TOKEN; invokes `gh pr create`; invokes `gh pr merge
 *     --auto --squash` (the `--squash` flag is load-bearing —
 *     release-tag.yml matches `chore: release vX.Y.Z` against the
 *     squash-merge's PR-title-as-commit-subject; `--merge` would
 *     produce `Merge pull request #N ...` which never matches);
 *     GH_TOKEN is declared in step-level `env:` block (not inline
 *     export inside `run:`) and env: precedes run:
 *   - `Guard against double-fired releases` step (1 test): uses
 *     App token, NOT GITHUB_TOKEN (the orphan-branch detection
 *     calls `gh api` + `gh pr list` and must see the repo as the
 *     App identity)
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

describe('release.yml — Release App token + PR-open contract', () => {
  let yamlText;
  // The actual step names in the workflow today (verified 2026-05-25):
  //   "Generate app token"
  //   "Create release branch and signed commit via GraphQL"
  //   "Open release PR"
  let appTokenStep;
  let guardStep;
  let createCommitStep;
  let openPrStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(RELEASE_YAML_PATH, 'utf8');
    appTokenStep = extractStep(yamlText, 'Generate app token');
    guardStep = extractStep(yamlText, 'Guard against double-fired releases');
    createCommitStep = extractStep(yamlText, 'Create release branch and signed commit via GraphQL');
    openPrStep = extractStep(yamlText, 'Open release PR');
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

  describe('Create release branch and signed commit via GraphQL step', () => {
    test('uses the App token (NOT GITHUB_TOKEN)', () => {
      // The commit itself must be App-signed so it carries the App's
      // identity (visible in git log as the bot user). Using
      // GITHUB_TOKEN here would: (a) lose App signing, (b) trigger
      // the loop-prevention rule on any downstream workflows that
      // listen for the branch push.
      expect(createCommitStep).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
      expect(createCommitStep).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });
  });

  describe('Open release PR step', () => {
    test('uses the App token (NOT GITHUB_TOKEN) — load-bearing for downstream workflows', () => {
      // Per the file-level docstring above: GITHUB_TOKEN-opened PRs
      // do not fire pr-checks.yml on `opened`, and GITHUB_TOKEN-merged
      // commits do not fire release-tag.yml on `push: main`. The App
      // token avoids both traps because the App's installation
      // identity is distinct from GITHUB_TOKEN.
      //
      // This assertion is the one that catches a "switch back to
      // GITHUB_TOKEN for convenience" regression.
      expect(openPrStep).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
      expect(openPrStep).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });

    test('invokes `gh pr create` (the PR-opening primitive)', () => {
      expect(openPrStep).toContain('gh pr create');
    });

    test('invokes `gh pr merge --auto --squash` (R1 I-1: squash strategy is load-bearing)', () => {
      // Auto-merge MUST be enabled by the App, not GITHUB_TOKEN, so
      // the eventual squash-merge commit on main is authored by the
      // App and triggers release-tag.yml. The `--squash` flag is
      // load-bearing: release-tag.yml's `Inspect commit subject`
      // step matches `chore: release vX.Y.Z` against the squash-
      // merge's commit subject (which is the PR title). A merge
      // commit (default `--merge`) would produce a subject like
      // `Merge pull request #N from release/v...` — release-tag.yml
      // would skip it. So both `--auto` AND `--squash` are required.
      expect(openPrStep).toContain('gh pr merge --auto --squash');
    });

    test('GH_TOKEN is declared in step-level `env:` block (R1 I-2)', () => {
      // GH_TOKEN must be set at the step level so EVERY `gh` sub-
      // command in the step's `run:` block inherits the App token.
      // Setting it via `export GH_TOKEN=...` inside `run:` instead
      // would leak ordering bugs — any `gh` call before the export
      // would silently fall through to the default GITHUB_TOKEN.
      expect(openPrStep).toContain('env:');
      const envIdx = openPrStep.indexOf('env:');
      const runIdx = openPrStep.indexOf('run:');
      // Ordering guard: `-1` slipping through would still satisfy a
      // naive `envIdx < runIdx` check if env is absent (-1 < positive).
      expect(envIdx).toBeGreaterThanOrEqual(0);
      expect(runIdx).toBeGreaterThanOrEqual(0);
      expect(envIdx).toBeLessThan(runIdx);
    });
  });

  describe('Guard against double-fired releases step (R1 I-3)', () => {
    test('uses the App token (NOT GITHUB_TOKEN)', () => {
      // The guard step calls `gh api` and `gh pr list` to detect
      // orphan release branches and open release PRs. Both need to
      // see the repo as the App identity for consistency with the
      // PR-open step's view. Using GITHUB_TOKEN here would also
      // hit the loop-prevention rule for any future branch-creation
      // side effects.
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
