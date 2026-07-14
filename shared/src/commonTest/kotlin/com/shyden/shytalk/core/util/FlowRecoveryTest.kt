package com.shyden.shytalk.core.util

import com.shyden.shytalk.data.repository.UserFlags
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * SHY-0185 — a realtime-listener Flow that errors (gitlive Firestore `.snapshots`
 * emitting a FirebaseFirestoreException on a rules-denial / network drop) must
 * NOT crash the app; [recoverListenerErrors] recovers it to a safe fallback.
 * Verifies the recovery operator directly (the iOS impl that consumes it is
 * device-gauntlet-verified — see the story Test Plan).
 */
class FlowRecoveryTest {
    @Test
    fun `a flow that errors recovers to the fallback instead of throwing`() =
        runTest {
            val out =
                flow<Int> {
                    emit(1)
                    throw RuntimeException("simulated listener error")
                }.recoverListenerErrors(99).toList()
            // The value emitted before the error survives; the error is REPLACED by the fallback.
            assertEquals(listOf(1, 99), out)
        }

    @Test
    fun `a healthy flow passes through untouched`() =
        runTest {
            val out = flowOf(1, 2, 3).recoverListenerErrors(99).toList()
            assertEquals(listOf(1, 2, 3), out)
        }

    @Test
    fun `a flow that errors on the very first term recovers to the single fallback`() =
        runTest {
            val out =
                flow<Int> {
                    throw RuntimeException("error before any emission")
                }.recoverListenerErrors(42).toList()
            assertEquals(listOf(42), out)
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `cancellation propagates uncaught and does NOT receive the fallback structured concurrency`() =
        runTest {
            // Swallowing CancellationException would break coroutine cancellation
            // propagation — a scope canceller would never get its cancel signal.
            // Guards against a future refactor to a bare catch(e: Exception){emit}.
            val collected = mutableListOf<Int>()
            val job =
                launch {
                    flow {
                        emit(1)
                        awaitCancellation()
                    }.recoverListenerErrors(99).collect { collected.add(it) }
                }
            advanceUntilIdle()
            job.cancel()
            job.join()
            assertTrue(job.isCancelled)
            assertEquals(listOf(1), collected) // the fallback (99) must NOT be appended
        }

    @Test
    fun `a fatal Error propagates uncaught rather than being masked as the fallback`() =
        runTest {
            // Parity with firebaseCall's boundary: OOM / StackOverflow are genuinely
            // unrecoverable and must crash the coroutine, not become a safe default.
            assertFailsWith<OutOfMemoryError> {
                flow<Int> {
                    throw OutOfMemoryError("simulated fatal")
                }.recoverListenerErrors(99).toList()
            }
        }

    @Test
    fun `the UserFlags fallback is the SAFE default state Security AC`() =
        runTest {
            // The observeUserFlags fix recovers to UserFlags(); a read error must
            // NOT lock a user out or fabricate a warning. Pin that contract here.
            val out =
                flow<UserFlags> {
                    throw RuntimeException("listener error")
                }.recoverListenerErrors(UserFlags()).toList()
            assertEquals(1, out.size)
            val flags = out.single()
            assertEquals(false, flags.isSuspended)
            assertEquals(null, flags.suspensionEndDate)
            assertEquals(false, flags.hasActiveWarning)
            assertEquals(null, flags.warningReason)
        }
}
