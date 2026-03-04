/**
 * Room routes — invite sending and seat request creation (FCM push required).
 *
 * POST   /api/rooms/:roomId/invites/send     → Send invite (FCM push to invitee)
 * POST   /api/rooms/:roomId/seat-requests    → Create seat request (FCM push to room owner)
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { writeRtdb } = require('../utils/rtdb');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');
const {
  getDoc,
  setDoc,
  updateDoc,
  queryCollection,
  fieldFilter,
  andFilter,
} = require('../utils/firestore');

// ─── Helpers ────────────────────────────────────────────────────

/** Broadcast a room event via RTDB. */
async function broadcastToRoom(env, roomId, data) {
  try {
    await writeRtdb(env, `rooms/${roomId}/events/lastEvent`, {
      type: data.type,
      ts: Date.now(),
      ...(data.userId ? { userId: data.userId } : {}),
    });
  } catch (err) {
    console.error(`Failed to write RTDB event for room ${roomId}:`, err);
  }
}

// ─── Route registration ─────────────────────────────────────────

function registerRoomRoutes(router) {

  // ── Send invite ──
  router.post('/api/rooms/:roomId/invites/send', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId || !body?.invitedBy) return jsonError('userId and invitedBy required', 400);
    const roomId = params.roomId;
    const inviteeId = body.userId;

    const room = await getDoc(env, `rooms/${roomId}`);
    if (!room) return jsonError('Room not found', 404);

    // Update pendingInvites on the room doc (matches Android client field name)
    const pendingInvites = room.pendingInvites || {};
    pendingInvites[inviteeId] = {
      invitedBy: body.invitedBy,
      invitedAt: now(),
    };

    await updateDoc(env, `rooms/${roomId}`, { pendingInvites });

    // Send FCM push to invitee
    try {
      const inviteeDoc = await getDoc(env, `users/${inviteeId}`);
      const tokens = inviteeDoc?.fcmTokens || [];
      if (tokens.length > 0) {
        const roomName = room.name || 'a room';
        // Look up inviter's display name
        const inviterDoc = await getDoc(env, `users/${body.invitedBy}`);
        const inviterName = inviterDoc?.displayName || 'Someone';

        const invalidTokens = await sendFcmToTokens(env, tokens, {
          type: 'ROOM_INVITE',
          roomId,
          roomName,
          invitedBy: body.invitedBy,
          inviterName,
        });

        if (invalidTokens.length > 0) {
          await cleanupInvalidTokens(env, invalidTokens, inviteeId);
        }
      }
    } catch (err) {
      console.error('Failed to send room invite FCM:', err);
    }

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Create seat request ──
  router.post('/api/rooms/:roomId/seat-requests', async (request, env, params) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { userName, seatIndex } = body || {};
    if (seatIndex == null) return jsonError('seatIndex required', 400);
    const roomId = params.roomId;

    // Check for existing pending request
    const existing = await queryCollection(env, `rooms/${roomId}/seatRequests`, {
      where: andFilter(
        fieldFilter('userId', 'EQUAL', uid),
        fieldFilter('status', 'EQUAL', 'PENDING')
      ),
      limit: 1,
    });

    if (existing.length > 0) {
      const reqId = existing[0].id || existing[0].requestId;
      await updateDoc(env, `rooms/${roomId}/seatRequests/${reqId}`, {
        seatIndex,
        createdAt: now(),
      });
      await broadcastToRoom(env, roomId, { type: 'seat_request_updated' });
      return json({ requestId: reqId });
    }

    const reqId = generateId();
    const timestamp = now();

    await setDoc(env, `rooms/${roomId}/seatRequests/${reqId}`, {
      requestId: reqId,
      userId: uid,
      userName: userName || '',
      seatIndex,
      status: 'PENDING',
      resolvedBy: null,
      createdAt: timestamp,
      resolvedAt: null,
    });

    // Send FCM push to room owner
    try {
      const room = await getDoc(env, `rooms/${roomId}`);
      if (room?.ownerId) {
        const ownerDoc = await getDoc(env, `users/${room.ownerId}`);
        const tokens = ownerDoc?.fcmTokens || [];
        if (tokens.length > 0) {
          const invalidTokens = await sendFcmToTokens(env, tokens, {
            type: 'SEAT_REQUEST',
            roomId,
            roomName: room.name || 'a room',
            requesterId: uid,
            requesterName: userName || '',
            seatIndex: String(seatIndex),
          });

          if (invalidTokens.length > 0) {
            await cleanupInvalidTokens(env, invalidTokens, room.ownerId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to send seat request FCM:', err);
    }

    await broadcastToRoom(env, roomId, { type: 'seat_request_updated' });
    return json({ requestId: reqId });
  });
}

module.exports = { registerRoomRoutes };
