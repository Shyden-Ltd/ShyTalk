package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Instant

/**
 * Tests for [deriveCohort] — the predicate that maps a UTC date-of-birth
 * to the segregation cohort tag ("minor" | "adult"). Spec:
 * `.project/plans/2026-05-13-age-segregation-design.md`.
 *
 * Boundary cases covered:
 * - DOB null -> "minor" (most-restrictive default)
 * - Exact 18th birthday in UTC -> "adult"
 * - Day before 18th birthday -> "minor"
 * - Leap-year DOB (Feb 29) -> "minor" on Feb 28 of the non-leap 18th year,
 *   "adult" on Mar 1 (strict convention; matches UK legal default and
 *   OSA "most-restrictive when ambiguous" posture)
 * - 19+ years old -> "adult"
 * - 16-17 years old -> "minor"
 */
class CohortUtilTest {
    private val dayMs = 24L * 60 * 60 * 1000

    /** Build a UTC start-of-day epoch-ms anchor from a Y-M-D triple. */
    private fun utcMs(
        year: Int,
        month: Int, // 1-12
        day: Int,
    ): Long {
        // ISO-8601 string -> kotlin.time.Instant -> ms.
        // Pure-stdlib path avoids any kotlinx-datetime API drift.
        val mm = month.toString().padStart(2, '0')
        val dd = day.toString().padStart(2, '0')
        return Instant.parse("$year-$mm-${dd}T00:00:00Z").toEpochMilliseconds()
    }

    @Test
    fun `adult when DOB is 19 years ago in UTC`() {
        val now = utcMs(2026, 1, 15)
        val dob = utcMs(2007, 1, 15)
        assertEquals("adult", deriveCohort(dob, now))
    }

    @Test
    fun `minor when DOB is 16 years ago in UTC`() {
        val now = utcMs(2026, 1, 15)
        val dob = utcMs(2010, 1, 15)
        assertEquals("minor", deriveCohort(dob, now))
    }

    @Test
    fun `minor when DOB is 17 years ago and 1 day`() {
        val now = utcMs(2026, 1, 15)
        val dob = utcMs(2009, 1, 14) // 17y + 1 day
        assertEquals("minor", deriveCohort(dob, now))
    }

    @Test
    fun `adult on exact 18th birthday in UTC`() {
        val dob = utcMs(2008, 1, 15)
        val nowAt18th = utcMs(2026, 1, 15)
        assertEquals("adult", deriveCohort(dob, nowAt18th))
    }

    @Test
    fun `minor on day before 18th birthday`() {
        val dob = utcMs(2008, 1, 15)
        val nowDayBefore = utcMs(2026, 1, 15) - dayMs
        assertEquals("minor", deriveCohort(dob, nowDayBefore))
    }

    @Test
    fun `adult one day after 18th birthday`() {
        val dob = utcMs(2008, 1, 15)
        val nowDayAfter = utcMs(2026, 1, 16)
        assertEquals("adult", deriveCohort(dob, nowDayAfter))
    }

    @Test
    fun `leap-year DOB Feb 29 is minor on Feb 28 of 18th non-leap year`() {
        // Born 2004-02-29. 18th anniversary in 2022 (non-leap year).
        // Strict convention: still minor on Feb 28; turns adult on Mar 1.
        // Matches UK legal default. OSA-safer than the lenient convention.
        val dob = utcMs(2004, 2, 29)
        val nowFeb28In2022 = utcMs(2022, 2, 28)
        assertEquals("minor", deriveCohort(dob, nowFeb28In2022))
    }

    @Test
    fun `leap-year DOB Feb 29 is adult on Mar 1 of 18th non-leap year`() {
        val dob = utcMs(2004, 2, 29)
        val nowMar1In2022 = utcMs(2022, 3, 1)
        assertEquals("adult", deriveCohort(dob, nowMar1In2022))
    }

    @Test
    fun `leap-year DOB Feb 29 is adult on Feb 29 of 18th leap year`() {
        // Born 2004-02-29. 22 years later (2026) is also non-leap, but
        // 2008+16=2024 would be a leap year. Sanity-check that on the
        // exact leap-day anniversary, the user is treated as adult.
        // Use 2020 (leap) as 16th birthday anniversary for the test —
        // but we need 18th, so 2022 (non-leap, tested above) is the
        // first 18th anniversary they actually experience.
        // This test verifies that an EARLIER leap year is correctly
        // handled: on Feb 29 of a leap year that is the user's actual
        // age >= 18 anniversary, they are adult.
        val dob = utcMs(1996, 2, 29)
        val nowFeb29In2024 = utcMs(2024, 2, 29) // user is 28y, leap day
        assertEquals("adult", deriveCohort(dob, nowFeb29In2024))
    }

    @Test
    fun `minor when DOB is null`() {
        // Null DOB defaults to most-restrictive cohort.
        assertEquals("minor", deriveCohort(null, utcMs(2026, 1, 15)))
    }

    @Test
    fun `minor immediately before birthday month`() {
        // DOB Aug 1; now is Jul 31 of the 18th year — still 17.
        val dob = utcMs(2008, 8, 1)
        val nowJul31 = utcMs(2026, 7, 31)
        assertEquals("minor", deriveCohort(dob, nowJul31))
    }

    @Test
    fun `adult on birthday month boundary`() {
        // DOB Aug 1; now is Aug 1 of 18th year — exactly 18.
        val dob = utcMs(2008, 8, 1)
        val nowAug1 = utcMs(2026, 8, 1)
        assertEquals("adult", deriveCohort(dob, nowAug1))
    }

    @Test
    fun `minor in early-month for late-month birthday`() {
        // DOB Aug 20; now is Aug 10 of the 18th year — still 17.
        val dob = utcMs(2008, 8, 20)
        val nowAug10 = utcMs(2026, 8, 10)
        assertEquals("minor", deriveCohort(dob, nowAug10))
    }

    @Test
    fun `future DOB returns minor (defensive — never happens but pin the contract)`() {
        // A clock-skew or data-entry error could surface a DOB later
        // than now (e.g. a Firebase server-timestamp deserialised
        // against a wrong wall clock). The age computation goes
        // negative; deriveCohort must still return the most-
        // restrictive "minor" cohort rather than throwing or
        // returning adult by some int-overflow accident. Pins the
        // defensive default for the entire negative-age branch.
        val dob = utcMs(2030, 1, 1)
        val now = utcMs(2020, 1, 1)
        assertEquals("minor", deriveCohort(dob, now))
    }
}
