/**
 * UK OSA #17 PR 5 — Discovery + search server-side cohort filter tests.
 *
 * Two new routes on the user surface:
 *
 *   GET /api/users/discover            → same-cohort users only,
 *                                        ordered by lastSeenAt DESC,
 *                                        limit 50; defence-in-depth at
 *                                        the API tier on top of the
 *                                        Firestore-rules gates from PR 3.
 *
 *   GET /api/users/search?q=<query>    → if `q` is a positive integer
 *                                        ≥ MIN_UNIQUE_ID  (10000000) →
 *                                        exact uniqueId lookup gated
 *                                        by `requireSameCohort` (cross-
 *                                        cohort returns existence-hiding
 *                                        404 + segregationEvents audit
 *                                        write).
 *                                        Otherwise → displayName prefix
 *                                        match with `where('cohort','==',
 *                                        callerCohort)` baked in at the
 *                                        Firestore query level.
 *
 * Both routes:
 *   • Strip sensitive fields (firebaseUid, email, pinHash, fcmTokens,
 *     dateOfBirth) before responding.
 *   • Exclude the caller from the result set.
 *   • Default to the fail-closed 'minor' cohort when the JWT cohort
 *     claim is missing (PR 2 contract preserved end-to-end).
 *
 * Tests are written RED first per the project's TDD requirement;
 * implementation lands in `routes/users.js` after this file is
 * confirmed failing.
 */

const express = require('express');
const request = require('supertest');

// ─── Firestore + helper mocks ───────────────────────────────────

// Query-chain builder: every call returns the chain itself so a route
// can `.where(...).orderBy(...).limit(...).get()` without surprises.
// `mockGet` is the terminal stub that returns the snapshot.
const mockGet = jest.fn();
const mockChain = {
  where: jest.fn(() => mockChain),
  orderBy: jest.fn(() => mockChain),
  limit: jest.fn(() => mockChain),
  startAfter: jest.fn(() => mockChain),
  get: (...args) => mockGet(...args),
};

const mockDocGet = jest.fn();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_seed' });
const mockCollection = jest.fn((name) => {
  if (name === 'segregationEvents') return { add: mockSegregationAdd };
  return mockChain;
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
    })),
    collection: (...args) => mockCollection(...args),
    runTransaction: jest.fn(),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
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
const { viewerIsBlocked: viewerIsBlockedMock } = require('../../src/utils/block-check');
const { _resetAuditDedup } = require('../../src/middleware/sameCohort');

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset();
  mockDocGet.mockReset();
  mockSegregationAdd.mockReset();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_seed' });
  mockIsLiveAdmin.mockReset();
  // Default: caller is NOT live admin. Tests that need admin bypass
  // override per-case.
  mockIsLiveAdmin.mockResolvedValue(false);
  mockChain.where.mockClear();
  mockChain.orderBy.mockClear();
  mockChain.limit.mockClear();
  // `jest.clearAllMocks()` clears call history but NOT implementations.
  // Re-arm viewerIsBlocked's default-false on every test so the
  // block-list enforcement describes don't pollute later cases.
  viewerIsBlockedMock.mockReset();
  viewerIsBlockedMock.mockReturnValue(false);
  _resetAuditDedup();
});

// ─── App setup with injectable cohort + admin ───────────────────

const usersRouter = require('../../src/routes/users');

