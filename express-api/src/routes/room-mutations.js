/**
 * Server-authoritative room mutations (anti-grief + race-safety hardening).
 *
 * Previously the client RoomRepository wrote the room doc directly, and
 * firestore.rules let any same-cohort participant write any field — so all
 * role/seat gates were CLIENT-ONLY (a hand-crafted write could self-promote
 * to host, kick anyone, or seize a seat), and seat claims were non-atomic
 * (`update()` with no precondition => concurrent claims last-write-wins, or a
 * user seated twice).
 *
 * These endpoints enforce the ChatRoom gates SERVER-SIDE via the Admin SDK
 * (bypasses rules) with TRANSACTIONAL seat claims: a seat has <=1 occupant and
 * a user occupies <=1 seat. firestore.rules is tightened in a later phase to
 * forbid direct client room-doc writes.
 *
 * Phase 1 — seat lifecycle (claim / accept-invite / leave). Moderation +
 * owner/settings ops follow in subsequent chunks.
 */

const router = require('express').Router();
const { db, rtdb, FieldValue } = require('../utils/firebase');
const { cohortFromClaim } = require('../utils/firebase-claims');
const {
  canTakeSeatDirectly,
  userSeatIndex,
  MAX_SEATS,
  OWNER_SEAT_INDEX,
} = require('../utils/room-auth');
const log = require('../utils/log');

/** Supplementary RTDB nudge (the Firestore room-doc listener is the primary propagation). */
async function broadcastRoomUpdated(roomId) {
  try {
    await rtdb
      .ref(`rooms/${roomId}/events/lastEvent`)
      .set({ type: 'room_updated', ts: Date.now() });
  } catch (err) {
    log.error('room-mutations', 'RTDB broadcast failed', { roomId, error: err.message });
  }
}

/** Parse + bounds-check a seat index from the path; null if invalid. */
function parseSeatIndex(raw) {
  const idx = Number(raw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SEATS) return null;
  return idx;
}

/**
 * Load the room + apply the cohort gate inside a transaction, then delegate
 * to `mutate(room, t, roomRef) -> { status, body }`. The room is cohort-
 * stamped at create; a cohort mismatch is hidden as 404 (OSA existence-hide).
 */
async function inRoomTransaction(req, roomId, mutate) {
  const roomRef = db.doc(`rooms/${roomId}`);
  return db.runTransaction(async (t) => {
    const snap = await t.get(roomRef);
    if (!snap.exists) return { status: 404, body: { error: 'Room not found' } };
    const room = snap.data();
    if (cohortFromClaim(req) !== (room.cohort ?? 'minor')) {
      return { status: 404, body: { error: 'Not found' } };
    }
    return mutate(room, t, roomRef);
  });
}

// POST /rooms/:roomId/seats/:seatIndex/claim — caller seats THEMSELVES.
router.post('/rooms/:roomId/seats/:seatIndex/claim', async (req, res) => {
  const { roomId } = req.params;
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      const seat = (room.seats || {})[String(seatIndex)] || {};
      if (seat.userId || seat.state === 'OCCUPIED') {
        return { status: 409, body: { error: 'Seat is already taken', code: 'SEAT_TAKEN' } };
      }
      if (!canTakeSeatDirectly(room, callerId, seatIndex)) {
        return { status: 403, body: { error: 'Not allowed to take this seat' } };
      }
      if (userSeatIndex(room, callerId) !== -1) {
        return { status: 409, body: { error: 'Already seated', code: 'ALREADY_SEATED' } };
      }
      t.update(roomRef, {
        [`seats.${seatIndex}.userId`]: callerId,
        [`seats.${seatIndex}.state`]: 'OCCUPIED',
        [`seats.${seatIndex}.isMuted`]: false,
        participantIds: FieldValue.arrayUnion(callerId),
        allTimeSeatUserIds: FieldValue.arrayUnion(callerId),
      });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Seat claim failed', { roomId, seatIndex, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/seats/:seatIndex/accept-invite — invited caller seats SELF.
router.post('/rooms/:roomId/seats/:seatIndex/accept-invite', async (req, res) => {
  const { roomId } = req.params;
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      const invited = Object.prototype.hasOwnProperty.call(room.pendingInvites || {}, callerId);
      if (!invited) return { status: 403, body: { error: 'No pending invite' } };
      if (seatIndex === OWNER_SEAT_INDEX)
        return { status: 403, body: { error: 'Seat 0 is owner-only' } };
      const seat = (room.seats || {})[String(seatIndex)] || {};
      if (seat.userId || seat.state === 'OCCUPIED') {
        return { status: 409, body: { error: 'Seat is already taken', code: 'SEAT_TAKEN' } };
      }
      if (userSeatIndex(room, callerId) !== -1) {
        return { status: 409, body: { error: 'Already seated', code: 'ALREADY_SEATED' } };
      }
      t.update(roomRef, {
        [`pendingInvites.${callerId}`]: FieldValue.delete(),
        [`seats.${seatIndex}.userId`]: callerId,
        [`seats.${seatIndex}.state`]: 'OCCUPIED',
        [`seats.${seatIndex}.isMuted`]: false,
        participantIds: FieldValue.arrayUnion(callerId),
        allTimeSeatUserIds: FieldValue.arrayUnion(callerId),
      });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Accept invite failed', { roomId, seatIndex, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/seats/:seatIndex/leave — caller leaves their OWN seat.
router.post('/rooms/:roomId/seats/:seatIndex/leave', async (req, res) => {
  const { roomId } = req.params;
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      const seat = (room.seats || {})[String(seatIndex)] || {};
      if (String(seat.userId) !== callerId) {
        return { status: 403, body: { error: 'Not your seat' } };
      }
      t.update(roomRef, {
        [`seats.${seatIndex}.userId`]: null,
        [`seats.${seatIndex}.state`]: 'EMPTY',
        [`seats.${seatIndex}.isMuted`]: false,
      });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Leave seat failed', { roomId, seatIndex, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
