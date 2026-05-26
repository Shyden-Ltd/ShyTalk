/**
 * Kotlin warnings-as-errors enforced on the shared module (#24c finale).
 *
 * shared/ holds the bulk of our code (commonMain: models, repos, ViewModels,
 * UI). `allWarningsAsErrors = true` makes ANY Kotlin compiler warning across
 * shared (commonMain / jvm / android / iOS) fail the build — the enforcement
 * end of the iOS-warnings arc. Verified: shared compiles green under the flag
 * on all targets (compileKotlinIosArm64 / compileKotlinJvm / compileAndroidMain).
 *
 * NOT enforced (upstream/environment debt — see
 * .project/ios-build-warnings-debt.md): pod deprecations, the gitlive cinterop
 * import warning, the Xcode-26.3 Metal `ld:` quirk, and Swift app-target
 * -warnings-as-errors (blocked by the cinterop diagnostic at the shared.h
 * import boundary). None are Kotlin-compiler warnings, so this gate is the
 * right scope for "enforce our code".
 *
 * Pins the flag so a future "build cleanup" can't silently drop it.
 */

const fs = require('fs');
const path = require('path');

const SHARED_BUILD_GRADLE = path.join(__dirname, '../../../shared/build.gradle.kts');

describe('shared Kotlin warnings-as-errors enforcement', () => {
  test('shared/build.gradle.kts sets allWarningsAsErrors = true', () => {
    const src = fs.readFileSync(SHARED_BUILD_GRADLE, 'utf8');
    // The Kotlin Gradle DSL: compilerOptions { allWarningsAsErrors = true }.
    expect(src).toMatch(/allWarningsAsErrors\s*=\s*true/);
  });
});
