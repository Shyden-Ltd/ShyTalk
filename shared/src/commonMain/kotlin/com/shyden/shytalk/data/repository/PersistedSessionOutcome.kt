package com.shyden.shytalk.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.withTimeoutOrNull

/** What a cold start learned from waiting for the auth SDK's persisted user. */
sealed interface PersistedSessionOutcome {
    /** Nothing said a user was persisted, so the launch did not wait. */
    data object NoneExpected : PersistedSessionOutcome

    /** The SDK reported its persisted user; the live uid can be read now. */
    data object Restored : PersistedSessionOutcome

    /** A user was expected, and the SDK had not reported one within the bound. */
    data class NotRestoredWithin(
        val timeoutMs: Long,
    ) : PersistedSessionOutcome
}

/**
 * SHY-0500 — waits for the auth SDK to report the user it persisted, when
 * there is reason to expect one.
 *
 * Firebase iOS loads its keychain user asynchronously and fires a freshly
 * added auth-state listener at once with whatever it holds — nil until that
 * load finishes. So the SDK's FIRST emission is not "the keychain load
 * finished", and a wait that returned on it read `currentUser == null`,
 * missed the identity cache keyed by that uid, and drew sign-in first for a
 * signed-in person (J40 on the iPhone, 2026-09-05).
 *
 * The only local sign that a user is coming is the identity cache's record
 * from the last signed-in session — [expectUser]. With it, hold for the
 * emission of [userIds] that carries a user, for at most [timeoutMs]; without
 * it, return at once, because a signed-out start must draw immediately. No
 * network is involved either way, and no launch can hang on this.
 */
suspend fun awaitRestoredUser(
    expectUser: Boolean,
    userIds: Flow<String?>,
    timeoutMs: Long,
): PersistedSessionOutcome {
    if (!expectUser) return PersistedSessionOutcome.NoneExpected
    val uid = withTimeoutOrNull(timeoutMs) { userIds.firstOrNull { !it.isNullOrBlank() } }
    return if (uid != null) PersistedSessionOutcome.Restored else PersistedSessionOutcome.NotRestoredWithin(timeoutMs)
}
