package com.shyden.shytalk.navigation

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0500 — the shell is drawn before the stored session is confirmed, so
 * the ORDER "claim refreshed before any cohort-scoped read" is no longer a
 * property of when the NavHost mounts. This gate is what keeps it: while a
 * restored session's refresh is in flight, a cohort-scoped read waits on it.
 * It holds nothing at any other time, so a fresh sign-in, a PIN unlock or an
 * offline launch never stall behind it (the SHY-0024 shape).
 */
class ColdStartClaimGateTest {
    @Test
    fun `at rest the gate is open, so nothing that never went through a cold start waits`() =
        runTest {
            val gate = ColdStartClaimGate()
            assertFalse(gate.refreshInFlight.value)
            gate.awaitSettled() // returns at once
        }

    @Test
    fun `a read started while the refresh is in flight waits until it settles`() =
        runTest {
            val gate = ColdStartClaimGate()
            gate.begin()
            assertTrue(gate.refreshInFlight.value)
            var proceeded = false
            val reader =
                async {
                    gate.awaitSettled()
                    proceeded = true
                }
            testScheduler.advanceUntilIdle()
            assertFalse(proceeded, "the read must not proceed while the claim is unconfirmed")
            gate.settle()
            reader.await()
            assertTrue(proceeded)
            assertFalse(gate.refreshInFlight.value)
        }

    @Test
    fun `settling twice, or without beginning, is harmless`() =
        runTest {
            val gate = ColdStartClaimGate()
            gate.settle()
            gate.settle()
            assertEquals(false, gate.refreshInFlight.value)
        }
}
