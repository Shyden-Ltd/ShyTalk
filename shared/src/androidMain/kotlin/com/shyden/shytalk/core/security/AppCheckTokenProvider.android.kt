package com.shyden.shytalk.core.security

import com.google.firebase.appcheck.FirebaseAppCheck
import com.shyden.shytalk.core.util.logE
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

private const val TAG = "AppCheck"

/**
 * Android attestation, via Play Integrity. The provider itself is installed at
 * app start — see `AppCheckInstaller` — because installing it is a one-time
 * global act and obtaining a token is a per-request one.
 */
actual class AppCheckTokenProvider {
    /**
     * `getAppCheckToken(false)` returns a CACHED token when one is valid and
     * only hits Play Integrity when it is not. The `false` is load-bearing:
     * `true` forces a refresh on every call, which on a cold start would put a
     * network round trip and a Play Integrity attestation in front of the ban
     * check — the exact critical-path cost the story forbids.
     */
    actual suspend fun currentToken(): String? =
        suspendCancellableCoroutine { cont ->
            try {
                FirebaseAppCheck
                    .getInstance()
                    .getAppCheckToken(false)
                    .addOnSuccessListener { result ->
                        val token = result.token
                        cont.resume(token.ifBlank { null })
                    }.addOnFailureListener { err ->
                        // Fail OPEN. Play Integrity throttles on the free tier
                        // and the device may be offline; neither is evidence
                        // this install is illegitimate, and neither should
                        // stop the user opening the app.
                        logE(TAG, "App Check token unavailable: ${err.message}")
                        cont.resume(null)
                    }
            } catch (e: Exception) {
                // getInstance() throws when Firebase is not initialised, which
                // is reachable on the very first frame of a cold start.
                logE(TAG, "App Check unavailable: ${e.message}")
                cont.resume(null)
            }
        }
}
