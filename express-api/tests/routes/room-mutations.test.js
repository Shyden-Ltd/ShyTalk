const express = require('express');
const request = require('supertest');

// ── Firebase Admin mock (db.runTransaction + FieldValue sentinels) ──
const mockTxnGet = jest.fn();
const mockTxnUpdate = jest.fn();
const mockDocGet = jest.fn(); // non-transactional roomRef.get() — owner-away/disconnect pre-read
const mockDocSet = jest.fn().mockResolvedValue(); // db.doc(...).set() — disconnect-user currentRoomId clear
const mockRoomRef = {
  path: 'rooms/room-1',
  get: (...a) => mockDocGet(...a),
  set: (...a) => mockDocSet(...a),
};
const mockRtdbSet = jest.fn().mockResolvedValue();
const mockRtdbGet = jest.fn(); // RTDB presence read (owner-away / disconnect-user)
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => mockRoomRef),
    runTransaction: jest.fn(async (fn) => fn({ get: mockTxnGet, update: mockTxnUpdate })),
    batch: jest.fn(() => ({
      set: (...a) => mockBatchSet(...a),
      commit: (...a) => mockBatchCommit(...a),
    })),
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: (...a) => mockRtdbSet(...a),
      get: (...a) => mockRtdbGet(...a),
    })),
  },
  FieldValue: {
    arrayUnion: (...args) => ({ __arrayUnion: args }),
    arrayRemove: (...args) => ({ __arrayRemove: args }),
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
  mockBatchCommit.mockResolvedValue();
  mockRtdbGet.mockResolvedValue({ exists: () => true }); // target present by default
  mockDocGet.mockResolvedValue({ exists: false }); // pre-read; set per test
  mockDocSet.mockResolvedValue();
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
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult', pendingInvites: { 20: '1' } })));
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    // Cross-cohort caller never observes whether the invite exists.
    expect(res.status).toBe(404);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('409 when the room is CLOSED — gate fires before invite/seat checks', async () => {
    // The impl orders the CLOSED gate FIRST so an attacker post-CLOSE can't
    // probe whether their invite or target seat still exists.
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'CLOSED',
          pendingInvites: { 20: '1' },
          seats: { 3: { userId: null, state: 'EMPTY', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

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

  test('409 ALREADY_SEATED when the caller already occupies another seat', async () => {
    // The /accept-invite impl mirrors /claim's per-user uniqueness guard: a
    // user cannot occupy two seats simultaneously. Pre-fix the impl gated
    // this case but no test pinned it; an accidental refactor that dropped
    // the userSeatIndex check would not have failed any test.
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          pendingInvites: { 20: '1' },
          // caller (uid 20) is already in seat 5
          seats: {
            3: { userId: null, state: 'EMPTY', isMuted: false },
            5: { userId: '20', state: 'OCCUPIED', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SEATED');
    expect(mockTxnUpdate).not.toHaveBeenCalled();
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

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(20))
      .post('/api/rooms/room-1/seats/3/accept-invite')
      .send({});
    expect(res.status).toBe(500);
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

  test('200 CLOSED-room cleanup: caller can still vacate their own seat after close', async () => {
    // CLEANUP-ON-CLOSED invariant: self-targeted vacate endpoints stay
    // available on CLOSED rooms so a client recovering from a crash/disconnect
    // can drop its stale seat occupancy. Distinct from state-extending writes
    // (/join, /name, /first-join, /claim) which 409 on CLOSED. Documenting
    // INTENTIONAL design — changing /seats/:seatIndex/leave to reject CLOSED
    // would break crash-recovery flows where the room transitioned to CLOSED
    // between the client's last state read and its self-vacate retry.
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'CLOSED',
          seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/3/leave').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ 'seats.3.userId': null, 'seats.3.state': 'EMPTY' }),
    );
  });
});

describe('POST /api/rooms/:roomId/kick', () => {
  test('400 when userId is missing', async () => {
    const res = await request(createApp(1)).post('/api/rooms/room-1/kick').send({});
    expect(res.status).toBe(400);
  });

  test('403 when an attendee tries to kick', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(99)).post('/api/rooms/room-1/kick').send({ userId: '88' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when a host tries to kick the owner', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(10)).post('/api/rooms/room-1/kick').send({ userId: '1' });
    expect(res.status).toBe(403);
  });

  test('403 when a host tries to kick another host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ hostIds: ['10', '55'] })));
    const res = await request(createApp(10)).post('/api/rooms/room-1/kick').send({ userId: '55' });
    expect(res.status).toBe(403);
  });

  test('200 owner bans + removes the target and clears their seat', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '99', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/kick')
      .send({ userId: '99', reason: 'spam', kickerName: 'Alice' });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        bannedUserIds: { __arrayUnion: ['99'] },
        participantIds: { __arrayRemove: ['99'] },
        'kickInfo.99': { kickerName: 'Alice', reason: 'spam' },
        'seats.4.userId': null,
        'seats.4.state': 'EMPTY',
      }),
    );
  });

  test('200 host kicks an attendee who is not seated (no seat fields written)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ participantIds: ['1', '10', '99'] })));
    const res = await request(createApp(10)).post('/api/rooms/room-1/kick').send({ userId: '99' });
    expect(res.status).toBe(200);
    const update = mockTxnUpdate.mock.calls[0][1];
    expect(update.bannedUserIds).toEqual({ __arrayUnion: ['99'] });
    expect(Object.keys(update).some((k) => k.startsWith('seats.'))).toBe(false);
  });

  test('409 when the room is CLOSED — gate fires AFTER role check (info-hiding ordering)', async () => {
    // The CLOSED gate is positioned AFTER the canKickUser role check so an
    // unprivileged caller still sees 403 regardless of room state — preventing
    // a state-probe by switching between role-lacking and privileged accounts.
    // This test uses the OWNER (uid=1) to clear the role gate and isolate the
    // CLOSED branch. Kicking a user from a dead room is a state-extending write
    // (the ban persists in bannedUserIds) so CLOSED rooms must reject it,
    // matching the universal invariant from the matrix doc.
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/kick').send({ userId: '99' });
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:roomId/seats/:seatIndex/remove', () => {
  test('403 when an attendee tries to remove an occupant', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(99)).post('/api/rooms/room-1/seats/4/remove').send({});
    expect(res.status).toBe(403);
  });

  test('403 when removing the occupant of seat 0 (owner seat is protected)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1)).post('/api/rooms/room-1/seats/0/remove').send({});
    expect(res.status).toBe(403);
  });

  test('200 host removes an attendee from a seat (no ban)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/seats/4/remove').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ 'seats.4.userId': null, 'seats.4.state': 'EMPTY' }),
    );
  });
});

