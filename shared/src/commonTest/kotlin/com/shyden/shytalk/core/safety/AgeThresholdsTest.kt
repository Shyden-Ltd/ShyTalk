package com.shyden.shytalk.core.safety

import com.shyden.shytalk.core.safety.AgeThresholds.Feature
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0060 engine — the per-feature age-threshold config + its CI validator.
 *
 * The threshold values here are the story's PROVISIONAL proposals (final values
 * are an operator/product/legal decision); these tests pin the exact provisional
 * contract so a later change is deliberate, not accidental. `validate()` is the
 * CI gate the story requires (no threshold < 13 COPPA floor, none > 21 sanity max)
 * — it runs in :shared:jvmTest, so a malformed config fails CI without a separate
 * script.
 */
class AgeThresholdsTest {
    @Test
    fun `every gated feature has a base threshold`() {
        Feature.values().forEach { feature ->
            assertTrue(
                AgeThresholds.base.containsKey(feature),
                "missing base threshold for $feature",
            )
        }
    }

    @Test
    fun `base thresholds match the provisional safety spec exactly`() {
        assertEquals(13, AgeThresholds.base.getValue(Feature.SIGNUP))
        assertEquals(13, AgeThresholds.base.getValue(Feature.PUBLIC_ROOM_BROWSE))
        assertEquals(13, AgeThresholds.base.getValue(Feature.PUBLIC_ROOM_ACTIVE_JOIN))
        assertEquals(13, AgeThresholds.base.getValue(Feature.DIRECT_MESSAGE_WITH_FOLLOWED_USER))
        assertEquals(18, AgeThresholds.base.getValue(Feature.DIRECT_MESSAGE_WITH_STRANGER))
        assertEquals(16, AgeThresholds.base.getValue(Feature.VOICE_ROOM_ACTIVE_SPEAKING))
        assertEquals(18, AgeThresholds.base.getValue(Feature.GIFTING_SEND))
        assertEquals(16, AgeThresholds.base.getValue(Feature.GIFTING_RECEIVE))
        assertEquals(18, AgeThresholds.base.getValue(Feature.PROFILE_MATURE_CONTENT))
        assertEquals(18, AgeThresholds.base.getValue(Feature.GACHA_SPEND))
    }

    @Test
    fun `the shipped config passes validation`() {
        assertEquals(emptyList(), AgeThresholds.validate())
    }

    @Test
    fun `validate rejects a base threshold below the COPPA floor of 13`() {
        val errors = AgeThresholds.validate(base = mapOf(Feature.SIGNUP to 12))
        assertTrue(
            errors.any { it.contains("SIGNUP") && it.contains("12") },
            "expected a floor error for SIGNUP=12, got $errors",
        )
    }

    @Test
    fun `validate rejects a base threshold above the sanity max of 21`() {
        val errors = AgeThresholds.validate(base = mapOf(Feature.SIGNUP to 22))
        assertTrue(
            errors.any { it.contains("SIGNUP") && it.contains("22") },
            "expected a max error for SIGNUP=22, got $errors",
        )
    }

    @Test
    fun `validate flags a feature missing from the base map`() {
        val errors = AgeThresholds.validate(base = mapOf(Feature.SIGNUP to 13))
        assertTrue(
            errors.any { it.contains("GACHA_SPEND") },
            "expected a missing-feature error for GACHA_SPEND, got $errors",
        )
    }

    @Test
    fun `validate rejects an out-of-range region override`() {
        val errors =
            AgeThresholds.validate(
                base = AgeThresholds.base,
                overrides = mapOf("DE" to mapOf(Feature.SIGNUP to 25)),
            )
        assertTrue(
            errors.any { it.contains("DE") && it.contains("25") },
            "expected a region-override error for DE SIGNUP=25, got $errors",
        )
    }

    @Test
    fun `Germany raises the signup threshold to 16 per GDPR Article 8`() {
        assertEquals(16, AgeThresholds.thresholdFor(Feature.SIGNUP, "DE"))
    }

    @Test
    fun `a region without an override uses the base threshold`() {
        assertEquals(13, AgeThresholds.thresholdFor(Feature.SIGNUP, "GB"))
    }

    @Test
    fun `an unrecognised country falls back to the base threshold`() {
        assertEquals(13, AgeThresholds.thresholdFor(Feature.SIGNUP, "XX"))
    }

    @Test
    fun `a null country falls back to the base threshold`() {
        assertEquals(13, AgeThresholds.thresholdFor(Feature.SIGNUP, null))
    }
}
