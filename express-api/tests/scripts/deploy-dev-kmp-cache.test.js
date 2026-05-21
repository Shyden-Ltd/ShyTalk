/**
 * Asserts the broader KMP intermediate-state cache exists alongside the
 * narrow final-framework cache in deploy-dev.yml's distribute-ios job.
 *
 * Background: PR #690 added two caches to the iOS path:
 *   - `~/.konan` (Kotlin/Native compiler distribution + platform libs)
 *   - `shared/build/bin/iosArm64/releaseFramework` (final framework binary)
 *
 * That left the K/N intermediate compile outputs (incremental kotlin
 * state, classes, intermediates, transformed metadata, generated code)
 * UN-cached. Even when the framework cache hit, gradle re-ran the K/N
 * compile tasks because their declared intermediate inputs were missing.
 * This PR adds a third cache step covering those intermediates, keyed
 * on the source files + build config so it invalidates appropriately.
 *
 * Implementation: regex assertions on the raw workflow YAML, same
 * pattern as `pr-checks-ios-gating.test.js`. Avoids adding js-yaml
 * just for one more structural test.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

function extractDistributeIosJob(yamlText) {
  // Capture the distribute-ios job block: from `  distribute-ios:`
  // to the next top-level job header. Same regex shape as the
  // ios-e2e extractor in pr-checks-ios-gating.test.js.
  const match = yamlText.match(/^ {2}distribute-ios:\n([\s\S]+?)(?=^ {2}\w[\w-]*:\n)/m);
  if (!match) {
    throw new Error(
      `Could not locate the distribute-ios job in ${DEPLOY_DEV_PATH}. ` +
        'The job declaration moved or was deleted — update this test to match.',
    );
  }
  return match[1];
}

describe('deploy-dev.yml — KMP intermediate cache', () => {
  let yamlText;
  let distributeIosBlock;

  beforeAll(() => {
    yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
    distributeIosBlock = extractDistributeIosJob(yamlText);
  });

  test('the existing ~/.konan cache step is preserved', () => {
    // Sanity check — the PR adds caching but must NOT remove what
    // PR #690 already established. ~/.konan covers the compiler
    // distribution + platform libs, which are version-stable and
    // expensive to re-download.
    expect(distributeIosBlock).toMatch(/path:\s+~\/\.konan/);
  });

  test('the existing framework binary cache step is preserved', () => {
    // The narrow framework cache (`shared/build/bin/iosArm64/releaseFramework`)
    // remains useful as a "is this exact framework already on disk"
    // shortcut for the warm-up step's `if: cache-hit != 'true'` skip.
    expect(distributeIosBlock).toMatch(/path:\s+shared\/build\/bin\/iosArm64\/releaseFramework/);
  });

  test('caches the KMP intermediate compile state (classes, kotlin, intermediates)', () => {
    // The actual perf-relevant change. Without these, gradle's
    // UP-TO-DATE check on K/N tasks fails because their declared
    // intermediate inputs/outputs aren't on disk — even when the
    // final framework IS cached. That forces a fresh K/N compile.
    expect(distributeIosBlock).toMatch(/path:\s*\|[\s\S]*?shared\/build\/classes/);
    expect(distributeIosBlock).toMatch(/path:\s*\|[\s\S]*?shared\/build\/kotlin\b/);
    expect(distributeIosBlock).toMatch(/path:\s*\|[\s\S]*?shared\/build\/intermediates/);
  });

  test('intermediates cache key invalidates on source + build-config + version changes', () => {
    // Cache key must hash inputs that gradle considers when deciding
    // whether the K/N output is up-to-date. Source files, the module
    // build script, and the version catalog. Missing any of these
    // would either (a) under-invalidate (stale builds shipping) or
    // (b) over-invalidate (cache never hits in practice).
    expect(distributeIosBlock).toMatch(
      /key:\s+kmp-intermediates-[^\n]*hashFiles\('shared\/src\/\*\*'[^)]*'shared\/build\.gradle\.kts'[^)]*'gradle\/libs\.versions\.toml'/,
    );
  });

  test('intermediates cache uses OS-scoped restore-keys for partial-match warm', () => {
    // When source changes invalidate the exact key, restore-keys
    // gives us a partial warm restore from a prior commit's
    // intermediates. Gradle's incremental compilation does the
    // diff and skips unchanged sub-tasks.
    expect(distributeIosBlock).toMatch(
      /restore-keys:[\s\S]*?kmp-intermediates-\$\{\{\s*runner\.os\s*\}\}-/,
    );
  });
});
