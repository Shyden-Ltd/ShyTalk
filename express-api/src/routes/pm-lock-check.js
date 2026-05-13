/**
 * POST /api/users/:uniqueId/pm-lock-check
 *
 * First-of-day auto-unlock check (PR 11). Called by the client right
 * after successful sign-in. Reads the user doc, decides whether the
 * pmLocked state should change, and writes if yes — all server-side
 * because Firestore rules deny client writes to `pmLocked` /
 * `lastPmLockCheck` / `cohort`.
 *
 * Throttling: when `lastPmLockCheck` falls in the same UTC day as
 * `now()`, we skip the Firestore write entirely. Active users only
 * pay the cost once per day; dormant accounts pay nothing.
 *
 * Authorisation: the path uniqueId MUST match the caller's
 * `req.auth.uniqueId`. Defends against a malicious client trying to
 * trigger an unlock check on another user's behalf (would be moot
 * since rules deny direct writes anyway, but gate at the route layer
 * for defence in depth).
 *
 * UK OSA #17 segregation extension (PR 1): the same `>=18y` predicate
 * that drives `pmLocked` also drives the `cohort` field ("minor" |
 * "adult"). Re-using the `lastPmLockCheck` stamp lets both fields
 * recompute on the same daily cadence with no second throttle. The
 * custom-claim mint that completes the cohort transition is deferred
 * to PR 2 — until it lands, the response carries `cohortChanged` and
 * `cohort` but NOT `forceTokenRefresh: true` (refreshing a stale
 * claim wastes Firebase mint quota for no behavioral change). Spec:
 * `.project/plans/2026-05-13-age-segregation-design.md`.
 */

const express = require('express');
const router = express.Router();

const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const log = require('../utils/log');

/** UTC midnight (start-of-day) for the timestamp `ms`. */
function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

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

router.post('/users/:uniqueId/pm-lock-check', async (req, res) => {
  const pathUniqueId = parseInt(req.params.uniqueId, 10);
  if (!Number.isFinite(pathUniqueId) || pathUniqueId !== req.auth?.uniqueId) {
    return res.status(403).json({ error: 'You can only check your own pm-lock state' });
  }

  try {
    const nowMs = now();
    const todayStart = utcDayStart(nowMs);
    let result = { pmLocked: false, unlocked: false, cohort: 'minor', cohortChanged: false };

    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${pathUniqueId}`);
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        result = { __notFound: true };
        return;
      }
      const data = snap.data();
      const currentlyLocked = data.pmLocked === true;
      const currentCohort = typeof data.cohort === 'string' ? data.cohort : 'minor';
      const last = typeof data.lastPmLockCheck === 'number' ? data.lastPmLockCheck : null;
      const lastDay = last !== null ? utcDayStart(last) : null;

      // Derive desired state from DOB. Null DOB → minor + locked
      // (most-restrictive default per spec § Edge cases).
      const eligible = isAtLeast18FromDob(data.dateOfBirth, nowMs);
      const desiredPmLocked = !eligible;
      const desiredCohort = eligible ? 'adult' : 'minor';

      // Already checked today: idempotent skip. The cohort + pmLocked
      // surfaced in the response are the CURRENT stored values, not
      // the derived ones — between the morning and evening of the
      // same UTC day, the field is whatever yesterday's check wrote.
      if (lastDay === todayStart) {
        result = {
          pmLocked: currentlyLocked,
          unlocked: false,
          alreadyCheckedToday: true,
          cohort: currentCohort,
          cohortChanged: false,
        };
        return;
      }

      // Hot-path no-op: adult cohort AND unlocked AND derived state
      // matches stored state. Skip even the throttle bump — dormant
      // adult accounts must pay zero Firestore quota. Sub-18 users
      // and mismatched-state users fall through to the write branch
      // (even when pmLocked is false) so cohort gets backfilled.
      if (
        !currentlyLocked &&
        currentCohort === 'adult' &&
        desiredCohort === 'adult' &&
        !desiredPmLocked
      ) {
        result = {
          pmLocked: false,
          unlocked: false,
          cohort: 'adult',
          cohortChanged: false,
        };
        return;
      }

      // Write branch — minimal payload. Always bumps lastPmLockCheck
      // so the next call today is the same-day-throttle no-op.
      // Each field is only written if it would change — saves
      // Firestore quota on the common "minor stays minor" path.
      const update = { lastPmLockCheck: nowMs };
      if (currentlyLocked !== desiredPmLocked) update.pmLocked = desiredPmLocked;
      if (currentCohort !== desiredCohort) update.cohort = desiredCohort;
      tx.update(userRef, update);

      result = {
        pmLocked: desiredPmLocked,
        unlocked: currentlyLocked && !desiredPmLocked,
        cohort: desiredCohort,
        cohortChanged: currentCohort !== desiredCohort,
      };
    });

    if (result.__notFound) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(result);
  } catch (err) {
    // Include err.code + err.stack so Sentry/dashboards can triage by
    // failure class — Firestore SDK errors carry codes like ABORTED
    // (transaction-retry exhaustion), FAILED_PRECONDITION,
    // UNAUTHENTICATED. Without them every failure looks identical.
    log.error('pm-lock-check', 'failed', {
      uid: req.auth?.uniqueId,
      error: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'pm-lock-check failed', errorId: 'PM_LOCK_CHECK' });
  }
});

module.exports = router;
