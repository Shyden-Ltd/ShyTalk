/**
 * Asserts that `.github/workflows/deploy-dev.yml` declares a concurrency
 * group so only one dev deploy runs at a time. Parallel dev deploys can:
 *   - Race on the same Express deployment target (London VM)
 *   - Race on Firebase App Distribution upload slots
 *   - Race on TestFlight build-number assignment (CFBundleVersion derived
 *     from GITHUB_RUN_NUMBER — fine in isolation, but two concurrent
 *     deploys both pushing means tester surface flips between builds)
 *
 * Per-2026-05-21 user policy: dev deploys MUST queue, never run in
 * parallel. Mirrors the existing `concurrency: deploy-prod` setting
 * in deploy-prod.yml.
 *
 * cancel-in-progress: false is deliberate — a queued deploy waiting on
 * a running one shouldn't preempt it. The running deploy completes,
 * THEN the queued one starts.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

describe('deploy-dev.yml — concurrency policy', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
  });

  // Each assertion checks ONE line independently — actionlint validates
  // the YAML's overall structural correctness, so we don't need cross-
  // line regex anchoring (which is the only thing that gets Sonar
  // grumpy about backtracking). Three lines all present = concurrency
  // block is in place.

  test('top-level concurrency block is declared', () => {
    // Anchored at column 0 to ensure we're checking the top-level
    // workflow concurrency (not some hypothetical job-level one).
    expect(yamlText).toMatch(/^concurrency:$/m);
  });

  test('concurrency group is "deploy-dev" (own queue, not shared with prod)', () => {
    // Distinct group from deploy-prod so a prod deploy can run in
    // parallel with a dev deploy — they target different VMs +
    // Firebase projects and have no shared state.
    expect(yamlText).toMatch(/^ {2}group: deploy-dev$/m);
  });

  test("cancel-in-progress is false (queue, don't preempt)", () => {
    // The running deploy should complete before the queued one
    // starts. Cancelling mid-run would leave the dev environment in
    // an undefined state (partial backend deploy + cancelled Android
    // distribution etc.).
    expect(yamlText).toMatch(/^ {2}cancel-in-progress: false$/m);
  });
});
