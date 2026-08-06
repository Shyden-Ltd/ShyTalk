'use strict';

/**
 * SHY-0060 — JS SERVER PORT of the Kotlin SafetyGate
 * (shared/src/commonMain/kotlin/com/shyden/shytalk/core/safety/SafetyGate.kt).
 *
 * Pure logic over a resolved verified age + region, mirroring the Kotlin engine
 * exactly, so the server enforces the identical verdict the clients compute.
 * Thresholds come from the parity-pinned age-thresholds mirror.
 *
 * Enforcement is gated by a default-OFF operator feature flag at the call sites
 * (a later increment); this engine computes the verdict, it does not decide
 * whether gating is switched on.
 */

const { BASE, COPPA_FLOOR, REGION_OVERRIDES, thresholdFor } = require('./age-thresholds');

/** What a block requires before the user can retry (mirror of the Kotlin enum). */
const VERIFICATION = Object.freeze({ NONE: 'NONE', REVERIFY: 'REVERIFY' });

/** GateResult constructors (mirror of the Kotlin sealed GateResult). */
const ALLOWED = Object.freeze({ type: 'Allowed' });
const blockedUnderAge = (threshold, actualAge, requiredVerification) => ({
  type: 'BlockedUnderAge',
  threshold,
  actualAge,
  requiredVerification,
});
const blockedRegion = (threshold, reason) => ({ type: 'BlockedRegion', threshold, reason });

/**
 * The strictest threshold across the base value + every region override for
 * `feature` — applied when the region can't be detected, so an undetected user
 * never lands on a more permissive threshold than any region.
 */
function conservativeThreshold(feature) {
  let max = BASE[feature];
  for (const map of Object.values(REGION_OVERRIDES)) {
    if (map[feature] !== undefined && map[feature] > max) max = map[feature];
  }
  return max;
}

/** Region-aware threshold; a null/undefined (undetected) region uses the conservative max. */
function effectiveThreshold(feature, countryCode) {
  return (countryCode ?? null) === null
    ? conservativeThreshold(feature)
    : thresholdFor(feature, countryCode);
}

/**
 * Decide whether `feature` is permitted for a user of `verifiedAgeYears`
 * (null/undefined when the age is unverified) in `countryCode` (ISO alpha-2;
 * null/undefined when the region can't be detected → conservative threshold).
 */
function canAccess(feature, verifiedAgeYears, countryCode) {
  const base = BASE[feature];
  const effective = effectiveThreshold(feature, countryCode);

  if ((verifiedAgeYears ?? null) === null) {
    // Legacy/unverified: COPPA-floor features stay open (they cleared the
    // signup-13 gate); anything stricter needs re-verification.
    return effective <= COPPA_FLOOR
      ? ALLOWED
      : blockedUnderAge(effective, null, VERIFICATION.REVERIFY);
  }

  if (verifiedAgeYears >= effective) return ALLOWED;

  // Blocked. If the user would clear the BASE bar and only a regional rule lifts
  // it above them, that's a region block; otherwise plain under-age.
  if (effective > base && verifiedAgeYears >= base) {
    return blockedRegion(effective, `This region requires age ${effective} for ${feature}`);
  }
  return blockedUnderAge(effective, verifiedAgeYears, VERIFICATION.NONE);
}

module.exports = { canAccess, conservativeThreshold, ALLOWED, VERIFICATION };
