const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    batch: jest.fn(() => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
  auth: {
    setCustomUserClaims: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

// Mock firestore-helpers so getDoc goes through our mockDocGet
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

/**
 * Creates a test app with the caller acting as the given uniqueId.
 * Routes use requireOwner which compares req.auth.uniqueId to the param.
 */
function createApp(uid = 'firebase-uid', uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset() drains queues from prior tests' mockResolvedValueOnce/mockImplementation
  // — clearAllMocks() does not. Required for cross-suite stability.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchCommit.mockReset();
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
});

// ─── POST /api/users/:uniqueId/appeal ────────────────────────────

describe('POST /api/users/:uniqueId/appeal', () => {
  it('returns 403 when caller does not own the account', async () => {
    // caller is 10000001, trying to appeal on behalf of 10000099
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000099/appeal')
      .send({ appealText: 'Please let me back in' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot modify another user/i);
  });

  it('returns 400 when appealText is missing', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/appeal').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/appealText/i);
  });

  it('returns 400 when appealText exceeds 500 characters', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/appeal')
      .send({ appealText: 'a'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });

  it('returns 200 and creates appeal + updates user on success', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/appeal')
      .send({ appealText: 'I believe my suspension was a mistake.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Should create a suspensionAppeals doc
    expect(mockDocSet).toHaveBeenCalledWith(
      'suspensionAppeals/gen-id',
      expect.objectContaining({
        appealText: 'I believe my suspension was a mistake.',
        status: 'pending',
      }),
      { merge: true },
    );

    // Should update the user doc
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001',
      expect.objectContaining({ suspensionAppealStatus: 'pending' }),
    );
  });
});

// ─── POST /api/users/:uniqueId/lift-suspension ───────────────────

describe('POST /api/users/:uniqueId/lift-suspension', () => {
  it('returns 403 when caller does not own the account', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000099/lift-suspension').send({});

    expect(res.status).toBe(403);
  });

  it('returns 400 when user is not suspended', async () => {
    getDoc.mockResolvedValueOnce({
      id: '10000001',
      isSuspended: false,
    });

    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/lift-suspension').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not suspended/i);
  });

  it('returns 400 when user is suspended but suspension has not yet expired', async () => {
    const futureTs = 1709913600000 + 86400000; // now + 1 day
    getDoc.mockResolvedValueOnce({
      id: '10000001',
      isSuspended: true,
      suspensionEndDate: futureTs,
    });

    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/lift-suspension').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not expired/i);
  });

  it('returns 200 and clears suspension fields when suspension has expired', async () => {
    const pastTs = 1709913600000 - 86400000; // now - 1 day
    getDoc.mockResolvedValueOnce({
      id: '10000001',
      isSuspended: true,
      suspensionEndDate: pastTs,
    });

    const { clearSuspensionCache } = require('../../src/middleware/auth');

    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/lift-suspension').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001',
      expect.objectContaining({
        isSuspended: false,
        suspensionReason: null,
        suspensionEndDate: null,
      }),
    );

    // Should clear the suspension cache
    expect(clearSuspensionCache).toHaveBeenCalledWith(10000001);
  });

  it('returns 200 and lifts a permanent (null endDate) expired suspension', async () => {
    // Permanent suspensions have a null endDate — they should always be liftable by the user
    getDoc.mockResolvedValueOnce({
      id: '10000001',
      isSuspended: true,
      suspensionEndDate: null,
    });

    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/lift-suspension').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /api/users/:uniqueId/follow (PR #494 — audit H3) ──────

describe('POST /api/users/:uniqueId/follow', () => {
  it('rejects targetUserId with path-traversal style string (NaN guard)', async () => {
    // Pre-fix: Number('evil../path') = NaN; arrayUnion(NaN) corrupted
    // followingIds. Strict-integer parse + round-trip equality rejects.
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 'evil../path' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it('rejects targetUserId with mixed alphanumeric (parseInt truncation guard)', async () => {
    // parseInt('123abc', 10) = 123 — silent truncation. Round-trip
    // equality on String(parsed) vs String(input) catches this.
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: '123abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it('rejects negative targetUserId', async () => {
    // Note: 0 is rejected by the existing falsy check; -1 is truthy
    // but my integer check should still reject it.
    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/follow').send({ targetUserId: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it('returns 404 when target user does not exist', async () => {
    // Pre-fix: target-doesnt-exist caused a 500 (Firestore batch
    // update on non-existent doc). Now returns the correct 404.
    mockDocGet.mockResolvedValueOnce({ exists: false });
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 99999999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/target user not found/i);
  });
});

// ─── POST /api/users/:uniqueId/unfollow ──────────────────────────

describe('POST /api/users/:uniqueId/unfollow', () => {
  it('returns 400 when targetUserId is missing', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/unfollow').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId/i);
  });

  it('returns 403 when caller does not own the account', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000099/unfollow')
      .send({ targetUserId: '10000002' });

    expect(res.status).toBe(403);
  });

  it('returns 200 and removes follow relationship on success', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: '10000002' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Should remove from follower of target and following of self
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /api/users/:uniqueId/remove-follower ───────────────────

describe('POST /api/users/:uniqueId/remove-follower', () => {
  it('returns 400 when followerUserId is missing', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app).post('/api/users/10000001/remove-follower').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/followerUserId/i);
  });

  it('returns 403 when caller does not own the account', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000099/remove-follower')
      .send({ followerUserId: '10000002' });

    expect(res.status).toBe(403);
  });

  it('returns 200 and removes follower relationship on success', async () => {
    const app = createApp('uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: '10000002' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Should update both the owner's followerIds and the follower's followingIds
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
