/**
 * Server-side mirror of the client room role/permission gates
 * (shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/ChatRoom.kt).
 *
 * The client checks are UX-only; THESE are the authoritative enforcement,
 * applied inside the Admin-SDK room-mutation endpoints (which bypass
 * firestore.rules). uniqueIds are stored as strings in the room doc
 * (ownerId, participantIds, hostIds, seats.*.userId), so every comparison
 * is String()-normalised — req.auth.uniqueId arrives as a number.
 */

const OWNER_SEAT_INDEX = 0;
const MAX_SEATS = 8;

function asIds(arr) {
  return (arr || []).map(String);
}

/** OWNER (room creator) | HOST (in hostIds) | ATTENDEE (everyone else). */
function resolveRole(room, callerId) {
  const id = String(callerId);
  if (String(room.ownerId) === id) return 'OWNER';
  if (asIds(room.hostIds).includes(id)) return 'HOST';
  return 'ATTENDEE';
}

/**
 * Mirror of ChatRoom.canTakeSeatDirectly: may `actorId` claim `seatIndex`
 * without going through the seat-request queue?
 * - seat 0 is owner-only (and the owner may sit ONLY in seat 0)
 * - hosts may take any non-owner seat unless the room requires approval
 * - attendees never bypass — they must create a seat request
 * Occupancy is re-checked by the caller transactionally; this is the
 * role/seat-policy gate only.
 */
function canTakeSeatDirectly(room, actorId, seatIndex) {
  const idx = Number(seatIndex);
  const role = resolveRole(room, actorId);
  if (role === 'OWNER' && idx !== OWNER_SEAT_INDEX) return false;
  if (idx === OWNER_SEAT_INDEX && role !== 'OWNER') return false;
  const seat = (room.seats || {})[String(idx)];
  if (!seat) return false;
  if (role === 'OWNER') return true;
  if (role === 'HOST') return !room.requireApproval;
  return false;
}

/**
 * Index of the seat currently occupied by `userId`, or -1 if none.
 * Per-user seat-uniqueness guard: a user may occupy at most one seat, so
 * a claim/accept must reject when this returns >= 0.
 */
function userSeatIndex(room, userId) {
  const id = String(userId);
  const seats = room.seats || {};
  for (const idx of Object.keys(seats)) {
    if (seats[idx] && String(seats[idx].userId) === id) return Number(idx);
  }
  return -1;
}

/**
 * Mirror of ChatRoom.canKickUser: may `actorId` kick/ban `targetId`?
 * Owners are never kickable; owner may kick anyone; host may kick non-hosts;
 * attendees may kick no one.
 */
function canKickUser(room, actorId, targetId) {
  if (String(targetId) === String(room.ownerId)) return false;
  const role = resolveRole(room, actorId);
  if (role === 'OWNER') return true;
  if (role === 'HOST') return !asIds(room.hostIds).includes(String(targetId));
  return false;
}

/**
 * Mirror of ChatRoom.canRemoveFromSeat: may `actorId` force-vacate the
 * occupant of `seatIndex` (without banning)? Seat 0 can never be force-
 * vacated; otherwise the actor must be able to kick the occupant.
 */
function canRemoveFromSeat(room, actorId, seatIndex) {
  if (Number(seatIndex) === OWNER_SEAT_INDEX) return false;
  const occupantId = ((room.seats || {})[String(seatIndex)] || {}).userId;
  if (!occupantId) return false;
  return canKickUser(room, actorId, occupantId);
}

/**
 * Mirror of ChatRoom.canForceMute: may `actorId` force-MUTE the occupant of
 * `seatIndex`? Never the owner; never an already-muted seat (only the
 * occupant may unmute themselves); a host may not mute another host.
 */
function canForceMute(room, actorId, seatIndex) {
  const seat = (room.seats || {})[String(seatIndex)];
  if (!seat || !seat.userId) return false;
  if (String(seat.userId) === String(room.ownerId)) return false;
  if (seat.isMuted) return false;
  const role = resolveRole(room, actorId);
  if (role === 'OWNER') return true;
  if (role === 'HOST') return !asIds(room.hostIds).includes(String(seat.userId));
  return false;
}

// mirrors Constants.OWNER_LEAVE_TIMEOUT_MS (5 minutes) — the owner-away grace
// window after which any remaining participant may close the room.
const OWNER_LEAVE_TIMEOUT_MS = 300000;

/**
 * True if any seat is OCCUPIED by a non-owner, optionally excluding `exceptId`
 * (e.g. the caller who is in the act of leaving). Mirrors the client's
 * `hasSeatedNonOwners` + staleRooms.js predicate; used to decide when an
 * OWNER_AWAY room is empty enough to close.
 */
