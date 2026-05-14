/**
 * UK OSA #17 PR 4 — `requireSameCohort` route-wiring tests for
 * `routes/rooms.js`.
 *
 *   POST /api/rooms/:roomId/invites/send   → gate caller↔invitee
 *   POST /api/rooms/:roomId/seat-requests  → gate caller↔room owner
 *                                            (room owner's cohort is
 *                                            the stand-in for room.cohort
 *                                            until PR 7 ships it).
 *
 * Each route: cross-cohort 404 + audit, same-cohort allow, admin bypass.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollectionWhereGet = jest.fn();
const mockRtdbSet = jest.fn().mockResolvedValue();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });

// Path-aware: lets each test set up specific docs by path.
const docResponses = new Map();
function setDoc(path, data) {
  docResponses.set(path, data);
}
function clearDocs() {
  docResponses.clear();
}

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn((name) => {
      if (name === 'segregationEvents') {
        return { add: mockSegregationAdd };
      }
      return {
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ get: mockCollectionWhereGet })),
          })),
        })),
      };
    }),
  },
  rtdb: {
    ref: jest.fn(() => ({ set: mockRtdbSet })),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'req-123',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
  cleanupInvalidTokens: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockIsLiveAdmin = jest.fn();
jest.mock('../../src/middleware/auth', () => ({
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

const { _resetAuditDedup } = require('../../src/middleware/sameCohort');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockSegregationAdd.mockReset();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_1' });
  mockCollectionWhereGet.mockReset();
  mockCollectionWhereGet.mockResolvedValue({ empty: true, docs: [] });
  mockIsLiveAdmin.mockReset();
  mockIsLiveAdmin.mockResolvedValue(true);
  _resetAuditDedup();
  clearDocs();

  mockDocGet.mockImplementation((path) => {
    if (docResponses.has(path)) {
      const data = docResponses.get(path);
      return Promise.resolve({
        exists: data !== undefined && data !== null,
        data: () => data,
      });
    }
    return Promise.resolve({ exists: false, data: () => null });
  });
});

// ─── App setup ───────────────────────────────────────────────────

const roomsRouter = require('../../src/routes/rooms');

function createApp({
  uid = 'firebase-uid',
  uniqueId = 'user-A',
  cohort = 'adult',
  admin = false,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid,
      uniqueId,
      token: { cohort, ...(admin ? { admin: true } : {}) },
    };
    next();
  });
  app.use('/api', roomsRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/invites/send
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/invites/send — cross-cohort gate', () => {
  test('adult inviting minor → 404 + audit', async () => {
    setDoc('rooms/room-1', { name: 'Room', pendingInvites: {} });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'user-A',
      sourceCohort: 'adult',
      targetUniqueId: 'user-B',
      targetCohort: 'minor',
      action: 'blocked',
    });
    // Critical: pendingInvites was NOT updated — gate ran first.
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('same-cohort invite proceeds normally', async () => {
    setDoc('rooms/room-1', { name: 'Room', pendingInvites: {} });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test('admin cross-cohort invite is allowed', async () => {
    setDoc('rooms/room-1', { name: 'Room', pendingInvites: {} });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing invitee → 404 Not found (existence-hiding)', async () => {
    setDoc('rooms/room-1', { name: 'Room', pendingInvites: {} });
    // No setDoc for users/user-B → fetch returns exists: false.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/rooms/room-1/invites/send')
      .send({ userId: 'user-B', invitedBy: 'user-A' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/seat-requests
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seat-requests — cross-cohort gate', () => {
  test('adult requesting seat in minor-owned room → 404 + audit', async () => {
    setDoc('rooms/room-1', { name: 'Minor Room', ownerId: 'owner-M' });
    setDoc('users/owner-M', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ seatIndex: 3, userName: 'Bob' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'user-A',
      sourceCohort: 'adult',
      targetUniqueId: 'owner-M',
      targetCohort: 'minor',
      action: 'blocked',
    });
    // Seat-request doc must NOT have been created.
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('same-cohort seat-request proceeds normally', async () => {
    setDoc('rooms/room-1', { name: 'Adult Room', ownerId: 'owner-A' });
    setDoc('users/owner-A', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/rooms/room-1/seat-requests')
      .send({ seatIndex: 3, userName: 'Bob' });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe('req-123');
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('admin cross-cohort seat-request is allowed', async () => {
    setDoc('rooms/room-1', { name: 'Minor Room', ownerId: 'owner-M' });
    setDoc('users/owner-M', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult', admin: true });
    const res = await request(app).post('/api/rooms/room-1/seat-requests').send({ seatIndex: 3 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('room without ownerId is refused (404) — cannot resolve cohort', async () => {
    // C3 fix (code-review). A malformed room without an `ownerId`
    // cannot resolve the cohort stand-in; we refuse rather than let
    // the API-layer gate fall through.
    setDoc('rooms/room-1', { name: 'Anonymous Room' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).post('/api/rooms/room-1/seat-requests').send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Room not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing owner doc → 404 + audit (existence-hiding via middleware)', async () => {
    // Reviewer I-test: owner deleted scenario.
    setDoc('rooms/room-1', { name: 'Room', ownerId: 'deleted-owner' });
    // No setDoc for 'users/deleted-owner' → ownerDoc null.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).post('/api/rooms/room-1/seat-requests').send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('missing room → 404 (existing behavior preserved)', async () => {
    // No setDoc for rooms/room-1.
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).post('/api/rooms/room-1/seat-requests').send({ seatIndex: 3 });

    expect(res.status).toBe(404);
  });
});
