package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.database.database
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.context.startKoin
import org.koin.mp.KoinPlatformTools

/**
 * Initializes Firebase and Koin for the iOS app.
 *
 * Called from Swift. The persona-shared password literal lives inside the
 * `#if DEBUG` block in iOSApp.swift and is forwarded as
 * `devPersonasPassword`; the Release branch passes `nil` so the literal
 * does NOT end up in the production iOS binary — Xcode strips `#if DEBUG`
 * text at compile time. This closes the "reverse-engineer the IPA to
 * learn the seed credential" leak. Source of truth for the value is
 * `local/seed.js`.
 *
 * `googleWebClientId` is intentionally not a parameter here: iOS reads its
 * Google OAuth client ID from `FirebaseApp.app().options.clientID` (set via
 * the bundled `GoogleService-Info.plist`), so the Android-only
 * `BuildConfig.WEB_CLIENT_ID` slot is left `null` for iOS.
 *
 * @param useEmulators If true, connects Firebase to local emulators (localhost).
 * @param devPersonasPassword Shared password for the 17 seeded test personas.
 *   Should be `nil` on prod builds. (The 2026-06-01 dev-sign-in removal
 *   collapsed the legacy single-account `devSignInPassword` / `devSignInEmail`
 *   slots — only this persona-shared password remains.)
 */
fun doInitKoin(
    useEmulators: Boolean = false,
    devPersonasPassword: String? = null,
    deviceId: String? = null,
    environment: String = "prod",
    buildVersion: String = "?",
    deviceInfo: String = "?",
    apiBaseUrl: String? = null,
    googleWebClientId: String? = null,
    gitBranch: String = "",
    gitSha: String = "",
    gitDirty: Boolean = false,
    builtAt: String = "",
) {
    BuildVariant.initLocalEmulator(
        value = useEmulators,
        devPersonasPassword = devPersonasPassword,
        // GoogleSignIn iOS SDK 9.x can take a `serverClientID` alongside
        // the iOS clientID — without it, the issued token's audience is
        // the iOS OAuth client only, and Firebase Auth's
        // signInWithCredential rejects it on some configurations. Passing
        // the same web client ID Android uses (per-flavour BuildConfig
        // value, mirrored from Swift) makes Firebase happy. nil on local
        // (no real Google flow against emulator).
        googleWebClientId = googleWebClientId,
    )
    // Drives the PreviewWatermark overlay — non-prod iOS builds get a
    // "ShyTalk Preview" badge on every screen so leaked screenshots
    // are unmistakably staging. Swift forwards `"local"` for `#if DEBUG`
    // and `"prod"` (or whatever the user-facing env is) for Release.
    // Git identity (SHY-0205) arrives from Info.plist's ShyTalkGit* keys
    // (xcodebuild SHYTALK_GIT_* settings); unstamped builds pass "" and
    // initBuildInfo coerces blank → "?".
    BuildVariant.initBuildInfo(
        environment = environment,
        buildVersion = buildVersion,
        deviceInfo = deviceInfo,
        gitBranch = gitBranch,
        gitSha = gitSha,
        gitDirty = gitDirty,
        builtAt = builtAt,
    )
    // Eagerly persist the iOS deviceId before any Firebase / Koin
    // resolution. PR #406 attempted lazy `UIDevice.identifierForVendor`
    // inside the Koin factory and crashed with `ClassCastException:
    // HashMap cannot be cast to CPointer` — see
    // `project-ios-device-id-revert-rca.md`. Eager Swift-side compute +
    // BuildVariant slot avoids the K/N + GitLive Firebase init race.
    BuildVariant.initIosDeviceId(deviceId)
    // API base URL must be set BEFORE startKoin runs — IosPlatformModule's
    // `single { IosApiClient(...) }` factory reads BuildVariant.apiBaseUrl
    // and fail-closes via `?: error(...)` if it's null. Without this slot
    // populated, every `POST /api/identity/resolve` after sign-in tried
    // localhost:3000 from real iPhones and locked the user on "Unable to
    // connect".
    BuildVariant.initApiBaseUrl(apiBaseUrl)
    if (KoinPlatformTools.defaultContext().getOrNull() != null) {
        logI("KoinHelper", "Koin already initialised — skipping")
        return
    }
    try {
        if (useEmulators) {
            configureFirebaseEmulators()
        }
        startKoin {
            modules(viewModelModule, iosPlatformModule)
        }
        logI("KoinHelper", "Koin initialised successfully (emulators=$useEmulators)")
    } catch (e: Exception) {
        logE("KoinHelper", "Koin initialisation failed: ${e.message}", e)
        throw e
    }
}

/**
 * Records "the app just went to background" for the App-Lock timeout
 * (SHY-0187). Called from Swift (`AppDelegate`) on
 * `UIApplication.didEnterBackgroundNotification` — the iOS counterpart of
 * `MainActivity`'s `ProcessLifecycleOwner` onStop observer, so both
 * platforms measure the lock timeout as time-spent-in-background.
 *
 * Failure direction: if Koin isn't up yet (a notification racing app init)
 * the write is skipped — the timestamp stays stale, and a stale timestamp
 * makes `isLockRequired()` MORE likely to lock, never less. Fail-closed.
 */
fun recordAppBackgroundedForAppLock() {
    val koin = KoinPlatformTools.defaultContext().getOrNull()
    if (koin == null) {
        logI("KoinHelper", "App-Lock background timestamp skipped — Koin not initialised (fail-closed)")
        return
    }
    koin.get<com.shyden.shytalk.data.repository.AppLockRepository>().updateLastActiveTimestamp()
}

private fun configureFirebaseEmulators() {
    val host = "localhost"
    Firebase.firestore.useEmulator(host, 8080)
    Firebase.auth.useEmulator(host, 9099)
    Firebase.database.useEmulator(host, 9000)
    logI("KoinHelper", "Firebase emulators: Firestore=$host:8080, Auth=$host:9099, RTDB=$host:9000")
}
