'use strict';

/**
 * SHY-0060 — client age-claim tamper detection (AC60 / BDD143).
 *
 * A client may assert its own age in a request (`claimedAge`). That claim NEVER
 * feeds the age gate — the gate always uses the server's DOB-derived age, so a
 * client cannot unlock anything by lying. This module is the abuse signal: when
 * the asserted age materially disagrees with the server's record, we 403 the
 * request and fire a T&S alert.
 *
 * A ±1-year tolerance absorbs client/server timezone + birthday-boundary drift
 * (client and server derive from the same DOB), so only egregious lies trip it.
 */

const { isAgeGatingEnabled } = require('./age-gating-flag');
const { ageFromDob } = require('./feature-access');

const TAMPER_TOLERANCE_YEARS = 1;

/**
 * Pure predicate: does the client's asserted age materially disagree with the
 * server's derived age? Non-numeric inputs never trip (no assertion, or no
 * record to compare against).
 *
 * @param {unknown} claimedAge the client's asserted age
 * @param {unknown} serverAge the server's DOB-derived age
 * @returns {boolean}
 */
function isAgeClaimTampered(claimedAge, serverAge) {
  if (typeof claimedAge !== 'number' || !Number.isFinite(claimedAge)) return false;
  if (typeof serverAge !== 'number' || !Number.isFinite(serverAge)) return false;
  return Math.abs(claimedAge - serverAge) > TAMPER_TOLERANCE_YEARS;
}

/**
 * Detect a tampered age claim and, if found, fire a T&S alert + return a 403
 * block. Returns null (no action) when: the client asserted no age; the
 * operator flag is OFF; there is no DOB on record to compare against; or the
 * claim is within tolerance. The alert is AWAITED (rare, security-critical
 * path) but wrapped so it can never throw into the request.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} p
 * @param {unknown} p.claimedAge the client's asserted age (from the request)
 * @param {object|(() => Promise<object>)} p.userDataOrLoader acting user's doc,
 *   or a lazy loader invoked only when a claim is present AND the flag is ON
 * @param {number} [p.nowMs=Date.now()] clock for the server age
 * @returns {Promise<null | { status: number, body: object }>}
 */
async function checkAgeClaimTamper(db, { claimedAge, userDataOrLoader, nowMs = Date.now() }) {
  // Cheap exits first: no assertion → nothing to check; flag OFF → engine inert.
  if (typeof claimedAge !== 'number' || !Number.isFinite(claimedAge)) return null;
  if (!(await isAgeGatingEnabled(db))) return null;

  const userData =
    typeof userDataOrLoader === 'function' ? await userDataOrLoader() : userDataOrLoader;
  const dob = userData?.dateOfBirth;
  if (typeof dob !== 'number' || !Number.isFinite(dob)) return null;

  const serverAge = ageFromDob(dob, nowMs);
  if (!isAgeClaimTampered(claimedAge, serverAge)) return null;

  // Lazy-required so the pure predicate above stays importable without booting
  // firebase (keeps the unit test infrastructure-free); require() caches, so
  // this costs nothing after the first call.
  const alertManager = require('../utils/alertManagerInstance');
  try {
    await alertManager.createAlert(
      'AGE_CLAIM_TAMPER',
      'critical',
      'Age claim tamper detected',
      `Client claimed age ${claimedAge}; server record derives ${serverAge}.`,
      { userId: userData?.uniqueId ?? null, claimedAge, serverAge },
    );
  } catch {
    // The alert is best-effort; a failed write must never mask the 403.
  }

  return { status: 403, body: { error: 'Age verification failed.', errorId: 'AGE_CLAIM_TAMPER' } };
}

module.exports = { isAgeClaimTampered, checkAgeClaimTamper, TAMPER_TOLERANCE_YEARS };
