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
 * Phase 1 — the full server-authoritative room-mutation surface: seat lifecycle
 * (claim / accept-invite / leave / move), moderation (kick / remove / mute /
 * add+remove host), join (with ban enforcement), invite-decline, room settings
 * (rename / require-approval) and room lifecycle (owner-away / owner-returned /
 * close). firestore.rules is tightened in a later phase to forbid direct client
 * room-doc writes.
 */

const router = require('express').Router();
const { db, rtdb, FieldValue } = require('../utils/firebase');
const { cohortFromClaim } = require('../utils/firebase-claims');
const {
  canTakeSeatDirectly,
  userSeatIndex,
  canKickUser,
  canRemoveFromSeat,
  canForceMute,
  canMoveSeat,
  canCloseRoom,
  canSetOwnerAway,
  resolveRole,
  MAX_SEATS,
  OWNER_SEAT_INDEX,
} = require('../utils/room-auth');
const log = require('../utils/log');

// Mirrors the client room-name input cap (CreateRoomDialog: length <= 50).
const MAX_ROOM_NAME_LENGTH = 50;

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

/**
 * Owner-presence check for the non-owner setOwnerAway safety-net path. Reads
 * RTDB presence at rooms/<roomId>/presence/<ownerId>. FAIL-SAFE to "present"
 * on any read error so a presence outage can never let a non-owner forge an
 * owner-away transition while the owner is actually connected.
 */
