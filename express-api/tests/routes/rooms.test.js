const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();
const mockRtdbSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: mockCollectionGet,
          })),
        })),
      })),
    })),
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: mockRtdbSet,
    })),
  },
  messaging: {
    sendEachForMulticast: jest.fn().mockResolvedValue({ responses: [] }),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'req-123',
  now: () => 1709913600000,
}));

const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const roomsRouter = require('../../src/routes/rooms');

function createApp(uniqueId = 'user-A') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId };
    next();
  });
  // Mount at /api — same as production index.js
  app.use('/api', roomsRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/rooms/:roomId/invites/send', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Test Room',
        pendingInvites: {},
      }),
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    // Should NOT be 404 (which would mean route doesn't match)
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  test('returns 400 when userId is missing', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ invitedBy: 'user-A' })
      .expect(400);
  });

  test('returns 400 when invitedBy is missing', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B' })
      .expect(400);
  });

  test('returns 404 when room does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(404);
  });

  test('returns 403 when invitedBy is spoofed (does not match auth)', async () => {
    const app = createApp('real-user');
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'impersonated-user' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another user/i);
  });

  test('merges into existing pendingInvites on room doc', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Room',
        pendingInvites: { 'existing-user': { invitedBy: 'someone', invitedAt: 1000 } },
      }),
    });

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    // pendingInvites should include both the existing and new invite
    const updateCall = mockDocUpdate.mock.calls[0];
    expect(updateCall[0].pendingInvites['existing-user']).toBeDefined();
    expect(updateCall[0].pendingInvites['user-B']).toBeDefined();
  });

  // --- FCM invite path (lines 63-89) ---

  test('sends FCM push to invitee with tokens', async () => {
    // First call: room doc, second: invitee doc, third: inviter doc
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Cool Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['token-1', 'token-2'] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: 'Alice' }),
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(200);
    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['token-1', 'token-2'],
      expect.objectContaining({
        type: 'ROOM_INVITE',
        roomId: 'room-1',
        roomName: 'Cool Room',
        invitedBy: 'user-A',
        inviterName: 'Alice',
      }),
    );
  });

  test('cleans up invalid tokens after FCM send', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['good-token', 'bad-token'] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: 'Bob' }),
      });

    mockSendFcmToTokens.mockResolvedValue(['bad-token']);

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['bad-token'], 'user-B');
  });

  test('skips FCM when invitee has no tokens', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: [] }),
      });

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM when invitee does not exist', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: false,
      });

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('uses "Someone" when inviter displayName is missing', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({}), // No displayName
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['tok-1'],
      expect.objectContaining({ inviterName: 'Someone' }),
    );
  });

  test('uses "Someone" when inviter doc does not exist', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      })
      .mockResolvedValueOnce({
        exists: false,
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['tok-1'],
      expect.objectContaining({ inviterName: 'Someone' }),
    );
  });

  test('uses "a room" when room name is missing', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ pendingInvites: {} }), // No name
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: 'Alice' }),
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('user-A');
    await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' })
      .expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['tok-1'],
      expect.objectContaining({ roomName: 'a room' }),
    );
  });

  test('logs error and still returns 200 when FCM push fails', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ name: 'Room', pendingInvites: {} }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: 'Alice' }),
      });

    mockSendFcmToTokens.mockRejectedValue(new Error('FCM service down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      'rooms',
      'Failed to send invite FCM',
      expect.objectContaining({ error: 'FCM service down' }),
    );
  });

  // --- RTDB broadcast error (line 28) ---

  test('logs error when RTDB broadcast fails', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Room', pendingInvites: {} }),
    });

    mockRtdbSet.mockRejectedValue(new Error('RTDB write failed'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    // Should still succeed (broadcast failure is non-fatal)
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'rooms',
      'Failed to write RTDB event',
      expect.objectContaining({ error: 'RTDB write failed' }),
    );
  });

  // --- Top-level catch block (lines 94-95) ---

  test('returns 500 when room doc fetch throws', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(log.error).toHaveBeenCalledWith(
      'rooms',
      'Send invite failed',
      expect.objectContaining({ error: 'Firestore down' }),
    );
  });
});

