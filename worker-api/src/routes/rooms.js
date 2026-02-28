/**
 * Room routes — creation, lifecycle, seats, participants, hosts, invites, messages, seat requests.
 *
 * POST   /api/rooms                          → Create room
 * GET    /api/rooms/active                   → List active rooms
 * GET    /api/rooms/:roomId                  → Get room details
 * POST   /api/rooms/:roomId/join             → Join room
 * POST   /api/rooms/:roomId/leave            → Leave room
 * POST   /api/rooms/:roomId/close            → Close room
 * POST   /api/rooms/:roomId/owner-away       → Owner leaves (OWNER_AWAY)
 * POST   /api/rooms/:roomId/owner-return     → Owner returns (ACTIVE)
 * POST   /api/rooms/:roomId/seats/:index/take  → Take seat
 * POST   /api/rooms/:roomId/seats/:index/leave → Leave seat
 * POST   /api/rooms/:roomId/seats/move       → Move/swap seats
 * PATCH  /api/rooms/:roomId/seats/:index/mute → Toggle mute
 * POST   /api/rooms/:roomId/hosts/add        → Add host
 * POST   /api/rooms/:roomId/hosts/remove     → Remove host
 * POST   /api/rooms/:roomId/kick             → Kick user
 * PATCH  /api/rooms/:roomId                  → Update room (name, approval)
 * POST   /api/rooms/:roomId/invites/send     → Send invite
 * POST   /api/rooms/:roomId/invites/cancel   → Cancel invite
 * POST   /api/rooms/:roomId/invites/accept   → Accept invite
 * POST   /api/rooms/:roomId/first-join       → Record first join timestamp
 * POST   /api/rooms/leave-all                → Leave all rooms
 * POST   /api/rooms/close-all                → Close all rooms by owner
 * POST   /api/rooms/:roomId/remove-disconnected → Remove disconnected user
 * GET    /api/rooms/:roomId/messages         → Get room messages
 * POST   /api/rooms/:roomId/messages         → Send message
 * PATCH  /api/rooms/:roomId/messages/:msgId  → Edit message
 * GET    /api/rooms/:roomId/seat-requests           → Get pending requests
 * GET    /api/rooms/:roomId/seat-requests/user/:uid → Get user's requests
 * POST   /api/rooms/:roomId/seat-requests           → Create seat request
 * POST   /api/rooms/:roomId/seat-requests/:reqId/approve → Approve request
 * POST   /api/rooms/:roomId/seat-requests/:reqId/deny    → Deny request
 * POST   /api/rooms/:roomId/seat-requests/:reqId/cancel  → Cancel request
 * GET    /api/rooms/by-owner/:ownerId        → Find active room by owner
 * GET    /api/rooms/:roomId/ws              → WebSocket upgrade (real-time presence)
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');

const MAX_SEATS = 8;
const OWNER_SEAT_INDEX = 0;
const MAX_ROOM_MESSAGES = 200;
const ACTIVE_ROOMS_LIMIT = 100;

/** Get a Durable Object stub for a room. */
function getRoomDO(env, roomId) {
  const id = env.ROOM_DO.idFromName(roomId);
  return env.ROOM_DO.get(id);
}

/** Broadcast a message to all WebSocket clients connected to a room's DO. */
async function broadcastToRoom(env, roomId, data) {
  try {
    const stub = getRoomDO(env, roomId);
    await stub.fetch(new Request('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
    }));
  } catch (err) {
    console.error(`Failed to broadcast to room ${roomId}:`, err);
  }
}

/**
 * Assemble a full ChatRoom object from normalized D1 tables.
 * Returns camelCase JSON matching ChatRoom.fromMap expectations.
 */