describe('PATCH /api/rooms/:roomId/seats/:seatIndex/mute', () => {
  test('400 when isMuted is missing', async () => {
    const res = await request(createApp(1)).patch('/api/rooms/room-1/seats/4/mute').send({});
    expect(res.status).toBe(400);
  });

  test('409 when the seat is empty', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/seats/3/mute')
      .send({ isMuted: true });
    expect(res.status).toBe(409);
  });

  test('403 when an attendee tries to force-mute', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(99))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: true });
    expect(res.status).toBe(403);
  });

  test('403 when a host tries to mute another host', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          hostIds: ['10', '55'],
          seats: { 4: { userId: '55', state: 'OCCUPIED', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(10))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: true });
    expect(res.status).toBe(403);
  });

  test('200 owner force-mutes an attendee', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: true });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ 'seats.4.isMuted': true }),
    );
  });

  test('403 when a non-occupant tries to unmute someone', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: true } } })),
    );
    const res = await request(createApp(10))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: false });
    expect(res.status).toBe(403);
  });

  test('200 the occupant unmutes themselves', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: true } } })),
    );
    const res = await request(createApp(88))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: false });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ 'seats.4.isMuted': false }),
    );
  });

  test('409 when the room is CLOSED — gate fires BEFORE seat-empty probe', async () => {
    // The CLOSED gate sits at the top of the handler — before the seat-empty
    // 409 branch — so an attacker cannot probe "is seat N still occupied in
    // that dead room?" by comparing the error message between empty vs
    // occupied seats. The test uses an OCCUPIED seat (so the write would
    // otherwise succeed, 200) to prove the CLOSED gate fires before any
    // state-read or write — masking occupancy state from the caller.
    // Muting in a dead room is a state-extending write (it persists
    // `seats.{i}.isMuted` on a room nobody can hear).
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'CLOSED',
          seats: { 4: { userId: '99', state: 'OCCUPIED', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/seats/4/mute')
      .send({ isMuted: true });
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:roomId/hosts (add) + DELETE .../hosts/:userId (remove)', () => {
  test('400 when userId is missing on add', async () => {
    const res = await request(createApp(1)).post('/api/rooms/room-1/hosts').send({});
    expect(res.status).toBe(400);
  });

  test('403 when a non-owner tries to add a host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(10)).post('/api/rooms/room-1/hosts').send({ userId: '99' });
    expect(res.status).toBe(403);
  });

  test('400 when trying to add the owner as a host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1)).post('/api/rooms/room-1/hosts').send({ userId: '1' });
    expect(res.status).toBe(400);
  });

  test('200 owner promotes a participant to host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1)).post('/api/rooms/room-1/hosts').send({ userId: '99' });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        hostIds: { __arrayUnion: ['99'] },
        allTimeHostIds: { __arrayUnion: ['99'] },
      }),
    );
  });

  test('409 when the room is CLOSED on POST add — gate fires AFTER owner-role check', async () => {
    // The CLOSED gate is positioned AFTER the owner-role 403 check + AFTER the
    // owner-is-not-a-host 400 sanity, so unprivileged callers still see their
    // 403 regardless of room state (info-hiding). Owner caller (uid=1) clears
    // the role gate; target uid=99 is a regular participant, not the owner.
    // Promoting a host of a dead room is a state-extending write — the host
    // role persists on a room whose lifecycle is over.
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/hosts').send({ userId: '99' });
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when a non-owner tries to remove a host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ hostIds: ['10', '55'] })));
    const res = await request(createApp(10)).delete('/api/rooms/room-1/hosts/55').send({});
    expect(res.status).toBe(403);
  });

  test('200 owner demotes a host', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1)).delete('/api/rooms/room-1/hosts/10').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ hostIds: { __arrayRemove: ['10'] } }),
    );
  });

  test('200 CLOSED-room cleanup: owner can still demote a host after close', async () => {
    // CLEANUP-ON-CLOSED invariant: host removal is a role-clearing cleanup
    // (mirror of /seats/:i/leave for seat occupancy). Documents intentional
    // design — the inverse `/hosts POST` (promotion) is a state-extending
    // write and gets a CLOSED gate in this same PR (test above).
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).delete('/api/rooms/room-1/hosts/10').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({ hostIds: { __arrayRemove: ['10'] } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chunk C1 — room lifecycle + settings (rename / require-approval /
// owner-away / owner-returned / close). Settings are owner-only; the two
// lifecycle ops (close, owner-away) additionally honour the NON-owner
// safety-net paths the client drives, with state + presence preconditions
// enforced server-side so a malicious participant can't grief.
// ─────────────────────────────────────────────────────────────────────────

describe('PATCH /api/rooms/:roomId/name', () => {
  test('400 when name missing — no transaction', async () => {
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({});
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('400 when name is blank after trim', async () => {
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('400 when name exceeds 50 characters', async () => {
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/name')
      .send({ name: 'x'.repeat(51) });
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(404);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when a host (non-owner) tries to rename', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(10)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when an attendee tries to rename', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(99)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(403);
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 owner renames — trims and persists', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/name')
      .send({ name: '  New Name  ' });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, { name: 'New Name' });
    expect(mockRtdbSet).toHaveBeenCalled(); // broadcast
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: 'Hi' });
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/rooms/:roomId/require-approval', () => {
  test('400 when requireApproval is not a boolean — no transaction', async () => {
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: 'yes' });
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('400 when requireApproval is missing', async () => {
    const res = await request(createApp(1)).patch('/api/rooms/room-1/require-approval').send({});
    expect(res.status).toBe(400);
  });

  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(404);
  });

  test('403 when a host (non-owner) toggles approval', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(10))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(409);
  });

  test('200 owner enables approval', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, { requireApproval: true });
  });

  test('200 owner disables approval (false is a valid value, not "missing")', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ requireApproval: true })));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: false });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, { requireApproval: false });
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/require-approval')
      .send({ requireApproval: true });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/rooms/:roomId/owner-returned', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(404);
  });

  test('403 when a non-owner tries to mark owner returned', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'OWNER_AWAY' })));
    const res = await request(createApp(10)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(409);
  });

  test('200 owner returns — clears away state', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'OWNER_AWAY', ownerLeftAt: 123 })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, { state: 'ACTIVE', ownerLeftAt: null });
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(500);
  });
});

