/**
 * Stale-room lazy reap — defense-in-depth for OWNER_AWAY room closure.
 *
 * When a room enters OWNER_AWAY state (owner gracefully or ungracefully
 * disconnects), the room must eventually close. Closure happens via three
 * paths, in descending order of latency:
 *
 *  1. RTDB ownerLeft signal (PRs A0-A2 of the cron-elim cluster) — the
 *     owner client arms an onDisconnect at room entry; the server-side
 *     listener consumes the signal within seconds of disconnect and
 *     transitions the room via owner-left-handler's decideOwnerLeftAction.
 *     This is the primary path.
 *  2. This lazy reap — any participant-triggered room mutation reaps the
 *     stale room inline as part of the transaction. Covers the residual
 *     case where the ownerLeft signal somehow missed (signal failed to
 *     fire, server-side retry exhausted, race conditions) AND a
 *     participant happens to touch the room afterwards.
 *  3. (Eliminated) The staleRooms cron polled every 5 min; deleted in
 *     cron-elim A4 once the event-driven signal was verified in production.
 *
 * The lazy reap and the ownerLeft handler share the same close predicate
 * for behaviour consistency:
 *   - state === 'OWNER_AWAY'
 *   - AND (no non-owner seated past grace || ownerLeftAt < (now - timeout))
 */

const { hasNonOwnerSeated, MAX_SEATS } = require('./room-auth');

// Aligns with the owner-left handler's effective timeout. Rooms closed by
// either path share the same `ownerLeftAt` cutoff so the close decision is
// indistinguishable to downstream consumers.
const STALE_ROOM_TIMEOUT_MS = 10 * 60 * 1000;

// Grace window for the "no holdouts" case. Without an explicit grace
// lazy reap (which has no tick rate — fires on every access) would close
// instantly on the first access, including the owner's own /owner-returned
// or a user joining within the natural 5-min window. The grace preserves
// owner-can-return-quickly and join-during-grace UX. Matches the historical
// 0-5 min effective grace from the deleted cron's tick rate.
const STALE_ROOM_NO_HOLDOUTS_GRACE_MS = 5 * 60 * 1000;

/**
 * Should this room be reaped right now?
 *
 * Semantics (mirrors the owner-left handler's decideOwnerLeftAction
 * predicate with the historical cron's tick-rate grace expressed
 * explicitly):
 *  - state must be OWNER_AWAY and ownerLeftAt must be set
 *  - the owner calling is never reaped (they're reclaiming the room
 *    via /owner-returned or any other mutation — the close-on-access
 *    pattern must NOT fight the state machine's OWNER_AWAY → ACTIVE
 *    transition)
 *  - "no holdouts" branch waits the grace window first (so a join in
 *    the first few minutes after owner leaves still succeeds, matching
 *    cron-tick behaviour)
 *  - "holdouts present" branch waits the full timeout
 *
 * @param {object} room
 * @param {number} nowMs - current time in ms-since-epoch
 * @param {string|number|null} [callerId] - the participant whose
 *   mutation triggered this check; the owner is never reaped against
 * @returns {boolean}
 */
function shouldReapStaleRoom(room, nowMs, callerId = null) {
  if (!room || room.state !== 'OWNER_AWAY') return false;
  if (!room.ownerLeftAt) return false;
  if (callerId !== null && callerId !== undefined && String(callerId) === String(room.ownerId)) {
    return false;
  }
  const ageMs = nowMs - Number(room.ownerLeftAt);
  if (!hasNonOwnerSeated(room)) {
    return ageMs >= STALE_ROOM_NO_HOLDOUTS_GRACE_MS;
  }
  return ageMs >= STALE_ROOM_TIMEOUT_MS;
}

/**
 * Build the close payload. Same shape as the owner-left handler's
 * applyOwnerLeftTx close branch and the /api/rooms/:id/close endpoint,
 * so a room transitions identically regardless of which path fired.
 */
function buildClosePayload(nowMs) {
  const emptySeat = { userId: null, state: 'EMPTY', isMuted: false };
  const emptySeats = {};
  for (let i = 0; i < MAX_SEATS; i++) emptySeats[String(i)] = { ...emptySeat };
  // `ownerLeftAt: null` matches the owner-left handler's close branch
  // and the /api/rooms/:id/close endpoint payload. Without it, a reaped
  // room would carry a stale OWNER_AWAY timestamp on a CLOSED row,
  // diverging from every other close path.
  return {
    state: 'CLOSED',
    closedAt: nowMs,
    seats: emptySeats,
    participantIds: [],
    ownerLeftAt: null,
  };
}

/**
 * Apply the close to the room within a Firestore transaction.
 *
 * @param {FirebaseFirestore.Transaction} t
 * @param {FirebaseFirestore.DocumentReference} roomRef
 * @param {object} room - current room data (used only to confirm we're
 *   acting on the right state; the close payload is independent)
 * @param {number} nowMs
 * @returns {object} the post-close room shape (same shape mutate() will see)
 */
function reapStaleRoomTx(t, roomRef, room, nowMs) {
  const payload = buildClosePayload(nowMs);
  t.update(roomRef, payload);
  return { ...room, ...payload };
}

module.exports = {
  STALE_ROOM_TIMEOUT_MS,
  STALE_ROOM_NO_HOLDOUTS_GRACE_MS,
  shouldReapStaleRoom,
  reapStaleRoomTx,
  buildClosePayload,
};