function hasNonOwnerSeated(room, exceptId = null) {
  const ownerId = String(room.ownerId);
  const except = exceptId === null ? null : String(exceptId);
  return Object.values(room.seats || {}).some(
    (seat) =>
      seat &&
      seat.userId &&
      seat.state === 'OCCUPIED' &&
      String(seat.userId) !== ownerId &&
      String(seat.userId) !== except,
  );
}

/**
 * Mirror of ActiveRoomManager.moveSeat: may `actorId` move the occupant of
 * `fromIndex` to `toIndex`? Owner/host only (attendees never); neither seat may
 * be the owner seat; the source must be occupied; a host may not move the owner
 * or another host. The actual swap (and per-user uniqueness, preserved by
 * construction) is applied transactionally by the caller.
 */
function canMoveSeat(room, actorId, fromIndex, toIndex) {
  if (Number(fromIndex) === OWNER_SEAT_INDEX || Number(toIndex) === OWNER_SEAT_INDEX) return false;
  const role = resolveRole(room, actorId);
  if (role === 'ATTENDEE') return false;
  const occupantId = ((room.seats || {})[String(fromIndex)] || {}).userId;
  if (!occupantId) return false;
  if (role === 'HOST') {
    if (String(occupantId) === String(room.ownerId)) return false;
    if (asIds(room.hostIds).includes(String(occupantId))) return false;
  }
  return true;
}

/**
 * May `callerId` close the room (at server time `nowMs`)?
 *  - the OWNER may always close;
 *  - otherwise a PARTICIPANT may close only an OWNER_AWAY room, and only once
 *    either no other non-owner is still seated OR the owner-away grace window
 *    has elapsed.
 * Mirrors ActiveRoomManager.leaveRoom (close when no seated non-owners remain)
 * + handleOwnerAwayCountdown (any participant closes an expired OWNER_AWAY
 * room). The state/precondition gate is what stops a malicious non-owner from
 * closing a live room.
 */
function canCloseRoom(room, callerId, nowMs) {
  if (resolveRole(room, callerId) === 'OWNER') return true;
  if (room.state !== 'OWNER_AWAY') return false;
  if (!asIds(room.participantIds).includes(String(callerId))) return false;
  if (!hasNonOwnerSeated(room, callerId)) return true;
  // `?? NaN` makes a missing/null ownerLeftAt yield NaN, so the comparison is
  // false (not-yet-expired) without a loose `!= null` check.
  return nowMs - Number(room.ownerLeftAt ?? NaN) >= OWNER_LEAVE_TIMEOUT_MS;
}

/**
 * May `callerId` transition the room to OWNER_AWAY? The OWNER always may
 * (graceful leave with others present). A non-owner may ONLY as the presence-
 * monitor safety net: the room must be ACTIVE, the caller a participant, and
 * the owner verifiably ABSENT (`ownerPresent === false`, read from RTDB
 * presence by the caller before the transaction). This blocks a forged
 * owner-away while the owner is actually connected.
 */
function canSetOwnerAway(room, callerId, ownerPresent) {
  if (resolveRole(room, callerId) === 'OWNER') return true;
  if (room.state !== 'ACTIVE') return false;
  if (ownerPresent) return false;
  return asIds(room.participantIds).includes(String(callerId));
}

/**
 * May `callerId` remove the DISCONNECTED user `targetId` (presence-timeout
 * eviction by the client presence monitor)? The target must NOT be the owner
 * (owner disconnect → owner-away, never removal), must be verifiably ABSENT
 * (`targetPresent === false`, read from RTDB by the caller before the txn), and
 * the caller must be a participant. Mirrors ActiveRoomManager's presence-monitor
 * non-owner removal branch; the presence precondition is what stops this being
 * abused as an "evict any participant" primitive.
 */
function canRemoveDisconnected(room, callerId, targetId, targetPresent) {
  if (String(targetId) === String(room.ownerId)) return false;
  if (targetPresent) return false;
  // Already-removed guard: a concurrent /leave or another presence-monitor
  // /disconnect-user may have removed the target between the client deciding
  // to evict and this request landing. Without this check the gate passes,
  // the arrayRemove is a no-op, but we still write an unnecessary user-doc
  // currentRoomId clear and fire a broadcast.
  if (!asIds(room.participantIds).includes(String(targetId))) return false;
  return asIds(room.participantIds).includes(String(callerId));
}

module.exports = {
  OWNER_SEAT_INDEX,
  MAX_SEATS,
  OWNER_LEAVE_TIMEOUT_MS,
  resolveRole,
  canTakeSeatDirectly,
  userSeatIndex,
  canKickUser,
  canRemoveFromSeat,
  canForceMute,
  hasNonOwnerSeated,
  canMoveSeat,
  canCloseRoom,
  canSetOwnerAway,
  canRemoveDisconnected,
};