describe('POST /api/rooms/:roomId/owner-away', () => {
  // owner-away pre-reads the room (non-txn) to resolve owner/role for the
  // presence decision, then re-validates inside the transaction.
  function primeOwnerAway(room) {
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
  }

  test('404 when the room does not exist (pre-read)', async () => {
    mockDocGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch (pre-read)', async () => {
    mockCohort = 'minor';
    mockDocGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(404);
  });

  test('200 owner marks self away — OWNER_AWAY + numeric ownerLeftAt, no presence read', async () => {
    primeOwnerAway(mkRoom({ state: 'ACTIVE' }));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(200);
    const [, payload] = mockTxnUpdate.mock.calls[0];
    expect(payload.state).toBe('OWNER_AWAY');
    expect(typeof payload.ownerLeftAt).toBe('number');
    expect(mockRtdbGet).not.toHaveBeenCalled(); // owner path skips presence verification
  });

  test('200 idempotent when already OWNER_AWAY — no write + no spurious broadcast', async () => {
    primeOwnerAway(mkRoom({ state: 'OWNER_AWAY', ownerLeftAt: 123 }));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockRtdbSet).not.toHaveBeenCalled();
  });

  test('409 when the room is CLOSED', async () => {
    primeOwnerAway(mkRoom({ state: 'CLOSED' }));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(409);
  });

  test('403 non-owner when the owner IS present', async () => {
    primeOwnerAway(mkRoom({ state: 'ACTIVE' }));
    mockRtdbGet.mockResolvedValue({ exists: () => true });
    const res = await request(createApp(10)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockRtdbGet).toHaveBeenCalled();
  });

  test('200 non-owner participant when the owner is ABSENT and room ACTIVE', async () => {
    primeOwnerAway(mkRoom({ state: 'ACTIVE' }));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    const res = await request(createApp(10)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(200);
    const [, payload] = mockTxnUpdate.mock.calls[0];
    expect(payload.state).toBe('OWNER_AWAY');
    expect(typeof payload.ownerLeftAt).toBe('number');
  });

  test('403 non-owner who is NOT a participant even if owner absent', async () => {
    primeOwnerAway(mkRoom({ state: 'ACTIVE', participantIds: ['1', '99'] }));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    const res = await request(createApp(10)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(403);
  });

  test('403 non-owner falls back to "present" when the presence read throws', async () => {
    primeOwnerAway(mkRoom({ state: 'ACTIVE' }));
    mockRtdbGet.mockRejectedValue(new Error('rtdb down'));
    const res = await request(createApp(10)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('500 when the transaction throws', async () => {
    mockDocGet.mockResolvedValue(snap(mkRoom({ state: 'ACTIVE' })));
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(500);
  });
});

describe('POST /api/rooms/:roomId/close', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(404);
  });

  test('200 owner closes — empties room + clears every participant currentRoomId', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom())); // participants 1, 10, 99
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200);
    const [, payload] = mockTxnUpdate.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({ state: 'CLOSED', ownerLeftAt: null, participantIds: [] }),
    );
    expect(typeof payload.closedAt).toBe('number');
    expect(payload.seats['0']).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
    expect(Object.keys(payload.seats)).toHaveLength(8);
    expect(mockBatchSet).toHaveBeenCalledTimes(3); // one per participant
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 idempotent when already CLOSED — no write, no clears', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  test('403 non-owner cannot close an ACTIVE room', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'ACTIVE' })));
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 non-owner closes OWNER_AWAY room with no other non-owner seated', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'OWNER_AWAY',
          ownerLeftAt: Date.now(),
          seats: {
            0: { userId: '1', state: 'OCCUPIED', isMuted: false },
            3: { userId: '10', state: 'OCCUPIED', isMuted: false }, // caller only
          },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalled();
  });

  test('403 non-owner cannot close OWNER_AWAY room while another non-owner is seated (not expired)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'OWNER_AWAY',
          ownerLeftAt: Date.now(),
          seats: {
            0: { userId: '1', state: 'OCCUPIED', isMuted: false },
            3: { userId: '10', state: 'OCCUPIED', isMuted: false }, // caller
            4: { userId: '99', state: 'OCCUPIED', isMuted: false }, // other non-owner still seated
          },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 non-owner closes an EXPIRED OWNER_AWAY room even if others seated', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'OWNER_AWAY',
          ownerLeftAt: Date.now() - 300000 - 1, // older than OWNER_LEAVE_TIMEOUT_MS (5 min)
          seats: {
            0: { userId: '1', state: 'OCCUPIED', isMuted: false },
            3: { userId: '10', state: 'OCCUPIED', isMuted: false },
            4: { userId: '99', state: 'OCCUPIED', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200);
  });

  test('403 non-owner who is not a participant cannot close', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ state: 'OWNER_AWAY', ownerLeftAt: Date.now(), participantIds: ['1', '99'] })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(403);
  });

  test('200 close still succeeds when the currentRoomId batch clear fails (best-effort)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    mockBatchCommit.mockRejectedValue(new Error('batch down'));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200); // room already closed in the txn; clearing is best-effort
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chunk C2 — seat-move, join (ban-check), invite-decline.
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/rooms/:roomId/seats/:seatIndex/move', () => {
  test('400 on out-of-range source seat index', async () => {
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/8/move')
      .send({ toIndex: 3 });
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('400 when toIndex is missing', async () => {
    const res = await request(createApp(1)).post('/api/rooms/room-1/seats/3/move').send({});
    expect(res.status).toBe(400);
  });

  test('400 when toIndex is out of range', async () => {
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 99 });
    expect(res.status).toBe(400);
  });

  test('400 when source and target are the same seat', async () => {
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 3 });
    expect(res.status).toBe(400);
  });

  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(404);
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(409);
  });

  test('403 when an attendee tries to move a seat', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(99))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when the source seat is the owner seat (0)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/0/move')
      .send({ toIndex: 3 });
    expect(res.status).toBe(403);
  });

  test('403 when the target seat is the owner seat (0)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 0 });
    expect(res.status).toBe(403);
  });

  test('403 when the source seat is empty', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom())); // seat 4 is empty
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/4/move')
      .send({ toIndex: 3 });
    expect(res.status).toBe(403);
  });

  test('403 when a host tries to move another host', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          hostIds: ['10', '20'],
          seats: {
            3: { userId: '20', state: 'OCCUPIED', isMuted: false }, // another host
            4: { userId: null, state: 'EMPTY', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 owner moves an occupant into an empty seat (preserves mute state)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          seats: {
            3: { userId: '99', state: 'OCCUPIED', isMuted: true },
            4: { userId: null, state: 'EMPTY', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        'seats.3.userId': null,
        'seats.3.state': 'EMPTY',
        'seats.3.isMuted': false,
        'seats.4.userId': '99',
        'seats.4.state': 'OCCUPIED',
        'seats.4.isMuted': true,
      }),
    );
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 swaps two occupied non-owner seats', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          participantIds: ['1', '10', '99', '77'],
          seats: {
            3: { userId: '99', state: 'OCCUPIED', isMuted: false },
            4: { userId: '77', state: 'OCCUPIED', isMuted: true },
          },
        }),
      ),
    );
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        'seats.3.userId': '77',
        'seats.3.state': 'OCCUPIED',
        'seats.3.isMuted': true,
        'seats.4.userId': '99',
        'seats.4.state': 'OCCUPIED',
        'seats.4.isMuted': false,
      }),
    );
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/rooms/:roomId/join', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(404);
  });

  test('409 when the room is CLOSED', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 BANNED when the caller is on the ban list', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ bannedUserIds: ['50'] })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BANNED');
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 joins an ACTIVE room — adds to participants', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, {
      participantIds: { __arrayUnion: ['50'] },
    });
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 joins an OWNER_AWAY room (still joinable)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'OWNER_AWAY', ownerLeftAt: Date.now() })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(200);
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(500);
  });
});

