/**
 * Watch transfer on merge — SHY-0258.
 *
 * When a duplicate suggestion is merged into an original, everyone watching the
 * duplicate must end up watching the original. Without this they silently stop
 * hearing about the thing they asked to follow: the duplicate never changes
 * again (it is terminal at `merged`), so their watch is attached to a record
 * that will never produce another update. Nothing tells them, and nothing looks
 * broken — the worst shape a notification failure can take.
 *
 * Idempotent by construction: `arrayRemove` + `arrayUnion` converge, so
 * replaying a merge (a retry, a double-click) cannot duplicate a watch or lose
 * one. Someone already watching BOTH suggestions ends up watching the original
 * exactly once.
 */

const { db, FieldValue } = require('./firebase');
const log = require('./log');

/**
 * Bound on watchers moved per merge. Large enough for any plausible
 * suggestion, small enough that a corrupt query cannot turn one admin action
 * into an unbounded write storm.
 */
const MAX_WATCHERS_PER_TRANSFER = 500;

/**
 * Move every watcher of `fromSuggestionId` onto `toSuggestionId`.
 *
 * Never throws: a merge that succeeded must not be reported as failed because
 * the bookkeeping behind it stumbled. Returns the number of watchers moved so
 * callers and tests can assert the work happened rather than trusting a silent
 * resolve.
 */
async function transferWatchers(fromSuggestionId, toSuggestionId) {
  if (!fromSuggestionId || !toSuggestionId || fromSuggestionId === toSuggestionId) return 0;

  try {
    const snap = await db
      .collection('subscriptions')
      .where('watchedSuggestions', 'array-contains', fromSuggestionId)
      .limit(MAX_WATCHERS_PER_TRANSFER)
      .get();

    if (snap.empty) return 0;

    await Promise.all(
      snap.docs.map((doc) =>
        doc.ref.update({
          watchedSuggestions: FieldValue.arrayRemove(fromSuggestionId),
        }),
      ),
    );
    // Two passes rather than one: a single update cannot arrayRemove and
    // arrayUnion the same field, and doing the union second means a failure
    // between them leaves someone watching neither rather than the merged-away
    // duplicate — recoverable by re-running, and never a watch on a dead record.
    await Promise.all(
      snap.docs.map((doc) =>
        doc.ref.update({
          watchedSuggestions: FieldValue.arrayUnion(toSuggestionId),
        }),
      ),
    );

    return snap.size;
  } catch (err) {
    log.error('watch-transfer', 'Failed to transfer watchers', {
      fromSuggestionId,
      toSuggestionId,
      error: err.message,
    });
    return 0;
  }
}

module.exports = { transferWatchers, MAX_WATCHERS_PER_TRANSFER };
