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

    /// SHY-0275 — the address a LOCAL build uses to reach the developer's Mac.
    ///
    /// Comes from `Info.plist`'s `ShyTalkLocalHost`, substituted at build time
    /// from the `LOCAL_HOST` build setting (`Local.xcconfig`, overridable on the
    /// xcodebuild command line). Falls back to `localhost`, which is correct for
    /// a Mac-hosted run and WRONG on a physical iPhone — an iPhone has no
    /// `adb reverse` equivalent, so `localhost` is the phone itself.
    ///
    /// Previously these were literals and the plist value did not exist, so
    /// `LOCAL_HOST=<mac-ip>` on the command line set a value nothing read: the
    /// documented recipe looked followed while every backend call went to a port
    /// on the handset. `iOSApp.swift` logs the resolved value at launch so a
    /// wrong one is visible on first run rather than as "the app is broken".
    /// Info.plist key carrying the build-time `LOCAL_HOST` value.
    static let localHostInfoKey = "ShyTalkLocalHost"

    /// Takes the RAW plist value so the resolution rules are testable with real
    /// strings — no stand-in Bundle. Every input a build can actually produce is
    /// covered: a stamped address, an absent key (`nil`, on dev/release), and an
    /// xcconfig that expanded to empty or whitespace.
    ///
    /// Absent must resolve to `localhost`, never `""`: an empty host builds
    /// `http://:3000`, which parses fine and then fails opaquely much later.
    static func resolveLocalHost(rawValue: String?) -> String {
        let trimmed = (rawValue ?? "").trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "localhost" : trimmed
    }

    static var localHost: String {
        resolveLocalHost(rawValue: Bundle.main.object(forInfoDictionaryKey: localHostInfoKey) as? String)
    }

    static var localApiBaseUrl: String { "http://\(localHost):3000" }

    /// The local LiveKit signalling URL. `express-api/src/routes/livekit.js`
    /// deliberately omits `url` from the token response when NODE_ENV is
    /// `local`, leaving the client to supply its own — Android does this via
    /// `BuildConfig.LIVEKIT_SERVER_URL`. iOS had no equivalent, so the voice
    /// service fell through to `""` and refused its own connection.
    static var localLiveKitUrl: String { "ws://\(localHost):7880" }

    /// The local Realtime Database emulator URL, used to configure Firebase.
    static var localRtdbUrl: String { "http://\(localHost):9000?ns=demo-shytalk" }

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
