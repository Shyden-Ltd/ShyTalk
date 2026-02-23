package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class DateUtilsTest {

    // ===== calculateAge edge cases =====

    @Test
    fun `calculateAge with leap year birthday Feb 29`() {
        // Person born on Feb 29, 2000 (leap year)
        val birth = Calendar.getInstance().apply {
            set(2000, Calendar.FEBRUARY, 29, 0, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val age = calculateAge(birth.timeInMillis)
        val today = Calendar.getInstance()
        val expectedYear = today.get(Calendar.YEAR) - 2000
        val birthdayPassed = today.get(Calendar.MONTH) > Calendar.FEBRUARY ||
            (today.get(Calendar.MONTH) == Calendar.FEBRUARY && today.get(Calendar.DAY_OF_MONTH) >= 29)
        val expected = if (birthdayPassed) expectedYear else expectedYear - 1
        assertEquals(expected, age)
    }

    @Test
    fun `calculateAge with epoch zero returns age since 1970`() {
        // Epoch 0 = Jan 1, 1970 UTC
        val age = calculateAge(0L)
        val today = Calendar.getInstance()
        val expectedMin = today.get(Calendar.YEAR) - 1970 - 1 // could be -1 if before Jan 1
        val expectedMax = today.get(Calendar.YEAR) - 1970
        assertTrue("Age $age should be between $expectedMin and $expectedMax", age in expectedMin..expectedMax)
    }

    @Test
    fun `calculateAge with birthday exactly one year ago`() {
        val birth = Calendar.getInstance().apply {
            add(Calendar.YEAR, -1)
        }
        assertEquals(1, calculateAge(birth.timeInMillis))
    }

    @Test
    fun `calculateAge returns correct age for past birthday this year`() {
        val today = Calendar.getInstance()
        val birth = Calendar.getInstance().apply {
            set(Calendar.YEAR, today.get(Calendar.YEAR) - 25)
            set(Calendar.MONTH, Calendar.JANUARY)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        val age = calculateAge(birth.timeInMillis)
        // If today is after Jan 1, age is 25; if today IS Jan 1, still 25
        assertTrue(age >= 25)
    }

    @Test
    fun `calculateAge returns correct age for future birthday this year`() {
        val today = Calendar.getInstance()
        val birth = Calendar.getInstance().apply {
            set(Calendar.YEAR, today.get(Calendar.YEAR) - 20)
            set(Calendar.MONTH, Calendar.DECEMBER)
            set(Calendar.DAY_OF_MONTH, 31)
        }
        val age = calculateAge(birth.timeInMillis)
        // Birthday hasn't happened yet this year (unless today is Dec 31)
        if (today.get(Calendar.MONTH) == Calendar.DECEMBER && today.get(Calendar.DAY_OF_MONTH) == 31) {
            assertEquals(20, age)
        } else {
            assertEquals(19, age)
        }
    }

    @Test
    fun `calculateAge for today returns 0`() {
        val age = calculateAge(System.currentTimeMillis())
        assertEquals(0, age)
    }

    @Test
    fun `isAtLeast13 returns true for 13 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -13)
            add(Calendar.DAY_OF_YEAR, -1) // One day past 13th birthday
        }
        assertTrue(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns true for 25 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -25)
        }
        assertTrue(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns false for 12 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -12)
        }
        assertFalse(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns false for baby`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -1)
        }
        assertFalse(isAtLeast13(cal.timeInMillis))
    }

    // ===== formatRelativeTime =====

    @Test
    fun `formatRelativeTime - just now for less than 1 minute ago`() {
        val ts = System.currentTimeMillis() - 30_000L // 30 seconds ago
        assertEquals("just now", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular minute`() {
        val ts = System.currentTimeMillis() - 90_000L // 1.5 minutes ago
        assertEquals("1 min ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural minutes`() {
        val ts = System.currentTimeMillis() - 5 * 60_000L // 5 minutes ago
        assertEquals("5 mins ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular hour`() {
        val ts = System.currentTimeMillis() - 90 * 60_000L // 1.5 hours ago
        assertEquals("1 hour ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural hours`() {
        val ts = System.currentTimeMillis() - 5 * 3600_000L // 5 hours ago
        assertEquals("5 hours ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular day`() {
        val ts = System.currentTimeMillis() - 36 * 3600_000L // 1.5 days ago
        assertEquals("1 day ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural days`() {
        val ts = System.currentTimeMillis() - 3 * 24 * 3600_000L // 3 days ago
        assertEquals("3 days ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - future timestamp returns just now`() {
        val ts = System.currentTimeMillis() + 60_000L // 1 minute in the future
        assertEquals("just now", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - exactly 1 minute ago`() {
        val ts = System.currentTimeMillis() - 60_000L // exactly 60 seconds ago
        assertEquals("1 min ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - exactly 1 hour ago`() {
        val ts = System.currentTimeMillis() - 3_600_000L // exactly 60 minutes ago
        assertEquals("1 hour ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - exactly 1 day ago`() {
        val ts = System.currentTimeMillis() - 86_400_000L // exactly 24 hours ago
        assertEquals("1 day ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - zero timestamp is distant past`() {
        val result = formatRelativeTime(0L)
        // Epoch 0 = 1970, should show many days ago
        assertTrue("Expected days ago, got: $result", result.endsWith("days ago"))
    }

    @Test
    fun `formatRelativeTime - just under 1 minute is just now`() {
        val ts = System.currentTimeMillis() - 59_999L // 59.999 seconds ago
        assertEquals("just now", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - 59 minutes ago is plural minutes`() {
        val ts = System.currentTimeMillis() - 59 * 60_000L
        assertEquals("59 mins ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - 23 hours ago is plural hours`() {
        val ts = System.currentTimeMillis() - 23 * 3_600_000L
        assertEquals("23 hours ago", formatRelativeTime(ts))
    }

    // ===== formatSuspensionEnd =====

    @Test
    fun `formatSuspensionEnd - past date returns Expired`() {
        val pastMs = System.currentTimeMillis() - 60_000L // 1 minute ago
        assertEquals("Expired", formatSuspensionEnd(pastMs))
    }

    @Test
    fun `formatSuspensionEnd - less than 1 minute remaining`() {
        val nearFuture = System.currentTimeMillis() + 30_000L // 30 seconds from now
        assertEquals("Less than 1 minute", formatSuspensionEnd(nearFuture))
    }

    @Test
    fun `formatSuspensionEnd - future date returns days hours minutes breakdown`() {
        // 2 days, 3 hours, 15 minutes from now
        val futureMs = System.currentTimeMillis() +
            (2 * 24 * 60 * 60_000L) + (3 * 60 * 60_000L) + (15 * 60_000L)
        val result = formatSuspensionEnd(futureMs)
        assertTrue(result.contains("2 days"))
        assertTrue(result.contains("3 hours"))
        assertTrue(result.contains("15 minutes"))
    }

    @Test
    fun `formatSuspensionEnd - exactly 1 day uses singular`() {
        val futureMs = System.currentTimeMillis() + (1 * 24 * 60 * 60_000L)
        val result = formatSuspensionEnd(futureMs)
        assertTrue(result.contains("1 day"))
        assertFalse(result.contains("1 days"))
    }

    @Test
    fun `formatSuspensionEnd - exactly 1 hour uses singular`() {
        val futureMs = System.currentTimeMillis() + (1 * 60 * 60_000L)
        val result = formatSuspensionEnd(futureMs)
        assertTrue(result.contains("1 hour"))
        assertFalse(result.contains("1 hours"))
    }

    @Test
    fun `formatSuspensionEnd - exactly 1 minute uses singular`() {
        val futureMs = System.currentTimeMillis() + (1 * 60_000L) + 30_000L // 1 min 30 sec
        val result = formatSuspensionEnd(futureMs)
        assertTrue(result.contains("1 minute"))
        assertFalse(result.contains("1 minutes"))
    }

    // ===== formatSuspensionEndDateTime =====

    @Test
    fun `formatSuspensionEndDateTime - returns formatted date time string`() {
        // Use a known timestamp: Jan 15, 2025 14:30 UTC
        // The exact output depends on the local timezone, so just verify the format pattern
        val ts = 1736951400000L // Jan 15, 2025 14:30 UTC
        val result = formatSuspensionEndDateTime(ts)
        // Should contain "Jan" or month abbreviation, a year, and "at" with time
        assertTrue("Result should contain 'at' separator: $result", result.contains("at"))
        assertTrue("Result should contain year: $result", result.contains("2025"))
    }

    // ===== formatDateForDisplay =====

    @Test
    fun `formatDateForDisplay - returns formatted date string`() {
        // Use a known timestamp: Jan 15, 2025 UTC
        val ts = 1736951400000L // Jan 15, 2025
        val result = formatDateForDisplay(ts)
        // Should contain year and a month abbreviation
        assertTrue("Result should contain year: $result", result.contains("2025"))
        assertTrue("Result should contain 'Jan': $result", result.contains("Jan"))
    }

    @Test
    fun `formatDateForDisplay - pads single-digit days`() {
        // Use a known date early in month: Jan 5, 2025 UTC
        val cal = Calendar.getInstance().apply {
            set(2025, Calendar.JANUARY, 5, 12, 0, 0)
        }
        val result = formatDateForDisplay(cal.timeInMillis)
        assertTrue("Result should contain padded day '05': $result", result.contains("05"))
    }

    // ===== formatSuspensionEnd additional edge cases =====

    @Test
    fun `formatSuspensionEnd - epoch zero returns Expired`() {
        assertEquals("Expired", formatSuspensionEnd(0L))
    }

    @Test
    fun `formatSuspensionEnd - exactly now returns Expired`() {
        assertEquals("Expired", formatSuspensionEnd(System.currentTimeMillis()))
    }

    @Test
    fun `formatSuspensionEnd - hours only no days no minutes`() {
        // 3 hours from now exactly
        val futureMs = System.currentTimeMillis() + 3 * 60 * 60_000L
        val result = formatSuspensionEnd(futureMs)
        assertTrue("Expected '3 hours': $result", result.contains("3 hours"))
        assertFalse("Should not contain 'day': $result", result.contains("day"))
    }

    @Test
    fun `formatSuspensionEnd - minutes only no days no hours`() {
        // 45 minutes from now
        val futureMs = System.currentTimeMillis() + 45 * 60_000L
        val result = formatSuspensionEnd(futureMs)
        assertTrue("Expected '45 minutes': $result", result.contains("45 minutes"))
        assertFalse("Should not contain 'hour': $result", result.contains("hour"))
        assertFalse("Should not contain 'day': $result", result.contains("day"))
    }

    // ===== formatSuspensionEndDateTime additional edge cases =====

    @Test
    fun `formatSuspensionEndDateTime - epoch zero formats to 1970`() {
        // Epoch 0 in local timezone - year should be 1970 (or possibly Dec 31 1969 in west timezones)
        val result = formatSuspensionEndDateTime(0L)
        assertTrue("Should contain 'at': $result", result.contains("at"))
        // Should be a valid-looking date string
        assertTrue(
            "Should contain 1969 or 1970: $result",
            result.contains("1970") || result.contains("1969")
        )
    }

    @Test
    fun `formatSuspensionEndDateTime - midnight formats hours as 00 00`() {
        // Find a timestamp that represents midnight in the local timezone
        val cal = Calendar.getInstance().apply {
            set(2025, Calendar.JUNE, 15, 0, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val result = formatSuspensionEndDateTime(cal.timeInMillis)
        assertTrue("Expected 'Jun': $result", result.contains("Jun"))
        assertTrue("Expected '2025': $result", result.contains("2025"))
        assertTrue("Expected '00:00': $result", result.contains("00:00"))
    }

    // ===== formatDateForDisplay additional edge cases =====

    @Test
    fun `formatDateForDisplay - epoch zero formats to 1970`() {
        val result = formatDateForDisplay(0L)
        assertTrue(
            "Should contain 1969 or 1970: $result",
            result.contains("1970") || result.contains("1969")
        )
    }

    @Test
    fun `formatDateForDisplay - double digit day is not padded extra`() {
        val cal = Calendar.getInstance().apply {
            set(2025, Calendar.MARCH, 25, 12, 0, 0)
        }
        val result = formatDateForDisplay(cal.timeInMillis)
        assertTrue("Expected 'Mar 25, 2025': $result", result.contains("Mar 25, 2025"))
    }

    // ===== isAtLeast13 additional edge cases =====

    @Test
    fun `isAtLeast13 returns true for exactly 13th birthday`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -13)
        }
        // On exactly the 13th birthday, calculateAge returns 13
        assertTrue(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns false for one day before 13th birthday`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -13)
            add(Calendar.DAY_OF_YEAR, 1) // born one day later -> hasn't turned 13 yet
        }
        assertFalse(isAtLeast13(cal.timeInMillis))
    }
}
