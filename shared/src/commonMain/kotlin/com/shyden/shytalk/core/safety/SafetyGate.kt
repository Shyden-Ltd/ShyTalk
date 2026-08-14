package com.shyden.shytalk.core.safety

import com.shyden.shytalk.core.safety.AgeThresholds.Feature

/** What a block requires of the user before they can retry (SHY-0060 AC line 59). */
enum class VerificationKind {
    /** The age is verified — the user is simply below the threshold. */
    NONE,

    /** The age is unverified (legacy account or verification gap) — the user must re-verify. */
    REVERIFY,
}

/**
 * Outcome of a per-feature age-gate check (SHY-0060 AC line 50). A sealed
 * three-way result rather than a boolean, because "why blocked" drives distinct
 * UX + audit copy: a plain under-age block, an unverified-age re-verify prompt,
 * and a region-policy block are different messages.
 */
sealed class GateResult {
    /** The user may use the feature. */
    object Allowed : GateResult()

    /**
     * The user is below the required age (or their age is unverified). [threshold]
     * is the effective (region-aware) minimum; [actualAge] is null when the age is
     * unverified; [requiredVerification] is REVERIFY only in the unverified case.
     */
    data class BlockedUnderAge(
        val threshold: Int,
        val actualAge: Int?,
        val requiredVerification: VerificationKind,
    ) : GateResult()

    /**
     * The user clears the base threshold but a regional rule (GDPR Article 8, or
     * the conservative default when the region can't be detected) lifts the bar
     * above them. [reason] is a functional English string — the localised copy is
     * produced by the UI layer (a follow-up SHY).
     */
    data class BlockedRegion(
        val threshold: Int,
        val reason: String,
    ) : GateResult()
}

/**
 * The per-feature age gate (SHY-0060 engine). Pure logic over a resolved verified
 * age + region — deterministic, no wall-clock, no I/O — so it is identical on
 * Android, iOS, and the (mirrored) server. Reads thresholds from [AgeThresholds].
 *
 * Enforcement is gated by a default-OFF operator feature flag at the call sites
 * (a later increment); this engine computes the verdict, it does not decide
 * whether gating is switched on.
 */
object SafetyGate {
    /**
     * Decide whether [feature] is permitted for a user of [verifiedAgeYears] (null
     * when the age is unverified) in [countryCode] (ISO alpha-2; null when the
     * region can't be detected → the conservative strictest threshold applies).
     */
    fun canAccess(
        feature: Feature,
        verifiedAgeYears: Int?,
        countryCode: String?,
    ): GateResult {
        val baseThreshold = AgeThresholds.base.getValue(feature)
        val effectiveThreshold = effectiveThreshold(feature, countryCode)

        if (verifiedAgeYears == null) {
            // Legacy/unverified: COPPA-floor features stay open (they cleared the
            // signup-13 gate); anything stricter needs re-verification (AC line 63).
            return if (effectiveThreshold <= AgeThresholds.COPPA_FLOOR) {
                GateResult.Allowed
            } else {
                GateResult.BlockedUnderAge(effectiveThreshold, actualAge = null, requiredVerification = VerificationKind.REVERIFY)
            }
        }

        if (verifiedAgeYears >= effectiveThreshold) return GateResult.Allowed

        // Blocked. If the user would clear the BASE bar and only a regional rule
        // lifts it above them, that's a region block; otherwise plain under-age.
        return if (effectiveThreshold > baseThreshold && verifiedAgeYears >= baseThreshold) {
            GateResult.BlockedRegion(effectiveThreshold, "This region requires age $effectiveThreshold for ${feature.name}")
        } else {
            GateResult.BlockedUnderAge(effectiveThreshold, actualAge = verifiedAgeYears, requiredVerification = VerificationKind.NONE)
        }
    }

    /** Region-aware threshold; a null (undetected) region uses the conservative max. */
    private fun effectiveThreshold(
        feature: Feature,
        countryCode: String?,
    ): Int = if (countryCode == null) conservativeThreshold(feature) else AgeThresholds.thresholdFor(feature, countryCode)

    /**
     * The strictest threshold across the base value + every region override for
     * [feature] — applied when the region can't be detected (AC line 61), so an
     * undetected user never lands on a more permissive threshold than any region.
     */
    fun conservativeThreshold(feature: Feature): Int {
        val base = AgeThresholds.base.getValue(feature)
        val maxOverride =
            AgeThresholds.regionOverrides.values
                .mapNotNull { it[feature] }
                .maxOrNull()
        return if (maxOverride != null) maxOf(base, maxOverride) else base
    }
}