describe('POST /api/rooms/:roomId/decline-invite', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(404);
  });

  test("200 deletes the caller's own pending invite", async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ pendingInvites: { 50: '10' } })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, {
      'pendingInvites.50': { __delete: true },
    });
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 idempotent no-op when the caller has no pending invite — no write', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ pendingInvites: { 77: '10' } })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 CLOSED-room cleanup: caller can still decline their pending invite after close', async () => {
    // CLEANUP-ON-CLOSED invariant: declining is a self-targeted cleanup of
    // the caller's own pendingInvites entry. The /close endpoint does NOT
    // clear pendingInvites server-side, so a client that received an invite
    // before the room closed can still cleanly decline post-close. Documents
    // intentional design — pairs with /seats/:i/leave and /hosts DELETE
    // pins.
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED', pendingInvites: { 50: '10' } })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, {
      'pendingInvites.50': { __delete: true },
    });
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chunk C — review-hardening coverage (boundaries, idempotency ORDERING,
// type-coercion, role×state edges surfaced in code review).
// ─────────────────────────────────────────────────────────────────────────

describe('Chunk C review-hardening coverage', () => {
  test('PATCH /name: 200 at exactly 50 characters (boundary)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(1))
      .patch('/api/rooms/room-1/name')
      .send({ name: 'x'.repeat(50) });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, { name: 'x'.repeat(50) });
  });

  test('PATCH /name: 400 when name is a non-string type (number)', async () => {
    const res = await request(createApp(1)).patch('/api/rooms/room-1/name').send({ name: 42 });
    expect(res.status).toBe(400);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('POST /owner-returned: 200 idempotent no-op on an already-ACTIVE room (no write, no broadcast)', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'ACTIVE' })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/owner-returned').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockRtdbSet).not.toHaveBeenCalled();
  });

  test('POST /owner-away: 403 for a non-owner on an already-OWNER_AWAY room (auth precedes idempotency)', async () => {
    const room = mkRoom({ state: 'OWNER_AWAY', ownerLeftAt: 123 });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false }); // even with the owner absent
    const res = await request(createApp(99)).post('/api/rooms/room-1/owner-away').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('POST /owner-away: the non-owner path reads presence at the owner RTDB node', async () => {
    const { rtdb } = require('../../src/utils/firebase');
    const room = mkRoom({ state: 'ACTIVE' });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    await request(createApp(10)).post('/api/rooms/room-1/owner-away').send({});
    expect(rtdb.ref).toHaveBeenCalledWith('rooms/room-1/presence/1');
  });

  test('POST /seats/:i/move: 403 when a host targets the owner seat (toIndex 0)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 0 });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('POST /seats/:i/move: 403 when a host tries to move the owner (source occupied by owner)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '1', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('POST /seats/:i/move: 400 when toIndex is a non-integer (float)', async () => {
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 3.7 });
    expect(res.status).toBe(400);
  });

  test('POST /seats/:i/move: 200 moves are permitted in an OWNER_AWAY room', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'OWNER_AWAY',
          ownerLeftAt: Date.now(),
          seats: {
            3: { userId: '99', state: 'OCCUPIED', isMuted: false },
            4: { userId: null, state: 'EMPTY', isMuted: false },
          },
        }),
      ),
    );
    const res = await request(createApp(1))
      .post('/api/rooms/room-1/seats/3/move')
      .send({ toIndex: 4 });
    expect(res.status).toBe(200);
  });

  test('POST /join: 200 idempotent when the caller is already a participant', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom())); // participant 10 already present
    const res = await request(createApp(10)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, {
      participantIds: { __arrayUnion: ['10'] },
    });
  });

  test('POST /join: 200 when the room doc has no bannedUserIds field', async () => {
    const room = mkRoom();
    delete room.bannedUserIds; // ensure the field is absent
    mockTxnGet.mockResolvedValue(snap(room));
    const res = await request(createApp(50)).post('/api/rooms/room-1/join').send({});
    expect(res.status).toBe(200);
  });

  test('POST /decline-invite: 200 deletes a pending invite even on a CLOSED room', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED', pendingInvites: { 50: '10' } })));
    const res = await request(createApp(50)).post('/api/rooms/room-1/decline-invite').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRoomRef, {
      'pendingInvites.50': { __delete: true },
    });
  });

  test('POST /close: 200 with zero participants performs no currentRoomId batch clear', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ participantIds: [] })));
    const res = await request(createApp(1)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  test('POST /close: 403 non-owner cannot expire-close when ownerLeftAt is missing (NaN guard)', async () => {
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'OWNER_AWAY',
          // ownerLeftAt intentionally absent → expiry comparison must be false
          seats: {
            0: { userId: '1', state: 'OCCUPIED', isMuted: false },
            3: { userId: '10', state: 'OCCUPIED', isMuted: false }, // caller
            4: { userId: '99', state: 'OCCUPIED', isMuted: false }, // another non-owner seated
          },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/close').send({});
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chunk D — participant lifecycle: leave-room, disconnect-eviction, first-join.
// Completes the server-authoritative surface so EVERY client room-doc write has
// an endpoint (prerequisite for the rules lockdown).
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/rooms/:roomId/leave', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(99)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(99)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(404);
  });

  test('200 removes the caller from participants and clears their seat', async () => {
    mockTxnGet.mockResolvedValue(
      snap(mkRoom({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } })),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        participantIds: { __arrayRemove: ['10'] },
        'seats.3.userId': null,
        'seats.3.state': 'EMPTY',
        'seats.3.isMuted': false,
      }),
    );
    expect(mockRtdbSet).toHaveBeenCalled();
  });

  test('200 removes from participants with no seat fields when the caller is unseated', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom())); // caller 99 is a participant but not seated
    const res = await request(createApp(99)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(200);
    const [, payload] = mockTxnUpdate.mock.calls[0];
    expect(payload).toEqual({ participantIds: { __arrayRemove: ['99'] } });
  });

  test('200 idempotent no-op: no write + no broadcast when caller is neither a participant nor seated', async () => {
    // Common on a client retrying /leave after a disconnect — the arrayRemove
    // would be a no-op anyway; the noop branch additionally suppresses the
    // spurious RTDB nudge that would wake every connected client.
    mockTxnGet.mockResolvedValue(snap(mkRoom({ participantIds: ['1', '10'] }))); // 99 absent
    const res = await request(createApp(99)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockRtdbSet).not.toHaveBeenCalled();
  });

  test('200 CLOSED-room cleanup: caller can still leave after close', async () => {
    // CLEANUP-ON-CLOSED invariant: room-leave is a self-targeted cleanup
    // (caller removing themselves from participantIds + own seat). Mirrors
    // /seats/:i/leave + /decline-invite + /hosts DELETE pins — the universal
    // post-CLOSE allowance is "drop your own state, never extend the room's".
    // Documents intentional design.
    mockTxnGet.mockResolvedValue(
      snap(
        mkRoom({
          state: 'CLOSED',
          seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } },
        }),
      ),
    );
    const res = await request(createApp(10)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        participantIds: { __arrayRemove: ['10'] },
        'seats.3.userId': null,
        'seats.3.state': 'EMPTY',
      }),
    );
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(10)).post('/api/rooms/room-1/leave').send({});
    expect(res.status).toBe(500);
  });
});

