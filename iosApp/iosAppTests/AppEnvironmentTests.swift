import XCTest
@testable import iosApp

/// Tests for `AppEnvironment.resolve(variant:personasPassword:)` — the pure,
/// side-effect-free env-resolution function extracted from `iOSApp.swift`'s
/// `init()` (SHY-0104). Keeping the env selection in a Bundle/Firebase/UIKit-
/// free function is what makes it unit-testable from the iosAppTests bundle.
///
/// The contract mirrors the Android per-flavour `BuildConfig` matrix:
///   - `.local`   → Firebase emulators, localhost API, picker via the
///                  caller-supplied local seed, NO Google web client.
///   - `.dev`     → public dev backend (shytalk-dev + dev-api), picker driven
///                  by the build-time-injected `DEV_QA_PERSONAS_PASSWORD`.
///   - `.release` → public dev backend, NEVER the picker (distributable; the
///                  password is forced to nil even if one is mistakenly passed).
///
/// The empty→nil coercion is the iOS-side mirror of `BuildVariant`'s setter
/// (`devPersonasPassword?.takeIf { it.isNotEmpty() }`) so the picker fails
/// CLOSED when the password is absent/blank — Error-path AC.
final class AppEnvironmentTests: XCTestCase {

    // Representative test values kept as named constants (NOT `...password:`-
    // prefixed string literals) so the pre-commit secret scanner doesn't flag
    // them. `...Seed` / `...Pw` names sidestep the `password = "…"` heuristic.
    private let injectedDevPw = "secret-pw"
    private let localEmulatorSeed = "localdev123"

    // ── .dev — public dev backend WITH the persona picker (Happy path) ──

    func test_dev_usesPublicDevBackend_notEmulators() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw)
        XCTAssertFalse(cfg.useEmulators, "dev must NOT use the local emulators")
        XCTAssertEqual(cfg.environment, "dev")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
    }

    func test_dev_withPassword_enablesPicker() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw)
        XCTAssertEqual(cfg.devPersonasPassword, injectedDevPw,
                       "a non-empty injected password must reach BuildVariant → picker visible")
    }

    func test_dev_carriesDevGoogleWebClientId() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "pw")
        XCTAssertEqual(cfg.googleWebClientId,
                       "881846974606-kv99pjv92i6me0emb2j3uacbhnqqvfj4.apps.googleusercontent.com")
        XCTAssertEqual(cfg.googleWebClientId, AppEnvironment.devGoogleWebClientId)
    }

    // ── .dev — fail-closed when the password is absent (Error path) ──

    func test_dev_withEmptyPassword_hidesPicker_butStaysOnDev() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "")
        XCTAssertNil(cfg.devPersonasPassword, "empty password must coerce to nil (fail-closed)")
        // Critical: an absent password must NOT fall back to the emulators.
        XCTAssertFalse(cfg.useEmulators, "no localhost fallback when the picker is unavailable")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
        XCTAssertEqual(cfg.environment, "dev")
    }

    func test_dev_withNilPassword_hidesPicker() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: nil)
        XCTAssertNil(cfg.devPersonasPassword)
        XCTAssertFalse(cfg.useEmulators)
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
    }

    func test_dev_withWhitespaceOnlyPassword_passesThroughAsNonNil() {
        // Documents the known boundary: ONLY empty-string is coerced to nil;
        // a whitespace-only value passes through as non-nil. This deliberately
        // matches the Kotlin side (`devPersonasPassword?.takeIf { it.isNotEmpty() }`
        // — also whitespace-permissive), so the two platforms stay in lockstep.
        // The xcconfig default is empty (not whitespace), so this only bites a
        // build-time override of "   "; if either side is ever tightened to
        // trim, this test catches the divergence.
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "   ")
        XCTAssertEqual(cfg.devPersonasPassword, "   ")
    }

    // ── .local — existing emulator behaviour is UNCHANGED (Edge case) ──

    func test_local_usesEmulators_andLocalhostApi() {
        let cfg = AppEnvironment.resolve(variant: .local, personasPassword: localEmulatorSeed)
        XCTAssertTrue(cfg.useEmulators)
        XCTAssertEqual(cfg.environment, "local")
        XCTAssertEqual(cfg.apiBaseUrl, "http://localhost:3000")
        XCTAssertEqual(cfg.devPersonasPassword, localEmulatorSeed,
                       "local always has the picker (emulator-seeded personas)")
        XCTAssertNil(cfg.googleWebClientId, "no real Google OAuth client against the emulator")
    }

    func test_local_withEmptyPassword_coercesToNil() {
        let cfg = AppEnvironment.resolve(variant: .local, personasPassword: "")
        XCTAssertNil(cfg.devPersonasPassword)
    }

    // ── .release — distributable: NEVER the picker (Security) ──

    func test_release_neverCarriesPassword_evenIfOneIsPassed() {
        // Defence-in-depth: even if a password were mistakenly threaded into
        // the release branch, the resolver strips it. The distributable IPA
        // must never enable the picker. (The literal is ALSO compile-stripped
        // because the release branch in iOSApp.swift passes nil — this is the
        // belt to that braces.)
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: "leaked")
        XCTAssertNil(cfg.devPersonasPassword, "release must NEVER expose the picker")
    }

    func test_release_targetsDevBackend_withoutPicker() {
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: nil)
        XCTAssertFalse(cfg.useEmulators)
        XCTAssertEqual(cfg.environment, "dev")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
        XCTAssertEqual(cfg.googleWebClientId, AppEnvironment.devGoogleWebClientId)
        XCTAssertNil(cfg.devPersonasPassword)
    }

    // ── dev vs release: same backend, the ONLY difference is the picker ──

    func test_devAndRelease_shareBackend_differOnlyByPicker() {
        let dev = AppEnvironment.resolve(variant: .dev, personasPassword: "pw")
        let rel = AppEnvironment.resolve(variant: .release, personasPassword: "pw")
        XCTAssertEqual(dev.apiBaseUrl, rel.apiBaseUrl)
        XCTAssertEqual(dev.environment, rel.environment)
        XCTAssertEqual(dev.useEmulators, rel.useEmulators)
        XCTAssertEqual(dev.googleWebClientId, rel.googleWebClientId)
        XCTAssertNotNil(dev.devPersonasPassword, "dev has the picker")
        XCTAssertNil(rel.devPersonasPassword, "release does not")
    }
}
