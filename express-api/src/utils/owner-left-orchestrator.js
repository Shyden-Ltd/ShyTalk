/**
 * Owner-left orchestrator — composes the room read, the RTDB presence
 * re-check, and the Firestore-transactional decide+apply, returning the
 * action result so the caller (an RTDB listener wrapper) can decide whether
 * to clear the `ownerLeft/{roomId}` signal entry.
 *
 * Separation of concerns:
 *   - Pure decision: `decideOwnerLeftAction` (owner-left-handler.js)
 *   - Pure application: `applyOwnerLeftTx` (owner-left-handler.js)
 *   - Composition + transactional read: THIS module
 *   - Signal-lifecycle (RTDB add/remove): the listener wrapper
 *
 * The orchestrator THROWS on infrastructure errors (Firestore read/txn
 * failure, RTDB presence read failure via the injected presenceChecker) so
 * the caller can leave the signal in place for a retry; it returns a result
 * object on success.
 */

const {
  OWNER_LEFT_ACTION,
  decideOwnerLeftAction,
  applyOwnerLeftTx,
} = require('./owner-left-handler');

/**
 * Process an owner-left signal for `roomId`.
 *
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {(roomId: string, userId: string) => Promise<boolean>} args.presenceChecker
 *   Async; resolves to true if the user is present in RTDB right now. Should
 *   THROW on read errors so the caller can decide whether to retry — do not
 *   fail-safe-to-true inside the checker for this code path.
 * @param {string} args.roomId
 * @param {number} [args.nowMs] - server time captured by caller; defaults to
 *   Date.now() at the start of the transaction
 * @returns {Promise<{action: string, reason?: string, postRoom?: object}>}
 */
async function handleOwnerLeftSignal({ db, presenceChecker, roomId, nowMs }) {
  const roomRef = db.doc(`rooms/${roomId}`);

  // Pre-txn read to extract the authoritative ownerId. We deliberately do NOT
  // trust an ownerId passed in via the signal payload — clients write to the
  // RTDB signal path and could forge a different ownerId. The Firestore room
  // doc is the source of truth.
  const preSnap = await roomRef.get();
  if (!preSnap.exists) {
    return { action: OWNER_LEFT_ACTION.NOOP, reason: 'room-missing' };
  }
  const preRoom = preSnap.data();

  // TOCTOU re-check: the signal may be stale by the time we process it (owner
  // reconnected on a second device, or the same device finished a transient
  // disconnect). The checker is the authoritative gate; it throws on read
  // failure so the caller can preserve the signal for a later retry.
  const ownerStillPresent = await presenceChecker(roomId, preRoom.ownerId);

  const effectiveNowMs = nowMs ?? Date.now();

  return db.runTransaction(async (t) => {
    const snap = await t.get(roomRef);
    if (!snap.exists) {
      return { action: OWNER_LEFT_ACTION.NOOP, reason: 'room-missing-in-txn' };
    }
    const room = snap.data();
    const action = decideOwnerLeftAction(room, ownerStillPresent);
    const postRoom = applyOwnerLeftTx(t, roomRef, room, action, effectiveNowMs);
    return { action, postRoom };
  });
}

module.exports = {
  handleOwnerLeftSignal,
};