async function assembleRoom(env, roomId) {
  const [room, seatsResult, participantsResult, hostsResult, bansResult,
         invitesResult, allTimeHostsResult, allTimeSeatUsersResult, giftEvent] = await Promise.all([
    env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first(),
    env.DB.prepare('SELECT * FROM room_seats WHERE room_id = ? ORDER BY seat_index').bind(roomId).all(),
    env.DB.prepare('SELECT user_id FROM room_participants WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT user_id FROM room_hosts WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT user_id, reason, kicker_name FROM room_bans WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT user_id, invited_by FROM room_invites WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT user_id FROM room_all_time_hosts WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT user_id FROM room_all_time_seat_users WHERE room_id = ?').bind(roomId).all(),
    env.DB.prepare('SELECT * FROM room_last_gift_event WHERE room_id = ?').bind(roomId).first(),
  ]);

  if (!room) return null;

  // Build seats map (0-7)
  const seats = {};
  for (let i = 0; i < MAX_SEATS; i++) {
    const seatRow = seatsResult.results.find(s => s.seat_index === i);
    seats[String(i)] = seatRow ? {
      userId: seatRow.user_id,
      state: seatRow.state || 'EMPTY',
      isMuted: !!seatRow.is_muted,
    } : { userId: null, state: 'EMPTY', isMuted: false };
  }

  // Build kickInfo map
  const kickInfo = {};
  for (const ban of bansResult.results) {
    if (ban.reason || ban.kicker_name) {
      kickInfo[ban.user_id] = {
        kickerName: ban.kicker_name || '',
        reason: ban.reason || '',
      };
    }
  }

  // Build pendingInvites map
  const pendingInvites = {};
  for (const inv of invitesResult.results) {
    pendingInvites[inv.user_id] = inv.invited_by;
  }

  // Build firstJoinTimestamps from participants
  const firstJoinTimestamps = {};
  for (const p of participantsResult.results) {
    // first_join_at stored in room_participants
  }
  const participantsWithJoin = await env.DB.prepare(
    'SELECT user_id, first_join_at FROM room_participants WHERE room_id = ?'
  ).bind(roomId).all();
  for (const p of participantsWithJoin.results) {
    if (p.first_join_at) firstJoinTimestamps[p.user_id] = p.first_join_at;
  }

  return {
    roomId: room.id,
    name: room.name,
    ownerId: room.owner_id,
    state: room.state,
    ownerLeftAt: room.owner_left_at,
    createdAt: room.created_at,
    closedAt: room.closed_at,
    voiceRoomName: room.voice_room_name || room.id,
    requireApproval: !!room.require_approval,
    participantIds: participantsResult.results.map(r => r.user_id),
    hostIds: hostsResult.results.map(r => r.user_id),
    bannedUserIds: bansResult.results.map(r => r.user_id),
    kickInfo,
    pendingInvites,
    seats,
    firstJoinTimestamps,
    allTimeHostIds: allTimeHostsResult.results.map(r => r.user_id),
    allTimeSeatUserIds: allTimeSeatUsersResult.results.map(r => r.user_id),
    lastGiftEvent: giftEvent ? {
      senderId: giftEvent.sender_id,
      senderName: giftEvent.sender_name,
      recipientId: giftEvent.recipient_id,
      recipientName: giftEvent.recipient_name,
      giftId: giftEvent.gift_id,
      giftName: giftEvent.gift_name,
      coinValue: giftEvent.coin_value,
      timestamp: giftEvent.timestamp,
    } : null,
  };
}

/** Get seats as array from D1 for a room. */
async function getSeats(env, roomId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM room_seats WHERE room_id = ? ORDER BY seat_index'
  ).bind(roomId).all();
  return results;
}

/** Clear a user from all seats except owner seat 0 (if they're the owner). */
function buildClearSeatStmts(env, roomId, userId, ownerId, seats) {
  const stmts = [];
  for (const seat of seats) {
    if (seat.user_id === userId && seat.state === 'OCCUPIED') {
      if (seat.seat_index === OWNER_SEAT_INDEX && userId === ownerId) continue;
      stmts.push(env.DB.prepare(
        "UPDATE room_seats SET user_id = NULL, state = 'EMPTY', is_muted = 0 WHERE room_id = ? AND seat_index = ?"
      ).bind(roomId, seat.seat_index));
    }
  }
  return stmts;
}

/** Build statements to close a room. */
function buildCloseStmts(env, roomId) {
  const timestamp = now();
  return [
    env.DB.prepare("UPDATE rooms SET state = 'CLOSED', closed_at = ? WHERE id = ?").bind(timestamp, roomId),
    env.DB.prepare("UPDATE room_seats SET user_id = NULL, state = 'EMPTY', is_muted = 0 WHERE room_id = ?").bind(roomId),
    env.DB.prepare("DELETE FROM room_participants WHERE room_id = ?").bind(roomId),
  ];
}


