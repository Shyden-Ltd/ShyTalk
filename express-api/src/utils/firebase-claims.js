/**
 * Custom-claim merge helper (UK OSA #17 PR 2).
 *
 * Firebase Admin's `setCustomUserClaims(uid, claims)` is a REPLACE
 * operation — the new claims object completely overwrites whatever
 * was there. That's a footgun when a route only wants to update ONE
 * claim (e.g. cohort flip on age-up) but unrelated claims (admin)
 * are still desired.
 *
 * `mintClaimsMerging(uid, partial)` reads the existing claims via
 * `auth.getUser` and spreads them in before writing — the single
 * chokepoint that every cohort/uniqueId/admin mint funnels through.
 *
 * For signup paths where there are no existing claims, pass
 * `{ skipFetch: true }` to save ~150ms on the critical path.
 */

const { auth } = require('./firebase');

async function mintClaimsMerging(uid, partial, { skipFetch = false, authClient = auth } = {}) {
  if (skipFetch) {
    await authClient.setCustomUserClaims(uid, partial);
    return;
  }
  let existing = {};
  try {
    const record = await authClient.getUser(uid);
    existing = record?.customClaims || {};
  } catch (_err) {
    // User may not exist in Firebase Auth yet (race) or the record
    // may have been reaped. Treat as empty existing claims and
    // proceed — the partial is still a valid mint.
  }
  await authClient.setCustomUserClaims(uid, { ...existing, ...partial });
}

/**
 * Allow-list of legitimate cohort values. Anything else (including
 * `cohortOverride` typos like `'admin'` or `'super-adult'` set by a
 * future admin-panel bug) falls back to `'minor'` — most-restrictive
 * posture per the OSA "fail closed when ambiguous" rule. Without
 * this allow-list, an arbitrary string would land in the JWT claim
 * and the PR 3 rules-layer `request.auth.token.cohort == 'adult'`
 * gate would silently fail in unexpected ways.
 */
const VALID_COHORTS = new Set(['adult', 'minor']);

/**
 * Resolves the effective cohort for a user doc per the segregation
 * design § Custom auth claim:
 *   - `cohortOverride` (admin-set, audit-logged) wins when present
 *     AND in the allow-list
 *   - `cohort` (DOB-derived by pm-lock-check) is the default,
 *     also allow-list-gated
 *   - any other case falls back to `'minor'`
 */
function effectiveCohort(userData) {
  if (
    userData &&
    typeof userData.cohortOverride === 'string' &&
    VALID_COHORTS.has(userData.cohortOverride)
  ) {
    return userData.cohortOverride;
  }
  if (userData && typeof userData.cohort === 'string' && VALID_COHORTS.has(userData.cohort)) {
    return userData.cohort;
  }
  return 'minor';
}

/**
 * Calendar-year age predicate. Duplicates the algorithm in
 * pm-lock-check.js + admin-age-verification.js + users.js — single
 * source of truth follow-up flagged in the security review (LOW #5).
 * Pre-fix used `(now - dob) / year-in-ms` which is wrong around
 * leap-year birthdays.
 */
function isAtLeast18FromDob(dobMs, nowMs) {
  if (typeof dobMs !== 'number' || !Number.isFinite(dobMs)) return false;
  const today = new Date(nowMs);
  const dob = new Date(dobMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 18;
}

/**
 * Returns the cohort to mint into the JWT for `userData`, derived
 * from the source-of-truth fields rather than the cached `cohort`
 * field. Priority:
 *   1. `cohortOverride` if allow-listed (admin-set, survives DOB)
 *   2. DOB-derived (`>=18y` predicate)
 *   3. `'minor'` — most-restrictive default
 *
 * Used at sign-in to defend against the narrow window where the
 * cached `cohort` field has drifted from the user's actual age (e.g.
 * admin DOB-modified yesterday, user signed out before pm-lock-check
 * refreshed the field). The PR 1 design treats `cohort` as a cache
 * for fast-path no-op detection; this helper recomputes the truth.
 */
function deriveCohortFromUser(userData, nowMs = Date.now()) {
  if (
    userData &&
    typeof userData.cohortOverride === 'string' &&
    VALID_COHORTS.has(userData.cohortOverride)
  ) {
    return userData.cohortOverride;
  }
  const dob = userData?.dateOfBirth;
  if (typeof dob === 'number' && Number.isFinite(dob)) {
    return isAtLeast18FromDob(dob, nowMs) ? 'adult' : 'minor';
  }
  return 'minor';
}

/**
 * Reads the cohort custom-claim off the verified Firebase ID token
 * attached to a request by `middleware/auth.js`. Fail-closed to
 * `'minor'` (most-restrictive) when the claim is missing or invalid —
 * mirrors `effectiveCohort` / `deriveCohortFromUser` so all three
 * "cohort resolvers" present one defensive contract to callers.
 *
 * A stripped or malformed claim is treated as a minor caller; this
 * restricts the attacker to minor↔minor interactions and surfaces a
 * meaningful `sourceCohort: 'minor'` signal in `segregationEvents`
 * (vs. the harder-to-aggregate `undefined`).
 */
function cohortFromClaim(req) {
  const claim = req?.auth?.token?.cohort;
  if (typeof claim === 'string' && VALID_COHORTS.has(claim)) {
    return claim;
  }
  return 'minor';
}

module.exports = {
  mintClaimsMerging,
  effectiveCohort,
  deriveCohortFromUser,
  isAtLeast18FromDob,
  cohortFromClaim,
  VALID_COHORTS,
};
