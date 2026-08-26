package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0459 — a minor must not be OFFERED what they may not use.
 *
 * Spec j02 expects a minor to have the messages tab and the wallet hidden. The
 * shipped app showed both: cohort enforcement was server-side only, so a minor
 * could see the controls, tap them, and be refused by an app that offered in
 * the first place.
 *
 * This is not a safeguarding hole — the server's refusal is real and stays. It
 * is the door that opens onto it.
 *
 * The decision lives here, as a value, so "what a minor sees" is something a
 * test can state rather than something read off a screenshot. The same shape
 * as `roomScreenContentFor` in SHY-0466, and for the same reason: a Compose
 * `if` is invisible to everything except a device walk.
 */
class CohortSurfaceTest {
    @Test
    fun `an adult is offered every gated feature`() {
        CohortGatedFeature.entries.forEach { feature ->
            assertTrue(
                isFeatureOffered(feature, COHORT_ADULT),
                "$feature must stay available to adults",
            )
        }
    }

    @Test
    fun `a minor is offered none of them`() {
        CohortGatedFeature.entries.forEach { feature ->
            assertFalse(
                isFeatureOffered(feature, COHORT_MINOR),
                "$feature must not be offered to a minor",
            )
        }
    }

    @Test
    fun `the gated set is the one j02 names, and is not empty`() {
        // Non-vacuous guard: an empty enum would make both sweeps above pass
        // while gating nothing at all.
        assertTrue(CohortGatedFeature.entries.isNotEmpty())
        assertEquals(
            setOf(CohortGatedFeature.DIRECT_MESSAGES, CohortGatedFeature.WALLET),
            CohortGatedFeature.entries.toSet(),
        )
    }

    @Test
    fun `an unrecognised cohort is treated as a minor, not as unrestricted`() {
        // Fails CLOSED, matching effectiveCohort and its Express twin. A
        // stripped or malformed value must restrict the surface, never open it
        // — the direction the server-side gate failed in during SHY-0468.
        listOf("", "ADULT", "grown-up", "18+", "unknown").forEach { junk ->
            assertFalse(
                isFeatureOffered(CohortGatedFeature.DIRECT_MESSAGES, junk),
                "\"$junk\" must not be read as an adult",
            )
        }
    }

    @Test
    fun `an admin cohort override decides, as it does everywhere else`() {
        // `effectiveCohort` prefers an audited override. The surface must obey
        // the same resolution, or staff can lift a restriction the UI ignores.
        assertTrue(
            isFeatureOffered(CohortGatedFeature.WALLET, COHORT_MINOR, cohortOverride = COHORT_ADULT),
        )
        assertFalse(
            isFeatureOffered(CohortGatedFeature.WALLET, COHORT_ADULT, cohortOverride = COHORT_MINOR),
        )
    }

    @Test
    fun `a junk override does not silently promote a minor`() {
        assertFalse(
            isFeatureOffered(CohortGatedFeature.WALLET, COHORT_MINOR, cohortOverride = "ADULT"),
        )
    }
}
