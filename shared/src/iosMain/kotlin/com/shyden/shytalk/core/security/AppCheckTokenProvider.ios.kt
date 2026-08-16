package com.shyden.shytalk.core.security

import com.shyden.shytalk.core.util.logE
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

private const val TAG = "AppCheck"

/**
 * Swift-side App Check, registered from `iosApp` during app init. Mirrors
 * `PushTokenBridge` / `LiveKitBridge`: the Firebase iOS SDK has no KMP
 * binding, so Swift implements this and hands it over at startup.
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

@kotlin.concurrent.Volatile
private var appCheckBridge: AppCheckBridge? = null

/** Called from Swift during app init, after `FirebaseApp.configure()`. */
fun registerAppCheckBridge(bridge: AppCheckBridge) {
    appCheckBridge = bridge
}

/** Present so a wiring test can prove Swift registered something. */
fun hasAppCheckBridge(): Boolean = appCheckBridge != null

actual class AppCheckTokenProvider {
    actual suspend fun currentToken(): String? {
        // Null until Swift registers — reachable on the very first frame of a
        // cold start, and on a build where the bridge was never wired. Both
        // fail OPEN: the request goes out unattested and the SERVER decides,
        // which during the monitor phase means nothing changes for the user.
        val bridge = appCheckBridge ?: return null
        return suspendCancellableCoroutine { cont ->
            try {
                bridge.currentToken { token -> cont.resume(token?.ifBlank { null }) }
            } catch (e: Exception) {
                // The callback crosses the Swift→Kotlin FFI boundary; an
                // uncaught throw there would take the app down over a header.
                logE(TAG, "App Check token unavailable: ${e.message}", e)
                cont.resume(null)
            }
        }
    }
}
