import Foundation

/// The three iOS build variants, mirroring the Android product flavors
/// (`local` / `dev` / `prod`). Selected at compile time in `iOSApp.swift`:
///   - `.dev`     ← `#if DEV_BACKEND` (the Debug-Dev configuration, SHY-0104)
///   - `.local`   ← `#elseif DEBUG`   (plain Debug — Firebase emulators)
///   - `.release` ← `#else`           (distributable Release — dev backend, no picker)
enum AppBuildVariant: Equatable {
    case local
    case dev
    case release
}

/// The resolved runtime configuration handed to `KoinHelper.doInitKoin(...)`.
/// Pure data — no Firebase / Bundle / UIKit — so it is unit-testable.
struct AppEnvironmentConfig: Equatable {
    let useEmulators: Bool
    let environment: String
    let apiBaseUrl: String
    let devPersonasPassword: String?
    let googleWebClientId: String?
}

/// Side-effect-free env resolution, extracted from `iOSApp.swift`'s `init()`
/// so the variant → config mapping is unit-testable (XCTest:
/// `AppEnvironmentTests`). The caller supplies the variant (via `#if`) and the
/// variant-appropriate persona password; this function owns the mapping.
///
/// Mirrors the Android per-flavour `BuildConfig` contract — see
/// `BuildVariant.kt` for the shared (Kotlin) side that derives
/// `isPersonaPickerAvailable` from the password's presence.
enum AppEnvironment {
    static let devApiBaseUrl = "https://dev-api.shytalk.shyden.co.uk"
    static let localApiBaseUrl = "http://localhost:3000"

    /// WEB OAuth client ID for the `shytalk-dev` Firebase project — Android
    /// passes the same value via `BuildConfig.WEB_CLIENT_ID`. Needed by
    /// GoogleSignIn iOS SDK 9.x's `serverClientID` so Firebase Auth accepts
    /// the token's audience. nil on local (no real Google flow vs the emulator).
    static let devGoogleWebClientId =
        "881846974606-kv99pjv92i6me0emb2j3uacbhnqqvfj4.apps.googleusercontent.com"

    /// - Parameters:
    ///   - variant: the compile-time-selected build variant.
    ///   - personasPassword: the variant-appropriate seed/injected password
    ///     (the local emulator seed for `.local`; the build-time-injected
    ///     `DEV_QA_PERSONAS_PASSWORD` for `.dev`; nil for `.release`). Empty
    ///     strings coerce to nil so the picker fails CLOSED, matching
    ///     `BuildVariant`'s `devPersonasPassword?.takeIf { it.isNotEmpty() }`.
    static func resolve(variant: AppBuildVariant, personasPassword: String?) -> AppEnvironmentConfig {
        let cleaned = (personasPassword?.isEmpty == false) ? personasPassword : nil
        switch variant {
        case .local:
            return AppEnvironmentConfig(
                useEmulators: true,
                environment: "local",
                apiBaseUrl: localApiBaseUrl,
                devPersonasPassword: cleaned,
                googleWebClientId: nil
            )
        case .dev:
            return AppEnvironmentConfig(
                useEmulators: false,
                environment: "dev",
                apiBaseUrl: devApiBaseUrl,
                devPersonasPassword: cleaned,
                googleWebClientId: devGoogleWebClientId
            )
        case .release:
            // Distributable build: NEVER carry the persona picker, regardless
            // of any password threaded in. Defence-in-depth alongside the
            // `#else` branch passing nil — see SHY-0104 Security AC.
            return AppEnvironmentConfig(
                useEmulators: false,
                environment: "dev",
                apiBaseUrl: devApiBaseUrl,
                devPersonasPassword: nil,
                googleWebClientId: devGoogleWebClientId
            )
        }
    }
}
