package com.shyden.shytalk.core.safety

/**
 * SHY-0060 — the single source-of-truth per-feature age-threshold config plus
 * its CI validator. Consumed by [SafetyGate] and (via the server mirror) by the
 * Express enforcement layer, all behind a default-OFF operator feature flag so
 * nothing changes in production until the thresholds are finalised and legal /
 * T&S have signed off.
 *
 * ⚠️ PROVISIONAL VALUES. The thresholds below are the story's research-grounded
 * proposals (COPPA floor 13 / GDPR Article 8 / Apple + Google store policy /
 * the per-feature safety-vector rationale documented in SHY-0060). The FINAL
 * values are an operator / product / legal decision; changing one is a one-line
 * edit here. Nothing is enforced in production until the operator flips the
 * feature flag ON.
 */
object AgeThresholds {
    /** COPPA "child" boundary — no gated feature may sit below this. */
    const val COPPA_FLOOR = 13

    /** Sanity ceiling — catches an accidental fat-fingered threshold. */
    const val SANITY_MAX = 21

    /** The age-sensitive features gated per-threshold (SHY-0060 § Happy path). */
    enum class Feature {
        SIGNUP,
        PUBLIC_ROOM_BROWSE,
        PUBLIC_ROOM_ACTIVE_JOIN,
        DIRECT_MESSAGE_WITH_FOLLOWED_USER,
        DIRECT_MESSAGE_WITH_STRANGER,
        VOICE_ROOM_ACTIVE_SPEAKING,
        GIFTING_SEND,
        GIFTING_RECEIVE,
        PROFILE_MATURE_CONTENT,
        GACHA_SPEND,
    }

    /** Provisional base minimum age (years) per feature. */
    val base: Map<Feature, Int> =
        mapOf(
            Feature.SIGNUP to 13,
            Feature.PUBLIC_ROOM_BROWSE to 13,
            Feature.PUBLIC_ROOM_ACTIVE_JOIN to 13,
            Feature.DIRECT_MESSAGE_WITH_FOLLOWED_USER to 13,
            Feature.DIRECT_MESSAGE_WITH_STRANGER to 18,
            Feature.VOICE_ROOM_ACTIVE_SPEAKING to 16,
            Feature.GIFTING_SEND to 18,
            Feature.GIFTING_RECEIVE to 16,
            Feature.PROFILE_MATURE_CONTENT to 18,
            Feature.GACHA_SPEND to 18,
        )

    /**
     * Region overrides keyed by ISO-3166 alpha-2 country code — GDPR Article 8
     * raises the digital-consent age in some EU member states. PROVISIONAL and
     * intentionally minimal, pending legal finalisation of the full map.
     */
    val regionOverrides: Map<String, Map<Feature, Int>> =
        mapOf(
            "DE" to mapOf(Feature.SIGNUP to 16), // Germany: GDPR Art.8 digital-consent age 16
            "NL" to mapOf(Feature.SIGNUP to 16), // Netherlands: GDPR Art.8 digital-consent age 16
        )

    /**
     * Minimum age for [feature] in [countryCode] (ISO alpha-2; null when the
     * region is unknown/undetected), falling back to the base threshold when no
     * override applies. NOTE: the conservative "region detection FAILED → apply
     * the strictest threshold" behaviour is [SafetyGate]'s decision, not this
     * lookup's — a null here means "no region-specific override," not "detection
     * failed."
     */
    fun thresholdFor(
        feature: Feature,
        countryCode: String?,
    ): Int = countryCode?.let { regionOverrides[it]?.get(feature) } ?: base.getValue(feature)

    /**
     * Validate a threshold config (defaults to the shipped one). Returns a list
     * of human-readable errors; empty means valid. This is the story's CI gate —
     * the `the shipped config passes validation` test runs it in :shared:jvmTest,
     * so a malformed config (threshold below the COPPA floor, above the sanity
     * max, or a missing feature) fails CI without a separate script.
     */
    fun validate(
        base: Map<Feature, Int> = this.base,
        overrides: Map<String, Map<Feature, Int>> = this.regionOverrides,
    ): List<String> {
        val errors = mutableListOf<String>()
        Feature.values().forEach { feature ->
            if (feature !in base) errors += "missing base threshold for $feature"
        }
        base.forEach { (feature, threshold) ->
            if (threshold < COPPA_FLOOR || threshold > SANITY_MAX) {
                errors += "base threshold for $feature is $threshold (must be $COPPA_FLOOR..$SANITY_MAX)"
            }
        }
        overrides.forEach { (country, map) ->
            map.forEach { (feature, threshold) ->
                if (threshold < COPPA_FLOOR || threshold > SANITY_MAX) {
                    errors += "region $country override for $feature is $threshold (must be $COPPA_FLOOR..$SANITY_MAX)"
                }
            }
        }
        return errors
    }
}
