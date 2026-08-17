package com.shyden.shytalk.core.security

import com.shyden.shytalk.core.util.logE
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

private const val TAG = "AppCheck"

// The `AppCheckBridge` interface and the `registerAppCheckBridge` /
// `hasAppCheckBridge` entry points live in `AppCheckBridge.kt`, NOT here.
// Kotlin/Native names a file's top-level facade after the file, so anything
// declared here is exported to Swift as `AppCheckTokenProvider_iosKt` — a name
// no caller guesses. See SHY-0306; that mismatch broke every iOS build.

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