async function isOwnerPresent(roomId, ownerId) {
  try {
    const snap = await rtdb.ref(`rooms/${roomId}/presence/${ownerId}`).get();
    return snap.exists();
  } catch (err) {
    log.error('room-mutations', 'Owner presence read failed', {
      roomId,
      ownerId,
      error: err.message,
    });
    return true;
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

// POST /rooms/:roomId/kick — owner/host bans + removes a target user.
router.post('/rooms/:roomId/kick', async (req, res) => {
  const { roomId } = req.params;
  const targetId = String(req.body?.userId ?? '') || null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  const kickerName = typeof req.body?.kickerName === 'string' ? req.body.kickerName : '';
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (!canKickUser(room, callerId, targetId)) {
        return { status: 403, body: { error: 'Not allowed to kick this user' } };
      }
      const update = {
        bannedUserIds: FieldValue.arrayUnion(targetId),
        participantIds: FieldValue.arrayRemove(targetId),
        [`kickInfo.${targetId}`]: { kickerName, reason },
      };
      const seatIdx = userSeatIndex(room, targetId);
      if (seatIdx !== -1) {
        update[`seats.${seatIdx}.userId`] = null;
        update[`seats.${seatIdx}.state`] = 'EMPTY';
        update[`seats.${seatIdx}.isMuted`] = false;
      }
      t.update(roomRef, update);
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Kick failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/seats/:seatIndex/remove — owner/host vacates a seat (no ban).
router.post('/rooms/:roomId/seats/:seatIndex/remove', async (req, res) => {
  const { roomId } = req.params;
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (!canRemoveFromSeat(room, callerId, seatIndex)) {
        return { status: 403, body: { error: 'Not allowed to remove this occupant' } };
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
    log.error('room-mutations', 'Remove from seat failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /rooms/:roomId/seats/:seatIndex/mute — force-mute (owner/host) or self-unmute.
router.patch('/rooms/:roomId/seats/:seatIndex/mute', async (req, res) => {
  const { roomId } = req.params;
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  if (typeof req.body?.isMuted !== 'boolean') {
    return res.status(400).json({ error: 'isMuted (boolean) required' });
  }
  const { isMuted } = req.body;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      const seat = (room.seats || {})[String(seatIndex)] || {};
      if (!seat.userId) return { status: 409, body: { error: 'Seat is empty' } };
      if (isMuted) {
        // Force-mute: moderator gate (owner/host, not owner/other-host, not already muted).
        if (!canForceMute(room, callerId, seatIndex)) {
          return { status: 403, body: { error: 'Not allowed to mute this seat' } };
        }
      } else if (String(seat.userId) !== callerId) {
        // Unmute: only the seat's own occupant may unmute themselves.
        return { status: 403, body: { error: 'Only the occupant can unmute' } };
      }
      t.update(roomRef, { [`seats.${seatIndex}.isMuted`]: isMuted });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Mute toggle failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/hosts — OWNER promotes a participant to host.
router.post('/rooms/:roomId/hosts', async (req, res) => {
  const { roomId } = req.params;
  const targetId = String(req.body?.userId ?? '') || null;
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (resolveRole(room, callerId) !== 'OWNER') {
        return { status: 403, body: { error: 'Only the owner can add hosts' } };
      }
      if (String(targetId) === String(room.ownerId)) {
        return { status: 400, body: { error: 'Owner is not a host' } };
      }
      t.update(roomRef, {
        hostIds: FieldValue.arrayUnion(targetId),
        allTimeHostIds: FieldValue.arrayUnion(targetId),
      });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Add host failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /rooms/:roomId/hosts/:userId — OWNER demotes a host.
router.delete('/rooms/:roomId/hosts/:userId', async (req, res) => {
  const { roomId } = req.params;
  const targetId = String(req.params.userId);
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (resolveRole(room, callerId) !== 'OWNER') {
        return { status: 403, body: { error: 'Only the owner can remove hosts' } };
      }
      t.update(roomRef, { hostIds: FieldValue.arrayRemove(targetId) });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Remove host failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /rooms/:roomId/name — OWNER renames the room.
router.patch('/rooms/:roomId/name', async (req, res) => {
  const { roomId } = req.params;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    return res.status(400).json({ error: 'name too long' });
  }
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (resolveRole(room, callerId) !== 'OWNER') {
        return { status: 403, body: { error: 'Only the owner can rename the room' } };
      }
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      t.update(roomRef, { name });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Rename failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /rooms/:roomId/require-approval — OWNER toggles the seat-approval policy.
router.patch('/rooms/:roomId/require-approval', async (req, res) => {
  const { roomId } = req.params;
  if (typeof req.body?.requireApproval !== 'boolean') {
    return res.status(400).json({ error: 'requireApproval (boolean) required' });
  }
  const { requireApproval } = req.body;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (resolveRole(room, callerId) !== 'OWNER') {
        return { status: 403, body: { error: 'Only the owner can change approval settings' } };
      }
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      t.update(roomRef, { requireApproval });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Set requireApproval failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/owner-returned — OWNER returns from OWNER_AWAY.
router.post('/rooms/:roomId/owner-returned', async (req, res) => {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (resolveRole(room, callerId) !== 'OWNER') {
        return { status: 403, body: { error: 'Only the owner can return to the room' } };
      }
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      // Idempotent: already active — no write, no spurious broadcast.
      if (room.state === 'ACTIVE') return { status: 200, body: { success: true } };
      t.update(roomRef, { state: 'ACTIVE', ownerLeftAt: null });
      return { status: 200, body: { success: true }, mutated: true };
    });
    if (result.status === 200 && result.mutated) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Owner returned failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/owner-away — OWNER (or a participant when the owner is
// verifiably absent) transitions the room to OWNER_AWAY. Presence is read
// BEFORE the transaction (RTDB reads can't run inside a Firestore txn); the
// txn re-validates state/role atomically.
router.post('/rooms/:roomId/owner-away', async (req, res) => {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  try {
    const roomRef = db.doc(`rooms/${roomId}`);
    const preSnap = await roomRef.get();
    if (!preSnap.exists) return res.status(404).json({ error: 'Room not found' });
    const preRoom = preSnap.data();
    if (cohortFromClaim(req) !== (preRoom.cohort ?? 'minor')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const callerIsOwner = resolveRole(preRoom, callerId) === 'OWNER';
    // Presence is read here, immediately before the txn, to keep the window
    // between read and commit minimal. A residual TOCTOU window is unavoidable
    // (RTDB can't be read inside a Firestore txn): if the owner reconnects
    // within it the room may briefly flip to OWNER_AWAY — self-healing via
    // owner-returned. This mirrors the client presence monitor and is strictly
    // safer than the prior client-only write. (Fully closing it needs a
    // Firestore-visible presence token — tracked for the rules-lockdown phase.)
    const ownerPresent = callerIsOwner ? false : await isOwnerPresent(roomId, preRoom.ownerId);

    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists) return { status: 404, body: { error: 'Room not found' } };
      const room = snap.data();
      if (cohortFromClaim(req) !== (room.cohort ?? 'minor')) {
        return { status: 404, body: { error: 'Not found' } };
      }
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      if (!canSetOwnerAway(room, callerId, ownerPresent)) {
        return { status: 403, body: { error: 'Not allowed to set owner away' } };
      }
      // Idempotent: already away (e.g. owner re-triggers). Placed AFTER the auth
      // gate so a non-participant can't probe room state via a 200.
      if (room.state === 'OWNER_AWAY') return { status: 200, body: { success: true } };
      t.update(roomRef, { state: 'OWNER_AWAY', ownerLeftAt: Date.now() });
      return { status: 200, body: { success: true }, mutated: true };
    });
    if (result.status === 200 && result.mutated) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Owner away failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/close — OWNER (or a participant under the OWNER_AWAY
// close preconditions) ends the room: empties seats + participants and clears
// every participant's currentRoomId (foreign user-doc writes that only the
// server may perform once firestore.rules is locked down).
router.post('/rooms/:roomId/close', async (req, res) => {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  const now = Date.now();
  let participantsToClear = [];
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (!canCloseRoom(room, callerId, now)) {
        return { status: 403, body: { error: 'Not allowed to close this room' } };
      }
      if (room.state === 'CLOSED') return { status: 200, body: { success: true } }; // idempotent
      participantsToClear = (room.participantIds || []).map(String);
      const emptySeats = {};
      for (let i = 0; i < MAX_SEATS; i += 1) {
        emptySeats[String(i)] = { userId: null, state: 'EMPTY', isMuted: false };
      }
      t.update(roomRef, {
        state: 'CLOSED',
        closedAt: now,
        ownerLeftAt: null,
        seats: emptySeats,
        participantIds: [],
      });
      return { status: 200, body: { success: true }, closed: true };
    });
    if (result.status === 200 && result.closed) {
      // Best-effort: a failure here must NOT undo the already-committed close;
      // clients also self-clear their own currentRoomId on observing the close.
      try {
        if (participantsToClear.length) {
          const batch = db.batch();
          for (const pid of participantsToClear) {
            batch.set(db.doc(`users/${pid}`), { currentRoomId: null }, { merge: true });
          }
          await batch.commit();
        }
      } catch (err) {
        log.error('room-mutations', 'closeRoom currentRoomId clear failed', {
          roomId,
          error: err.message,
        });
      }
      await broadcastRoomUpdated(roomId);
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Close room failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/seats/:seatIndex/move — owner/host moves a seat occupant
// to another seat, swapping with the target seat's contents. seatIndex is the
// SOURCE; the destination is `toIndex` in the body. Mirrors
// ActiveRoomManager.moveSeat: neither seat may be the owner seat, and a host
// may not move the owner or another host.
router.post('/rooms/:roomId/seats/:seatIndex/move', async (req, res) => {
  const { roomId } = req.params;
  const fromIndex = parseSeatIndex(req.params.seatIndex);
  if (fromIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const toIndex = parseSeatIndex(req.body?.toIndex);
  if (toIndex === null) return res.status(400).json({ error: 'Invalid target seat index' });
  if (fromIndex === toIndex) {
    return res.status(400).json({ error: 'Source and target seats are the same' });
  }
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      if (!canMoveSeat(room, callerId, fromIndex, toIndex)) {
        return { status: 403, body: { error: 'Not allowed to move this seat' } };
      }
      const seats = room.seats || {};
      const fromSeat = seats[String(fromIndex)] || {};
      const toSeat = seats[String(toIndex)] || {};
      t.update(roomRef, {
        [`seats.${fromIndex}.userId`]: toSeat.userId ?? null,
        [`seats.${fromIndex}.state`]: toSeat.state ?? 'EMPTY',
        [`seats.${fromIndex}.isMuted`]: toSeat.isMuted ?? false,
        [`seats.${toIndex}.userId`]: fromSeat.userId ?? null,
        [`seats.${toIndex}.state`]: fromSeat.state ?? 'EMPTY',
        [`seats.${toIndex}.isMuted`]: fromSeat.isMuted ?? false,
      });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Move seat failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/join — caller joins the room's participant list. The ban
// list is enforced server-side here. currentRoomId is the caller's own user-doc
// field and remains a client write.
router.post('/rooms/:roomId/join', async (req, res) => {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
      if ((room.bannedUserIds || []).map(String).includes(callerId)) {
        return { status: 403, body: { error: 'You are banned from this room', code: 'BANNED' } };
      }
      t.update(roomRef, { participantIds: FieldValue.arrayUnion(callerId) });
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Join room failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/decline-invite — caller declines THEIR OWN pending invite.
// Self-scoped by auth: a caller can only ever remove their own pendingInvites
// entry. No-op (still 200) when there is no pending invite.
router.post('/rooms/:roomId/decline-invite', async (req, res) => {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) => {
      const hasInvite = Object.prototype.hasOwnProperty.call(room.pendingInvites || {}, callerId);
      if (!hasInvite) return { status: 200, body: { success: true } };
      t.update(roomRef, { [`pendingInvites.${callerId}`]: FieldValue.delete() });
      return { status: 200, body: { success: true }, mutated: true };
    });
    if (result.status === 200 && result.mutated) await broadcastRoomUpdated(roomId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Decline invite failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
