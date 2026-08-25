package com.shyden.shytalk.feature.auth

/**
 * Two decisions about a failed backend call: whether it means the SESSION is
 * bad or the NETWORK is, and whether it is worth asking again (SHY-0442).
 *
 * Pure and separate from `AuthViewModel` so both can be pinned without
 * standing a ViewModel and five repositories up — the same reasoning as
 * `WatermarkFormat`. It is also the single place the auth-error shapes are
 * listed: they used to live inline in `handleBackendError`, and a retry that
 * classified failures its own way would eventually disagree with the handler
 * about the same message.
 *
 * ## Why the retry exists
 *
 * Filmed on a real iPhone on 2026-08-22 (journey J38): for the first ~20
 * seconds after launch the app showed a full-screen "Unable to Connect —
 * ShyTalk is having trouble reaching our servers. Please check your internet
 * connection", against a stack that was up. The same walk then signed in and
 * raised tickets against that stack.
 *
 * `handleBackendError` sent EVERY non-auth failure straight to
 * `isBackendUnreachable`, and nothing retried before it. One connection reset
 * before the network settles after launch — landing on identity resolution,
 * the very first request the app makes — produced exactly that screen, for as
 * long as nobody pressed Retry. It cleared on relaunch because the second
 * launch's first call succeeded.
 *
 * The budget is deliberately small. Retrying for ever would trade a wrong
 * error screen for an endless spinner, which is worse — an error screen at
 * least tells somebody something.
 */
object BackendFailurePolicy {
    /**
     * Extra attempts after the first, for a failure that looks transient.
     * Two gives three tries in total.
     */
    const val TRANSIENT_RETRY_ATTEMPTS: Int = 2

    /** Backoff before the first retry; later ones scale from it. */
    const val RETRY_BASE_DELAY_MS: Long = 400L

    /**
     * `\b401\b`, not `401`. A connection error naming an IPv6 host such as
     * `2401:db8::1`, or a port like `14012`, must not read as an HTTP 401 and
     * sign somebody out over a network blip.
     */
    private val AUTH_401_REGEX = Regex("\\b401\\b")

    private val AUTH_ERROR_SUBSTRINGS =
        listOf(
            "Not authenticated",
            "Token refresh",
            "INVALID_REFRESH_TOKEN",
            "UNAUTHENTICATED",
        )

    /**
     * True when the message says the session is no longer good — which is
     * answered by signing in again, not by trying again.
     *
     * Substring matching on free-form text is fragile; prefer migrating
     * producers to typed error codes over lengthening this list.
     */
    fun isAuthError(message: String?): Boolean {
        val text = message.orEmpty()
        if (text.isBlank()) return false
        return AUTH_ERROR_SUBSTRINGS.any { text.contains(it, ignoreCase = true) } ||
            AUTH_401_REGEX.containsMatchIn(text)
    }

    /**
     * Whether a failure carrying [message] deserves attempt number [attempt]
     * (1-based, counting only the retries).
     *
     * An auth error is never retried: the same rejected token fails the same
     * way, and every retry postpones the sign-in screen that is the answer.
     */
    fun shouldRetry(
        attempt: Int,
        message: String?,
    ): Boolean = attempt in 1..TRANSIENT_RETRY_ATTEMPTS && !isAuthError(message)

    /**
     * How long to wait before retry number [attempt] (1-based).
     *
     * Linear rather than exponential: the whole budget has to stay inside the
     * moment somebody reads as "the app is opening". A first call that
     * succeeds waits not at all.
     */
    fun delayBeforeAttemptMs(attempt: Int): Long = RETRY_BASE_DELAY_MS * attempt.coerceAtLeast(1)
}
