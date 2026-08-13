package com.shyden.shytalk.core.safety

import com.shyden.shytalk.core.safety.AgeThresholds.Feature
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * SHY-0060 engine — the pure per-feature gate-logic core. Inputs are a resolved
 * verified age (years, null when unverified) + an ISO country code (null when
 * undetected), so the behaviour is deterministic (no wall-clock). The User
 * adapter + DOB→age extraction ship with the client/server wiring increment.
 *
 * Contract (AC lines 50/59/61/118/136): three-way GateResult —
 *  - Allowed
 *  - BlockedUnderAge(threshold, actualAge, requiredVerification) — you're below
 *    the base bar, OR your age is unverified for a stricter-than-floor feature
 *  - BlockedRegion(threshold, reason) — you'd pass the base bar but a regional
 *    (GDPR Art.8 / undetected-region conservative) rule lifts it above you
 */
class SafetyGateTest {
    // --- Happy path: allowed ---

    @Test
    fun `allows access when verified age equals the threshold`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.DIRECT_MESSAGE_WITH_STRANGER, verifiedAgeYears = 18, countryCode = "GB"),
        )
    }

    @Test
    fun `allows access when verified age exceeds the threshold`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.DIRECT_MESSAGE_WITH_STRANGER, verifiedAgeYears = 40, countryCode = "GB"),
        )
    }

    @Test
    fun `allows a COPPA-floor feature at exactly the floor age`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.PUBLIC_ROOM_BROWSE, verifiedAgeYears = 13, countryCode = "GB"),
        )
    }

    @Test
    fun `allows a 16-year-old to speak in voice rooms`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.VOICE_ROOM_ACTIVE_SPEAKING, verifiedAgeYears = 16, countryCode = "GB"),
        )
    }

    // --- Under-age blocks (base threshold) ---

    @Test
    fun `blocks under-age access below the base threshold`() {
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 18, actualAge = 14, requiredVerification = VerificationKind.NONE),
            SafetyGate.canAccess(Feature.DIRECT_MESSAGE_WITH_STRANGER, verifiedAgeYears = 14, countryCode = "GB"),
        )
    }

    @Test
    fun `blocks a 17-year-old from gifting-send`() {
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 18, actualAge = 17, requiredVerification = VerificationKind.NONE),
            SafetyGate.canAccess(Feature.GIFTING_SEND, verifiedAgeYears = 17, countryCode = "GB"),
        )
    }

    @Test
    fun `blocks a 15-year-old from speaking in voice rooms`() {
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 16, actualAge = 15, requiredVerification = VerificationKind.NONE),
            SafetyGate.canAccess(Feature.VOICE_ROOM_ACTIVE_SPEAKING, verifiedAgeYears = 15, countryCode = "GB"),
        )
    }

    // --- Region blocks (GDPR Article 8 elevation) ---

    @Test
    fun `blocks with the region reason when a GDPR override lifts the bar above base`() {
        // Germany signup: base 13, GDPR Art.8 -> 16. A 14-year-old passes base but not the region bar. (AC line 136)
        val result = SafetyGate.canAccess(Feature.SIGNUP, verifiedAgeYears = 14, countryCode = "DE")
        val blocked = assertIs<GateResult.BlockedRegion>(result)
        assertEquals(16, blocked.threshold)
    }

    @Test
    fun `allows access at the GDPR-elevated regional threshold`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.SIGNUP, verifiedAgeYears = 16, countryCode = "DE"),
        )
    }

    @Test
    fun `treats a sub-floor age in a GDPR region as under-age not region`() {
        // A 12-year-old is below the COPPA floor entirely -> under-age (reported bar is the region-effective 16).
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 16, actualAge = 12, requiredVerification = VerificationKind.NONE),
            SafetyGate.canAccess(Feature.SIGNUP, verifiedAgeYears = 12, countryCode = "DE"),
        )
    }

    // --- Unverified age (null) -> Reverify vs floor-open ---

    @Test
    fun `requires re-verification when the age is unverified and the feature exceeds the floor`() {
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 18, actualAge = null, requiredVerification = VerificationKind.REVERIFY),
            SafetyGate.canAccess(Feature.DIRECT_MESSAGE_WITH_STRANGER, verifiedAgeYears = null, countryCode = "GB"),
        )
    }

    @Test
    fun `keeps COPPA-floor features open for a legacy unverified account`() {
        // AC line 63: null verified age is only blocked for features stricter than the floor.
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.PUBLIC_ROOM_BROWSE, verifiedAgeYears = null, countryCode = "GB"),
        )
    }

    @Test
    fun `unverified age dominates even when the region is undetected`() {
        assertEquals(
            GateResult.BlockedUnderAge(threshold = 18, actualAge = null, requiredVerification = VerificationKind.REVERIFY),
            SafetyGate.canAccess(Feature.DIRECT_MESSAGE_WITH_STRANGER, verifiedAgeYears = null, countryCode = null),
        )
    }

    // --- Region-detection failure (null country) -> conservative max ---

    @Test
    fun `uses the conservative max threshold when the region is undetected`() {
        // AC line 61: undetected region -> strictest threshold (signup 16, not base 13).
        val result = SafetyGate.canAccess(Feature.SIGNUP, verifiedAgeYears = 14, countryCode = null)
        val blocked = assertIs<GateResult.BlockedRegion>(result)
        assertEquals(16, blocked.threshold)
    }

    @Test
    fun `allows an undetected-region user who clears the conservative threshold`() {
        assertEquals(
            GateResult.Allowed,
            SafetyGate.canAccess(Feature.SIGNUP, verifiedAgeYears = 16, countryCode = null),
        )
    }

    // --- conservativeThreshold ---

    @Test
    fun `conservativeThreshold picks the GDPR max for signup`() {
        assertEquals(16, SafetyGate.conservativeThreshold(Feature.SIGNUP))
    }

    @Test
    fun `conservativeThreshold falls back to base for a feature without overrides`() {
        assertEquals(18, SafetyGate.conservativeThreshold(Feature.GACHA_SPEND))
    }

    @Test
    fun `conservativeThreshold for a COPPA-floor feature stays at the floor`() {
        assertEquals(13, SafetyGate.conservativeThreshold(Feature.PUBLIC_ROOM_BROWSE))
    }
}
