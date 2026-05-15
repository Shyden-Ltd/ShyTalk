/**
 * Room routes — invite sending and seat request creation (FCM push required).
 *
 * POST /api/rooms/:roomId/invites/send  -> Send invite (FCM push to invitee)
 * POST /api/rooms/:roomId/seat-requests -> Create seat request (FCM push to room owner)
 */

const router = require('express').Router();
const { db, rtdb } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');
const { requireSameCohort } = require('../middleware/sameCohort');
const log = require('../utils/log');

const MAX_USER_NAME_LENGTH = 50;
const MAX_SEAT_INDEX = 20;

// --- Helpers ---

/** Broadcast a room event via RTDB. */
async function broadcastToRoom(roomId, data) {
  try {
    await rtdb.ref(`rooms/${roomId}/events/lastEvent`).set({
      type: data.type,
      ts: Date.now(),
      ...(data.userId ? { userId: data.userId } : {}),
    });
  } catch (err) {
    log.error('rooms', 'Failed to write RTDB event', { roomId, error: err.message });
  }
}

// --- Route registration ---

// -- Send invite --
router.post('/rooms/:roomId/invites/send', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.userId || !body?.invitedBy) {
      return res.status(400).json({ error: 'userId and invitedBy required' });
    }
    if (req.auth.uniqueId !== body.invitedBy) {
      return res.status(403).json({ error: 'Cannot send invite on behalf of another user' });
    }
    const roomId = req.params.roomId;
    const inviteeId = body.userId;

    log.info('rooms', 'Sending room invite', { roomId, inviteeId, invitedBy: body.invitedBy });

    const roomSnap = await db.doc(`rooms/${roomId}`).get();
    if (!roomSnap.exists) return res.status(404).json({ error: 'Room not found' });
    const room = roomSnap.data();

    // UK OSA #17 PR 4 — fetch invitee up front for the cross-cohort
    // gate; the FCM block reuses the same doc.
    const inviteeSnap = await db.doc(`users/${inviteeId}`).get();
    const inviteeDoc = inviteeSnap.exists ? inviteeSnap.data() : null;
    const blocked = await requireSameCohort(req, res, inviteeId, () => inviteeDoc);
    if (blocked) return;

    // Update pendingInvites on the room doc (matches Android client field name)
    const pendingInvites = room.pendingInvites || {};
    pendingInvites[inviteeId] = {
      invitedBy: body.invitedBy,
      invitedAt: now(),
    };

    await db.doc(`rooms/${roomId}`).update({ pendingInvites });

    // Send FCM push to invitee
    try {
      const inviterSnap = await db.doc(`users/${body.invitedBy}`).get();
      const tokens = inviteeDoc?.fcmTokens || [];
      if (tokens.length > 0) {
        const roomName = room.name || 'a room';
        const inviterName = inviterSnap.exists
          ? inviterSnap.data().displayName || 'Someone'
          : 'Someone';

        const invalidTokens = await sendFcmToTokens(
          tokens,
          {
            type: 'ROOM_INVITE',
            roomId,
            roomName,
            invitedBy: body.invitedBy,
            inviterName,
          },
          { senderUniqueId: body.invitedBy, recipientUniqueId: inviteeId },
        );

        if (invalidTokens.length > 0) {
          await cleanupInvalidTokens(invalidTokens, inviteeId);
        }
      }
    } catch (err) {
      log.error('rooms', 'Failed to send invite FCM', { roomId, inviteeId, error: err.message });
    }

    await broadcastToRoom(roomId, { type: 'room_updated' });
    return res.json({ success: true });
  } catch (err) {
    log.error('rooms', 'Send invite failed', { roomId: req.params.roomId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Create seat request --
router.post('/rooms/:roomId/seat-requests', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const seatIndex = body?.seatIndex;
    const userName = (body?.userName || '').slice(0, MAX_USER_NAME_LENGTH);
    if (
      seatIndex === null ||
      seatIndex === undefined ||
      typeof seatIndex !== 'number' ||
      !Number.isInteger(seatIndex) ||
      seatIndex < 0 ||
      seatIndex > MAX_SEAT_INDEX
    ) {
      return res.status(400).json({ error: 'Valid seatIndex required (0-20)' });
    }
    const roomId = req.params.roomId;

    log.info('rooms', 'Creating seat request', { roomId, userId: uniqueId, seatIndex });

    // UK OSA #17 PR 4 — fetch room + owner up front for the cross-
    // cohort gate; reused later in the FCM push block.
    const roomSnap = await db.doc(`rooms/${roomId}`).get();
    if (!roomSnap.exists) return res.status(404).json({ error: 'Room not found' });
    const room = roomSnap.data();

    // A room without an `ownerId` cannot resolve a cohort for the
    // gate (cohort stand-in = owner cohort until PR 7). Refuse the
    // action rather than letting the API-layer gate fall through —
    // the Firestore rules layer (PR 3) is a backstop, not the only
    // line of defence.
    if (!room?.ownerId) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const ownerSnap = await db.doc(`users/${room.ownerId}`).get();
    const ownerDoc = ownerSnap.exists ? ownerSnap.data() : null;
    const blocked = await requireSameCohort(req, res, room.ownerId, () => ownerDoc);
    if (blocked) return;

    // Check for existing pending request
    const existingSnap = await db
      .collection(`rooms/${roomId}/seatRequests`)
      .where('userId', '==', uniqueId)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const reqId = existingDoc.id;
      await db.doc(`rooms/${roomId}/seatRequests/${reqId}`).update({
        seatIndex,
        createdAt: now(),
      });
      await broadcastToRoom(roomId, { type: 'seat_request_updated' });
      return res.json({ requestId: reqId });
    }

    const reqId = generateId();
    const timestamp = now();

    await db.doc(`rooms/${roomId}/seatRequests/${reqId}`).set({
      requestId: reqId,
      userId: uniqueId,
      userName: userName || '',
      seatIndex,
      status: 'PENDING',
      resolvedBy: null,
      createdAt: timestamp,
      resolvedAt: null,
    });

    // Send FCM push to room owner (reusing the up-front fetched docs)
    try {
      if (room?.ownerId) {
        const tokens = ownerDoc?.fcmTokens || [];
        if (tokens.length > 0) {
          const invalidTokens = await sendFcmToTokens(
            tokens,
            {
              type: 'SEAT_REQUEST',
              roomId,
              roomName: room.name || 'a room',
              requesterId: uniqueId,
              requesterName: userName || '',
              seatIndex: String(seatIndex),
            },
            { senderUniqueId: uniqueId, recipientUniqueId: room.ownerId },
          );

          if (invalidTokens.length > 0) {
            await cleanupInvalidTokens(invalidTokens, room.ownerId);
          }
        }
      }
    } catch (err) {
      log.error('rooms', 'Failed to send seat request FCM', {
        roomId,
        userId: uniqueId,
        error: err.message,
      });
    }

    await broadcastToRoom(roomId, { type: 'seat_request_updated' });
    return res.json({ requestId: reqId });
  } catch (err) {
    log.error('rooms', 'Create seat request failed', {
      roomId: req.params.roomId,
      userId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
