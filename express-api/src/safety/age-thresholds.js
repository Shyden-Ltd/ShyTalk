'use strict';

/**
 * SHY-0060 — JS SERVER MIRROR of the Kotlin source of truth
 * (shared/src/commonMain/kotlin/com/shyden/shytalk/core/safety/AgeThresholds.kt).
 *
 * The Express server can't import Kotlin, so these values are duplicated here
 * and PARITY-PINNED to the Kotlin file by tests/safety/age-thresholds.test.js —
 * a mismatch fails CI, so the two cannot drift silently.
 *
 * ⚠️ PROVISIONAL VALUES (COPPA floor / GDPR Article 8 / store policy). Final
 * thresholds are an operator/product/legal decision; nothing is enforced in
 * production until the default-OFF operator feature flag is switched on.
 */

/** COPPA "child" boundary — no gated feature may sit below this. */
const COPPA_FLOOR = 13;

/** Sanity ceiling — catches an accidental fat-fingered threshold. */
const SANITY_MAX = 21;

/** The 10 age-sensitive gated features (mirror of the Kotlin Feature enum). */
const FEATURES = Object.freeze({
  SIGNUP: 'SIGNUP',
  PUBLIC_ROOM_BROWSE: 'PUBLIC_ROOM_BROWSE',
  PUBLIC_ROOM_ACTIVE_JOIN: 'PUBLIC_ROOM_ACTIVE_JOIN',
  DIRECT_MESSAGE_WITH_FOLLOWED_USER: 'DIRECT_MESSAGE_WITH_FOLLOWED_USER',
  DIRECT_MESSAGE_WITH_STRANGER: 'DIRECT_MESSAGE_WITH_STRANGER',
  VOICE_ROOM_ACTIVE_SPEAKING: 'VOICE_ROOM_ACTIVE_SPEAKING',
  GIFTING_SEND: 'GIFTING_SEND',
  GIFTING_RECEIVE: 'GIFTING_RECEIVE',
  PROFILE_MATURE_CONTENT: 'PROFILE_MATURE_CONTENT',
  GACHA_SPEND: 'GACHA_SPEND',
});

/** Provisional base minimum age (years) per feature. */
const BASE = Object.freeze({
  SIGNUP: 13,
  PUBLIC_ROOM_BROWSE: 13,
  PUBLIC_ROOM_ACTIVE_JOIN: 13,
  DIRECT_MESSAGE_WITH_FOLLOWED_USER: 13,
  DIRECT_MESSAGE_WITH_STRANGER: 18,
  VOICE_ROOM_ACTIVE_SPEAKING: 16,
  GIFTING_SEND: 18,
  GIFTING_RECEIVE: 16,
  PROFILE_MATURE_CONTENT: 18,
  GACHA_SPEND: 18,
});

/**
 * Region overrides keyed by ISO-3166 alpha-2 country code (GDPR Article 8).
 * PROVISIONAL and intentionally minimal, pending legal finalisation.
 */
const REGION_OVERRIDES = Object.freeze({
  DE: Object.freeze({ SIGNUP: 16 }), // Germany: GDPR Art.8 digital-consent age 16
  NL: Object.freeze({ SIGNUP: 16 }), // Netherlands: GDPR Art.8 digital-consent age 16
});

/**
 * Minimum age for `feature` in `countryCode` (ISO alpha-2; null/undefined when
 * the region is unknown), falling back to the base threshold when no override
 * applies. The conservative "region-detection FAILED → strictest threshold"
 * behaviour is safety-gate's decision, not this lookup's.
 */
function thresholdFor(feature, countryCode) {
  if (
    countryCode &&
    REGION_OVERRIDES[countryCode] &&
    REGION_OVERRIDES[countryCode][feature] !== undefined
  ) {
    return REGION_OVERRIDES[countryCode][feature];
  }
  return BASE[feature];
}

/**
 * Validate a threshold config (defaults to the shipped one). Returns an array of
 * human-readable errors; empty means valid. Mirrors the Kotlin `validate()`.
 */
function validate(base = BASE, overrides = REGION_OVERRIDES) {
  const errors = [];
  for (const feature of Object.keys(FEATURES)) {
    if (base[feature] === undefined) errors.push(`missing base threshold for ${feature}`);
  }
  for (const [feature, threshold] of Object.entries(base)) {
    if (threshold < COPPA_FLOOR || threshold > SANITY_MAX) {
      errors.push(
        `base threshold for ${feature} is ${threshold} (must be ${COPPA_FLOOR}..${SANITY_MAX})`,
      );
    }
  }
  for (const [country, map] of Object.entries(overrides)) {
    for (const [feature, threshold] of Object.entries(map)) {
      if (threshold < COPPA_FLOOR || threshold > SANITY_MAX) {
        errors.push(
          `region ${country} override for ${feature} is ${threshold} (must be ${COPPA_FLOOR}..${SANITY_MAX})`,
        );
      }
    }
  }
  return errors;
}

module.exports = {
  COPPA_FLOOR,
  SANITY_MAX,
  FEATURES,
  BASE,
  REGION_OVERRIDES,
  thresholdFor,
  validate,
};
