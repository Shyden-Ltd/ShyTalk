/**
 * Evict a suspended user from all rooms they participate in or own.
 *
 * Behaviour matrix (matches manual QA expectations):
 *   - Owner   → room CLOSED immediately (state=CLOSED, closedAt=now). Participants
 *               and hosts are also cleared so the room can't be re-joined while
 *               clients drain their listeners. ownerId is preserved for audit.
 *   - Host    → removed from hostIds AND participantIds; their seat (if any) is
 *               cleared (state=EMPTY, userId=null, isMuted=false). Room stays open.
 *   - Seated non-host → seat cleared, removed from participantIds. Room stays open.
 *   - Visitor (in participantIds, not seated) → removed from participantIds. Room
 *               stays open.
 *
 * Always:
 *   - Clears the user's `currentRoomId` field.
 *   - Fires an RTDB event per affected room (`room_closed` for owner, `room_updated`
 *     otherwise) so live clients see the change without a Firestore round-trip.
 *
 * The two-query pattern (participants AND owners) is required because a suspended
 * owner who has already left their own room is no longer in participantIds — the
 * single participants-only query would miss them and leave the room running.
 */

const { db, rtdb } = require('./firebase');
const { queryDocs } = require('./firestore-helpers');
const { now } = require('./helpers');
const log = require('./log');

