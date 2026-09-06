package com.shyden.shytalk.core.util

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0523 — on Kotlin/Native an uncaught coroutine exception aborts the
 * process. gitlive's `.snapshots` closes its Flow with the listener's
 * `FirebaseFirestoreException` (a rules denial after the session is revoked,
 * a network drop), so a collector without a `catch` took the iPhone down 218 ms
 * after the SESSION_EXPIRED redirect. [completeOnListenerError] is the guard
 * every iOS listener now goes through: it logs and completes instead.
 */
class ListenerFlowCompletionTest {
    private class SimulatedFatalError : Error("simulated fatal error")

    @Test
    fun `a listener error completes the flow after the values already emitted`() =
        runTest {
            val out =
                flow<Int> {
                    emit(1)
                    emit(2)
                    throw RuntimeException("PERMISSION_DENIED: false for 'get' @ L554")
                }.completeOnListenerError("ListenerFlowCompletionTest", "document config/economy").toList()
            assertEquals(listOf(1, 2), out)
        }

    @Test
    fun `a healthy flow passes through untouched`() =
        runTest {
            val out = flowOf(1, 2, 3).completeOnListenerError("ListenerFlowCompletionTest", "query").toList()
            assertEquals(listOf(1, 2, 3), out)
        }

    @Test
    fun `a fatal Error propagates rather than being swallowed`() =
        runTest {
            assertFailsWith<SimulatedFatalError> {
                flow<Int> { throw SimulatedFatalError() }
                    .completeOnListenerError("ListenerFlowCompletionTest", "document users/1")
                    .toList()
            }
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `cancellation propagates and is not converted into completion`() =
        runTest {
            val collected = mutableListOf<Int>()
            var completedNormally = false
            val job =
                launch {
                    flow {
                        emit(1)
                        awaitCancellation()
                    }.completeOnListenerError("ListenerFlowCompletionTest", "query").collect { collected.add(it) }
                    completedNormally = true
                }
            advanceUntilIdle()
            job.cancel()
            job.join()
            assertTrue(job.isCancelled)
            assertFalse(completedNormally, "cancellation was swallowed and the collector ran to completion")
            assertEquals(listOf(1), collected)
        }
}
