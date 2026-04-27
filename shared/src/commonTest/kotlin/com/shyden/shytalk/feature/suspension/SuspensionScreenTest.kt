package com.shyden.shytalk.feature.suspension

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SuspensionScreenTest {
    @Test
    fun `shouldShowReason - true when not expired and reason present`() {
        assertTrue(shouldShowReason(countdownExpired = false, reason = "Spam"))
    }

    @Test
    fun `shouldShowReason - false when expired even with reason`() {
        assertFalse(shouldShowReason(countdownExpired = true, reason = "Spam"))
    }

    @Test
    fun `shouldShowReason - false when not expired but reason null`() {
        assertFalse(shouldShowReason(countdownExpired = false, reason = null))
    }

    @Test
    fun `shouldShowReason - false when not expired but reason blank`() {
        assertFalse(shouldShowReason(countdownExpired = false, reason = ""))
    }

    @Test
    fun `shouldShowReason - false when not expired but reason whitespace only`() {
        assertFalse(shouldShowReason(countdownExpired = false, reason = "   "))
    }

    @Test
    fun `shouldShowReason - false when expired and reason null`() {
        assertFalse(shouldShowReason(countdownExpired = true, reason = null))
    }
}
