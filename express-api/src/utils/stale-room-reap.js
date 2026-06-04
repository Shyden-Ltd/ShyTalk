/**
 * Stale-room lazy reap — server-side replacement for the staleRooms cron's
 * close-decision path.
 *
 * When a room enters OWNER_AWAY state (owner gracefully or ungracefully
 * disconnects), the room must eventually close. The staleRooms cron polls
 * every 5 minutes (~288 Firestore reads/day baseline). This module lets
 * any participant-triggered room mutation reap the stale room inline as
 * part of the transaction — no polling needed for the active-traffic case.
 *
 * Scope of this PR:
 *  - The cron stays running for abandoned-rooms safety (rooms with zero
 *    further participant traffic after owner leaves). Future PRs add
 *    RTDB onDisconnect client-side to catch those, and the cron is then
 *    deleted entirely.
 *  - User-doc currentRoomId clears are NOT done here — the cron handles
 *    them within 5 minutes. After RTDB onDisconnect lands, this module
 *    will take that over too.
 *
 * The close-decision MUST match the cron's predicate so behaviour stays
 * consistent during the transition:
 *   - state === 'OWNER_AWAY'
 *   - AND (no non-owner seated || ownerLeftAt < (now - timeout))
 */

const { hasNonOwnerSeated, MAX_SEATS } = require('./room-auth');

// Matches src/cron/staleRooms.js's tenMinutesAgo computation. Aligns the
// lazy-reap upper bound with what the cron would have done, so a room
// closed by lazy reap and a room closed by the cron use the same
// `ownerLeftAt` cutoff.
const STALE_ROOM_TIMEOUT_MS = 10 * 60 * 1000;

// Grace window for the "no holdouts" case. The cron has an effective
// 0-5 min grace because it only runs every 5 minutes — a room with no
// non-owner seated stays OWNER_AWAY until the next cron tick. Lazy reap
// has no tick rate (fires on every access), so without an explicit
// grace it would close instantly on the first access — even the owner
// returning or a user joining within the natural 5-min window. The
// grace preserves owner-can-return-quickly and join-during-grace UX.
const STALE_ROOM_NO_HOLDOUTS_GRACE_MS = 5 * 60 * 1000;

/**
 * Should this room be reaped right now?
 *
 * Semantics (matches the staleRooms cron's effective in-production
 * behaviour with the cron's tick-rate grace expressed explicitly):
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
 * Build the close payload that staleRooms.js writes — same shape so the
 * room transitions identically whether the cron or the lazy reap fires.
 */
function buildClosePayload(nowMs) {
  const emptySeat = { userId: null, state: 'EMPTY', isMuted: false };
  const emptySeats = {};
  for (let i = 0; i < MAX_SEATS; i++) emptySeats[String(i)] = { ...emptySeat };
  // `ownerLeftAt: null` matches both staleRooms.js and the /close
  // endpoint's payload. Without it, a reaped room would carry a
  // stale OWNER_AWAY timestamp on a CLOSED row, diverging from
  // every other close path.
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
