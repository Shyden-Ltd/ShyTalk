package com.shyden.shytalk.core.util

import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

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
}
