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

    /// Only correct where the app shares the Mac's network — i.e. the iOS
    /// Simulator, which was RETIRED 2026-07-15. On a physical iPhone
    /// `localhost` is the PHONE, so this is a fallback, never the answer.
    static let localApiBaseUrlFallback = "http://localhost:3000"

    /// Composes the local API base URL from the build-time `LOCAL_HOST`
    /// (Info.plist ← Local.xcconfig, overridable via `xcodebuild LOCAL_HOST=…`).
    ///
    /// This used to be a hardcoded `http://localhost:3000` constant, which made
    /// Local.xcconfig's documented `LOCAL_HOST` override — and the
    /// `xcodebuild LOCAL_HOST=…` invocation it instructs you to use — DEAD
    /// CODE. The app always called itself, so the preview badge showed a red
    /// api dot on a real device no matter how the build was driven.
    ///
    /// Takes the HOST, not a URL: Xcode's Info.plist variable expansion runs a
    /// C-preprocessor-style pass that treats the `//` in `http://` as a comment
    /// and truncates the value to `http:`, so the scheme must be added here.
    ///
    /// Pure over its input so the contract is unit-testable without a bundle.
    static func localApiBaseUrl(fromInfoPlistValue raw: Any?) -> String {
        guard let value = raw as? String else { return localApiBaseUrlFallback }
        let host = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // Reject empties, an UNSUBSTITUTED `$(LOCAL_HOST)`, and a value that
        // already carries a scheme (which would compose to `http://http://…`).
        // Letting any of those through surfaces as an opaque DNS failure at
        // runtime instead of an obvious misconfiguration.
        guard !host.isEmpty, !host.contains("$("), !host.contains("/") else {
            return localApiBaseUrlFallback
        }
        return "http://\(host):3000"
    }

    static var localApiBaseUrl: String {
        localApiBaseUrl(fromInfoPlistValue: Bundle.main.object(forInfoDictionaryKey: "LOCAL_HOST"))
    }

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
