/**
 * Owner-left RTDB listener — attaches a `child_added` listener to the
 * `ownerLeft` ref, delegates each fired child to the owner-left orchestrator,
 * and clears the signal entry on success.
 *
 * Wiring contract:
 *   1. Client (owner) arms `ownerLeft/{roomId}` onDisconnect on room entry
 *      (PR #998 Android, #999 iOS).
 *   2. RTDB writes the entry when the owner disconnects.
 *   3. This listener picks up the `child_added` event in Express.
 *   4. Orchestrator decides + applies the Firestore mutation.
 *   5. Listener clears the RTDB signal entry on success.
 *
 * Restart resilience: Firebase admin SDK's `.on('child_added', cb)` fires
 * synchronously for every existing child at attach time. That gives us a
 * free startup-scan — any signals written during Express downtime are
 * processed on next boot without any explicit catch-up code.
 *
 * The handler is intentionally crash-safe: orchestrator failures are caught
 * and logged, never rethrown. The signal entry is preserved on failure so a
 * later signal-fire or restart-scan can retry.
 */

const { handleOwnerLeftSignal: defaultHandleSignal } = require('./owner-left-orchestrator');

/** Conservative cap matching Firebase RTDB / Firestore reasonable id sizes. */
const MAX_ROOM_ID_LENGTH = 256;
const SAFE_ROOM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;
  if (roomId.length === 0 || roomId.length > MAX_ROOM_ID_LENGTH) return false;
  return SAFE_ROOM_ID_PATTERN.test(roomId);
}

/**
 * @param {object} args
 * @param {object} args.rtdb - firebase-admin Realtime Database instance
 * @param {object} args.db - firebase-admin Firestore instance
 * @param {(roomId: string, userId: string) => Promise<boolean>} args.presenceChecker
 * @param {object} args.log - logger with .warn / .error
 * @param {Function} [args.handleSignal] - injectable for tests; defaults to
 *   the real orchestrator
 * @returns {() => void} detach function (calls .off on the listener)
 */
function registerOwnerLeftListener({
  rtdb,
  db,
  presenceChecker,
  log,
  handleSignal = defaultHandleSignal,
}) {
  const ownerLeftRef = rtdb.ref('ownerLeft');

  async function onChildAdded(snap) {
    const roomId = snap && snap.key;
    if (!isValidRoomId(roomId)) {
      log.warn('owner-left-listener', 'Ignoring signal with invalid roomId', { roomId });
      return;
    }

    // The signal entry's value is the uid of the client that armed the
    // onDisconnect. The RTDB rule for `ownerLeft/{roomId}` forces
    // `newData.val() === auth.uid`, so an authenticated writer can only sign
    // with their own uid. The orchestrator additionally verifies the writer
    // is the room's owner — closing the "attacker writes ownerLeft for
    // victim's room" forgery vector.
    const writerUid = snap && typeof snap.val === 'function' ? snap.val() : undefined;

    let result;
    try {
      result = await handleSignal({ db, presenceChecker, roomId, writerUid });
    } catch (err) {
      // Orchestrator failed — leave the signal entry in place so a later
      // restart-scan or duplicate fire can retry.
      log.error('owner-left-listener', 'Processing failed; signal retained', {
        roomId,
        error: err && err.message,
      });
      return;
    }

    // Success path (incl. NOOP outcomes): clear the signal so we don't
    // re-process it on restart. A NOOP would just NOOP again, so there's
    // no value in retaining it.
    try {
      await snap.ref.remove();
    } catch (err) {
      log.error('owner-left-listener', 'Failed to clear signal after success', {
        roomId,
        action: result && result.action,
        error: err && err.message,
      });
    }
  }

  ownerLeftRef.on('child_added', onChildAdded);

  let detached = false;
  return function detach() {
    if (detached) return;
    detached = true;
    ownerLeftRef.off('child_added', onChildAdded);
  };
}

module.exports = {
  registerOwnerLeftListener,
  // Exported for direct re-use by future listeners that need the same
  // safe-key allowlist (defense-in-depth for any RTDB → Firestore path
  // interpolation). Not currently used outside this module.
  isValidRoomId,
};
