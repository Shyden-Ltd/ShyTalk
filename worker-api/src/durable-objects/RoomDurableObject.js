/**
 * RoomDurableObject — manages real-time room presence via WebSocket.
 *
 * Responsibilities:
 * - Track connected users (WebSocket session = present)
 * - Broadcast presence changes to all connected clients
 * - Detect owner disconnect → set OWNER_AWAY in D1 + start 5-min alarm
 * - Alarm fires → close room in D1 + notify clients
 * - Accept event broadcasts from Worker REST handlers (room_updated, etc.)
 *
 * WebSocket protocol:
 *   Client → Server: { type: "ping" }
 *   Server → Client: { type: "pong" }
 *                    { type: "presence", userIds: [...] }
 *                    { type: "room_updated" }
 *                    { type: "room_closed" }
 *                    { type: "kicked", userId: "..." }
 */

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, WebSocket>} userId → server-side WebSocket */
    this.sessions = new Map();
    /** @type {Map<string, number>} userId → disconnect grace timer ID */
    this.gracePeriods = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(url);
    }

    // Internal REST endpoints (called by Worker route handlers)
    switch (url.pathname) {
      case '/broadcast':
        return this.handleBroadcast(request);
      case '/presence':
        return this.getPresence();
      case '/close':
        return this.closeRoom();
      case '/init':
        return this.initRoom(request);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Initialize room metadata in DO storage.
   * Called when the room is created or when the first WebSocket connects.
   */
  async initRoom(request) {
    const { roomId, ownerId } = await request.json();
    await this.state.storage.put('roomId', roomId);
    await this.state.storage.put('ownerId', ownerId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle a new WebSocket upgrade request.
   * The userId is passed as a query parameter by the Worker route handler.
   */
  async handleWebSocket(url) {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // Cancel any pending grace period for this user (reconnection)
    const existingTimer = this.gracePeriods.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.gracePeriods.delete(userId);
    }

    // Close existing session for this user (duplicate connection)
    const existing = this.sessions.get(userId);
    if (existing) {
      try { existing.close(1000, 'Reconnected from another session'); } catch {}
    }

    this.sessions.set(userId, server);
    this.broadcastPresence();

    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') {
          server.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {}
    });

    server.addEventListener('close', () => {
      // Only process if this is still the active session for this user
      if (this.sessions.get(userId) === server) {
        this.sessions.delete(userId);
        this.broadcastPresence();
        this.handleDisconnect(userId);
      }
    });

    server.addEventListener('error', () => {
      if (this.sessions.get(userId) === server) {
        this.sessions.delete(userId);
        this.broadcastPresence();
        this.handleDisconnect(userId);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle user disconnect. If the user is the room owner,
   * set OWNER_AWAY state and start the 5-minute alarm.
   */
  async handleDisconnect(userId) {
    const ownerId = await this.state.storage.get('ownerId');
    if (userId !== ownerId) return;

    // Owner disconnected — check if anyone else is still connected
    if (this.sessions.size === 0) {
      // Room is empty, close it
      await this.closeRoomInD1();
      return;
    }

    // Others are still in the room — set OWNER_AWAY + start 5-min alarm
    const roomId = await this.state.storage.get('roomId');
    if (!roomId) return;

    const now = Date.now();
    try {
      await this.env.DB.prepare(
        `UPDATE rooms SET state = 'OWNER_AWAY', owner_left_at = ? WHERE id = ? AND state = 'ACTIVE'`
      ).bind(now, roomId).run();
    } catch (err) {
      console.error('Failed to set OWNER_AWAY:', err);
    }

    // Schedule alarm for 5 minutes (300,000 ms)
    await this.state.storage.setAlarm(now + 300_000);

    // Broadcast room_updated so clients refetch
    this.broadcast({ type: 'room_updated' });
  }

  /**
   * Alarm handler — fires when the 5-minute owner-away timer expires.
   * If the owner hasn't reconnected, close the room.
   */
  async alarm() {
    const ownerId = await this.state.storage.get('ownerId');

    // If the owner reconnected, the alarm is stale — ignore
    if (this.sessions.has(ownerId)) return;

    await this.closeRoomInD1();
    await this.closeRoom();
  }

  /**
   * Close the room in D1 (mark as CLOSED, clear seats, etc.).
   */
  async closeRoomInD1() {
    const roomId = await this.state.storage.get('roomId');
    if (!roomId) return;

    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE rooms SET state = 'CLOSED', owner_left_at = NULL WHERE id = ?`
        ).bind(roomId),
        this.env.DB.prepare(
          `DELETE FROM room_seats WHERE room_id = ?`
        ).bind(roomId),
        this.env.DB.prepare(
          `DELETE FROM room_participants WHERE room_id = ?`
        ).bind(roomId),
      ]);
    } catch (err) {
      console.error('Failed to close room in D1:', err);
    }
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const [, ws] of this.sessions) {
      try { ws.send(msg); } catch {}
    }
  }

  /**
   * Broadcast current presence (set of connected user IDs) to all clients.
   */
  broadcastPresence() {
    this.broadcast({
      type: 'presence',
      userIds: Array.from(this.sessions.keys()),
    });
  }

  /**
   * Handle a broadcast request from the Worker REST handler.
   * Used to push events (room_updated, kicked, etc.) to connected clients.
   */
  async handleBroadcast(request) {
    const data = await request.json();
    this.broadcast(data);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Return current presence as a JSON response.
   */
  getPresence() {
    return new Response(JSON.stringify({
      userIds: Array.from(this.sessions.keys()),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Close the room: notify all clients and disconnect them.
   */
  async closeRoom() {
    this.broadcast({ type: 'room_closed' });

    for (const [, ws] of this.sessions) {
      try { ws.close(1000, 'Room closed'); } catch {}
    }
    this.sessions.clear();

    // Clear all grace periods
    for (const [, timer] of this.gracePeriods) {
      clearTimeout(timer);
    }
    this.gracePeriods.clear();

    // Cancel any pending alarm
    await this.state.storage.deleteAlarm();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
