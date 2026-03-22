const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();

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
      set: jest.fn().mockResolvedValue(),
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
});
