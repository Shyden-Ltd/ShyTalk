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

module.exports = {
  OWNER_SEAT_INDEX,
  MAX_SEATS,
  resolveRole,
  canTakeSeatDirectly,
  userSeatIndex,
  canKickUser,
  canRemoveFromSeat,
  canForceMute,
};