function createApp({
  uid = 'firebase-uid-A',
  uniqueId = 10000001,
  cohort = 'adult',
  admin = false,
  stripCohortClaim = false,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = stripCohortClaim ? {} : { cohort };
    if (admin) token.admin = true;
    req.auth = { uid, uniqueId, token };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── Snapshot helpers ───────────────────────────────────────────

/**
 * Mock a Firestore query response with the given user documents.
 * Each doc receives `id` = uniqueId (string) and `data()` callable.
 */
function mockQueryResult(userDocs) {
  mockGet.mockResolvedValue({
    docs: userDocs.map((u) => ({
      id: String(u.uniqueId),
      exists: true,
      data: () => u,
    })),
    empty: userDocs.length === 0,
    size: userDocs.length,
  });
}

/** Mock `getDoc('users/...')` for the uniqueId-exact branch. */
function mockUserDoc(uniqueId, data) {
  getDoc.mockImplementation((path) => {
    if (path === `users/${uniqueId}`) return Promise.resolve(data);
    return Promise.resolve(null);
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/discover
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/discover — cohort filter at Firestore query level', () => {
  test('adult caller: same-cohort users only, ordered by lastSeenAt DESC, capped at 50', async () => {
    mockQueryResult([
      { uniqueId: 10000300, cohort: 'adult', displayName: 'Cara', lastSeenAt: 3000 },
      { uniqueId: 10000200, cohort: 'adult', displayName: 'Bob', lastSeenAt: 2000 },
      { uniqueId: 10000100, cohort: 'adult', displayName: 'Alice', lastSeenAt: 1000 },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000300, 10000200, 10000100]);

    // Confirm cohort filter was applied at the Firestore query layer.
    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'adult');
    expect(mockChain.orderBy).toHaveBeenCalledWith('lastSeenAt', 'desc');
    expect(mockChain.limit).toHaveBeenCalledWith(50);
  });

  test('minor caller: cohort filter symmetry — only minor users surface', async () => {
    mockQueryResult([
      { uniqueId: 10000700, cohort: 'minor', displayName: 'Min2', lastSeenAt: 7000 },
      { uniqueId: 10000600, cohort: 'minor', displayName: 'Min1', lastSeenAt: 6000 },
    ]);

    const app = createApp({ uniqueId: 10000050, cohort: 'minor' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000700, 10000600]);
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'minor');
  });

  test('caller is excluded from their own discovery feed', async () => {
    mockQueryResult([
      { uniqueId: 10000001, cohort: 'adult', displayName: 'Me', lastSeenAt: 9000 },
      { uniqueId: 10000200, cohort: 'adult', displayName: 'Bob', lastSeenAt: 2000 },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000200]);
  });

  test('empty cohort: returns empty users array, no error', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test('sensitive fields stripped: firebaseUid / email / pinHash / fcmTokens / dateOfBirth never leak', async () => {
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        displayName: 'Bob',
        lastSeenAt: 2000,
        firebaseUid: 'fb-uid-leak',
        email: 'bob@leak.com',
        pinHash: 'pin-hash-leak',
        fcmTokens: ['fcm-leak'],
        dateOfBirth: '2000-01-01',
        gcsScore: 42,
        warningCount: 1,
        deletionScheduledAt: 1234,
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    const u = res.body.users[0];
    expect(u.firebaseUid).toBeUndefined();
    expect(u.email).toBeUndefined();
    expect(u.pinHash).toBeUndefined();
    expect(u.fcmTokens).toBeUndefined();
    expect(u.dateOfBirth).toBeUndefined();
    expect(u.gcsScore).toBeUndefined();
    expect(u.warningCount).toBeUndefined();
    expect(u.deletionScheduledAt).toBeUndefined();
    // Non-sensitive fields preserved.
    expect(u.uniqueId).toBe(10000200);
    expect(u.displayName).toBe('Bob');
  });

  test('stripped cohort claim (no token.cohort) → fail-closed to minor → only minor users', async () => {
    mockQueryResult([
      { uniqueId: 10000600, cohort: 'minor', displayName: 'Min', lastSeenAt: 1000 },
    ]);

    const app = createApp({ uniqueId: 10000001, stripCohortClaim: true });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'minor');
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000600]);
  });

  test('Firestore error → 500 with generic body, error logged', async () => {
    mockGet.mockRejectedValueOnce(new Error('firestore unavailable'));

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('reserved word /discover does NOT clash with /users/:uniqueId catch-all', async () => {
    // Regression pin: if route ordering ever flips, /discover would be
    // captured as :uniqueId. The integer-validation branch of
    // GET /users/:uniqueId returns 400 for non-numeric param; if we
    // see 400 here something is misrouted.
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/search?q=...
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/search — uniqueId numeric branch', () => {
  test('numeric q matching uniqueId: same-cohort target → 200 with target user', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'adult',
      displayName: 'Bob',
      lastSeenAt: 2000,
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].uniqueId).toBe(10000200);
    expect(res.body.users[0].displayName).toBe('Bob');
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('numeric q matching uniqueId: cross-cohort → 404 + segregationEvents audit (existence-hiding)', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'minor',
      displayName: 'KidBob',
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    // Fire-and-forget audit write — flush the microtask queue.
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

  test('numeric q matching uniqueId: target missing → 404, no audit', async () => {
    mockUserDoc(99999999, null);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=99999999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('numeric q matching uniqueId: caller searches their own id → returns self', async () => {
    mockUserDoc(10000001, {
      uniqueId: 10000001,
      cohort: 'adult',
      displayName: 'Me',
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000001');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].uniqueId).toBe(10000001);
  });

  test('numeric q matching uniqueId: stripped sensitive fields on hit', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'adult',
      displayName: 'Bob',
      firebaseUid: 'leak',
      email: 'leak@x.com',
      pinHash: 'leak',
      fcmTokens: ['leak'],
      dateOfBirth: '2000-01-01',
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(200);
    const u = res.body.users[0];
    expect(u.firebaseUid).toBeUndefined();
    expect(u.email).toBeUndefined();
    expect(u.pinHash).toBeUndefined();
    expect(u.fcmTokens).toBeUndefined();
    expect(u.dateOfBirth).toBeUndefined();
  });

  test('numeric q below MIN_UNIQUE_ID (e.g. 100) falls through to displayName branch', async () => {
    // "100" is integer but not in the uniqueId namespace.  Behavior:
    // treat as displayName prefix.  No segregationEvents.  Returns the
    // displayName-prefix path's chain result.
    mockQueryResult([]);
    mockUserDoc(100, { uniqueId: 100, cohort: 'minor' }); // shouldn't be consulted

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=100');

    expect(res.status).toBe(200);
    // The Firestore chain was consulted on the displayName branch, NOT
    // a direct doc fetch.
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'adult');
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/search — displayName prefix branch', () => {
  test('string q: returns same-cohort displayName-prefix matches', async () => {
    mockQueryResult([
      { uniqueId: 10000100, cohort: 'adult', displayName: 'Alice' },
      { uniqueId: 10000101, cohort: 'adult', displayName: 'Alex' },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Ali');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000100, 10000101]);

    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'adult');
    // Prefix-range pattern: displayName >= 'Ali' AND < 'Ali'.
    expect(mockChain.where).toHaveBeenCalledWith('displayName', '>=', 'Ali');
    expect(mockChain.where).toHaveBeenCalledWith('displayName', '<', 'Ali');
  });

  test('string q: cohort symmetry — minor sees only minor matches', async () => {
    mockQueryResult([{ uniqueId: 10000600, cohort: 'minor', displayName: 'Kid' }]);

    const app = createApp({ uniqueId: 10000050, cohort: 'minor' });
    const res = await request(app).get('/api/users/search?q=Kid');

    expect(res.status).toBe(200);
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'minor');
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000600]);
  });

  test('string q: caller excluded from own displayName results', async () => {
    mockQueryResult([
      { uniqueId: 10000001, cohort: 'adult', displayName: 'Me' },
      { uniqueId: 10000200, cohort: 'adult', displayName: 'Mel' },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Mel');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000200]);
  });

  test('string q: empty results', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Zzz');

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test('string q: sensitive fields stripped', async () => {
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        displayName: 'Bob',
        firebaseUid: 'leak',
        email: 'leak@x.com',
        pinHash: 'leak',
        fcmTokens: ['leak'],
        dateOfBirth: '2000-01-01',
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Bob');

    expect(res.status).toBe(200);
    const u = res.body.users[0];
    expect(u.firebaseUid).toBeUndefined();
    expect(u.email).toBeUndefined();
    expect(u.pinHash).toBeUndefined();
    expect(u.fcmTokens).toBeUndefined();
    expect(u.dateOfBirth).toBeUndefined();
  });

  test('string q: stripped cohort claim → fail-closed to minor → only minor matches surface', async () => {
    mockQueryResult([{ uniqueId: 10000600, cohort: 'minor', displayName: 'Kid' }]);

    const app = createApp({ uniqueId: 10000001, stripCohortClaim: true });
    const res = await request(app).get('/api/users/search?q=Kid');

    expect(res.status).toBe(200);
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'minor');
  });

  test('string q: limit applied (max 50)', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    await request(app).get('/api/users/search?q=Ali');

    expect(mockChain.limit).toHaveBeenCalledWith(50);
  });
});

describe('GET /api/users/search — input validation', () => {
  test('missing q → 400', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'q required' });
  });

  test('q with only whitespace → 400', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=%20%20');

    expect(res.status).toBe(400);
  });

  test('q shorter than 3 chars → 400 (rate-limit-friendly minimum)', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=A');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'q must be at least 3 characters' });
  });

  test('q longer than 50 chars → 400', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const longQ = 'A'.repeat(51);
    const res = await request(app).get(`/api/users/search?q=${longQ}`);

    expect(res.status).toBe(400);
  });

  test('Firestore error on displayName branch → 500', async () => {
    mockGet.mockRejectedValueOnce(new Error('firestore boom'));

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Ali');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('q exactly at SEARCH_MIN_QUERY_CHARS (3 chars) → accepted', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Abc');

    expect(res.status).toBe(200);
  });

  test('q exactly at SEARCH_MAX_QUERY_CHARS (50 chars) → accepted', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const exactlyFifty = 'A'.repeat(50);
    const res = await request(app).get(`/api/users/search?q=${exactlyFifty}`);

    expect(res.status).toBe(200);
  });

  test('q as array (?q=a&q=b) → 400 (type-confusion defence)', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=a&q=b');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'q required' });
  });

  test('q as nested array (?q[]=foo) → 400 (type-confusion defence)', async () => {
    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q[]=foo');

    expect(res.status).toBe(400);
  });

  test('getDoc throw on numeric search branch → 500', async () => {
    getDoc.mockImplementationOnce(() => Promise.reject(new Error('getDoc boom')));

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// looksLikeUniqueId — disambiguator boundary table
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/search — looksLikeUniqueId boundaries', () => {
  test('q="10000000" (exactly MIN_UNIQUE_ID) → uniqueId branch (getDoc consulted)', async () => {
    mockUserDoc(10000000, { uniqueId: 10000000, cohort: 'adult', displayName: 'Edge' });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000000');

    expect(res.status).toBe(200);
    expect(res.body.users[0].uniqueId).toBe(10000000);
    expect(getDoc).toHaveBeenCalledWith('users/10000000');
  });

  test('q="9999999" (1 below MIN_UNIQUE_ID) → displayName branch (no getDoc, query chain consulted)', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=9999999');

    expect(res.status).toBe(200);
    expect(mockChain.where).toHaveBeenCalledWith('cohort', '==', 'adult');
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('q="01000000" (leading zero) → displayName branch (regex rejects leading 0)', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=01000000');

    expect(res.status).toBe(200);
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('q="1e9" (scientific notation) → displayName branch (regex rejects "e")', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=1e9');

    expect(res.status).toBe(200);
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('q="10000000.5" (decimal) → displayName branch (regex rejects ".")', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    // Decimal point survives URL transport.
    const res = await request(app).get('/api/users/search?q=10000000.5');

    expect(res.status).toBe(200);
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('q="99999999999999999" (beyond MAX_SAFE_INTEGER) → displayName branch (isSafeInteger guard)', async () => {
    mockQueryResult([]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    // 17 digits — Number.isSafeInteger boundary at 2^53 - 1 = 9007199254740991.
    const res = await request(app).get('/api/users/search?q=99999999999999999');

    expect(res.status).toBe(200);
    expect(getDoc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Block-list enforcement — viewerIsBlocked applied on both branches
// ═══════════════════════════════════════════════════════════════════

const { viewerIsBlocked } = require('../../src/utils/block-check');

describe('GET /api/users/discover — block-list enforcement', () => {
  test('docs where target has blocked caller are dropped from results', async () => {
    // Two candidates: one blocks caller (10000001), one does not.
    viewerIsBlocked.mockImplementation((viewerId, target) => {
      if (!target) return false;
      return (target.blockedUserIds || []).map(String).includes(String(viewerId));
    });

    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        displayName: 'Bob',
        lastSeenAt: 2000,
        blockedUserIds: [10000001],
      },
      {
        uniqueId: 10000300,
        cohort: 'adult',
        displayName: 'Cara',
        lastSeenAt: 1000,
        blockedUserIds: [],
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000300]);
  });
});

describe('GET /api/users/search — block-list enforcement', () => {
  beforeEach(() => {
    viewerIsBlocked.mockImplementation((viewerId, target) => {
      if (!target) return false;
      return (target.blockedUserIds || []).map(String).includes(String(viewerId));
    });
  });

  test('displayName branch: blocked-by docs filtered out of results', async () => {
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        displayName: 'Bob',
        blockedUserIds: [10000001],
      },
      {
        uniqueId: 10000300,
        cohort: 'adult',
        displayName: 'Bobby',
        blockedUserIds: [],
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Bob');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000300]);
  });

  test('numeric branch: blocked-by target → 403 (matches /users/:uniqueId semantics)', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'adult',
      displayName: 'Bob',
      blockedUserIds: [10000001],
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Cannot view content of users who have blocked you',
    });
  });

  test('numeric branch: self always bypasses viewerIsBlocked (self-blocked-self defensive case)', async () => {
    // Pathological case: caller's own doc claims they have blocked
    // themselves. Self-view must still succeed (matches /users/:uniqueId).
    mockUserDoc(10000001, {
      uniqueId: 10000001,
      cohort: 'adult',
      displayName: 'Me',
      blockedUserIds: [10000001],
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000001');

    expect(res.status).toBe(200);
    expect(res.body.users[0].uniqueId).toBe(10000001);
  });
});

// ═══════════════════════════════════════════════════════════════════
// effectiveCohort post-filter — cohortOverride drift defence
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/discover — effectiveCohort post-filter', () => {
  test('doc with cohortOverride differing from cached cohort is dropped', async () => {
    // Adult caller; query field matches but the override flips this doc
    // back to minor — must not be returned.
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        cohortOverride: 'minor', // admin-flipped back to minor
        displayName: 'WasAdult',
        lastSeenAt: 2000,
      },
      {
        uniqueId: 10000300,
        cohort: 'adult',
        displayName: 'StableAdult',
        lastSeenAt: 1000,
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000300]);
  });

  test('doc with cohortOverride matching caller cohort is kept', async () => {
    // Inverse: cached cohort would say drop, override says keep.
    // (Note: with the current Firestore query on `cohort` field, such a
    // doc wouldn't be in the snapshot at all — but the post-filter must
    // still treat it correctly if it ever surfaces.)
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        cohortOverride: 'adult', // matches caller
        displayName: 'OverrideAdult',
        lastSeenAt: 2000,
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000200]);
  });
});

describe('GET /api/users/search — effectiveCohort post-filter', () => {
  test('displayName branch drops docs with cohortOverride differing from caller', async () => {
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        cohortOverride: 'minor',
        displayName: 'Bob',
      },
      {
        uniqueId: 10000300,
        cohort: 'adult',
        displayName: 'Bobby',
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=Bob');

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.uniqueId)).toEqual([10000300]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Comprehensive sensitive-field strip — every field in stripSensitiveFields
// ═══════════════════════════════════════════════════════════════════

describe('stripSensitiveFields — every protected field in one payload', () => {
  test('discover: all GCS / warning / deletion / cohort / provider fields stripped', async () => {
    mockQueryResult([
      {
        uniqueId: 10000200,
        cohort: 'adult',
        cohortOverride: 'adult',
        displayName: 'Bob',
        lastSeenAt: 2000,
        // every stripped key, distinct sentinels for negative assertions
        gcsScore: 'leak-gcsScore',
        gcsLastDeductionAt: 'leak-gcsLastDeductionAt',
        gcsDisplayScore: 'leak-gcsDisplayScore',
        warningCount: 'leak-warningCount',
        warningIssuedAt: 'leak-warningIssuedAt',
        hasNewWarning: 'leak-hasNewWarning',
        pinHash: 'leak-pinHash',
        fcmTokens: ['leak-fcmTokens'],
        firebaseUid: 'leak-firebaseUid',
        email: 'leak-email',
        dateOfBirth: 'leak-dateOfBirth',
        deletionScheduledAt: 'leak-deletionScheduledAt',
        deletionReason: 'leak-deletionReason',
        deletionExecuteAt: 'leak-deletionExecuteAt',
        providers: [
          { provider: 'google', identifier: 'leak-identifier' },
          { provider: 'email', identifier: 'leak-identifier-2' },
        ],
      },
    ]);

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/discover');

    expect(res.status).toBe(200);
    const u = res.body.users[0];
    // every individually asserted absent — drift-proof
    [
      'gcsScore',
      'gcsLastDeductionAt',
      'gcsDisplayScore',
      'warningCount',
      'warningIssuedAt',
      'hasNewWarning',
      'pinHash',
      'fcmTokens',
      'firebaseUid',
      'email',
      'dateOfBirth',
      'deletionScheduledAt',
      'deletionReason',
      'deletionExecuteAt',
      'cohort',
      'cohortOverride',
    ].forEach((field) => {
      expect(u[field]).toBeUndefined();
    });
    // providers preserved but identifiers stripped
    expect(u.providers).toEqual([{ provider: 'google' }, { provider: 'email' }]);
    // public fields preserved
    expect(u.uniqueId).toBe(10000200);
    expect(u.displayName).toBe('Bob');
    expect(u.lastSeenAt).toBe(2000);
  });

  test('search numeric: cohort and cohortOverride stripped from response', async () => {
    mockUserDoc(10000200, {
      uniqueId: 10000200,
      cohort: 'adult',
      cohortOverride: 'adult',
      displayName: 'Bob',
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/search?q=10000200');

    expect(res.status).toBe(200);
    expect(res.body.users[0].cohort).toBeUndefined();
    expect(res.body.users[0].cohortOverride).toBeUndefined();
  });

  test('GET /users/:uniqueId regression: strip helper applied consistently', async () => {
    // Pins that the refactor of /users/:uniqueId still strips cohort
    // and cohortOverride (new behaviour added by PR 5's helper).
    getDoc.mockImplementationOnce((path) => {
      if (path === 'users/10000200') {
        return Promise.resolve({
          uniqueId: 10000200,
          cohort: 'adult',
          cohortOverride: 'adult',
          displayName: 'Bob',
          firebaseUid: 'leak',
          email: 'leak@x.com',
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp({ uniqueId: 10000001, cohort: 'adult' });
    const res = await request(app).get('/api/users/10000200');

    expect(res.status).toBe(200);
    expect(res.body.cohort).toBeUndefined();
    expect(res.body.cohortOverride).toBeUndefined();
    expect(res.body.firebaseUid).toBeUndefined();
    expect(res.body.email).toBeUndefined();
    expect(res.body.uniqueId).toBe(10000200);
  });
});