describe('POST /api/rooms/:roomId/seat-requests', () => {
  test('route is reachable (no double /api prefix)', async () => {
    // No existing pending request
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    // Room doc for FCM push
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        ownerId: 'owner-1',
        name: 'Test Room',
      }),
    });

    const app = createApp('requester-1');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 2 });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
  });

  test('returns 400 when seatIndex is missing', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice' })
      .expect(400);
  });

  test('returns 400 when seatIndex is a string', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 'abc' })
      .expect(400);
  });

  test('returns 400 when seatIndex is negative', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: -1 })
      .expect(400);
  });

  test('returns 400 when seatIndex exceeds max (20)', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 21 })
      .expect(400);
  });

  test('returns 400 when seatIndex is a float', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 2.5 })
      .expect(400);
  });

  test('returns 400 when seatIndex is null', async () => {
    const app = createApp();
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: null })
      .expect(400);
  });

  test('accepts seatIndex 0 (boundary)', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ownerId: 'owner-1', name: 'Room' }),
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 0 });

    expect(res.status).toBe(200);
  });

  test('accepts seatIndex 20 (max boundary)', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ownerId: 'owner-1', name: 'Room' }),
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 20 });

    expect(res.status).toBe(200);
  });

  test('truncates userName exceeding max length', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ownerId: 'owner-1', name: 'Test Room' }),
    });

    const app = createApp('requester-1');
    const longName = 'A'.repeat(100);
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: longName, seatIndex: 2 })
      .expect(200);

    // The userName written to Firestore should be truncated to 50 chars
    const setCall = mockDocSet.mock.calls[0];
    expect(setCall[0].userName.length).toBe(50);
  });

  test('updates existing pending request instead of creating new one', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'existing-req-1' }],
    });

    const app = createApp('requester-1');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Alice', seatIndex: 3 })
      .expect(200);

    expect(res.body.requestId).toBe('existing-req-1');
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  // --- FCM seat request path (lines 162-177) ---

  test('sends FCM push to room owner when creating new seat request', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    // First call: room doc (for FCM), second call: owner doc
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Fun Room' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['owner-token-1'] }),
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 3 })
      .expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['owner-token-1'],
      expect.objectContaining({
        type: 'SEAT_REQUEST',
        roomId: 'room-1',
        roomName: 'Fun Room',
        requesterId: 'requester-1',
        requesterName: 'Bob',
        seatIndex: '3',
      }),
    );
  });

  test('cleans up invalid tokens after seat request FCM send', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Room' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['good', 'bad'] }),
      });

    mockSendFcmToTokens.mockResolvedValue(['bad']);

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['bad'], 'owner-1');
  });

  test('skips FCM when room has no ownerId', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Ownerless Room' }), // No ownerId
    });

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM when owner has no tokens', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Room' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: [] }),
      });

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM when owner doc does not exist', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Room' }),
      })
      .mockResolvedValueOnce({
        exists: false,
      });

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM when room doc does not exist (for FCM lookup)', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet.mockResolvedValue({
      exists: false,
    });

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('uses "a room" as roomName fallback in seat request FCM', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1' }), // No name
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('requester-1');
    await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 })
      .expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['tok-1'],
      expect.objectContaining({ roomName: 'a room' }),
    );
  });

  test('uses empty string as requesterName when userName is not provided', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Room' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      });

    mockSendFcmToTokens.mockResolvedValue([]);

    const app = createApp('requester-1');
    await request(app).post('/api/rooms/room-1/seat-requests').send({ seatIndex: 1 }).expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['tok-1'],
      expect.objectContaining({ requesterName: '' }),
    );
  });

  test('logs error and still returns 200 when seat request FCM fails', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ownerId: 'owner-1', name: 'Room' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ fcmTokens: ['tok-1'] }),
      });

    mockSendFcmToTokens.mockRejectedValue(new Error('FCM unavailable'));

    const app = createApp('requester-1');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 });

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'rooms',
      'Failed to send seat request FCM',
      expect.objectContaining({ error: 'FCM unavailable' }),
    );
  });

  // --- Top-level catch block (lines 186-193) ---

  test('returns 500 when seat request creation throws', async () => {
    mockCollectionGet.mockRejectedValue(new Error('Firestore timeout'));

    const app = createApp('requester-1');
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ userName: 'Bob', seatIndex: 1 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(log.error).toHaveBeenCalledWith(
      'rooms',
      'Create seat request failed',
      expect.objectContaining({ error: 'Firestore timeout' }),
    );
  });
});
