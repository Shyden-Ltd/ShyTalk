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

module.exports = {
  OWNER_SEAT_INDEX,
  MAX_SEATS,
  resolveRole,
  canTakeSeatDirectly,
  userSeatIndex,
};
