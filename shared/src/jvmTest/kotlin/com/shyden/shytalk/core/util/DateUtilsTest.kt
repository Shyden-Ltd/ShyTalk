package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DateUtilsTest {
    // ── formatRelativeTime ──────────────────────────────────────────

    @Test
    fun `formatRelativeTime shows just now for current timestamp`() {
        val now = currentTimeMillis()
        assertEquals("just now", formatRelativeTime(now))
    }

    @Test
    fun `formatRelativeTime shows just now for timestamp less than 1 minute ago`() {
        val thirtySecsAgo = currentTimeMillis() - 30_000
        assertEquals("just now", formatRelativeTime(thirtySecsAgo))
    }

    @Test
    fun `formatRelativeTime shows minutes for 1 minute ago`() {
        val oneMinAgo = currentTimeMillis() - 60_000
        assertEquals("1 min ago", formatRelativeTime(oneMinAgo))
    }

    @Test
    fun `formatRelativeTime shows minutes plural for 5 minutes ago`() {
        val fiveMinAgo = currentTimeMillis() - 5 * 60_000
        assertEquals("5 mins ago", formatRelativeTime(fiveMinAgo))
    }

    @Test
    fun `formatRelativeTime shows minutes for 59 minutes ago`() {
        val fiftyNineMinAgo = currentTimeMillis() - 59 * 60_000
        assertEquals("59 mins ago", formatRelativeTime(fiftyNineMinAgo))
    }

    @Test
    fun `formatRelativeTime shows 1 hour for 60 minutes ago`() {
        val oneHourAgo = currentTimeMillis() - 60 * 60_000
        assertEquals("1 hour ago", formatRelativeTime(oneHourAgo))
    }

    @Test
    fun `formatRelativeTime shows hours plural for 3 hours ago`() {
        val threeHoursAgo = currentTimeMillis() - 3 * 60 * 60_000
        assertEquals("3 hours ago", formatRelativeTime(threeHoursAgo))
    }

    @Test
    fun `formatRelativeTime shows hours for 23 hours ago`() {
        val twentyThreeHoursAgo = currentTimeMillis() - 23 * 60 * 60_000
        assertEquals("23 hours ago", formatRelativeTime(twentyThreeHoursAgo))
    }

    @Test
    fun `formatRelativeTime shows 1 day for 24 hours ago`() {
        val oneDayAgo = currentTimeMillis() - 24 * 60 * 60_000
        assertEquals("1 day ago", formatRelativeTime(oneDayAgo))
    }

    @Test
    fun `formatRelativeTime shows days plural for 5 days ago`() {
        val fiveDaysAgo = currentTimeMillis() - 5 * 24 * 60 * 60_000L
        assertEquals("5 days ago", formatRelativeTime(fiveDaysAgo))
    }

    @Test
    fun `formatRelativeTime shows days for 30 days ago`() {
        val thirtyDaysAgo = currentTimeMillis() - 30L * 24 * 60 * 60_000
        assertEquals("30 days ago", formatRelativeTime(thirtyDaysAgo))
    }

    @Test
    fun `formatRelativeTime uses custom strings`() {
        val now = currentTimeMillis()
        val strings = RelativeTimeStrings(justNow = "NOW!")
        assertEquals("NOW!", formatRelativeTime(now, strings))
    }

    @Test
    fun `formatRelativeTime uses custom minutesAgo string`() {
        val twoMinAgo = currentTimeMillis() - 2 * 60_000
        val strings = RelativeTimeStrings(minutesAgo = { m -> "${m}m" })
        assertEquals("2m", formatRelativeTime(twoMinAgo, strings))
    }

    @Test
    fun `formatRelativeTime uses custom hoursAgo string`() {
        val twoHoursAgo = currentTimeMillis() - 2 * 60 * 60_000
        val strings = RelativeTimeStrings(hoursAgo = { h -> "${h}h" })
        assertEquals("2h", formatRelativeTime(twoHoursAgo, strings))
    }

    @Test
    fun `formatRelativeTime uses custom daysAgo string`() {
        val twoDaysAgo = currentTimeMillis() - 2L * 24 * 60 * 60_000
        val strings = RelativeTimeStrings(daysAgo = { d -> "${d}d" })
        assertEquals("2d", formatRelativeTime(twoDaysAgo, strings))
    }

    // ── formatSuspensionEnd ─────────────────────────────────────────

    @Test
    fun `formatSuspensionEnd shows Expired for past timestamp`() {
        val past = currentTimeMillis() - 1000
        assertEquals("Expired", formatSuspensionEnd(past))
    }

    @Test
    fun `formatSuspensionEnd shows Expired for exactly now`() {
        // endDateMillis = currentTimeMillis(), remaining <= 0
        val now = currentTimeMillis()
        assertEquals("Expired", formatSuspensionEnd(now))
    }

    @Test
    fun `formatSuspensionEnd shows minutes for near future`() {
        val fiveMinFuture = currentTimeMillis() + 5 * 60_000 + 1000 // +1s buffer
        val result = formatSuspensionEnd(fiveMinFuture)
        assertTrue(result.contains("minute"), "Expected minutes, got: $result")
    }

    @Test
    fun `formatSuspensionEnd shows hours and minutes`() {
        val twoHours30Min = currentTimeMillis() + (2 * 60 + 30) * 60_000L + 1000
        val result = formatSuspensionEnd(twoHours30Min)
        assertTrue(result.contains("hour"), "Expected hours, got: $result")
        assertTrue(result.contains("minute"), "Expected minutes, got: $result")
    }

    @Test
    fun `formatSuspensionEnd shows days for long duration`() {
        val threeDays = currentTimeMillis() + 3L * 24 * 60 * 60_000 + 1000
        val result = formatSuspensionEnd(threeDays)
        assertTrue(result.contains("day"), "Expected days, got: $result")
    }

    @Test
    fun `formatSuspensionEnd shows singular day`() {
        val oneDay = currentTimeMillis() + 1L * 24 * 60 * 60_000 + 1000
        val result = formatSuspensionEnd(oneDay)
        assertTrue(result.contains("1 day"), "Expected '1 day', got: $result")
    }

    @Test
    fun `formatSuspensionEnd shows Less than 1 minute for very near future`() {
        val nearFuture = currentTimeMillis() + 30_000 // 30 seconds
        val result = formatSuspensionEnd(nearFuture)
        assertEquals("Less than 1 minute", result)
    }

    @Test
    fun `formatSuspensionEnd uses custom strings`() {
        val past = currentTimeMillis() - 1000
        val strings = SuspensionTimeStrings(expired = "DONE")
        assertEquals("DONE", formatSuspensionEnd(past, strings))
    }

    @Test
    fun `formatSuspensionEnd uses custom lessThanMinute`() {
        val nearFuture = currentTimeMillis() + 30_000
        val strings = SuspensionTimeStrings(lessThanMinute = "<1m")
        assertEquals("<1m", formatSuspensionEnd(nearFuture, strings))
    }

    @Test
    fun `formatSuspensionEnd singular forms`() {
        // Exactly 1 hour and 1 minute from now
        val oneHourOneMin = currentTimeMillis() + (61) * 60_000L + 1000
        val result = formatSuspensionEnd(oneHourOneMin)
        assertTrue(result.contains("1 hour"), "Expected '1 hour', got: $result")
        assertTrue(result.contains("1 minute"), "Expected '1 minute', got: $result")
    }

    // ── formatSuspensionEndDateTime ─────────────────────────────────

    @Test
    fun `formatSuspensionEndDateTime returns formatted date string`() {
        // Fixed timestamp: Jan 15, 2024 at 14:30 UTC
        val timestamp = 1705326600000L
        val result = formatSuspensionEndDateTime(timestamp)
        // Should contain month abbreviation, day, year, and time
        assertTrue(result.contains("Jan") || result.contains("2024"), "Expected date format, got: $result")
        assertTrue(result.contains("at"), "Expected 'at' separator, got: $result")
    }

    @Test
    fun `formatSuspensionEndDateTime contains colon in time`() {
        val timestamp = 1705326600000L
        val result = formatSuspensionEndDateTime(timestamp)
        assertTrue(result.contains(":"), "Expected colon in time, got: $result")
    }

    // ── formatDateForDisplay ────────────────────────────────────────

    @Test
    fun `formatDateForDisplay returns formatted date string`() {
        // Fixed timestamp: Jan 15, 2024 in UTC
        val timestamp = 1705326600000L
        val result = formatDateForDisplay(timestamp)
        assertTrue(result.contains("2024"), "Expected year 2024, got: $result")
    }

    @Test
    fun `formatDateForDisplay contains comma`() {
        val timestamp = 1705326600000L
        val result = formatDateForDisplay(timestamp)
        assertTrue(result.contains(","), "Expected comma in date format, got: $result")
    }

    @Test
    fun `formatDateForDisplay day is zero-padded`() {
        // Pick a date where day is single digit
        // Jan 5, 2024: timestamp approx 1704412800000
        val jan5 = 1704412800000L
        val result = formatDateForDisplay(jan5)
        // Day should be zero-padded: "05"
        assertTrue(
            result.contains("05") || result.contains("04") || result.contains("06"),
            "Expected zero-padded day, got: $result",
        )
    }

    // ── calculateAge ────────────────────────────────────────────────

    @Test
    fun `calculateAge for very old date returns large number`() {
        // Jan 1, 1990 in millis
        val dob = 631152000000L
        val age = calculateAge(dob)
        assertTrue(age >= 35, "Expected age >= 35 for 1990 birth, got: $age")
    }

    @Test
    fun `calculateAge for recent date returns small number`() {
        // Approximately 10 years ago
        val tenYearsAgo = currentTimeMillis() - 10L * 365 * 24 * 60 * 60 * 1000
        val age = calculateAge(tenYearsAgo)
        assertTrue(age in 9..11, "Expected age ~10 for 10 years ago birth, got: $age")
    }

    @Test
    fun `calculateAge returns 0 for today`() {
        val today = currentTimeMillis()
        val age = calculateAge(today)
        assertEquals(0, age)
    }

    @Test
    fun `calculateAge returns non-negative`() {
        val recentBirth = currentTimeMillis() - 1000 // 1 second ago
        val age = calculateAge(recentBirth)
        assertTrue(age >= 0, "Age should be non-negative, got: $age")
    }

    // ── isAtLeast13 ─────────────────────────────────────────────────

    @Test
    fun `isAtLeast13 returns true for 18 year old`() {
        val eighteenYearsAgo = currentTimeMillis() - 18L * 365 * 24 * 60 * 60 * 1000
        assertTrue(isAtLeast13(eighteenYearsAgo))
    }

    @Test
    fun `isAtLeast13 returns true for 13 year old`() {
        // 13 years and some extra days to be safe
        val thirteenYearsAgo = currentTimeMillis() - (13L * 365 + 30) * 24 * 60 * 60 * 1000
        assertTrue(isAtLeast13(thirteenYearsAgo))
    }

    @Test
    fun `isAtLeast13 returns false for 10 year old`() {
        val tenYearsAgo = currentTimeMillis() - 10L * 365 * 24 * 60 * 60 * 1000
        assertFalse(isAtLeast13(tenYearsAgo))
    }

    @Test
    fun `isAtLeast13 returns false for 1 year old`() {
        val oneYearAgo = currentTimeMillis() - 1L * 365 * 24 * 60 * 60 * 1000
        assertFalse(isAtLeast13(oneYearAgo))
    }

    @Test
    fun `isAtLeast13 returns true for very old date`() {
        // Jan 1, 1980
        val oldDate = 315532800000L
        assertTrue(isAtLeast13(oldDate))
    }

    @Test
    fun `isAtLeast13 returns false for current time`() {
        assertFalse(isAtLeast13(currentTimeMillis()))
    }

    // ── RelativeTimeStrings defaults ────────────────────────────────

    @Test
    fun `RelativeTimeStrings default justNow`() {
        val strings = RelativeTimeStrings()
        assertEquals("just now", strings.justNow)
    }

    @Test
    fun `RelativeTimeStrings singular minute`() {
        val strings = RelativeTimeStrings()
        assertEquals("1 min ago", strings.minutesAgo(1))
    }

    @Test
    fun `RelativeTimeStrings plural minutes`() {
        val strings = RelativeTimeStrings()
        assertEquals("5 mins ago", strings.minutesAgo(5))
    }

    @Test
    fun `RelativeTimeStrings singular hour`() {
        val strings = RelativeTimeStrings()
        assertEquals("1 hour ago", strings.hoursAgo(1))
    }

    @Test
    fun `RelativeTimeStrings plural hours`() {
        val strings = RelativeTimeStrings()
        assertEquals("3 hours ago", strings.hoursAgo(3))
    }

    @Test
    fun `RelativeTimeStrings singular day`() {
        val strings = RelativeTimeStrings()
        assertEquals("1 day ago", strings.daysAgo(1))
    }

    @Test
    fun `RelativeTimeStrings plural days`() {
        val strings = RelativeTimeStrings()
        assertEquals("7 days ago", strings.daysAgo(7))
    }

    // ── SuspensionTimeStrings defaults ──────────────────────────────

    @Test
    fun `SuspensionTimeStrings default expired`() {
        val strings = SuspensionTimeStrings()
        assertEquals("Expired", strings.expired)
    }

    @Test
    fun `SuspensionTimeStrings default lessThanMinute`() {
        val strings = SuspensionTimeStrings()
        assertEquals("Less than 1 minute", strings.lessThanMinute)
    }

    @Test
    fun `SuspensionTimeStrings singular day`() {
        val strings = SuspensionTimeStrings()
        assertEquals("1 day", strings.days(1))
    }

    @Test
    fun `SuspensionTimeStrings plural days`() {
        val strings = SuspensionTimeStrings()
        assertEquals("3 days", strings.days(3))
    }

    @Test
    fun `SuspensionTimeStrings singular hour`() {
        val strings = SuspensionTimeStrings()
        assertEquals("1 hour", strings.hours(1))
    }

    @Test
    fun `SuspensionTimeStrings plural hours`() {
        val strings = SuspensionTimeStrings()
        assertEquals("5 hours", strings.hours(5))
    }

    @Test
    fun `SuspensionTimeStrings singular minute`() {
        val strings = SuspensionTimeStrings()
        assertEquals("1 minute", strings.minutes(1))
    }

    @Test
    fun `SuspensionTimeStrings plural minutes`() {
        val strings = SuspensionTimeStrings()
        assertEquals("10 minutes", strings.minutes(10))
    }
}