async function evictSuspendedUser(uid) {
  const [participantRooms, ownerRooms] = await Promise.all([
    queryDocs(db.collection('rooms').where('participantIds', 'array-contains', uid)),
    queryDocs(db.collection('rooms').where('ownerId', '==', uid)),
  ]);

  // De-duplicate (owner is normally also in participantIds of their own room).
  const roomsById = new Map();
  for (const r of participantRooms || []) roomsById.set(r.id, r);
  for (const r of ownerRooms || []) {
    if (!roomsById.has(r.id)) roomsById.set(r.id, r);
  }
  const rooms = [...roomsById.values()];

  if (rooms.length === 0) {
    // set+merge (not update) so a missing user doc — possible if the user was deleted
    // between suspension lookup and cascade — doesn't throw "no document to update".
    // Tag any thrown error with phase: 'user_doc' so the route's catch can set
    // userDocFailed: true accurately rather than reporting a generic cascade abort.
    try {
      await db.doc(`users/${uid}`).set({ currentRoomId: null }, { merge: true });
    } catch (err) {
      // instanceof Error narrows out frozen objects, primitives, and null
      // throws — assigning to those would silently no-op under sloppy mode
      // and route catches would mis-classify the failure as cascade-abort.
      if (err instanceof Error) {
        err.phase = 'user_doc';
      }
      throw err;
    }
    return {
      roomsClosed: 0,
      roomsUpdated: 0,
      partial: false,
      failedRoomIds: [],
      userDocFailed: false,
      rtdbEventsFailed: 0,
      // error:null on success makes the contract symmetric with the failure
      // path (buildCascadeFailure) so consumers can branch on `cascade.error`
      // uniformly without conditional-presence checks.
      error: null,
    };
  }

  const closeTimestamp = now();
  const batchOps = [];
  const rtdbEvents = [];
  let roomsClosed = 0;
  let roomsUpdated = 0;

  for (const room of rooms) {
    const isOwner = room.ownerId === uid;

    if (isOwner) {
      batchOps.push({
        path: `rooms/${room.id}`,
        data: {
          state: 'CLOSED',
          closedAt: closeTimestamp,
          participantIds: [],
          hostIds: [],
        },
      });
      rtdbEvents.push({ roomId: room.id, type: 'room_closed' });
      roomsClosed += 1;
      continue;
    }

    const participantIds = (room.participantIds || []).filter((id) => id !== uid);
    const hostIds = (room.hostIds || []).filter((id) => id !== uid);

    // Clear any seat occupied by this user. Field shape matches the Seat data
    // class (userId, state, isMuted) — the previous admin-users.js code wrote
    // `status` and `index` keys which are not part of the data model.
    const seats = room.seats ? { ...room.seats } : {};
    for (const [index, seat] of Object.entries(seats)) {
      if (seat && (seat.userId === uid || seat.user_id === uid)) {
        seats[index] = { userId: null, state: 'EMPTY', isMuted: false };
      }
    }

    batchOps.push({
      path: `rooms/${room.id}`,
      data: { participantIds, hostIds, seats },
    });
    rtdbEvents.push({ roomId: room.id, type: 'room_updated' });
    roomsUpdated += 1;
  }

  batchOps.push({ path: `users/${uid}`, data: { currentRoomId: null } });

  // Firestore batch (chunked at 500 to respect Firestore limits). Track which
  // room chunks AND the user-doc op failed so the caller can distinguish a
  // fully-committed cascade from a partial one. Earlier code returned success
  // even when the second chunk threw, and silently dropped user-doc failures
  // (the path regex below matches only `rooms/...`, so user-doc errors were
  // invisible in `failedRoomIds`).
  const failedRoomIds = [];
  let userDocFailed = false;
  for (let i = 0; i < batchOps.length; i += 500) {
    const chunk = batchOps.slice(i, i + 500);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(db.doc(op.path), op.data, { merge: true });
    }
    try {
      await batch.commit();
    } catch (err) {
      log.error('evict-suspended-user', 'Batch commit failed', {
        userId: uid,
        chunkStart: i,
        chunkSize: chunk.length,
        error: err.message,
      });
      for (const op of chunk) {
        const roomMatch = op.path.match(/^rooms\/(.+)$/);
        if (roomMatch) {
          failedRoomIds.push(roomMatch[1]);
        } else if (op.path === `users/${uid}`) {
          userDocFailed = true;
        }
      }
    }
  }

  // RTDB events fire only for rooms whose Firestore write actually committed —
  // emitting `room_closed` for a room that's still OPEN in Firestore would lie
  // to live clients listening on the RTDB channel.
  const failedSet = new Set(failedRoomIds);
  let rtdbEventsFailed = 0;
  for (const evt of rtdbEvents) {
    if (failedSet.has(evt.roomId)) continue;
    try {
      await rtdb.ref(`rooms/${evt.roomId}/events/lastEvent`).set({
        type: evt.type,
        ts: Date.now(),
      });
    } catch (err) {
      log.warn('evict-suspended-user', `Failed to write ${evt.type} RTDB event`, {
        roomId: evt.roomId,
        error: err.message,
      });
      rtdbEventsFailed += 1;
    }
    // For owner closures, also tear down the RTDB room node entirely so any
    // lingering presence/typing/event children are cleaned up.
    if (evt.type === 'room_closed') {
      try {
        await rtdb.ref(`rooms/${evt.roomId}`).remove();
      } catch (err) {
        log.warn('evict-suspended-user', 'Failed to remove RTDB room node', {
          roomId: evt.roomId,
          error: err.message,
        });
        rtdbEventsFailed += 1;
      }
    }
  }

  return {
    roomsClosed,
    roomsUpdated,
    // partial covers Firestore failures (the source of truth); RTDB failures
    // surface as a separate counter so the admin can distinguish "user is
    // still in rooms" from "live clients didn't get the close event but state
    // is correct" — only the former needs manual cleanup.
    partial: failedRoomIds.length > 0 || userDocFailed,
    failedRoomIds,
    userDocFailed,
    rtdbEventsFailed,
    // error: null when the cascade ran to completion (even partially), to
    // match the failure-path shape from buildCascadeFailure.
    error: null,
  };
}

/**
 * Build the on-wire cascade contract from a thrown evictSuspendedUser error.
 * Centralises four previously-duplicated literals across reports.js + admin-users.js
 * so the response shape can't drift (rtdbEventsFailed was missing on two sites,
 * causing inconsistent contracts between the resolve and suspend routes).
 *
 * Always returns the full superset shape — fields that are unknown given a
 * pre-room-loop throw default to safe zero/false values. The caller decides
 * the `error` token by passing it in (kept as an arg so different routes can
 * reference their own MOD_ERROR.CASCADE_FAILED literal without circular deps).
 */
function buildCascadeFailure(err, errorToken) {
  // Boolean() coerces the && short-circuit so userDocFailed is always strictly
  // boolean (a null err would otherwise leak `null` into the response).
  return {
    roomsClosed: 0,
    roomsUpdated: 0,
    partial: true,
    failedRoomIds: [],
    userDocFailed: Boolean(err && err.phase === 'user_doc'),
    rtdbEventsFailed: 0,
    error: errorToken,
  };
}

module.exports = { evictSuspendedUser, buildCascadeFailure };
