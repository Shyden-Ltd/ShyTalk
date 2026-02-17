package com.shyden.shytalk.feature.suspension

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SuspensionScreenTest {

    // ===== suspensionTitle =====

    @Test
    fun `suspensionTitle - shows Account Unlocked when countdown expired`() {
        assertEquals("Account Unlocked", suspensionTitle(countdownExpired = true))
    }

    @Test
    fun `suspensionTitle - shows Account Suspended when countdown not expired`() {
        assertEquals("Account Suspended", suspensionTitle(countdownExpired = false))
    }

    // ===== shouldShowReason =====

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
