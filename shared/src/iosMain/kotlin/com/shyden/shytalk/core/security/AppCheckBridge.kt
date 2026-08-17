package com.shyden.shytalk.core.security

/**
 * Swift-side App Check, registered from `iosApp` during app init. Mirrors
 * `IosPushBridge` / `IosLiveKitBridge`: the Firebase iOS SDK has no KMP
 * binding, so Swift implements this and hands it over at startup.
 *
 * ## Why this is its own file (SHY-0306)
 *
 * Kotlin/Native names the facade carrying a file's top-level functions after
 * THE FILE. These declarations started life in `AppCheckTokenProvider.ios.kt`,
 * whose facade is `AppCheckTokenProvider_iosKt` — the `.ios` infix that marks
 * an `actual` implementation becomes part of the Swift name. `AppDelegate`
 * called `AppCheckTokenProviderKt`, which nothing exports, and iOS could not
 * build. Every other bridge here already avoids that by living in a file with
 * no infix, and this now does too: Swift says `AppCheckBridgeKt`.
 *
 * Keep Swift-facing top-level functions out of `*.ios.kt` files. The infix is
 * a KMP convention for `actual` declarations; it is not meant to be spoken by
 * Swift.
 *
 * The callback takes a nullable token rather than a Result: EVERY failure on
 * this path is the same failure — no attestation available — and collapsing
 * them at the boundary keeps the Kotlin side from having to reason about
 * Objective-C error domains it cannot act on differently anyway.
 */
interface AppCheckBridge {
    /**
     * Hand back a cached App Check token, or null if none is available.
     *
     * MUST NOT block waiting for attestation: this is called on the cold-start
     * path, and the story forbids putting a Play Integrity/App Attest round
     * trip in front of the ban check. Swift returns whatever it already has
     * and refreshes in the background.
     */
    fun currentToken(callback: (String?) -> Unit)
}

/**
 * `internal`, not `private`: `AppCheckTokenProvider.ios.kt` reads it, and
 * `internal` keeps it off the Swift facade, which is right — Swift registers
 * through the function below and has no business touching the slot.
 */
@kotlin.concurrent.Volatile
internal var appCheckBridge: AppCheckBridge? = null

/** Called from Swift during app init, after `FirebaseApp.configure()`. */
fun registerAppCheckBridge(bridge: AppCheckBridge) {
    appCheckBridge = bridge
}

/** Present so a wiring test can prove Swift registered something. */
fun hasAppCheckBridge(): Boolean = appCheckBridge != null