function registerRoomRoutes(router) {

  // ── Create room ──
  router.post('/api/rooms', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const name = body?.name;
    if (!name) return jsonError('name required', 400);

    const roomId = generateId();
    const timestamp = now();
    const stmts = [];

    // Create room
    stmts.push(env.DB.prepare(`
      INSERT INTO rooms (id, name, owner_id, state, voice_room_name, created_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).bind(roomId, name, uid, roomId, timestamp));

    // Create 8 seats (owner in seat 0, rest empty)
    for (let i = 0; i < MAX_SEATS; i++) {
      if (i === OWNER_SEAT_INDEX) {
        stmts.push(env.DB.prepare(`
          INSERT INTO room_seats (room_id, seat_index, user_id, state, is_muted)
          VALUES (?, ?, ?, 'OCCUPIED', 1)
        `).bind(roomId, i, uid));
      } else {
        stmts.push(env.DB.prepare(`
          INSERT INTO room_seats (room_id, seat_index, user_id, state, is_muted)
          VALUES (?, ?, NULL, 'EMPTY', 0)
        `).bind(roomId, i));
      }
    }

    // Add owner as participant
    stmts.push(env.DB.prepare(`
      INSERT INTO room_participants (room_id, user_id, first_join_at) VALUES (?, ?, ?)
    `).bind(roomId, uid, timestamp));

    // Track all-time seat users
    stmts.push(env.DB.prepare(`
      INSERT OR IGNORE INTO room_all_time_seat_users (room_id, user_id) VALUES (?, ?)
    `).bind(roomId, uid));

    // Update user's current room
    stmts.push(env.DB.prepare('UPDATE users SET current_room_id = ? WHERE uid = ?').bind(roomId, uid));

    await env.DB.batch(stmts);

    // Initialize the Durable Object for this room
    const stub = getRoomDO(env, roomId);
    await stub.fetch(new Request('https://do/init', {
      method: 'POST',
      body: JSON.stringify({ roomId, ownerId: uid }),
    }));

    return json({ roomId, voiceRoomName: roomId });
  });

  // ── WebSocket upgrade for real-time presence ──
  router.get('/api/rooms/:roomId/ws', async (request, env, params) => {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonError('Expected WebSocket upgrade', 426);
    }

    const roomId = params.roomId;
    const userId = request.auth.uid;

    // Ensure DO knows about this room
    const stub = getRoomDO(env, roomId);
    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    await stub.fetch(new Request('https://do/init', {
      method: 'POST',
      body: JSON.stringify({ roomId, ownerId: room.owner_id }),
    }));

    // Forward the WebSocket upgrade to the Durable Object
    const doUrl = new URL(request.url);
    doUrl.pathname = '/ws';
    doUrl.searchParams.set('userId', userId);

    return stub.fetch(new Request(doUrl.toString(), request));
  });

  // ── List active rooms ──
  router.get('/api/rooms/active', async (request, env) => {
    const { results: rooms } = await env.DB.prepare(`
      SELECT id FROM rooms WHERE state IN ('ACTIVE', 'OWNER_AWAY')
      ORDER BY created_at DESC LIMIT ?
    `).bind(ACTIVE_ROOMS_LIMIT).all();

    const assembled = await Promise.all(rooms.map(r => assembleRoom(env, r.id)));
    return json(assembled.filter(Boolean));
  });

  // ── Get room details ──
  router.get('/api/rooms/:roomId', async (request, env, params) => {
    const room = await assembleRoom(env, params.roomId);
    if (!room) return jsonError('Room not found', 404);
    return json(room);
  });

  // ── Join room ──
  router.post('/api/rooms/:roomId/join', async (request, env, params) => {
    const uid = request.auth.uid;
    const roomId = params.roomId;

    await env.DB.prepare(`
      INSERT OR IGNORE INTO room_participants (room_id, user_id) VALUES (?, ?)
    `).bind(roomId, uid).run();

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Leave room ──
  router.post('/api/rooms/:roomId/leave', async (request, env, params) => {
    const uid = request.auth.uid;
    const roomId = params.roomId;

    const room = await env.DB.prepare('SELECT owner_id, state FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    const stmts = [];

    // Remove participant
    stmts.push(env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?').bind(roomId, uid));

    // Clear seats
    const seats = await getSeats(env, roomId);
    stmts.push(...buildClearSeatStmts(env, roomId, uid, room.owner_id, seats));

    // Check if room should close
    const { results: remaining } = await env.DB.prepare(
      'SELECT user_id FROM room_participants WHERE room_id = ? AND user_id != ?'
    ).bind(roomId, uid).all();

    const shouldClose = remaining.length === 0 ||
      (remaining.length === 1 && remaining[0].user_id === room.owner_id && room.state === 'OWNER_AWAY');

    if (shouldClose) {
      stmts.push(...buildCloseStmts(env, roomId));
    }

    await env.DB.batch(stmts);

    if (shouldClose) {
      try {
        const stub = getRoomDO(env, roomId);
        await stub.fetch(new Request('https://do/close', { method: 'POST' }));
      } catch {}
    } else {
      await broadcastToRoom(env, roomId, { type: 'room_updated' });
    }

    return json({ success: true, roomClosed: shouldClose });
  });

  // ── Close room ──
  router.post('/api/rooms/:roomId/close', async (request, env, params) => {
    await env.DB.batch(buildCloseStmts(env, params.roomId));

    // Notify DO to close all WebSocket connections
    try {
      const stub = getRoomDO(env, params.roomId);
      await stub.fetch(new Request('https://do/close', { method: 'POST' }));
    } catch {}

    return json({ success: true });
  });

  // ── Owner away ──
  router.post('/api/rooms/:roomId/owner-away', async (request, env, params) => {
    const roomId = params.roomId;
    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    // Get current mute state of owner seat
    const ownerSeat = await env.DB.prepare(
      'SELECT is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?'
    ).bind(roomId, OWNER_SEAT_INDEX).first();

    const stmts = [
      env.DB.prepare("UPDATE rooms SET state = 'OWNER_AWAY', owner_left_at = ? WHERE id = ?")
        .bind(now(), roomId),
      // Ensure owner stays in seat 0
      env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(room.owner_id, ownerSeat?.is_muted ? 1 : 0, roomId, OWNER_SEAT_INDEX),
    ];

    await env.DB.batch(stmts);
    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Owner return ──
  router.post('/api/rooms/:roomId/owner-return', async (request, env, params) => {
    const roomId = params.roomId;
    const uid = request.auth.uid;

    const ownerSeat = await env.DB.prepare(
      'SELECT is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?'
    ).bind(roomId, OWNER_SEAT_INDEX).first();

    const stmts = [
      env.DB.prepare("UPDATE rooms SET state = 'ACTIVE', owner_left_at = NULL WHERE id = ?").bind(roomId),
      env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(uid, ownerSeat?.is_muted ? 1 : 0, roomId, OWNER_SEAT_INDEX),
    ];

    await env.DB.batch(stmts);
    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Take seat ──
  router.post('/api/rooms/:roomId/seats/:index/take', async (request, env, params) => {
    const uid = request.auth.uid;
    const roomId = params.roomId;
    const requestedIndex = parseInt(params.index);

    const seats = await getSeats(env, roomId);

    // Check if user already seated
    if (seats.some(s => s.user_id === uid && s.state === 'OCCUPIED')) {
      return json({ success: true, message: 'Already seated' });
    }

    // Find target seat
    let targetIndex = requestedIndex;
    const requestedSeat = seats.find(s => s.seat_index === requestedIndex);
    if (!requestedSeat || requestedSeat.state === 'OCCUPIED') {
      // Fall back to first empty non-owner seat
      const empty = seats.find(s => s.seat_index !== OWNER_SEAT_INDEX && s.state !== 'OCCUPIED');
      if (!empty) return jsonError('No seats available', 409);
      targetIndex = empty.seat_index;
    }

    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    const stmts = buildClearSeatStmts(env, roomId, uid, room?.owner_id, seats);

    stmts.push(env.DB.prepare(
      "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = 1 WHERE room_id = ? AND seat_index = ?"
    ).bind(uid, roomId, targetIndex));

    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO room_all_time_seat_users (room_id, user_id) VALUES (?, ?)'
    ).bind(roomId, uid));

    await env.DB.batch(stmts);

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true, seatIndex: targetIndex });
  });

  // ── Leave seat ──
  router.post('/api/rooms/:roomId/seats/:index/leave', async (request, env, params) => {
    await env.DB.prepare(
      "UPDATE room_seats SET user_id = NULL, state = 'EMPTY', is_muted = 0 WHERE room_id = ? AND seat_index = ?"
    ).bind(params.roomId, parseInt(params.index)).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Move/swap seats ──
  router.post('/api/rooms/:roomId/seats/move', async (request, env, params) => {
    const body = await parseBody(request);
    const { fromIndex, toIndex, userId } = body || {};
    const roomId = params.roomId;

    if (fromIndex == null || toIndex == null || !userId) {
      return jsonError('fromIndex, toIndex, userId required', 400);
    }

    const seats = await getSeats(env, roomId);
    const fromSeat = seats.find(s => s.seat_index === fromIndex);
    const toSeat = seats.find(s => s.seat_index === toIndex);

    if (!fromSeat || fromSeat.user_id !== userId) {
      return json({ success: true, message: 'User not in source seat' });
    }

    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    const stmts = buildClearSeatStmts(env, roomId, userId, room?.owner_id, seats);

    if (toSeat?.state === 'OCCUPIED' && toSeat.user_id) {
      // Swap
      stmts.push(env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(toSeat.user_id, fromSeat.is_muted ? 1 : 0, roomId, fromIndex));
      stmts.push(env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(userId, toSeat.is_muted ? 1 : 0, roomId, toIndex));
    } else {
      // Move to empty
      stmts.push(env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(userId, fromSeat.is_muted ? 1 : 0, roomId, toIndex));
    }

    await env.DB.batch(stmts);

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Toggle mute ──
  router.patch('/api/rooms/:roomId/seats/:index/mute', async (request, env, params) => {
    const body = await parseBody(request);
    await env.DB.prepare(
      'UPDATE room_seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?'
    ).bind(body?.isMuted ? 1 : 0, params.roomId, parseInt(params.index)).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Add host ──
  router.post('/api/rooms/:roomId/hosts/add', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId) return jsonError('userId required', 400);

    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO room_hosts (room_id, user_id) VALUES (?, ?)')
        .bind(params.roomId, body.userId),
      env.DB.prepare('INSERT OR IGNORE INTO room_all_time_hosts (room_id, user_id) VALUES (?, ?)')
        .bind(params.roomId, body.userId),
    ]);

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Remove host ──
  router.post('/api/rooms/:roomId/hosts/remove', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId) return jsonError('userId required', 400);

    await env.DB.prepare('DELETE FROM room_hosts WHERE room_id = ? AND user_id = ?')
      .bind(params.roomId, body.userId).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Kick user ──
  router.post('/api/rooms/:roomId/kick', async (request, env, params) => {
    const body = await parseBody(request);
    const { userId, kickerName, reason } = body || {};
    if (!userId) return jsonError('userId required', 400);
    const roomId = params.roomId;

    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    const seats = await getSeats(env, roomId);
    const stmts = buildClearSeatStmts(env, roomId, userId, room.owner_id, seats);

    stmts.push(env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?')
      .bind(roomId, userId));
    stmts.push(env.DB.prepare(`
      INSERT OR REPLACE INTO room_bans (room_id, user_id, reason, kicker_name)
      VALUES (?, ?, ?, ?)
    `).bind(roomId, userId, (reason || 'No reason given'), (kickerName || '')));

    await env.DB.batch(stmts);
    await broadcastToRoom(env, roomId, { type: 'kicked', userId });
    return json({ success: true });
  });

  // ── Update room (name, approval) ──
  router.patch('/api/rooms/:roomId', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const updates = [];
    const binds = [];
    if ('name' in body) { updates.push('name = ?'); binds.push(body.name); }
    if ('requireApproval' in body) { updates.push('require_approval = ?'); binds.push(body.requireApproval ? 1 : 0); }

    if (updates.length === 0) return jsonError('No valid fields', 400);

    binds.push(params.roomId);
    await env.DB.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Send invite ──
  router.post('/api/rooms/:roomId/invites/send', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId || !body?.invitedBy) return jsonError('userId and invitedBy required', 400);

    await env.DB.prepare(`
      INSERT OR REPLACE INTO room_invites (room_id, user_id, invited_by, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(params.roomId, body.userId, body.invitedBy, now()).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Cancel invite ──
  router.post('/api/rooms/:roomId/invites/cancel', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId) return jsonError('userId required', 400);

    await env.DB.prepare('DELETE FROM room_invites WHERE room_id = ? AND user_id = ?')
      .bind(params.roomId, body.userId).run();

    await broadcastToRoom(env, params.roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ── Accept invite ──
  router.post('/api/rooms/:roomId/invites/accept', async (request, env, params) => {
    const uid = request.auth.uid;
    const roomId = params.roomId;
    const body = await parseBody(request);
    const requestedSeat = body?.seatIndex ?? 1;

    const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    const seats = await getSeats(env, roomId);
    const stmts = buildClearSeatStmts(env, roomId, uid, room.owner_id, seats);

    // Remove invite
    stmts.push(env.DB.prepare('DELETE FROM room_invites WHERE room_id = ? AND user_id = ?').bind(roomId, uid));

    // Check if already seated
    if (seats.some(s => s.user_id === uid && s.state === 'OCCUPIED')) {
      await env.DB.batch(stmts);
      return json({ success: true, message: 'Already seated' });
    }

    // Find empty seat
    let targetIndex = requestedSeat;
    const target = seats.find(s => s.seat_index === requestedSeat);
    if (!target || target.state === 'OCCUPIED') {
      const empty = seats.find(s => s.seat_index !== OWNER_SEAT_INDEX && s.state !== 'OCCUPIED');
      if (!empty) {
        await env.DB.batch(stmts);
        return json({ success: true, message: 'No seats available' });
      }
      targetIndex = empty.seat_index;
    }

    stmts.push(env.DB.prepare(
      "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = 1 WHERE room_id = ? AND seat_index = ?"
    ).bind(uid, roomId, targetIndex));

    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO room_all_time_seat_users (room_id, user_id) VALUES (?, ?)'
    ).bind(roomId, uid));

    await env.DB.batch(stmts);

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true, seatIndex: targetIndex });
  });

  // ── Record first join timestamp ──
  router.post('/api/rooms/:roomId/first-join', async (request, env, params) => {
    const uid = request.auth.uid;
    const existing = await env.DB.prepare(
      'SELECT first_join_at FROM room_participants WHERE room_id = ? AND user_id = ?'
    ).bind(params.roomId, uid).first();

    if (!existing || !existing.first_join_at) {
      await env.DB.prepare(
        'UPDATE room_participants SET first_join_at = ? WHERE room_id = ? AND user_id = ?'
      ).bind(now(), params.roomId, uid).run();
    }

    return json({ success: true });
  });

  // ── Leave all rooms ──
  router.post('/api/rooms/leave-all', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const exceptRoomId = body?.exceptRoomId;

    const { results: participations } = await env.DB.prepare(
      "SELECT rp.room_id FROM room_participants rp JOIN rooms r ON r.id = rp.room_id WHERE rp.user_id = ? AND r.state IN ('ACTIVE', 'OWNER_AWAY')"
    ).bind(uid).all();

    const roomIds = participations.map(p => p.room_id).filter(id => id !== exceptRoomId);
    if (roomIds.length === 0) return json({ success: true, roomsLeft: 0 });

    const stmts = [];

    for (const roomId of roomIds) {
      const [room, seats, remaining] = await Promise.all([
        env.DB.prepare('SELECT owner_id, state FROM rooms WHERE id = ?').bind(roomId).first(),
        getSeats(env, roomId),
        env.DB.prepare('SELECT user_id FROM room_participants WHERE room_id = ? AND user_id != ?').bind(roomId, uid).all(),
      ]);
      if (!room) continue;

      if (room.owner_id === uid) {
        if (remaining.results.length === 0) {
          stmts.push(...buildCloseStmts(env, roomId));
        } else {
          // Owner away
          const ownerSeat = seats.find(s => s.seat_index === OWNER_SEAT_INDEX);
          stmts.push(env.DB.prepare("UPDATE rooms SET state = 'OWNER_AWAY', owner_left_at = ? WHERE id = ?").bind(now(), roomId));
          stmts.push(env.DB.prepare(
            "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
          ).bind(uid, ownerSeat?.is_muted ? 1 : 0, roomId, OWNER_SEAT_INDEX));
          stmts.push(env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?').bind(roomId, uid));
        }
      } else {
        stmts.push(...buildClearSeatStmts(env, roomId, uid, room.owner_id, seats));
        stmts.push(env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?').bind(roomId, uid));
      }
    }

    if (stmts.length > 0) await env.DB.batch(stmts);

    // Notify all affected rooms
    await Promise.all(roomIds.map(roomId => broadcastToRoom(env, roomId, { type: 'room_updated' })));
    return json({ success: true, roomsLeft: roomIds.length });
  });

  // ── Close all rooms by owner ──
  router.post('/api/rooms/close-all', async (request, env) => {
    const uid = request.auth.uid;

    const { results: rooms } = await env.DB.prepare(
      "SELECT id FROM rooms WHERE owner_id = ? AND state IN ('ACTIVE', 'OWNER_AWAY')"
    ).bind(uid).all();

    if (rooms.length === 0) return json({ success: true, roomsClosed: 0 });

    const stmts = [];
    for (const room of rooms) {
      stmts.push(...buildCloseStmts(env, room.id));
    }
    await env.DB.batch(stmts);

    // Notify all DOs to close WebSocket connections
    await Promise.all(rooms.map(room => {
      try {
        const stub = getRoomDO(env, room.id);
        return stub.fetch(new Request('https://do/close', { method: 'POST' }));
      } catch { return Promise.resolve(); }
    }));

    return json({ success: true, roomsClosed: rooms.length });
  });

  // ── Find active room by owner ──
  router.get('/api/rooms/by-owner/:ownerId', async (request, env, params) => {
    const room = await env.DB.prepare(
      "SELECT id FROM rooms WHERE owner_id = ? AND state IN ('ACTIVE', 'OWNER_AWAY') LIMIT 1"
    ).bind(params.ownerId).first();

    return json({ roomId: room?.id || null });
  });

  // ── Remove disconnected user ──
  router.post('/api/rooms/:roomId/remove-disconnected', async (request, env, params) => {
    const body = await parseBody(request);
    const userId = body?.userId;
    if (!userId) return jsonError('userId required', 400);
    const roomId = params.roomId;

    const room = await env.DB.prepare('SELECT owner_id, state FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return jsonError('Room not found', 404);

    // Check if user is actually a participant
    const participant = await env.DB.prepare(
      'SELECT user_id FROM room_participants WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, userId).first();
    if (!participant) return json({ success: true, message: 'Not a participant' });

    const seats = await getSeats(env, roomId);
    const isOwner = room.owner_id === userId;
    const stmts = [];

    if (isOwner) {
      // Owner disconnected: mark away, keep in seat 0
      const ownerSeat = seats.find(s => s.seat_index === OWNER_SEAT_INDEX);
      stmts.push(env.DB.prepare("UPDATE rooms SET state = 'OWNER_AWAY', owner_left_at = ? WHERE id = ?").bind(now(), roomId));
      stmts.push(env.DB.prepare(
        "UPDATE room_seats SET user_id = ?, state = 'OCCUPIED', is_muted = ? WHERE room_id = ? AND seat_index = ?"
      ).bind(userId, ownerSeat?.is_muted ? 1 : 0, roomId, OWNER_SEAT_INDEX));
    } else {
      // Non-owner: clear seats
      stmts.push(...buildClearSeatStmts(env, roomId, userId, room.owner_id, seats));

      // Check if room should close (no one on mic + owner away)
      const anyoneElseOnMic = seats.some(s =>
        s.seat_index !== OWNER_SEAT_INDEX &&
        s.user_id !== userId &&
        s.user_id !== null &&
        s.state === 'OCCUPIED'
      );

      if (!anyoneElseOnMic && room.state === 'OWNER_AWAY') {
        stmts.push(...buildCloseStmts(env, roomId));
      }
    }

    if (stmts.length > 0) await env.DB.batch(stmts);

    await broadcastToRoom(env, roomId, { type: 'room_updated' });
    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // ROOM MESSAGES
  // ══════════════════════════════════════════════════════════════

  // ── Get messages ──
  router.get('/api/rooms/:roomId/messages', async (request, env, params) => {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || String(MAX_ROOM_MESSAGES)), MAX_ROOM_MESSAGES);

    const { results } = await env.DB.prepare(`
      SELECT id AS messageId, sender_id AS senderId, sender_name AS senderName,
        text, type, is_edited AS isEdited, gift_id AS giftId, gift_icon_url AS giftIconUrl,
        created_at AS createdAt
      FROM room_messages WHERE room_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).bind(params.roomId, limit).all();

    // Return in chronological order (oldest first)
    return json(results.reverse());
  });

  // ── Send message ──
  router.post('/api/rooms/:roomId/messages', async (request, env, params) => {
    const body = await parseBody(request);
    const { senderId, senderName, text, type } = body || {};
    if (!text) return jsonError('text required', 400);
    const roomId = params.roomId;
    const msgId = generateId();
    const timestamp = now();
    const msgType = type || 'TEXT';

    const stmts = [
      env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_id, sender_name, text, type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(msgId, roomId, senderId || request.auth.uid, senderName || '', text, msgType, timestamp),
    ];

    // Trim old messages
    stmts.push(env.DB.prepare(`
      DELETE FROM room_messages WHERE room_id = ? AND id NOT IN (
        SELECT id FROM room_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?
      )
    `).bind(roomId, roomId, MAX_ROOM_MESSAGES));

    await env.DB.batch(stmts);

    // Broadcast to connected clients so they can refetch messages
    await broadcastToRoom(env, roomId, { type: 'new_message' });

    return json({
      messageId: msgId,
      senderId: senderId || request.auth.uid,
      senderName: senderName || '',
      text,
      type: msgType,
      createdAt: timestamp,
    });
  });

  // ── Edit message ──
  router.patch('/api/rooms/:roomId/messages/:msgId', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.text) return jsonError('text required', 400);

    await env.DB.prepare(
      'UPDATE room_messages SET text = ?, is_edited = 1 WHERE id = ? AND room_id = ?'
    ).bind(body.text, params.msgId, params.roomId).run();

    await broadcastToRoom(env, params.roomId, { type: 'new_message' });
    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // SEAT REQUESTS
  // ══════════════════════════════════════════════════════════════

  // ── Get pending requests ──
  router.get('/api/rooms/:roomId/seat-requests', async (request, env, params) => {
    const { results } = await env.DB.prepare(`
      SELECT id AS requestId, user_id AS userId, user_name AS userName,
        seat_index AS seatIndex, status, resolved_by AS resolvedBy,
        resolved_at AS resolvedAt, created_at AS createdAt
      FROM seat_requests WHERE room_id = ? AND status = 'PENDING'
      ORDER BY created_at ASC
    `).bind(params.roomId).all();

    return json(results);
  });

  // ── Get user's requests ──
  router.get('/api/rooms/:roomId/seat-requests/user/:uid', async (request, env, params) => {
    const { results } = await env.DB.prepare(`
      SELECT id AS requestId, user_id AS userId, user_name AS userName,
        seat_index AS seatIndex, status, resolved_by AS resolvedBy,
        resolved_at AS resolvedAt, created_at AS createdAt
      FROM seat_requests WHERE room_id = ? AND user_id = ? AND status IN ('PENDING', 'APPROVED')
      ORDER BY created_at ASC
    `).bind(params.roomId, params.uid).all();

    return json(results);
  });

  // ── Create seat request ──
  router.post('/api/rooms/:roomId/seat-requests', async (request, env, params) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { userName, seatIndex } = body || {};
    if (seatIndex == null) return jsonError('seatIndex required', 400);
    const roomId = params.roomId;

    // Check for existing pending request
    const existing = await env.DB.prepare(
      "SELECT id FROM seat_requests WHERE room_id = ? AND user_id = ? AND status = 'PENDING'"
    ).bind(roomId, uid).first();

    if (existing) {
      // Update existing
      await env.DB.prepare(
        'UPDATE seat_requests SET seat_index = ?, created_at = ? WHERE id = ?'
      ).bind(seatIndex, now(), existing.id).run();
      await broadcastToRoom(env, roomId, { type: 'seat_request_updated' });
      return json({ requestId: existing.id });
    }

    const reqId = generateId();
    await env.DB.prepare(`
      INSERT INTO seat_requests (id, room_id, user_id, user_name, seat_index, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `).bind(reqId, roomId, uid, userName || '', seatIndex, now()).run();

    await broadcastToRoom(env, roomId, { type: 'seat_request_updated' });
    return json({ requestId: reqId });
  });

  // ── Approve seat request ──
  router.post('/api/rooms/:roomId/seat-requests/:reqId/approve', async (request, env, params) => {
    const body = await parseBody(request);
    const resolvedBy = body?.resolvedBy || request.auth.uid;
    const timestamp = now();

    await env.DB.prepare(
      "UPDATE seat_requests SET status = 'APPROVED', resolved_by = ?, resolved_at = ? WHERE id = ? AND room_id = ?"
    ).bind(resolvedBy, timestamp, params.reqId, params.roomId).run();

    // Return updated request
    const req = await env.DB.prepare(`
      SELECT id AS requestId, user_id AS userId, user_name AS userName,
        seat_index AS seatIndex, status, resolved_by AS resolvedBy,
        resolved_at AS resolvedAt, created_at AS createdAt
      FROM seat_requests WHERE id = ?
    `).bind(params.reqId).first();

    await broadcastToRoom(env, params.roomId, { type: 'seat_request_updated' });
    return json(req || { requestId: params.reqId, status: 'APPROVED' });
  });

  // ── Deny seat request ──
  router.post('/api/rooms/:roomId/seat-requests/:reqId/deny', async (request, env, params) => {
    const body = await parseBody(request);
    const resolvedBy = body?.resolvedBy || request.auth.uid;

    await env.DB.prepare(
      "UPDATE seat_requests SET status = 'DENIED', resolved_by = ?, resolved_at = ? WHERE id = ? AND room_id = ?"
    ).bind(resolvedBy, now(), params.reqId, params.roomId).run();

    await broadcastToRoom(env, params.roomId, { type: 'seat_request_updated' });
    return json({ success: true });
  });

  // ── Cancel seat request (user cancels their own approved request) ──
  router.post('/api/rooms/:roomId/seat-requests/:reqId/cancel', async (request, env, params) => {
    const uid = request.auth.uid;

    await env.DB.prepare(
      "UPDATE seat_requests SET status = 'DENIED', resolved_by = ?, resolved_at = ? WHERE id = ? AND room_id = ? AND user_id = ?"
    ).bind(uid, now(), params.reqId, params.roomId, uid).run();

    await broadcastToRoom(env, params.roomId, { type: 'seat_request_updated' });
    return json({ success: true });
  });
}

module.exports = { registerRoomRoutes };
