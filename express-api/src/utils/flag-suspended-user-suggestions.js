/**
 * Ban-cascade for the suggestions surface.
 *
 * When an admin suspends a user, their existing "live" suggestions
 * (status === 'accepted' or 'planned') get a `flaggedForReview: true`
 * sticky note so an admin can decide case-by-case whether the suggestion
 * stays on the roadmap. Suggestion status is left untouched — this preserves
 * voter/subscriber state and lets unsuspend cleanly reverse the cascade by
 * just clearing the flag fields.
 *
 * Why not change `status`?
 *   - `planned` -> `pending` would silently rip items off the public roadmap
 *     mid-flight, surprising voters/subscribers who are watching them.
 *   - Adding an `under_review` status would force changes to every transition
 *     guard in suggestions.js (lines 949-953) plus FE badges + 20 locales.
 *   - A flag is reversible by symmetry on unsuspend; status changes need a
 *     `priorStatus` stash to revert cleanly.
 *
 * Why not filter by status server-side?
 *   - `where('submitterUid','==',uid).where('status','in',[...])` needs a
 *     composite index. We expect <5 suggestions per typical user, so the
 *     single-field query + in-JS status filter avoids the index entirely.
 *
 * Idempotency:
 *   - flag: skip docs already carrying `flaggedReason === 'submitter_suspended'`.
 *   - unflag: only clear docs whose `flaggedReason === 'submitter_suspended'`
 *     (leaves unrelated manual admin flags alone).
 *
 * Contract mirrors evict-suspended-user.js for consistency across cascade utilities.
 */

const { db } = require('./firebase');
const { now } = require('./helpers');
const log = require('./log');

const FLAGGABLE_STATUSES = new Set(['accepted', 'planned']);
const FLAG_REASON = 'submitter_suspended';

/**
 * `submitterUid` is stored numerically (sourced from `req.auth.uniqueId`)
 * but suspension callers pass `req.params.uniqueId` (always a string).
 * Firestore equality is strict, so the string form silently matches nothing —
 * normalize once at the boundary.
 *
 * Edge-case behaviour (all routed to "silently match nothing" rather than
 * coercing to 0 or crashing — Firestore strict equality is the loud signal):
 *   - `42`           → `42`        (already numeric, passthrough)
 *   - `'42'`         → `42`        (integer string, normalized)
 *   - `'-7'`         → `-7`        (negative integer string, normalized)
 *   - `'7.5'`        → `'7.5'`     (float string, regex rejects, passthrough)
 *   - `'abc'`        → `'abc'`     (non-numeric string, passthrough)
 *   - `''`           → `''`        (empty string, passthrough)
 *   - `NaN`          → `NaN`       (typeof 'number' passthrough; matches nothing in Firestore)
 *   - `null`/`undef` → original    (typeof neither 'number' nor 'string', passthrough)
 *
 * For `NaN` specifically: Firestore equality treats NaN strictly, so a NaN-uid
 * query returns empty rather than throwing. That is "match nothing" not "throw",
 * which keeps the cascade route safe (admin response surfaces flaggedCount: 0)
 * but means a buggy upstream sending NaN would not loudly fail at this layer —
 * a worth-knowing limitation for future debugging.
 */
function normalizeUid(uid) {
  if (typeof uid === 'number') return uid;
  if (typeof uid === 'string' && uid !== '' && /^-?\d+$/.test(uid)) {
    const n = Number(uid);
    if (Number.isFinite(n)) return n;
  }
  return uid;
}

async function flagSuspendedUserSuggestions(uid, adminUid) {
  const normalizedUid = normalizeUid(uid);
  const snap = await db.collection('suggestions').where('submitterUid', '==', normalizedUid).get();

  if (!snap || snap.empty) {
    return {
      flaggedCount: 0,
      skippedCount: 0,
      partial: false,
      failedSuggestionIds: [],
      error: null,
    };
  }

  const flaggedAt = now();
  const toFlag = [];
  let skippedCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!FLAGGABLE_STATUSES.has(data.status)) {
      skippedCount += 1;
      continue;
    }
    if (data.flaggedForReview === true && data.flaggedReason === FLAG_REASON) {
      skippedCount += 1;
      continue;
    }
    toFlag.push(doc);
  }

  if (toFlag.length === 0) {
    return {
      flaggedCount: 0,
      skippedCount,
      partial: false,
      failedSuggestionIds: [],
      error: null,
    };
  }

  const payload = {
    flaggedForReview: true,
    flaggedReason: FLAG_REASON,
    flaggedAt,
    flaggedBy: adminUid,
  };

  return commitChunked(toFlag, payload, 'flag', skippedCount);
}

async function unflagUnsuspendedUserSuggestions(uid) {
  const normalizedUid = normalizeUid(uid);
  const snap = await db.collection('suggestions').where('submitterUid', '==', normalizedUid).get();

  if (!snap || snap.empty) {
    return {
      unflaggedCount: 0,
      skippedCount: 0,
      partial: false,
      failedSuggestionIds: [],
      error: null,
    };
  }

  const toClear = [];
  let skippedCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.flaggedForReview === true && data.flaggedReason === FLAG_REASON) {
      toClear.push(doc);
    } else {
      skippedCount += 1;
    }
  }

  if (toClear.length === 0) {
    return {
      unflaggedCount: 0,
      skippedCount,
      partial: false,
      failedSuggestionIds: [],
      error: null,
    };
  }

  const payload = {
    flaggedForReview: false,
    flaggedReason: null,
    flaggedAt: null,
    flaggedBy: null,
  };

  return commitChunked(toClear, payload, 'unflag', skippedCount);
}

async function commitChunked(docs, payload, mode, skippedCount = 0) {
  const failedSuggestionIds = [];
  let firstError = null;

  for (let i = 0; i < docs.length; i += 500) {
    const chunk = docs.slice(i, i + 500);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, payload);
    }
    try {
      await batch.commit();
    } catch (err) {
      log.error('flag-suspended-user-suggestions', `Batch ${mode} commit failed`, {
        chunkStart: i,
        chunkSize: chunk.length,
        error: err && err.message,
      });
      for (const doc of chunk) failedSuggestionIds.push(doc.id);
      if (!firstError) firstError = err && err.message ? err.message : String(err);
    }
  }

  const successCount = docs.length - failedSuggestionIds.length;
  const partial = failedSuggestionIds.length > 0;

  if (mode === 'flag') {
    return {
      flaggedCount: successCount,
      skippedCount,
      partial,
      failedSuggestionIds,
      error: firstError,
    };
  }
  return {
    unflaggedCount: successCount,
    skippedCount,
    partial,
    failedSuggestionIds,
    error: firstError,
  };
}

module.exports = {
  flagSuspendedUserSuggestions,
  unflagUnsuspendedUserSuggestions,
  FLAG_REASON,
  FLAGGABLE_STATUSES,
};
