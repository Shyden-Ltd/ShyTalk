/**
 * UK OSA #17 PR 4 — `requireSameCohort` route-wiring tests for
 * `routes/users.js`. Pins the cross-cohort 404 + `segregationEvents`
 * audit contract for every user-to-user interaction endpoint:
 *
 *   GET    /api/users/:uniqueId                  (profile view)
 *   POST   /api/users/:uniqueId/follow
 *   POST   /api/users/:uniqueId/unfollow
 *   POST   /api/users/:uniqueId/remove-follower
 *   POST   /api/users/:uniqueId/record-visit
 *
 * Each route gets three scenarios:
 *   1. Cross-cohort caller   → 404 `{ error: 'Not found' }` +
 *      `segregationEvents` audit doc.
 *   2. Same-cohort caller    → existing success path.
 *   3. Admin caller          → bypass, success path; NO audit doc.
 *
 * The 404 body MUST be byte-identical to the "target does not exist"
 * 404 — that's the existence-hiding contract.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase + helper mocks ────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });
const mockCollection = jest.fn((name) => {
  if (name === 'segregationEvents') return { add: mockSegregationAdd };
  return { add: jest.fn() };
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
    collection: (...args) => mockCollection(...args),
    runTransaction: jest.fn(),
  },
  auth: {
    setCustomUserClaims: jest.fn().mockResolvedValue(),
    getUser: jest.fn().mockResolvedValue({ customClaims: {} }),
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

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

const mockIsLiveAdmin = jest.fn();
jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/block-check', () => ({
  viewerIsBlocked: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../../src/utils/email-templates', () => ({ buildDeletionScheduledEmail: jest.fn() }));
jest.mock('../../src/utils/fcm', () => ({ sendFcmToTokens: jest.fn() }));

const { getDoc } = require('../../src/utils/firestore-helpers');
const { _resetAuditDedup } = require('../../src/middleware/sameCohort');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockSegregationAdd.mockReset();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_1' });
  mockIsLiveAdmin.mockReset();
  mockIsLiveAdmin.mockResolvedValue(true);
  _resetAuditDedup();
});

// ─── App setup with injectable cohort + admin ───────────────────

const usersRouter = require('../../src/routes/users');

/**
 * Boots a test Express app whose injected auth middleware sets
 * `req.auth = { uid, uniqueId, token: { cohort, admin? } }`.
 */
