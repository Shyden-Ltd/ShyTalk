package com.shyden.shytalk.core.util

import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/**
 * Segregation cohort constants for UK OSA #17.
 * "minor" = under 18; "adult" = 18 or older. Spec:
 * `.project/plans/2026-05-13-age-segregation-design.md`.
 */
const val COHORT_MINOR: String = "minor"
const val COHORT_ADULT: String = "adult"

/** Age at which a user crosses from minor to adult cohort. */
const val ADULT_AGE_THRESHOLD: Int = 18

/**
 * Map a date-of-birth to the segregation cohort tag, evaluated in UTC.
 *
 * UTC is used (not the local system timezone) so the client agrees with
 * the Express server about a user's cohort. A user born just before
 * midnight UTC who lives in a +13 timezone should not "age in" 13 hours
 * earlier on the client than on the server.
 *
 * `null` date-of-birth defaults to [COHORT_MINOR] (most-restrictive).
 *
 * @param dateOfBirthMs UTC epoch milliseconds of the user's DOB (start
 *   of their birth day), or null when unknown.
 * @param nowMs UTC epoch milliseconds for "now" — exposed as a parameter
 *   (not `currentTimeMillis()`) so tests can pin the cohort decision to
 *   a deterministic anchor date.
 */
fun deriveCohort(
    dateOfBirthMs: Long?,
    nowMs: Long,
): String {
    if (dateOfBirthMs == null) return COHORT_MINOR
    val age = ageAtUtc(dateOfBirthMs, nowMs)
    return if (age >= ADULT_AGE_THRESHOLD) COHORT_ADULT else COHORT_MINOR
}

/**
 * Whole-years age computed in UTC, between [dateOfBirthMs] and [nowMs].
 * Mirrors [calculateAge] but pinned to UTC and `now` is a parameter
 * (caller controls the clock so the function is test-stable).
 */
private fun ageAtUtc(
    dateOfBirthMs: Long,
    nowMs: Long,
): Int {
    val tz = TimeZone.UTC
    val today = Instant.fromEpochMilliseconds(nowMs).toLocalDateTime(tz).date
    val birth = Instant.fromEpochMilliseconds(dateOfBirthMs).toLocalDateTime(tz).date
    var age = today.year - birth.year
    // Subtract one year if we haven't reached the birthday yet THIS year.
    // Compare months first; if equal, compare days.
    if (today.month < birth.month ||
        (today.month == birth.month && today.day < birth.day)
    ) {
        age--
    }
    return age
}
