/**
 * ConversationDurableObject — manages real-time typing indicators
 * and event broadcasting for private conversations.
 *
 * Replaces Firebase RTDB /typing/{conversationId}/{userId} paths.
 *
 * WebSocket protocol:
 *   Client → Server: { type: "typing_start" }
 *                    { type: "typing_stop" }
 *                    { type: "ping" }
 *   Server → Client: { type: "pong" }
 *                    { type: "typing", userId: "...", isTyping: true/false }
 *                    { type: "new_message" }  (broadcast from REST handler)
 *
 * Internal REST endpoints (called by Worker route handlers):
 *   POST /broadcast — push an event to all connected clients
 */

export class ConversationDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, WebSocket>} userId → server-side WebSocket */
    this.sessions = new Map();
    /** @type {Map<string, number>} userId → typing auto-clear timeout ID */
    this.typingTimers = new Map();
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
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Handle a new WebSocket upgrade request.
   * The userId is passed as a query parameter.
   */
  async handleWebSocket(url) {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // Close existing session for this user (duplicate connection)
    const existing = this.sessions.get(userId);
    if (existing) {
      try { existing.close(1000, 'Reconnected from another session'); } catch {}
    }

    this.sessions.set(userId, server);

    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(userId, data);
      } catch {}
    });

    server.addEventListener('close', () => {
      if (this.sessions.get(userId) === server) {
        this.sessions.delete(userId);
        this.clearTyping(userId);
      }
    });

    server.addEventListener('error', () => {
      if (this.sessions.get(userId) === server) {
        this.sessions.delete(userId);
        this.clearTyping(userId);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle an incoming WebSocket message from a client.
   */
  handleMessage(userId, data) {
    switch (data.type) {
      case 'ping':
        this.sendTo(userId, { type: 'pong' });
        break;

      case 'typing_start':
        this.setTyping(userId, true);
        break;

      case 'typing_stop':
        this.setTyping(userId, false);
        break;
    }
  }

  /**
   * Set typing state for a user and broadcast to others.
   * Auto-clears after 5 seconds if no follow-up typing_start.
   */
  setTyping(userId, isTyping) {
    // Clear any existing auto-clear timer
    const existingTimer = this.typingTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.typingTimers.delete(userId);
    }

    // Broadcast typing state to all OTHER connected users
    this.broadcastExcept(userId, {
      type: 'typing',
      userId,
      isTyping,
    });

    // If typing started, set a 5-second auto-clear
    if (isTyping) {
      const timer = setTimeout(() => {
        this.typingTimers.delete(userId);
        this.broadcastExcept(userId, {
          type: 'typing',
          userId,
          isTyping: false,
        });
      }, 5000);
      this.typingTimers.set(userId, timer);
    }
  }

  /**
   * Clear typing state for a user (on disconnect).
   */
  clearTyping(userId) {
    const timer = this.typingTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(userId);
    }

    // Notify others that user stopped typing
    this.broadcastExcept(userId, {
      type: 'typing',
      userId,
      isTyping: false,
    });
  }

  /**
   * Send a message to a specific user.
   */
  sendTo(userId, data) {
    const ws = this.sessions.get(userId);
    if (ws) {
      try { ws.send(JSON.stringify(data)); } catch {}
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
   * Broadcast a message to all connected clients except one.
   */
  broadcastExcept(excludeUserId, data) {
    const msg = JSON.stringify(data);
    for (const [uid, ws] of this.sessions) {
      if (uid !== excludeUserId) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  /**
   * Handle a broadcast request from the Worker REST handler.
   * Used to push events (new_message, etc.) to connected clients.
   */
  async handleBroadcast(request) {
    const data = await request.json();
    this.broadcast(data);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
