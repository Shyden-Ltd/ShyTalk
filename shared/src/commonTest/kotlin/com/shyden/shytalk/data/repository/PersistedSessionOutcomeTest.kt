package com.shyden.shytalk.data.repository

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * SHY-0500 — how a cold start waits for the auth SDK's persisted user.
 *
 * Firebase iOS loads its keychain user asynchronously and fires a freshly
 * added auth-state listener at once with whatever it holds — nil until that
 * load finishes. So the SDK's FIRST emission is not "the keychain load
 * finished": waiting for it returned before the restore, the identity cache
 * (keyed by the live uid) missed, and a signed-in person was drawn sign-in
 * first (J40 on the iPhone, 2026-09-05: `Cold-start identity cache miss`, then
 * `authenticated=true` 560 ms later).
 *
 * The only sign that a user is coming is local — the identity cache still
 * holds a record from the last signed-in session — so the wait is gated by it:
 * with a record, hold (bounded) for the emission that CARRIES a user; without
 * one, do not wait at all, because a signed-out start must draw at once.
 *
 * Virtual time throughout: `runTest` advances `delay` and `withTimeoutOrNull`
 * without waiting, and `currentTime` says how long the wait really held.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PersistedSessionOutcomeTest {
    private val bound = 1_500L

    @Test
    fun `without a record there is nothing to wait for, so a signed-out start does not`() =
        runTest {
            val sdkThatNeverAnswers = flow<String?> { awaitCancellation() }

            val started = currentTime
            val outcome = awaitRestoredUser(expectUser = false, userIds = sdkThatNeverAnswers, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.NoneExpected, outcome)
            assertEquals(0L, currentTime - started, "a signed-out start must not pay the bound")
        }

    @Test
    fun `the SDK's first emission is not the restore, so the wait holds for the user`() =
        runTest {
            // What the iPhone did: nil at once, the keychain user 560 ms later.
            val sdk =
                flow {
                    emit(null)
                    delay(560)
                    emit("fb-uid-1")
                }

            val started = currentTime
            val outcome = awaitRestoredUser(expectUser = true, userIds = sdk, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.Restored, outcome)
            assertEquals(560L, currentTime - started, "returning on the nil is the defect this wait exists to remove")
        }

    @Test
    fun `a user the SDK already holds when the listener attaches is reported at once`() =
        runTest {
            val sdk = flow<String?> { emit("fb-uid-1") }

            val started = currentTime
            val outcome = awaitRestoredUser(expectUser = true, userIds = sdk, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.Restored, outcome)
            assertEquals(0L, currentTime - started)
        }

    @Test
    fun `a blank uid is not a user`() =
        runTest {
            val sdk =
                flow {
                    emit("")
                    delay(10)
                    emit("fb-uid-1")
                }

            val started = currentTime
            val outcome = awaitRestoredUser(expectUser = true, userIds = sdk, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.Restored, outcome)
            assertEquals(10L, currentTime - started)
        }

    @Test
    fun `a record with no user behind it costs one bounded wait, never a hang`() =
        runTest {
            // A keychain wiped by hand, or an SDK that never answers: the
            // launch pays the bound once and decides on what it knows.
            val sdk =
                flow<String?> {
                    emit(null)
                    awaitCancellation()
                }

            val started = currentTime
            val outcome = awaitRestoredUser(expectUser = true, userIds = sdk, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.NotRestoredWithin(bound), outcome)
            assertEquals(bound, currentTime - started, "the bound is the whole cost")
        }

    @Test
    fun `an SDK flow that ends without a user reads as not restored, not as a crash`() =
        runTest {
            val sdk = flow<String?> { emit(null) }

            val outcome = awaitRestoredUser(expectUser = true, userIds = sdk, timeoutMs = bound)

            assertEquals(PersistedSessionOutcome.NotRestoredWithin(bound), outcome)
        }
}
