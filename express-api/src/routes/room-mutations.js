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
 * (claim / accept-invite / leave-seat / move), participant lifecycle (join with
 * ban enforcement / leave-room / disconnect-eviction / first-join), moderation
 * (kick / remove / mute / add+remove host), invite-decline, room settings
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
  canRemoveDisconnected,
  resolveRole,
  MAX_SEATS,
  OWNER_SEAT_INDEX,
} = require('../utils/room-auth');
const { shouldReapStaleRoom, reapStaleRoomTx } = require('../utils/stale-room-reap');
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
 * RTDB presence check for the presence-gated endpoints (owner-away safety net,
 * disconnect-user eviction). Reads rooms/<roomId>/presence/<userId>. FAIL-SAFE
 * to "present" on any read error so a presence outage can never let a caller
 * forge an owner-away transition or evict a still-connected user.
 */
async function isUserPresent(roomId, userId) {
  try {
    const snap = await rtdb.ref(`rooms/${roomId}/presence/${userId}`).get();
    return snap.exists();
  } catch (err) {
    log.error('room-mutations', 'Presence read failed', {
      roomId,
      userId,
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
    let room = snap.data();
    if (cohortFromClaim(req) !== (room.cohort ?? 'minor')) {
      return { status: 404, body: { error: 'Not found' } };
    }
    // Lazy reap: if the room has been OWNER_AWAY long enough that the
    // owner-left-handler's decideOwnerLeftAction would close it, close
    // it inline within this same transaction. The mutate() callback
    // below sees the post-close room shape and returns its standard
    // "room is closed" 409. Defense-in-depth alongside the RTDB
    // ownerLeft-signal-driven closure (PRs A0-A4): the event-driven
    // signal handles the common "owner force-quit" case in seconds, and
    // this lazy reap covers the residual case where an OWNER_AWAY room
    // is touched after grace expiry but the ownerLeft signal somehow
    // missed (signal failed to fire, retry exhausted, etc).
    //
    // The owner returning never triggers reap — that path is the
    // OWNER_AWAY → ACTIVE transition, not a close — so the predicate
    // takes callerId and short-circuits when caller === ownerId.
    const callerId = req.auth ? String(req.auth.uniqueId) : null;
    const nowMs = Date.now();
    if (shouldReapStaleRoom(room, nowMs, callerId)) {
      room = reapStaleRoomTx(t, roomRef, room, nowMs);
    }
    return mutate(room, t, roomRef);
  });
}

/**
 * Standard wrapper for mutation endpoints: routes the request + cohort gate
 * through `inRoomTransaction`, broadcasts the RTDB nudge on a real mutation
 * (return `{ noop: true }` from the inner `mutate` to opt out — used by
 * idempotent set-once / already-in-target-state branches), and converts an
 * unexpected throw into a logged 500. Reserved for endpoints whose shape is
 * "validate → load+gate→update → respond"; specialised flows (`owner-away`
 * pre-reads RTDB presence; `close` does a post-txn batch user-doc clear;
 * `disconnect-user` does both) hand-roll their try/catch.
 */
async function executeRoomMutation(req, res, errorContext, mutate) {
  const { roomId } = req.params;
  const callerId = String(req.auth.uniqueId);
  try {
    const result = await inRoomTransaction(req, roomId, (room, t, roomRef) =>
      mutate({ room, t, roomRef, callerId, req }),
    );
    if (result.status === 200 && !result.noop) {
      await broadcastRoomUpdated(roomId);
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', `${errorContext} failed`, { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /rooms/:roomId/seats/:seatIndex/claim — caller seats THEMSELVES.
router.post('/rooms/:roomId/seats/:seatIndex/claim', async (req, res) => {
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  return executeRoomMutation(req, res, 'Seat claim', ({ room, t, roomRef, callerId }) => {
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
});

// POST /rooms/:roomId/seats/:seatIndex/accept-invite — invited caller seats SELF.
router.post('/rooms/:roomId/seats/:seatIndex/accept-invite', async (req, res) => {
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  return executeRoomMutation(req, res, 'Accept invite', ({ room, t, roomRef, callerId }) => {
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
});

// POST /rooms/:roomId/seats/:seatIndex/leave — caller leaves their OWN seat.
router.post('/rooms/:roomId/seats/:seatIndex/leave', async (req, res) => {
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  return executeRoomMutation(req, res, 'Leave seat', ({ room, t, roomRef, callerId }) => {
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
});

// POST /rooms/:roomId/kick — owner/host bans + removes a target user.
router.post('/rooms/:roomId/kick', async (req, res) => {
  const targetId = String(req.body?.userId ?? '') || null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  const kickerName = typeof req.body?.kickerName === 'string' ? req.body.kickerName : '';
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  return executeRoomMutation(req, res, 'Kick', ({ room, t, roomRef, callerId }) => {
    if (!canKickUser(room, callerId, targetId)) {
      return { status: 403, body: { error: 'Not allowed to kick this user' } };
    }
    // CLOSED gate positioned AFTER the role check (info-hiding): unprivileged
    // callers still see 403 regardless of room state, so an attacker cannot
    // probe CLOSED state by switching between role-lacking and privileged
    // accounts. Kicking a user from a dead room is a state-extending write
    // (the ban persists in bannedUserIds) and must be rejected.
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
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
});

// POST /rooms/:roomId/seats/:seatIndex/remove — owner/host vacates a seat (no ban).
router.post('/rooms/:roomId/seats/:seatIndex/remove', async (req, res) => {
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  return executeRoomMutation(req, res, 'Remove from seat', ({ room, t, roomRef, callerId }) => {
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
});

// PATCH /rooms/:roomId/seats/:seatIndex/mute — force-mute (owner/host) or self-unmute.
router.patch('/rooms/:roomId/seats/:seatIndex/mute', async (req, res) => {
  const seatIndex = parseSeatIndex(req.params.seatIndex);
  if (seatIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  if (typeof req.body?.isMuted !== 'boolean') {
    return res.status(400).json({ error: 'isMuted (boolean) required' });
  }
  const { isMuted } = req.body;
  return executeRoomMutation(req, res, 'Mute toggle', ({ room, t, roomRef, callerId }) => {
    // CLOSED gate fires FIRST — before the seat-empty probe. Otherwise an
    // attacker could compare the seat-empty 409 vs seat-occupied 200/403
    // responses to learn the room's seat state after CLOSE. Muting in a dead
    // room is also a state-extending write (`seats.{i}.isMuted` persists on
    // a room nobody can hear).
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
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
});

// POST /rooms/:roomId/hosts — OWNER promotes a participant to host.
router.post('/rooms/:roomId/hosts', async (req, res) => {
  const targetId = String(req.body?.userId ?? '') || null;
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  return executeRoomMutation(req, res, 'Add host', ({ room, t, roomRef, callerId }) => {
    if (resolveRole(room, callerId) !== 'OWNER') {
      return { status: 403, body: { error: 'Only the owner can add hosts' } };
    }
    if (String(targetId) === String(room.ownerId)) {
      return { status: 400, body: { error: 'Owner is not a host' } };
    }
    // CLOSED gate positioned AFTER role + input checks (info-hiding for the
    // role probe). Promoting a host of a dead room is a state-extending write
    // — the host role persists on a room whose lifecycle is over.
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    t.update(roomRef, {
      hostIds: FieldValue.arrayUnion(targetId),
      allTimeHostIds: FieldValue.arrayUnion(targetId),
    });
    return { status: 200, body: { success: true } };
  });
});

// DELETE /rooms/:roomId/hosts/:userId — OWNER demotes a host.
router.delete('/rooms/:roomId/hosts/:userId', async (req, res) => {
  const targetId = String(req.params.userId);
  return executeRoomMutation(req, res, 'Remove host', ({ room, t, roomRef, callerId }) => {
    if (resolveRole(room, callerId) !== 'OWNER') {
      return { status: 403, body: { error: 'Only the owner can remove hosts' } };
    }
    t.update(roomRef, { hostIds: FieldValue.arrayRemove(targetId) });
    return { status: 200, body: { success: true } };
  });
});

// PATCH /rooms/:roomId/name — OWNER renames the room.
router.patch('/rooms/:roomId/name', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    return res.status(400).json({ error: 'name too long' });
  }
  return executeRoomMutation(req, res, 'Rename', ({ room, t, roomRef, callerId }) => {
    if (resolveRole(room, callerId) !== 'OWNER') {
      return { status: 403, body: { error: 'Only the owner can rename the room' } };
    }
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    t.update(roomRef, { name });
    return { status: 200, body: { success: true } };
  });
});

// PATCH /rooms/:roomId/require-approval — OWNER toggles the seat-approval policy.
router.patch('/rooms/:roomId/require-approval', async (req, res) => {
  if (typeof req.body?.requireApproval !== 'boolean') {
    return res.status(400).json({ error: 'requireApproval (boolean) required' });
  }
  const { requireApproval } = req.body;
  return executeRoomMutation(req, res, 'Set requireApproval', ({ room, t, roomRef, callerId }) => {
    if (resolveRole(room, callerId) !== 'OWNER') {
      return { status: 403, body: { error: 'Only the owner can change approval settings' } };
    }
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    t.update(roomRef, { requireApproval });
    return { status: 200, body: { success: true } };
  });
});

// POST /rooms/:roomId/owner-returned — OWNER returns from OWNER_AWAY (idempotent on ACTIVE).
router.post('/rooms/:roomId/owner-returned', async (req, res) =>
  executeRoomMutation(req, res, 'Owner returned', ({ room, t, roomRef, callerId }) => {
    if (resolveRole(room, callerId) !== 'OWNER') {
      return { status: 403, body: { error: 'Only the owner can return to the room' } };
    }
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    if (room.state === 'ACTIVE') return { status: 200, body: { success: true }, noop: true };
    t.update(roomRef, { state: 'ACTIVE', ownerLeftAt: null });
    return { status: 200, body: { success: true } };
  }),
);

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
    const ownerPresent = callerIsOwner ? false : await isUserPresent(roomId, preRoom.ownerId);

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
  const fromIndex = parseSeatIndex(req.params.seatIndex);
  if (fromIndex === null) return res.status(400).json({ error: 'Invalid seat index' });
  const toIndex = parseSeatIndex(req.body?.toIndex);
  if (toIndex === null) return res.status(400).json({ error: 'Invalid target seat index' });
  if (fromIndex === toIndex) {
    return res.status(400).json({ error: 'Source and target seats are the same' });
  }
  return executeRoomMutation(req, res, 'Move seat', ({ room, t, roomRef, callerId }) => {
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
});

// POST /rooms/:roomId/join — caller joins the room's participant list. The ban
// list is enforced server-side here. currentRoomId is the caller's own user-doc
// field and remains a client write.
router.post('/rooms/:roomId/join', async (req, res) =>
  executeRoomMutation(req, res, 'Join room', ({ room, t, roomRef, callerId }) => {
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    if ((room.bannedUserIds || []).map(String).includes(callerId)) {
      return { status: 403, body: { error: 'You are banned from this room', code: 'BANNED' } };
    }
    t.update(roomRef, { participantIds: FieldValue.arrayUnion(callerId) });
    return { status: 200, body: { success: true } };
  }),
);

// POST /rooms/:roomId/decline-invite — caller declines THEIR OWN pending invite.
// Self-scoped by auth: a caller can only ever remove their own pendingInvites
// entry. No-op (still 200) when there is no pending invite.
router.post('/rooms/:roomId/decline-invite', async (req, res) =>
  executeRoomMutation(req, res, 'Decline invite', ({ room, t, roomRef, callerId }) => {
    const hasInvite = Object.prototype.hasOwnProperty.call(room.pendingInvites || {}, callerId);
    if (!hasInvite) return { status: 200, body: { success: true }, noop: true };
    t.update(roomRef, { [`pendingInvites.${callerId}`]: FieldValue.delete() });
    return { status: 200, body: { success: true } };
  }),
);

// POST /rooms/:roomId/leave — caller removes THEMSELVES from the room
// (participant list + their own seat, if seated). currentRoomId stays a client
// self-write. Idempotent: a no-op arrayRemove if the caller isn't a member.
router.post('/rooms/:roomId/leave', async (req, res) =>
  executeRoomMutation(req, res, 'Leave room', ({ room, t, roomRef, callerId }) => {
    const isMember = (room.participantIds || []).map(String).includes(callerId);
    const seatIdx = userSeatIndex(room, callerId);
    // Idempotent no-op: caller isn't a member and isn't seated. Skip the
    // unnecessary t.update + RTDB broadcast (the arrayRemove was a no-op
    // anyway). Common on a client retrying after a disconnect.
    if (!isMember && seatIdx === -1) {
      return { status: 200, body: { success: true }, noop: true };
    }
    const update = { participantIds: FieldValue.arrayRemove(callerId) };
    if (seatIdx !== -1) {
      update[`seats.${seatIdx}.userId`] = null;
      update[`seats.${seatIdx}.state`] = 'EMPTY';
      update[`seats.${seatIdx}.isMuted`] = false;
    }
    t.update(roomRef, update);
    return { status: 200, body: { success: true } };
  }),
);

// POST /rooms/:roomId/disconnect-user — remove a DISCONNECTED non-owner
// (presence-timeout eviction triggered by a participant's presence monitor).
// The target's absence is verified against RTDB presence BEFORE the txn
// (fail-safe to present). Also clears the removed user's currentRoomId — a
// foreign user-doc write that only the server may perform once rules lock down.
router.post('/rooms/:roomId/disconnect-user', async (req, res) => {
  const { roomId } = req.params;
  const targetId = String(req.body?.userId ?? '') || null;
  if (!targetId) return res.status(400).json({ error: 'userId required' });
  const callerId = String(req.auth.uniqueId);
  try {
    const roomRef = db.doc(`rooms/${roomId}`);
    const preSnap = await roomRef.get();
    if (!preSnap.exists) return res.status(404).json({ error: 'Room not found' });
    const preRoom = preSnap.data();
    if (cohortFromClaim(req) !== (preRoom.cohort ?? 'minor')) {
      return res.status(404).json({ error: 'Not found' });
    }
    // CLOSED gate fires HERE — after the cohort check, before the RTDB
    // presence read. Saves a roundtrip on a CLOSED room and avoids leaking
    // RTDB error behaviour for a state that no longer matters. Disconnecting
    // from a dead room is a state-extending write (clears the target's
    // `currentRoomId` on a room nobody can rejoin).
    if (preRoom.state === 'CLOSED') return res.status(409).json({ error: 'Room is closed' });
    const targetPresent = await isUserPresent(roomId, targetId);

    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists) return { status: 404, body: { error: 'Room not found' } };
      const room = snap.data();
      if (cohortFromClaim(req) !== (room.cohort ?? 'minor')) {
        return { status: 404, body: { error: 'Not found' } };
      }
      if (!canRemoveDisconnected(room, callerId, targetId, targetPresent)) {
        return { status: 403, body: { error: 'Not allowed to remove this user' } };
      }
      const update = { participantIds: FieldValue.arrayRemove(targetId) };
      const seatIdx = userSeatIndex(room, targetId);
      if (seatIdx !== -1) {
        update[`seats.${seatIdx}.userId`] = null;
        update[`seats.${seatIdx}.state`] = 'EMPTY';
        update[`seats.${seatIdx}.isMuted`] = false;
      }
      t.update(roomRef, update);
      return { status: 200, body: { success: true } };
    });
    if (result.status === 200) {
      try {
        await db.doc(`users/${targetId}`).set({ currentRoomId: null }, { merge: true });
      } catch (err) {
        log.error('room-mutations', 'disconnect-user currentRoomId clear failed', {
          roomId,
          targetId,
          error: err.message,
        });
      }
      await broadcastRoomUpdated(roomId);
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    log.error('room-mutations', 'Disconnect user failed', { roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rooms/:roomId/first-join — caller records THEIR OWN first-join time.
// Self-scoped + set-once: writes firstJoinTimestamps[caller] only if absent, so
// re-entry never overwrites the original timestamp. Rejects 409 on CLOSED rooms
// — the participation-timestamp record is conceptually a lifecycle-write and
// must follow the same "no writes after CLOSE" invariant as /join, /name, etc.
router.post('/rooms/:roomId/first-join', async (req, res) =>
  executeRoomMutation(req, res, 'Record first join', ({ room, t, roomRef, callerId }) => {
    if (room.state === 'CLOSED') return { status: 409, body: { error: 'Room is closed' } };
    const already = Object.prototype.hasOwnProperty.call(room.firstJoinTimestamps || {}, callerId);
    if (already) return { status: 200, body: { success: true }, noop: true };
    t.update(roomRef, { [`firstJoinTimestamps.${callerId}`]: Date.now() });
    return { status: 200, body: { success: true } };
  }),
);

module.exports = router;
