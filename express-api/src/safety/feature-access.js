'use strict';

/**
 * SHY-0060 — server-side feature-access evaluation: turn an already-loaded
 * user doc into a per-feature age-gating verdict.
 *
 * This is the glue between the stored user record and the pure gate engine
 * (safety-gate.js): it extracts the two engine inputs — a VERIFIED age (or
 * null) and an ISO alpha-2 region (or null) — from the user doc, then calls
 * canAccess. It is pure (data in, verdict out): the caller loads the user doc
 * once (endpoints already do) and passes the data in, so there is no extra
 * Firestore read on the hot path.
 */

const { canAccess } = require('./safety-gate');
const { FEATURES } = require('./age-thresholds');

/**
 * Calendar-aware whole-years age from a date-of-birth (ms epoch), computed
 * in UTC. Mirrors the existing `isAtLeast18FromDob` age math exactly (so
 * `isAtLeast18FromDob(dob) === ageFromDob(dob) >= 18`) and is the server
 * analog of Kotlin DateUtils.calculateAge. The exact-calendar comparison
 * avoids the ~6h/leap-window drift a `365.25 * MS_PER_DAY` approximation
 * would put on the birthday boundary.
 *
 * @param {number} dateOfBirthMs ms epoch of the DOB
 * @param {number} [nowMs=Date.now()] ms epoch of "now"
 * @returns {number} whole years old
 */
function ageFromDob(dateOfBirthMs, nowMs = Date.now()) {
  const today = new Date(nowMs);
  const dob = new Date(dateOfBirthMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

/**
 * The engine's "verified age" input: the user's age in whole years IFF the
 * account is ID-verified (`ageVerified === true`) AND a usable DOB is on
 * record; otherwise null (→ the engine's Reverify path). Matches the app's
 * existing model where `ageVerified` gates the 18+ surfaces (PMs / gacha);
 * an unverified — or verified-but-DOB-less (anomalous) — record is treated
 * as unverified, the safe direction.
 */
function extractVerifiedAge(userData, nowMs) {
  if (userData?.ageVerified !== true) return null;
  const dob = userData.dateOfBirth;
  if (typeof dob !== 'number' || !Number.isFinite(dob)) return null;
  return ageFromDob(dob, nowMs);
}

/**
 * The engine's region input: the user's `nationality` normalised to an
 * uppercase ISO alpha-2 code, or null when it is absent/blank. Null means
 * "region undetected" → the engine applies the conservative (strictest)
 * threshold, so an undetected region never yields a more permissive gate
 * than some stricter region would. Uppercasing guards the case-sensitive
 * override lookup (stored `nationality` case is not guaranteed).
 */
function extractRegion(userData) {
  const nat = userData?.nationality;
  if (typeof nat !== 'string') return null;
  const trimmed = nat.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

/**
 * Per-feature age-gating verdict for an already-loaded user doc.
 *
 * @param {Object} userData the `users/<id>` doc data
 * @param {string} feature a Feature key (age-thresholds FEATURES)
 * @param {number} [nowMs=Date.now()] clock for the age computation
 * @returns {Object} a GateResult (see safety-gate.js)
 * @throws if `feature` is not a known gated feature (fail-fast — a typo'd
 *   call-site constant must never silently mis-gate)
 */
function evaluateFeatureAccess(userData, feature, nowMs = Date.now()) {
  if (!Object.hasOwn(FEATURES, feature)) {
    throw new Error(`evaluateFeatureAccess: unknown feature "${feature}"`);
  }
  const verifiedAgeYears = extractVerifiedAge(userData, nowMs);
  const region = extractRegion(userData);
  return canAccess(feature, verifiedAgeYears, region);
}

module.exports = { ageFromDob, evaluateFeatureAccess };
