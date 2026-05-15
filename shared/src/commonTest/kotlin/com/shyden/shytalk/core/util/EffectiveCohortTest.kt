package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.model.User
import kotlin.test.Test
import kotlin.test.assertEquals

class EffectiveCohortTest {
    @Test
    fun `cohortOverride wins when allow-listed`() {
        assertEquals(COHORT_ADULT, effectiveCohort(cohort = COHORT_MINOR, cohortOverride = COHORT_ADULT))
        assertEquals(COHORT_MINOR, effectiveCohort(cohort = COHORT_ADULT, cohortOverride = COHORT_MINOR))
    }

    @Test
    fun `cohort returned when cohortOverride is null`() {
        assertEquals(COHORT_ADULT, effectiveCohort(cohort = COHORT_ADULT, cohortOverride = null))
        assertEquals(COHORT_MINOR, effectiveCohort(cohort = COHORT_MINOR, cohortOverride = null))
    }

    @Test
    fun `invalid cohortOverride falls back to cohort`() {
        assertEquals(COHORT_ADULT, effectiveCohort(cohort = COHORT_ADULT, cohortOverride = "super-adult"))
        assertEquals(COHORT_ADULT, effectiveCohort(cohort = COHORT_ADULT, cohortOverride = ""))
    }

    @Test
    fun `invalid cohort falls back to minor`() {
        assertEquals(COHORT_MINOR, effectiveCohort(cohort = "gibberish", cohortOverride = null))
        assertEquals(COHORT_MINOR, effectiveCohort(cohort = "", cohortOverride = null))
    }

    @Test
    fun `both invalid yields minor (most-restrictive)`() {
        assertEquals(COHORT_MINOR, effectiveCohort(cohort = "x", cohortOverride = "y"))
    }

    @Test
    fun `User extension returns effective cohort`() {
        val minorUser = User(cohort = COHORT_MINOR, cohortOverride = null)
        val adultUser = User(cohort = COHORT_ADULT, cohortOverride = null)
        val overriddenMinor = User(cohort = COHORT_ADULT, cohortOverride = COHORT_MINOR)
        val invalidOverride = User(cohort = COHORT_ADULT, cohortOverride = "garbage")

        assertEquals(COHORT_MINOR, minorUser.effectiveCohort)
        assertEquals(COHORT_ADULT, adultUser.effectiveCohort)
        assertEquals(COHORT_MINOR, overriddenMinor.effectiveCohort)
        assertEquals(COHORT_ADULT, invalidOverride.effectiveCohort)
    }

    @Test
    fun `mirror of Express utils firebase-claims effectiveCohort`() {
        // Same truth table as express-api/src/utils/firebase-claims.js
        // effectiveCohort(). Keep these in lock-step — divergence
        // between server and client would mean a user blocked by the
        // server is still visible client-side (or vice versa), defeating
        // the defence-in-depth design.
        val cases =
            listOf(
                Triple(COHORT_ADULT, null, COHORT_ADULT),
                Triple(COHORT_MINOR, null, COHORT_MINOR),
                Triple(COHORT_ADULT, COHORT_MINOR, COHORT_MINOR),
                Triple(COHORT_MINOR, COHORT_ADULT, COHORT_ADULT),
                Triple(COHORT_ADULT, "junk", COHORT_ADULT),
                Triple("junk", null, COHORT_MINOR),
            )
        for ((cohort, override, expected) in cases) {
            assertEquals(expected, effectiveCohort(cohort, override), "cohort=$cohort override=$override")
        }
    }
}
