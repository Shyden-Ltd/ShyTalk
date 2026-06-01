/**
 * Pins per-ref concurrency + cancel-in-progress on every reusable workflow
 * called from pr-checks.yml.
 *
 * Rationale (self-discovered 2026-06-01 during PR #946 stall):
 * pr-checks.yml itself has `concurrency: cancel-in-progress: true` so a
 * newer commit cancels the prior PR Checks run. BUT GitHub Actions
 * concurrency cancellation does NOT propagate into reusable workflows
 * spawned via `uses: ./.github/workflows/X.yml`. Each reusable runs in
 * its own concurrency context.
 *
 * Observed failure: PR #946 commit bd754dc was pushed while commit
 * 163f1f3's ios-tests reusable was still running. The PR Checks
 * concurrency cancelled the OUTER run, but the inner ios-tests
 * continued (group "ios-tests", cancel-in-progress: false) and held
 * the slot for bd754dc's PR Checks queue. Result: PR #946 sat in
 * "pending" for ~2 hours until manual cancel.
 *
 * Fix pattern (this test pins it):
 *   concurrency:
 *     group: <workflow-name>-${{ inputs.ref || github.ref }}
 *     cancel-in-progress: true
 *
 * - Per-ref grouping (via inputs.ref for workflow_call OR github.ref
 *   for workflow_dispatch) ensures independent PRs don't serialize.
 * - cancel-in-progress: true cancels the in-progress reusable run when
 *   the parent PR Checks re-fires with a newer commit.
 *
 * Deploy/release workflows DELIBERATELY keep cancel-in-progress: false
 * (an in-flight deploy must complete, not be killed by a new push).
 * Those are excluded here.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github/workflows');

// Reusables that MUST cancel-in-progress with per-ref scoping.
// Excludes deploy-dev/deploy-prod/release/seed-dev-personas (deliberately
// non-cancelling) and allure-report (deploys to gh-pages; ordering matters).
const CANCEL_REUSABLES = [
  'lint.yml',
  'sonarcloud.yml',
  'test-backend.yml',
  'e2e-tests.yml',
  'ios-tests.yml',
  'integration-tests.yml',
  'playwright-tests.yml',
  'qa-runner-driver-checks.yml',
];

describe('reusable workflow concurrency — per-ref + cancel-in-progress', () => {
  describe.each(CANCEL_REUSABLES)('%s', (filename) => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf8');
    });

    test('declares a top-level concurrency block', () => {
      // Anchored at column 0 — top-level concurrency, not job-level.
      expect(yamlText).toMatch(/^concurrency:$/m);
    });

    test('group is per-ref (inputs.ref || github.ref)', () => {
      // Match either:
      //   group: <name>-${{ inputs.ref || github.ref }}
      //   group: <name>-${{ inputs.ref }}     (parent always passes ref)
      // The first form is preferred for workflows that also support
      // workflow_dispatch — but either is correct because the parent
      // always supplies inputs.ref for the workflow_call path.
      const groupLine = yamlText.match(/^ {2}group: ([^\n]+)$/m);
      expect(groupLine).not.toBeNull();
      const groupValue = groupLine[1];
      // Must reference inputs.ref OR github.ref (or both) — bare
      // global names like "e2e-tests" are forbidden.
      const hasRefScope = /inputs\.ref/.test(groupValue) || /github\.ref/.test(groupValue);
      expect(hasRefScope).toBe(true);
    });

    test('cancel-in-progress is true (newer commit supersedes)', () => {
      expect(yamlText).toMatch(/^ {2}cancel-in-progress: true$/m);
    });
  });
});
