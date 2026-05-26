/**
 * Kotlin warnings-as-errors enforced on the Android `app` module.
 *
 * Sibling of the shared-module gate (#852, ios-shared-warnings-as-errors).
 * The app module (Android UI, services, navigation, the instrumented BDD
 * suite) compiles clean under allWarningsAsErrors across its main / unit-test
 * / androidTest source sets — this pins the flag so a future "build cleanup"
 * can't silently drop it.
 *
 * IMPORTANT — this pins the `.set(true)` form, NOT `= true`. The app module
 * uses AGP 9.x's built-in kotlinc (not the kotlin-multiplatform plugin that
 * `shared` uses). On built-in kotlinc the Kotlin-DSL property assignment
 * `allWarningsAsErrors = true` binds as a SILENT NO-OP — verified empirically:
 * a deliberate deprecation-usage probe compiled clean with `= true`, but
 * FAILED the build (`e: warnings found and -Werror specified`) with
 * `.set(true)`. So the `.set(...)` form is load-bearing here; a regression to
 * `= true` would re-disable enforcement while looking correct, so we fail on it.
 */

const fs = require('fs');
const path = require('path');

const APP_BUILD_GRADLE = path.join(__dirname, '../../../app/build.gradle.kts');

describe('Android app Kotlin warnings-as-errors enforcement', () => {
  test('app/build.gradle.kts enforces allWarningsAsErrors via the .set(true) form', () => {
    const src = fs.readFileSync(APP_BUILD_GRADLE, 'utf8');
    expect(src).toMatch(/allWarningsAsErrors\.set\(\s*true\s*\)/);
  });

  test('app/build.gradle.kts does NOT use the no-op `allWarningsAsErrors = true` form (built-in kotlinc)', () => {
    const src = fs.readFileSync(APP_BUILD_GRADLE, 'utf8');
    expect(src).not.toMatch(/allWarningsAsErrors\s*=\s*true/);
  });
});
