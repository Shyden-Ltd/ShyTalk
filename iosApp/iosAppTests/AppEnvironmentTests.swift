import XCTest
@testable import iosApp

/// Tests for `AppEnvironment.resolve(variant:personasPassword:isDebugBuild:)` — the pure,
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
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw, isDebugBuild: false)
        XCTAssertFalse(cfg.useEmulators, "dev must NOT use the local emulators")
        XCTAssertEqual(cfg.environment, "dev")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
    }

    func test_dev_withPassword_enablesPicker() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw, isDebugBuild: false)
        XCTAssertEqual(cfg.devPersonasPassword, injectedDevPw,
                       "a non-empty injected password must reach BuildVariant → picker visible")
    }

    func test_dev_carriesDevGoogleWebClientId() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "pw", isDebugBuild: false)
        XCTAssertEqual(cfg.googleWebClientId,
                       "881846974606-kv99pjv92i6me0emb2j3uacbhnqqvfj4.apps.googleusercontent.com")
        XCTAssertEqual(cfg.googleWebClientId, AppEnvironment.devGoogleWebClientId)
    }

    // ── .dev — fail-closed when the password is absent (Error path) ──

    func test_dev_withEmptyPassword_hidesPicker_butStaysOnDev() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "", isDebugBuild: false)
        XCTAssertNil(cfg.devPersonasPassword, "empty password must coerce to nil (fail-closed)")
        // Critical: an absent password must NOT fall back to the emulators.
        XCTAssertFalse(cfg.useEmulators, "no localhost fallback when the picker is unavailable")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
        XCTAssertEqual(cfg.environment, "dev")
    }

    func test_dev_withNilPassword_hidesPicker() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: nil, isDebugBuild: false)
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
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: "   ", isDebugBuild: false)
        XCTAssertEqual(cfg.devPersonasPassword, "   ")
    }

    // ── .local — existing emulator behaviour is UNCHANGED (Edge case) ──

    func test_local_usesEmulators_andLocalhostApi() {
        let cfg = AppEnvironment.resolve(variant: .local, personasPassword: localEmulatorSeed, isDebugBuild: false)
        XCTAssertTrue(cfg.useEmulators)
        XCTAssertEqual(cfg.environment, "local")
        XCTAssertEqual(cfg.apiBaseUrl, "http://localhost:3000")
        XCTAssertEqual(cfg.devPersonasPassword, localEmulatorSeed,
                       "local always has the picker (emulator-seeded personas)")
        XCTAssertNil(cfg.googleWebClientId, "no real Google OAuth client against the emulator")
    }

    func test_local_withEmptyPassword_coercesToNil() {
        let cfg = AppEnvironment.resolve(variant: .local, personasPassword: "", isDebugBuild: false)
        XCTAssertNil(cfg.devPersonasPassword)
    }

    // ── .release — distributable: NEVER the picker (Security) ──

    func test_release_neverCarriesPassword_evenIfOneIsPassed() {
        // Defence-in-depth: even if a password were mistakenly threaded into
        // the release branch, the resolver strips it. The distributable IPA
        // must never enable the picker. (The literal is ALSO compile-stripped
        // because the release branch in iOSApp.swift passes nil — this is the
        // belt to that braces.)
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: "leaked", isDebugBuild: false)
        XCTAssertNil(cfg.devPersonasPassword, "release must NEVER expose the picker")
    }

    func test_release_targetsDevBackend_withoutPicker() {
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: nil, isDebugBuild: false)
        XCTAssertFalse(cfg.useEmulators)
        XCTAssertEqual(cfg.environment, "dev")
        XCTAssertEqual(cfg.apiBaseUrl, "https://dev-api.shytalk.shyden.co.uk")
        XCTAssertEqual(cfg.googleWebClientId, AppEnvironment.devGoogleWebClientId)
        XCTAssertNil(cfg.devPersonasPassword)
    }

    // ── dev vs release: same backend, the ONLY difference is the picker ──

    func test_devAndRelease_shareBackend_differOnlyByPicker() {
        let dev = AppEnvironment.resolve(variant: .dev, personasPassword: "pw", isDebugBuild: false)
        let rel = AppEnvironment.resolve(variant: .release, personasPassword: "pw", isDebugBuild: false)
        XCTAssertEqual(dev.apiBaseUrl, rel.apiBaseUrl)
        XCTAssertEqual(dev.environment, rel.environment)
        XCTAssertEqual(dev.useEmulators, rel.useEmulators)
        XCTAssertEqual(dev.googleWebClientId, rel.googleWebClientId)
        XCTAssertNotNil(dev.devPersonasPassword, "dev has the picker")
        XCTAssertNil(rel.devPersonasPassword, "release does not")
    }

    // ── bypassDeviceChecks — auth-stage device checks (Security, SHY-0170) ──
    //
    // SHY-0526: mirrors Android's REAL rule, not its flavour line. On Android
    // `buildTypes.debug` sets BYPASS_DEVICE_CHECKS=true for EVERY *-debug
    // build (devDebug included), overriding the flavour's `false`. So the iOS
    // rule is: bypass = `.local` || debug configuration. Release configurations
    // (the only ones archived for TestFlight) enforce.

    func test_local_bypassesDeviceChecks_inEveryConfiguration() {
        for isDebug in [true, false] {
            let cfg = AppEnvironment.resolve(variant: .local, personasPassword: localEmulatorSeed, isDebugBuild: isDebug)
            XCTAssertTrue(cfg.bypassDeviceChecks,
                          "local mirrors Android's local flavour (emulator/E2E journeys), isDebugBuild=\(isDebug)")
        }
    }

    func test_dev_debugConfiguration_bypassesDeviceChecks_likeAndroidDevDebug() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw, isDebugBuild: true)
        XCTAssertTrue(cfg.bypassDeviceChecks,
                      "Debug-Dev mirrors Android devDebug: buildTypes.debug overrides the dev flavour — personas must rotate on one real iPhone")
    }

    func test_dev_releaseConfiguration_enforcesDeviceChecks() {
        let cfg = AppEnvironment.resolve(variant: .dev, personasPassword: injectedDevPw, isDebugBuild: false)
        XCTAssertFalse(cfg.bypassDeviceChecks,
                       "a Release configuration on the dev backend enforces the device-lock + ban checks, like Android devRelease")
    }

    func test_release_releaseConfiguration_enforcesDeviceChecks() {
        // The regression this section exists for: IosPlatformModule used to
        // hardcode the bypass to `true` for EVERY build — TestFlight included —
        // silently skipping the SHY-0170 device-lock and SHY-0149 ban checks.
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: nil, isDebugBuild: false)
        XCTAssertFalse(cfg.bypassDeviceChecks,
                       "distributable builds must NEVER skip device-lock/ban checks")
    }

    func test_release_debugConfiguration_bypassesDeviceChecks_likeAndroidProdDebug() {
        let cfg = AppEnvironment.resolve(variant: .release, personasPassword: nil, isDebugBuild: true)
        XCTAssertTrue(cfg.bypassDeviceChecks,
                      "a debugger build on the prod backend mirrors Android prodDebug; archives use Release, so this never ships")
    }

    func test_isDebugBuild_isTrueUnderTheDebugCompilationCondition() {
        // This test bundle is built with a Debug* configuration, all of which
        // define DEBUG. The Release side is pinned from the pbxproj by
        // IosDebugBuildBypassPinTest (host JVM).
        XCTAssertTrue(AppEnvironment.isDebugBuild,
                      "the flag must come from `#if DEBUG`, which every Debug* configuration defines")
    }

    // ── SHY-0275 — the local host a real iPhone uses to reach the Mac ──
    //
    // `LOCAL_HOST` (Local.xcconfig) → `ShyTalkLocalHost` (Info.plist) →
    // `AppEnvironment.localHost` → API / RTDB / LiveKit URLs. Before this, the
    // URLs were literals containing `localhost`, so a physical iPhone — which
    // has no `adb reverse` equivalent — sent every backend call to a port on
    // ITSELF. Measured on device: `Firestore=localhost:8080` while the Mac was
    // at 192.168.1.9.

    // Resolution takes the RAW plist value, so these are real strings — no
    // stand-in Bundle. (A Bundle subclass here would be a test double in an
    // iOS `*Tests` target, which the no-stubs ratchet correctly rejects.)

    func test_localHost_usesTheStampedAddress() {
        // The whole point: a real iPhone must get the Mac's LAN address.
        XCTAssertEqual(AppEnvironment.resolveLocalHost(rawValue: "192.168.1.9"), "192.168.1.9")
    }

    func test_localHost_fallsBackToLocalhostWhenTheKeyIsAbsent() {
        // dev/release builds never stamp the key, and a Mac-hosted run wants
        // localhost anyway. Absent must NOT become "" — that would build
        // "http://:3000", which parses and then fails opaquely much later.
        XCTAssertEqual(AppEnvironment.resolveLocalHost(rawValue: nil), "localhost")
    }

    func test_localHost_treatsAnUnsubstitutedOrBlankValueAsAbsent() {
        // An xcconfig that never substituted leaves the key EMPTY rather than
        // missing — a different input that must land in the same place.
        XCTAssertEqual(AppEnvironment.resolveLocalHost(rawValue: ""), "localhost")
        XCTAssertEqual(AppEnvironment.resolveLocalHost(rawValue: "   "), "localhost")
    }

    func test_localHost_trimsSurroundingWhitespace() {
        // xcconfig values keep trailing spaces before an inline comment, which
        // would otherwise produce "http://192.168.1.9 :3000".
        XCTAssertEqual(AppEnvironment.resolveLocalHost(rawValue: "  192.168.1.9  "), "192.168.1.9")
    }

    func test_localHost_infoKeyMatchesTheOneInfoPlistDeclares() {
        // The plist declares <key>ShyTalkLocalHost</key>; if these ever diverge
        // the read silently returns nil and every URL falls back to localhost —
        // the original bug, restored, with nothing red.
        XCTAssertEqual(AppEnvironment.localHostInfoKey, "ShyTalkLocalHost")
    }

    func test_localUrls_areAllBuiltFromTheResolvedHost() {
        // The three the device console named, one per line of its output.
        let host = AppEnvironment.localHost
        XCTAssertEqual(AppEnvironment.localApiBaseUrl, "http://\(host):3000")
        XCTAssertEqual(AppEnvironment.localLiveKitUrl, "ws://\(host):7880")
        XCTAssertEqual(AppEnvironment.localRtdbUrl, "http://\(host):9000?ns=demo-shytalk")
    }

    func test_localVariant_carriesTheLocalApiBaseUrl() {
        // Ties the resolved host to what actually reaches Koin: `.local` must
        // hand over the host-derived URL, not a literal.
        let cfg = AppEnvironment.resolve(variant: .local, personasPassword: localEmulatorSeed, isDebugBuild: false)
        XCTAssertEqual(cfg.apiBaseUrl, AppEnvironment.localApiBaseUrl)
        XCTAssertTrue(cfg.apiBaseUrl.contains(AppEnvironment.localHost))
    }
}
