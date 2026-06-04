/**
 * Owner-left handler — server-side event-driven response to the
 * `ownerLeft/{roomId}` RTDB signal (armed by the owner client via
 * `onDisconnect().setValue(...)` when entering an ACTIVE room).
 *
 * Replaces the staleRooms cron's role in detecting and acting on owner
 * disconnects. The cron polled every 5 minutes; this handler reacts within
 * RTDB's onDisconnect latency (seconds). The operator's refined state machine
 * (2026-06-04) determines the action:
 *
 *   - if the owner is still present somewhere (multi-device, reconnect within
 *     the handler's processing window) — NOOP
 *   - if the room is no longer ACTIVE (already AWAY/CLOSED via a concurrent
 *     path) — NOOP
 *   - if ACTIVE and at least one non-owner is OCCUPIED on a seat — transition
 *     to OWNER_AWAY (the existing client-driven countdown will then close it)
 *   - if ACTIVE and no non-owner is seated — close the room IMMEDIATELY
 *     (the cron's "no holdouts" branch would have closed it; we just don't
 *     wait the 5-minute tick)
 *
 * The decision is pure (`decideOwnerLeftAction`), the application is the
 * transactional wrapper (`applyOwnerLeftTx`). The orchestrator (which performs
 * the RTDB presence re-check, opens the Firestore transaction, applies the
 * action, and clears the signal) lives in the listener module.
 */

const { hasNonOwnerSeated } = require('./room-auth');
const { reapStaleRoomTx } = require('./stale-room-reap');

const OWNER_LEFT_ACTION = Object.freeze({
  NOOP: 'NOOP',
  OWNER_AWAY: 'OWNER_AWAY',
  CLOSE_IMMEDIATE: 'CLOSE_IMMEDIATE',
});

/**
 * Decide what to do given the room's current Firestore shape + whether the
 * owner is still present in RTDB (re-checked by the caller AFTER the signal
 * fired, to close the TOCTOU window where the owner reconnects between
 * signal arrival and handler execution, or is present on another device).
 *
 * @param {object|null|undefined} room - the room doc (from Firestore.get())
 * @param {boolean} ownerStillPresent - result of the post-signal isUserPresent
 *   re-check; if true, do nothing
 * @returns {string} one of OWNER_LEFT_ACTION values
 */
function decideOwnerLeftAction(room, ownerStillPresent) {
  if (ownerStillPresent) return OWNER_LEFT_ACTION.NOOP;
  if (!room || !room.state) return OWNER_LEFT_ACTION.NOOP;
  if (room.state !== 'ACTIVE') return OWNER_LEFT_ACTION.NOOP;
  if (hasNonOwnerSeated(room)) return OWNER_LEFT_ACTION.OWNER_AWAY;
  return OWNER_LEFT_ACTION.CLOSE_IMMEDIATE;
}

/**
 * Apply the decided action inside a Firestore transaction.
 *
 * NOOP / unknown actions are intentionally a no-op write (zero t.update calls)
 * so the caller can safely invoke this for every signal event without branching
 * on the action upstream.
 *
 * @param {FirebaseFirestore.Transaction} t
 * @param {FirebaseFirestore.DocumentReference} roomRef
 * @param {object} room - the pre-transition room shape (from t.get())
 * @param {string} action - one of OWNER_LEFT_ACTION values
 * @param {number} nowMs - server time at the start of this transaction
 * @returns {object} the post-transition room shape (room merged with the patch)
 */
function applyOwnerLeftTx(t, roomRef, room, action, nowMs) {
  if (action === OWNER_LEFT_ACTION.OWNER_AWAY) {
    const patch = { state: 'OWNER_AWAY', ownerLeftAt: nowMs };
    t.update(roomRef, patch);
    return { ...room, ...patch };
  }
  if (action === OWNER_LEFT_ACTION.CLOSE_IMMEDIATE) {
    // Reuse the close payload + write through reapStaleRoomTx so the close
    // shape stays a single source of truth (ownerLeftAt: null invariant from
    // PR #996's reviewer-Critical finding lives in buildClosePayload).
    return reapStaleRoomTx(t, roomRef, room, nowMs);
  }
  // NOOP or unknown — return the room as-is, no write.
  return room;
}

module.exports = {
  OWNER_LEFT_ACTION,
  decideOwnerLeftAction,
  applyOwnerLeftTx,
};
