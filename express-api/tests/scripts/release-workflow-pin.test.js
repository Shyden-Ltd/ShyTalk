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
 * Coverage:
 *   - The `Generate Release App token` step exists and uses
 *     actions/create-github-app-token@v3.2.0 with `client-id`
 *   - The `Open release PR` step uses `GH_TOKEN: ${{
 *     steps.app-token.outputs.token }}`, NOT `secrets.GITHUB_TOKEN`
 *   - The `Open release PR` step has BOTH `gh pr create` AND
 *     `gh pr merge --auto` invocations (auto-merge must use the same
 *     non-GITHUB_TOKEN identity to keep release-tag.yml firing)
 *   - The `Create signed release commit` step also uses the App token
 *     (this was already correct, but pinning it prevents drift)
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
        'Step was renamed, removed, or indentation changed — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches.map((i) => i + 1).join(', ')}.`,
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
  let createCommitStep;
  let openPrStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(RELEASE_YAML_PATH, 'utf8');
    appTokenStep = extractStep(yamlText, 'Generate app token');
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

    test('invokes `gh pr merge --auto` (auto-merge enable)', () => {
      // Auto-merge MUST be enabled by the App, not GITHUB_TOKEN, so
      // the eventual squash-merge commit on main is authored by the
      // App and triggers release-tag.yml.
      expect(openPrStep).toContain('gh pr merge --auto');
    });
  });
});
