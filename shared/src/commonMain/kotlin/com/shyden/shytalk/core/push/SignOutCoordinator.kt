package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.logW
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Signs out in an order that actually releases this device's push registration.
 *
 * SHY-0494. Four accounts on one phone — including a minor and an admin — all
 * held the same installation ID, so a push to any of them arrived on that
 * device. The removal code was fine; the ORDER was not. `onSignOut` fired the
 * removal into a coroutine scope and then, synchronously, signed out of auth
 * and navigated away. The removal lost two races at once:
 *
 *  - the scope belonged to the screen the navigation was destroying, and
 *  - the credential authorising the request was revoked before it landed.
 *
 * Both failures are silent. Removal is best-effort and logged, so nothing goes
 * red; the only symptom is somebody receiving a stranger's notifications.
 *
 * A push identifier names the app INSTANCE, not the person, so every account
 * that signs in on a phone registers the same value. Releasing it on the way
 * out is the only thing that stops them accumulating.
 */
class SignOutCoordinator(
    private val pushTokenManager: PushTokenManager,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
) {
    /**
     * Releases the push registration, then runs [signOut].
     *
     * [signOut] runs even if the release fails or times out. Leaving an
     * identifier behind is a real problem, but refusing to sign somebody out
     * of their own account is a worse one, and it is the person holding the
     * phone who pays for it. A device that cannot reach the backend cannot be
     * released from it either way.
     */
    suspend fun signOut(
        userId: String?,
        signOut: suspend () -> Unit,
    ) {
        if (!userId.isNullOrEmpty()) {
            val released = withTimeoutOrNull(timeoutMs) { pushTokenManager.clearToken(userId) }
            if (released == null) {
                // Loud on purpose: this is the state in which the next person
                // to sign in on this device shares its notifications with the
                // person who just left.
                logW(
                    TAG,
                    "push identifier not released within ${timeoutMs}ms for userId=$userId — " +
                        "this device may still be registered to that account",
                )
            }
        }
        signOut()
    }

    private companion object {
        const val TAG = "SignOutCoordinator"

        /**
         * Long enough for a normal round trip, short enough that a person on a
         * dead connection is not left staring at a settings screen.
         */
        const val DEFAULT_TIMEOUT_MS = 3_000L
    }
}