function createApp({
  uid = 'firebase-uid-A',
  uniqueId = 10000001,
  cohort = 'adult',
  admin = false,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: { cohort, ...(admin ? { admin: true } : {}) } };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Set up `getDoc` to return a user doc by uniqueId. */
function mockUserDoc(uniqueId, data) {
  getDoc.mockImplementation((path) => {
    if (path === `users/${uniqueId}`) return Promise.resolve(data);
    return Promise.resolve(null);
  });
}

/** Set up `db.doc(...).get()` to return a snapshot for a uniqueId. */
function mockSnapshot(uniqueId, data) {
  mockDocGet.mockImplementation((path) => {
    if (path === `users/${uniqueId}`) {
      return Promise.resolve({
        exists: data !== undefined && data !== null,
        data: () => data,
      });
    }
    return Promise.resolve({ exists: false });
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId  (profile view)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId — cross-cohort gate', () => {
  test('adult viewing minor profile → 404 + segregationEvents audit', async () => {
    mockUserDoc(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/10000200');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    // Flush pending fire-and-forget audit write.
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: '10000001',
      sourceCohort: 'adult',
      targetUniqueId: '10000200',
      targetCohort: 'minor',
      action: 'blocked',
    });
  });

  test('minor viewing adult profile → 404 + audit (symmetry)', async () => {
    mockUserDoc(10000100, { uniqueId: 10000100, cohort: 'adult' });

    const app = createApp({ uniqueId: 10000050, cohort: 'minor' });
    const res = await request(app).get('/api/users/10000100');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('same-cohort: adult → adult profile returns 200', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'adult',
      displayName: 'Bob',
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/10000200');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('self-view always allowed regardless of cohort lookup', async () => {
    mockUserDoc(10000001, { uniqueId: 10000001, cohort: 'adult' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/10000001');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin viewing cross-cohort profile is allowed, no audit doc', async () => {
    mockUserDoc(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult', admin: true });
    const res = await request(app).get('/api/users/10000200');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing target profile returns 404 with identical body (existence-hiding)', async () => {
    mockUserDoc(99999999, null);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/99999999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('caller with stripped cohort claim (no token.cohort) is treated as minor', async () => {
    // I6 reviewer test: route-integration level coverage for the
    // fail-closed `cohortFromClaim` path. Stripped claim → 'minor'
    // → cannot view an adult profile.
    mockUserDoc(10000200, { uniqueId: 10000200, cohort: 'adult' });

    // createApp default cohort='adult'; override by injecting raw
    // auth without the cohort claim.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'fb-uid', uniqueId: 10000001, token: {} };
      next();
    });
    app.use('/api', usersRouter);

    const res = await request(app).get('/api/users/10000200');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0].sourceCohort).toBe('minor');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/follow
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/follow — cross-cohort gate', () => {
  test('adult following minor target → 404 + audit', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('same-cohort follow succeeds and writes batch', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'adult' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('admin cross-cohort follow is allowed', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('missing target user → 404 Not found (matches cross-cohort body)', async () => {
    mockSnapshot(99999999, null);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/follow')
      .send({ targetUserId: 99999999 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/unfollow
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/unfollow — cross-cohort gate', () => {
  test('adult unfollowing minor → 404 + audit (existence-hiding)', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('same-cohort unfollow succeeds', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'adult' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('admin cross-cohort unfollow allowed', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('missing target → 404 Not found (existence-hiding via middleware)', async () => {
    mockSnapshot(99999999, null);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: 99999999 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('non-integer targetUserId rejected with 400 (NaN-poisoning defence)', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/unfollow')
      .send({ targetUserId: '123abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/remove-follower
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/remove-follower — cross-cohort gate', () => {
  test('adult removing minor follower → 404 + audit', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: 10000200 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('same-cohort remove-follower succeeds', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'adult' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('admin cross-cohort remove-follower allowed', async () => {
    mockSnapshot(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: 10000200 });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('missing follower → 404 Not found (existence-hiding)', async () => {
    mockSnapshot(99999999, null);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: 99999999 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('non-integer followerUserId rejected with 400', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000001/remove-follower')
      .send({ followerUserId: '123abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/record-visit
// ═══════════════════════════════════════════════════════════════════
// Note: the *visitor* is the caller; the *profile owner* (:uniqueId)
// is the target. record-visit gates on the profile-owner's cohort.

describe('POST /api/users/:uniqueId/record-visit — cross-cohort gate', () => {
  test('adult visitor recording on minor profile → 404 + audit', async () => {
    // getDoc is called for both block-check AND middleware's fetch.
    // Return the same minor profile for both.
    mockUserDoc(10000200, { uniqueId: 10000200, cohort: 'minor' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000200/record-visit')
      .send({ visitorId: 10000001 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('same-cohort visit recorded normally', async () => {
    // getDoc returns the target user (no block) AND lets the existing
    // stalker doc not exist (new visit).
    getDoc.mockImplementation((path) => {
      if (path === `users/10000200`) {
        return Promise.resolve({ uniqueId: 10000200, cohort: 'adult' });
      }
      // stalker subcollection doc — return null so "new visit" path
      // is taken (idempotent batch).
      return Promise.resolve(null);
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app)
      .post('/api/users/10000200/record-visit')
      .send({ visitorId: 10000001 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin cross-cohort visit recorded', async () => {
    getDoc.mockImplementation((path) => {
      if (path === `users/10000200`) {
        return Promise.resolve({ uniqueId: 10000200, cohort: 'minor' });
      }
      return Promise.resolve(null);
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/users/10000200/record-visit')
      .send({ visitorId: 10000001 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});