// TOCTOU note for the disconnect-user presence gate: a test for the reconnect-
// between-pre-read-and-txn race is intentionally absent — that window is
// accepted and documented in isUserPresent(). It cannot be closed without a
// Firestore-visible presence token (tracked for the rules-lockdown phase).
describe('POST /api/rooms/:roomId/disconnect-user', () => {
  test('400 when userId is missing', async () => {
    const res = await request(createApp(10)).post('/api/rooms/room-1/disconnect-user').send({});
    expect(res.status).toBe(400);
  });

  test('404 when the room does not exist (pre-read)', async () => {
    mockDocGet.mockResolvedValue(snap(null));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch (pre-read)', async () => {
    mockCohort = 'minor';
    mockDocGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(404);
  });

  test('403 when the target is the owner (owner disconnect uses owner-away, not removal)', async () => {
    const room = mkRoom();
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '1' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when the target is still present', async () => {
    const room = mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => true }); // present → cannot evict
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('403 when the caller is not a participant', async () => {
    const room = mkRoom({ participantIds: ['1', '99'] }); // caller 10 not a participant
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(403);
  });

  test('403 fail-safe to present when the presence read throws', async () => {
    const room = mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockRejectedValue(new Error('rtdb down'));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 removes an absent non-owner, clears their seat + currentRoomId', async () => {
    const { db } = require('../../src/utils/firebase');
    const room = mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false }); // absent → evictable
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).toHaveBeenCalledWith(
      mockRoomRef,
      expect.objectContaining({
        participantIds: { __arrayRemove: ['99'] },
        'seats.3.userId': null,
        'seats.3.state': 'EMPTY',
        'seats.3.isMuted': false,
      }),
    );
    // Pin the foreign-doc address: the currentRoomId clear must target the
    // EVICTED user's doc (users/99), not the room doc. Without this guard a
    // refactor could silently write the clear against the wrong path and the
    // mockDocSet assertion alone would still pass (db.doc returns the same
    // shared mockRoomRef for any path).
    expect(db.doc).toHaveBeenCalledWith('users/99');
    expect(mockDocSet).toHaveBeenCalledWith({ currentRoomId: null }, { merge: true });
  });

  test('403 when the target is already removed (not in participantIds)', async () => {
    // Race window: a concurrent /leave or another presence-monitor
    // /disconnect-user may have removed the target between the client deciding
    // to evict and this request landing. Without the target-membership gate we
    // would no-op write a clean room + fire a spurious broadcast.
    const room = mkRoom({ participantIds: ['1', '10'] }); // 99 already removed
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(403);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 still succeeds when the currentRoomId clear fails (best-effort)', async () => {
    // The post-txn user-doc clear is wrapped in try/catch (mirrors /close):
    // the room mutation already committed, the kicked user self-clears on
    // observing the ban, and the foreign user-doc write must not undo the
    // already-committed eviction.
    const room = mkRoom({ seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } } });
    mockDocGet.mockResolvedValue(snap(room));
    mockTxnGet.mockResolvedValue(snap(room));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    mockDocSet.mockRejectedValue(new Error('user doc write failed'));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalled();
  });

  test('500 when the transaction throws', async () => {
    mockDocGet.mockResolvedValue(snap(mkRoom()));
    mockRtdbGet.mockResolvedValue({ exists: () => false });
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(500);
  });

  test('409 when the room is CLOSED — pre-read short-circuit (no RTDB, no txn, no user-doc clear)', async () => {
    // The CLOSED gate sits BETWEEN the cohort gate on preRoom and the
    // isUserPresent() RTDB roundtrip. Three not-called assertions isolate the
    // short-circuit:
    //   - mockRtdbGet not called → the presence read was skipped (saved roundtrip)
    //   - mockTxnGet not called → the transaction was never entered
    //   - mockDocSet not called → the post-txn currentRoomId clear didn't fire
    // The mockDocSet pin specifically guards against a future refactor that
    // moves the user-doc clear ahead of the txn (which would silently break
    // the 409 path's "no state writes" invariant). Disconnecting a user from
    // a dead room is a state-extending write — clearing currentRoomId mutates
    // the target user's doc based on a room that no longer matters.
    mockDocGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(10))
      .post('/api/rooms/room-1/disconnect-user')
      .send({ userId: '99' });
    expect(res.status).toBe(409);
    expect(mockRtdbGet).not.toHaveBeenCalled();
    expect(mockTxnGet).not.toHaveBeenCalled();
    expect(mockTxnUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:roomId/first-join', () => {
  test('404 when the room does not exist', async () => {
    mockTxnGet.mockResolvedValue(snap(null));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    mockCohort = 'minor';
    mockTxnGet.mockResolvedValue(snap(mkRoom({ cohort: 'adult' })));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(404);
  });

  test('409 when the room is CLOSED — no write to firstJoinTimestamps', async () => {
    // Invariant: CLOSED rooms accept zero client writes. Pre-fix the handler
    // had no state gate, so a post-CLOSE call would persist a participation
    // timestamp on a dead room (stale-state leak). Other lifecycle/settings
    // endpoints (/join, /name, /require-approval, /claim) already reject 409
    // on CLOSED — this pin extends the same invariant to /first-join.
    mockTxnGet.mockResolvedValue(snap(mkRoom({ state: 'CLOSED' })));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(409);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('200 records a numeric first-join timestamp when absent', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom()));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(200);
    const [, payload] = mockTxnUpdate.mock.calls[0];
    expect(typeof payload['firstJoinTimestamps.99']).toBe('number');
  });

  test('200 idempotent set-once: no write when a timestamp already exists', async () => {
    mockTxnGet.mockResolvedValue(snap(mkRoom({ firstJoinTimestamps: { 99: 12345 } })));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(200);
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  test('500 when the transaction throws', async () => {
    mockTxnGet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp(99)).post('/api/rooms/room-1/first-join').send({});
    expect(res.status).toBe(500);
  });
});
