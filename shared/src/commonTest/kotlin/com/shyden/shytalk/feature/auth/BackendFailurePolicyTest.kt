package com.shyden.shytalk.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * How a failed backend call is classified, and whether it is worth trying
 * again (SHY-0442).
 *
 * Filmed on a real iPhone on 2026-08-22: for the first ~20 seconds after
 * launch the app showed a full-screen "Unable to Connect … check your
 * internet connection", against a stack that was up and answering — the same
 * walk went on to sign in and raise tickets against it. Twenty-one
 * consecutive dumps. It cleared only because the harness force-stopped and
 * relaunched, which is not a thing a person does.
 *
 * The cause was that ONE non-auth failure went straight to the error state
 * with nothing between. These are the two decisions that fix it, kept pure so
 * they can be pinned without standing a ViewModel up.
 */
class BackendFailurePolicyTest {
    // ── isAuthError: is the SESSION bad, or the NETWORK? ──

    @Test
    fun `the five shapes that mean the session is bad`() {
        listOf(
            "Not authenticated",
            "Token refresh failed",
            "INVALID_REFRESH_TOKEN",
            "UNAUTHENTICATED",
            "HTTP 401 Unauthorized",
        ).forEach {
            assertTrue(BackendFailurePolicy.isAuthError(it), "should be an auth error: $it")
        }
    }

    @Test
    fun `case does not decide whether somebody is signed out`() {
        assertTrue(BackendFailurePolicy.isAuthError("not authenticated"))
        assertTrue(BackendFailurePolicy.isAuthError("invalid_refresh_token"))
    }

    @Test
    fun `an ordinary transport failure is not an auth error`() {
        listOf(
            "Connection reset by peer",
            "Failed to connect to /10.0.2.2:3000",
            "timeout",
            "Software caused connection abort",
            "HTTP 500 Internal Server Error",
            "HTTP 503 Service Unavailable",
        ).forEach {
            assertFalse(BackendFailurePolicy.isAuthError(it), "should NOT be an auth error: $it")
        }
    }

    @Test
    fun `an address that merely contains 401 is a network failure`() {
        // An IPv6 host like 2401:db8:: in a connection error must not read as
        // a 401 and sign somebody out. The digits are matched on word
        // boundaries for exactly this reason.
        assertFalse(BackendFailurePolicy.isAuthError("connect failed to 2401:db8::1"))
        assertFalse(BackendFailurePolicy.isAuthError("port 14012 unreachable"))
    }

    @Test
    fun `nothing to classify is not an auth error`() {
        // A failure with no message is far more likely a dropped socket than a
        // rejected session, and treating it as auth would sign somebody out
        // for a blip.
        assertFalse(BackendFailurePolicy.isAuthError(null))
        assertFalse(BackendFailurePolicy.isAuthError(""))
        assertFalse(BackendFailurePolicy.isAuthError("   "))
    }

    // ── shouldRetry: is it worth asking again? ──

    @Test
    fun `a transport failure is retried within the budget`() {
        assertTrue(BackendFailurePolicy.shouldRetry(attempt = 1, message = "Connection reset"))
        assertTrue(
            BackendFailurePolicy.shouldRetry(
                attempt = BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS,
                message = "Connection reset",
            ),
        )
    }

    @Test
    fun `the budget is finite, so a real outage still reaches the person`() {
        // The other half of the fix. Retrying for ever would replace a wrong
        // error screen with an endless spinner, which is worse: at least the
        // error screen tells somebody something.
        assertFalse(
            BackendFailurePolicy.shouldRetry(
                attempt = BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS + 1,
                message = "Connection reset",
            ),
        )
    }

    @Test
    fun `a rejected session is never retried`() {
        // Asking again with the same bad token just fails again, and delays
        // the sign-in screen that is the actual answer.
        (1..BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS).forEach { attempt ->
            assertFalse(
                BackendFailurePolicy.shouldRetry(attempt, "INVALID_REFRESH_TOKEN"),
                "auth errors must not be retried (attempt $attempt)",
            )
        }
    }

    @Test
    fun `the budget allows at least one retry`() {
        // Guards the constant itself. At zero the policy compiles, every test
        // above still passes on its own terms, and the defect is back.
        assertTrue(
            BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS >= 1,
            "a budget of ${BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS} retries fixes nothing",
        )
    }

    // ── delayBeforeAttemptMs: how long to wait ──

    @Test
    fun `each attempt waits longer than the last`() {
        val delays =
            (1..BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS).map {
                BackendFailurePolicy.delayBeforeAttemptMs(it)
            }
        assertEquals(delays.sorted(), delays, "backoff must not go backwards: $delays")
        assertTrue(delays.first() > 0, "the first retry must actually wait: $delays")
    }

    @Test
    fun `the whole budget costs under a second and a half`() {
        // "Retries are bounded and do not delay a successful start" — a first
        // call that succeeds waits not at all, and the worst case stays short
        // enough that somebody reads it as the app opening, not as a hang.
        val worstCase =
            (1..BackendFailurePolicy.TRANSIENT_RETRY_ATTEMPTS)
                .sumOf { BackendFailurePolicy.delayBeforeAttemptMs(it) }
        assertTrue(worstCase <= 1_500, "worst-case backoff was ${worstCase}ms")
    }
}
