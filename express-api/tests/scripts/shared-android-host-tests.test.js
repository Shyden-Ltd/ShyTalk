/**
 * shared module runs commonTest on the android host (#10).
 *
 * The KMP android library plugin emitted "commonTest source directory exists,
 * but android host tests are not enabled. add withHostTest {}". Enabling it
 * runs the shared suite against the androidMain actuals (Logger.android.kt,
 * etc.) — coverage jvm() never exercises — and clears the notice.
 *
 * isReturnDefaultValues=true is load-bearing: without it, android.jar stubs
 * (android.util.Log) throw "Method ... not mocked" and 39 tests cascade-fail.
 * It mirrors app/build.gradle.kts's testOptions so the suite runs without
 * Robolectric. This pins both so the android-host coverage can't be silently
 * dropped or quietly broken.
 */

const fs = require('fs');
const path = require('path');

const SHARED_BUILD_GRADLE = path.join(__dirname, '../../../shared/build.gradle.kts');
const PR_CHECKS = path.join(__dirname, '../../../.github/workflows/pr-checks.yml');

describe('shared android host tests (#10)', () => {
  test('shared/build.gradle.kts enables withHostTest with returnDefaultValues', () => {
    const src = fs.readFileSync(SHARED_BUILD_GRADLE, 'utf8');
    expect(src).toMatch(/withHostTest\s*\{/);
    expect(src).toMatch(/isReturnDefaultValues\s*=\s*true/);
  });

  test('pr-checks.yml runs :shared:testAndroidHostTest in CI (#12)', () => {
    // Enabling host tests is only meaningful if CI runs them — otherwise the
    // androidMain-actual coverage rots (it never reaches the pipeline). Pin
    // the CI invocation so the coverage stays live.
    const src = fs.readFileSync(PR_CHECKS, 'utf8');
    expect(src).toMatch(/:shared:testAndroidHostTest/);
  });
});
