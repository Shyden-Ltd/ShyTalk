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

  // ── Relocated from the "Chunk C" hardening group (SHY-0487). These stay
  // here: owner-away reads RTDB presence, which the SHY-0113 umbrella
  // sequences against SHY-0103. ─────────────────────────────────────────

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
});

// ─────────────────────────────────────────────────────────────────────────
// Chunk D — participant lifecycle: leave-room, disconnect-eviction, first-join.
// Completes the server-authoritative surface so EVERY client room-doc write has
// an endpoint (prerequisite for the rules lockdown).
// ─────────────────────────────────────────────────────────────────────────

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
