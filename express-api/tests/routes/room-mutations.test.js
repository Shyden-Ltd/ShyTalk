const express = require('express');
const request = require('supertest');

// ── Firebase Admin mock (db.runTransaction + FieldValue sentinels) ──
const mockTxnGet = jest.fn();
const mockTxnUpdate = jest.fn();
const mockRoomRef = { path: 'rooms/room-1' };
const mockRtdbSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => mockRoomRef),
    runTransaction: jest.fn(async (fn) => fn({ get: mockTxnGet, update: mockTxnUpdate })),
  },
  rtdb: { ref: jest.fn(() => ({ set: (...a) => mockRtdbSet(...a) })) },
  FieldValue: {
    arrayUnion: (...args) => ({ __arrayUnion: args }),
    delete: () => ({ __delete: true }),
  },
}));

// Caller cohort is controllable per test; the room is cohort-stamped.
let mockCohort = 'adult';
jest.mock('../../src/utils/firebase-claims', () => ({
  cohortFromClaim: () => mockCohort,
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

function createApp(uniqueId = 10) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId };
    next();
  });
  app.use('/api', router);
  return app;
}

function snap(room) {
  return room === null ? { exists: false } : { exists: true, data: () => room };
}

/** Default room: owner=1 (seat 0), host=10, attendee=99; seats 3 & 4 empty. */
function mkRoom(overrides = {}) {
  return {
    ownerId: '1',
    cohort: 'adult',
    state: 'ACTIVE',
    participantIds: ['1', '10', '99'],
    hostIds: ['10'],
    requireApproval: false,
    pendingInvites: {},
    seats: {
      0: { userId: '1', state: 'OCCUPIED', isMuted: false },
      3: { userId: null, state: 'EMPTY', isMuted: false },
      4: { userId: null, state: 'EMPTY', isMuted: false },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCohort = 'adult';
  mockRtdbSet.mockResolvedValue();
});

describe('POST /api/rooms/:roomId/seats/:seatIndex/claim', () => {
  test('400 on out-of-range seat index (>= MAX_SEATS) — no transaction', async () => {
    const res = await request(createApp()).post('/api/rooms/room-1/seats/8/claim').send({});
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('400 on negative seat index', async () => {
    const res = await request(createApp()).post('/api/rooms/room-1/seats/-1/claim').send({});
    expect(res.status).toBe(400);
  });

  test('400 on non-numeric seat index', async () => {
    const res = await request(createApp()).post('/api/rooms/room-1/seats/abc/claim').send({});
    expect(res.status).toBe(400);
  });

  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp()).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(404);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('404 (hidden) when the caller cohort differs from the room cohort', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp()).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(404);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp()).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(409);
  });

  test('409 SEAT_TAKEN when the seat is already occupied (race guard)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_TAKEN');
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when an attendee tries to take a seat directly (must use the request flow)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(99)).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when a non-owner tries to take seat 0 (owner-only)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/0/claim').send({});
    expect(res.status).toBe(403);
  });

  test('409 ALREADY_SEATED when the caller already occupies another seat', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          seats: {
            3: { userId: null, state: 'EMPTY', isMuted: false },
            4: { userId: '10', state: 'OCCUPIED', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SEATED');
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 seats a host in an empty seat (transactional write + broadcast)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        'seats.3.userId': '10',
        'seats.3.state': 'OCCUPIED',
        'seats.3.isMuted': false,
        participantIds: { __arrayUnion: ['10'] },
        allTimeSeatUserIds: { __arrayUnion: ['10'] },
      }),
    );
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 lets the owner take seat 0', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } } })),
    );
    const res = await request(createApp(1)).post('/api/rooms/room-1/seats/0/claim').send({});
    expect(res.status).toBe(200);
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('Firestore down'));
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/claim').send({});
    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:roomId/seats/:seatIndex/accept-invite', () => {
  test('403 when the caller has no pending invite', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ pendingInvites: {} })));
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when accepting into seat 0 (owner-only)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          pendingInvites: { 20: '1' },
          seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/0/accept-invite')
      .send({});
    expect(res.status).toBe(403);
  });

  test('409 SEAT_TAKEN when the invited seat is occupied', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          pendingInvites: { 20: '1' },
          seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_TAKEN');
  });

  test('200 seats the invited user, consumes the invite, adds participant', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          pendingInvites: { 20: '1' },
          participantIds: ['1', '10'],
          seats: { 3: { userId: null, state: 'EMPTY', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        'pendingInvites.20': { __delete: true },
        'seats.3.userId': '20',
        'seats.3.state': 'OCCUPIED',
        participantIds: { __arrayUnion: ['20'] },
      }),
    );
  });
});

describe('POST /api/rooms/:roomId/seats/:seatIndex/leave', () => {
  test("200 clears the caller's own seat", async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/leave').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ 'seats.3.userId': null, 'seats.3.state': 'EMPTY' }),
    );
  });

  test('403 when the caller does not occupy that seat', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/leave').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });
});
