/**
 * UK OSA #17 PR 10 — list-body cohort filter.
 *
 * Companion to `middleware/sameCohort.js` (which handles the *outer*
 * 404-existence-hiding gate). This module handles the *inner* gate:
 * given a list of entries that each point to a user, filter out the
 * entries whose owner is cross-cohort to the caller.
 *
 * Resolution rules per entry:
 *   1. If the entry has a stamped `cohort` field in the
 *      `VALID_COHORTS` allow-list → use it. Zero Firestore reads.
 *   2. Else (legacy entry, pre-PR-10) → live-look up `users/<id>` and
 *      derive via `effectiveCohort`. Zero-downtime migration: old
 *      entries Just Work until they're rewritten by the write-time
 *      stamping in `updateGiftRankings` / `updateGiftWall`.
 *   3. If the live lookup returns a non-existent doc → return null
 *      (drop the entry). This is the deleted-user case: WITHOUT
 *      explicit drop, `effectiveCohort(null) → 'minor'` would leak
 *      the existence of deleted users to minor callers as
 *      "same-cohort" entries.
 *
 * Tests live in `tests/routes/leaderboards-cohort.test.js`.
 */

const { db } = require('./firebase');
const { effectiveCohort, VALID_COHORTS } = require('./firebase-claims');

async function resolveEntryCohort(entry, userId) {
  if (entry && typeof entry.cohort === 'string' && VALID_COHORTS.has(entry.cohort)) {
    return entry.cohort;
  }
  if (!userId) return null;
  const snap = await db.doc(`users/${userId}`).get();
  if (!snap.exists) return null;
  return effectiveCohort(snap.data());
}

async function filterListByCohort(items, callerCohort, idField) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const resolved = await Promise.all(
    items.map(async (item) => {
      const cohort = await resolveEntryCohort(item, item?.[idField]);
      return cohort === callerCohort ? item : null;
    }),
  );
  return resolved.filter((x) => x !== null);
}

module.exports = { resolveEntryCohort, filterListByCohort };
