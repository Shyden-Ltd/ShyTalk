const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockVerifyIdToken = jest.fn();
const mockDocGet = jest.fn();
const mockCollectionQuery = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  auth: {
    verifyIdToken: (...args) => mockVerifyIdToken(...args),
  },
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: () => mockCollectionQuery(),
        })),
      })),
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  authMiddleware,
  requireAdmin,
  clearSuspensionCache,
  clearUniqueIdCache,
  updateUniqueIdCache,
} = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset() is required for mocks that ever use mockImplementation/mockResolvedValueOnce
  // — clearAllMocks() only resets call history, not implementations. Without these resets,
  // mockImplementation set in one test bleeds into the next, causing flaky failures.
  mockVerifyIdToken.mockReset();
  mockDocGet.mockReset();
  mockCollectionQuery.mockReset();
  clearUniqueIdCache(); // Reset uniqueId cache
  clearSuspensionCache('__all__'); // Not a real key, but we also need per-key clearing
  // Clear suspension cache for any keys used in tests by calling with known keys
  [
    10000001, 10000002, 10000050, 10000051, 10000052, 10000053, 10000060, 10000061, 10000062,
    10000063, 10000064, 10000065, 10000070, 10000071, 10000072, 10000073, 10000074, 10000075,
    10000080, 10000081, 10000082, 10000083, 10000090, 10000091,
  ].forEach((id) => {
    clearSuspensionCache(id);
  });
});

// ─── App setup helper ────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(authMiddleware);

  // Dummy routes for testing
  router.get('/users/:uniqueId', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/appeal', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/lift-suspension', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/follow', (req, res) => res.json({ success: true }));

  app.use('/api', router);
  return app;
}

/**
 * Helper: configure mocks for a user with known uniqueId and suspension status.
 */
function mockUser(uid, uniqueId, isSuspended = false) {
  mockVerifyIdToken.mockResolvedValueOnce({ uid });
  // uniqueId resolution query
  if (uniqueId !== null && uniqueId !== undefined) {
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: String(uniqueId), data: () => ({ uniqueId, firebaseUid: uid }) }],
    });
  } else {
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });
  }
  // suspension check
  mockDocGet.mockImplementation((path) => {
    if (path === `users/${uniqueId}`) {
      return Promise.resolve({ exists: true, data: () => ({ isSuspended }) });
    }
    return Promise.resolve({ exists: false });
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('authMiddleware', () => {
  test('returns 401 when no Authorization header', async () => {
    const app = createApp();
    await request(app).get('/api/users/10000001').expect(401);
  });

  test('returns 401 when Authorization header has no Bearer prefix', async () => {
    const app = createApp();
    await request(app).get('/api/users/10000001').set('Authorization', 'Basic abc').expect(401);
  });

  test('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));
    const app = createApp();
    await request(app)
      .get('/api/users/10000001')
      .set('Authorization', 'Bearer bad-token')
      .expect(401);
  });

  test('sets req.auth and passes through for non-suspended user', async () => {
    mockUser('user-1', 10000001, false);

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000001')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('returns 403 for suspended user on normal routes', async () => {
    mockUser('suspended-user-2', 10000002, true);

    const app = createApp();
    await request(app)
      .post('/api/users/10000002/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: '10000003' })
      .expect(403);
  });
});

describe('suspension exemption paths', () => {
  test('allows suspended user to POST /users/:uniqueId/appeal', async () => {
    mockUser('suspended-user', 10000050, true);

    const app = createApp();
    const res = await request(app)
      .post('/api/users/10000050/appeal')
      .set('Authorization', 'Bearer valid-token')
      .send({ appealText: 'Please unban me' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows suspended user to POST /users/:uniqueId/lift-suspension', async () => {
    mockUser('suspended-user-ls', 10000051, true);

    const app = createApp();
    const res = await request(app)
      .post('/api/users/10000051/lift-suspension')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('blocks suspended user from GET /users/:uniqueId', async () => {
    mockUser('suspended-user-get', 10000052, true);

    const app = createApp();
    await request(app)
      .get('/api/users/10000052')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });

  test('blocks suspended user from POST /users/:uniqueId/follow', async () => {
    mockUser('suspended-user-follow', 10000053, true);

    const app = createApp();
    await request(app)
      .post('/api/users/10000053/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: 'other-user' })
      .expect(403);
  });

  test('allows suspended user to POST /users/:uniqueId/delete', async () => {
    mockUser('suspended-del', 10000060, true);

    const app = createAppWithExtraRoutes();
    const res = await request(app)
      .post('/api/users/10000060/delete')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows suspended user to POST /users/:uniqueId/cancel-delete', async () => {
    mockUser('suspended-cdel', 10000061, true);

    const app = createAppWithExtraRoutes();
    const res = await request(app)
      .post('/api/users/10000061/cancel-delete')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows suspended user to GET /users/:uniqueId/deletion-status', async () => {
    mockUser('suspended-ds', 10000062, true);

    const app = createAppWithExtraRoutes();
    const res = await request(app)
      .get('/api/users/10000062/deletion-status')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows suspended user to GET /users/:uniqueId/data-export', async () => {
    mockUser('suspended-de', 10000063, true);

    const app = createAppWithExtraRoutes();
    const res = await request(app)
      .get('/api/users/10000063/data-export')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows suspended user to POST /appeals', async () => {
    mockUser('suspended-appeal', 10000064, true);

    const app = createAppWithExtraRoutes();
    const res = await request(app)
      .post('/api/appeals')
      .set('Authorization', 'Bearer valid-token')
      .send({ reason: 'I was wrongly suspended' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('blocks suspended user on GET /appeals (non-exempt method)', async () => {
    mockUser('suspended-appeal-get', 10000065, true);

    const app = createAppWithExtraRoutes();
    await request(app).get('/api/appeals').set('Authorization', 'Bearer valid-token').expect(403);
  });
});

// ─── Extended app helper for additional exemption routes ─────────

function createAppWithExtraRoutes() {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(authMiddleware);

  // Standard routes
  router.get('/users/:uniqueId', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/appeal', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/lift-suspension', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/follow', (req, res) => res.json({ success: true }));

  // Additional exemption routes
  router.post('/users/:uniqueId/delete', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/cancel-delete', (req, res) => res.json({ success: true }));
  router.get('/users/:uniqueId/deletion-status', (req, res) => res.json({ success: true }));
  router.get('/users/:uniqueId/data-export', (req, res) => res.json({ success: true }));
  router.post('/appeals', (req, res) => res.json({ success: true }));
  router.get('/appeals', (req, res) => res.json({ success: true }));

  app.use('/api', router);
  return app;
}

// ─── UniqueId resolution caching ─────────────────────────────────

describe('uniqueId resolution', () => {
  test('returns null uniqueId when no user doc found (new user)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'new-user-uid' });
    // Collection query returns empty (no user doc with this firebaseUid)
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });
    // Suspension check for null uniqueId should not query
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000070')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
    // The collection query should have been called
    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);
  });

  test('uses cached uniqueId on second request (no Firestore query)', async () => {
    // First request: populates cache
    mockUser('cache-uid', 10000071, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000071')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);

    // Second request: should use cached uniqueId
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'cache-uid' });
    // Do NOT set up mockCollectionQuery — it should not be called
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000071') {
        return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
      }
      return Promise.resolve({ exists: false });
    });

    await request(app)
      .get('/api/users/10000071')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Collection query should NOT have been called again (cache hit)
    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);
  });

  test('re-queries Firestore when uniqueId cache is expired', async () => {
    // First request: populates cache
    mockUser('expired-uid', 10000072, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000072')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);

    // Simulate cache expiry by advancing time
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 60 * 1000; // 6 minutes later (TTL is 5 min)

    try {
      // Second request: cache expired, should query again
      mockVerifyIdToken.mockResolvedValueOnce({ uid: 'expired-uid' });
      mockCollectionQuery.mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: '10000072', data: () => ({ uniqueId: 10000072, firebaseUid: 'expired-uid' }) },
        ],
      });
      mockDocGet.mockImplementation((path) => {
        if (path === 'users/10000072') {
          return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
        }
        return Promise.resolve({ exists: false });
      });

      await request(app)
        .get('/api/users/10000072')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // Collection query should have been called again
      expect(mockCollectionQuery).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realDateNow;
    }
  });

  test('handles user doc missing uniqueId field (uses ?? null)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'no-field-uid' });
    // User doc exists but has no uniqueId field
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'some-doc', data: () => ({ firebaseUid: 'no-field-uid' }) }],
    });
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000073')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Should proceed (uniqueId resolved to null → no suspension check)
    expect(res.body.success).toBe(true);
  });
});

// ─── Suspension check caching ────────────────────────────────────

describe('suspension check', () => {
  test('skips suspension check when uniqueId is null', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'null-unique' });
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });
    // mockDocGet should NOT be called for suspension check
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    await request(app)
      .get('/api/users/10000074')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // doc().get() should NOT have been called since uniqueId is null
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  test('uses cached suspension status on second request', async () => {
    mockUser('susp-cache-uid', 10000075, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000075')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // mockDocGet called once for suspension check
    const firstCallCount = mockDocGet.mock.calls.length;

    // Second request: uniqueId from cache, suspension from cache
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'susp-cache-uid' });
    // No collection query (uniqueId cached)
    // No doc get (suspension cached)

    await request(app)
      .get('/api/users/10000075')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // mockDocGet should NOT have been called again (suspension cache hit)
    expect(mockDocGet.mock.calls.length).toBe(firstCallCount);
  });

  test('re-checks suspension when suspension cache is expired', async () => {
    mockUser('susp-exp-uid', 10000080, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000080')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    const firstDocGetCalls = mockDocGet.mock.calls.length;

    // Advance time past TTL
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 60 * 1000;

    try {
      mockVerifyIdToken.mockResolvedValueOnce({ uid: 'susp-exp-uid' });
      // uniqueId cache also expired, so need collection query too
      mockCollectionQuery.mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: '10000080', data: () => ({ uniqueId: 10000080, firebaseUid: 'susp-exp-uid' }) },
        ],
      });
      mockDocGet.mockImplementation((path) => {
        if (path === 'users/10000080') {
          return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
        }
        return Promise.resolve({ exists: false });
      });

      await request(app)
        .get('/api/users/10000080')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // mockDocGet should have been called again (cache expired)
      expect(mockDocGet.mock.calls.length).toBeGreaterThan(firstDocGetCalls);
    } finally {
      Date.now = realDateNow;
    }
  });

  test('detects suspension via is_suspended (snake_case field)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'snake-uid' });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: '10000081', data: () => ({ uniqueId: 10000081, firebaseUid: 'snake-uid' }) }],
    });
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000081') {
        // Only snake_case field set
        return Promise.resolve({ exists: true, data: () => ({ is_suspended: true }) });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app)
      .post('/api/users/10000081/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({})
      .expect(403);
  });

  test('treats non-existent user doc as not suspended', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'nouser-uid' });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: '10000082', data: () => ({ uniqueId: 10000082, firebaseUid: 'nouser-uid' }) }],
    });
    mockDocGet.mockImplementation(() => {
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000082')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});

// ─── Firebase token verification edge cases ──────────────────────

describe('Firebase token verification', () => {
  test('returns 401 for expired token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Firebase ID token has expired'), { code: 'auth/id-token-expired' }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000083')
      .set('Authorization', 'Bearer expired-token')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('returns 401 for revoked token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Firebase ID token has been revoked'), {
        code: 'auth/id-token-revoked',
      }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000083')
      .set('Authorization', 'Bearer revoked-token')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('returns 401 for malformed token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Decoding Firebase ID token failed'), {
        code: 'auth/argument-error',
      }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000083')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('returns 401 when Authorization header is "Bearer " with empty token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

    const app = createApp();
    await request(app).get('/api/users/10000083').set('Authorization', 'Bearer ').expect(401);
  });
});

// ─── requireAdmin helper ─────────────────────────────────────────

describe('requireAdmin', () => {
  test('returns true and sends 403 when user is not admin', async () => {
    const req = { auth: { token: { admin: false } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    const blocked = await requireAdmin(req, res);

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  test('returns true and sends 403 when admin claim is undefined', async () => {
    const req = { auth: { token: {} } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    const blocked = await requireAdmin(req, res);

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns false when user is admin', async () => {
    const req = { auth: { token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    const blocked = await requireAdmin(req, res);

    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns true when req.auth is missing', async () => {
    const req = {};
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    const blocked = await requireAdmin(req, res);

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─── Cache management helpers ────────────────────────────────────

describe('clearSuspensionCache', () => {
  test('clears cached suspension so next request re-checks Firestore', async () => {
    // Reset mocks to ensure no leftover once-values from previous tests
    mockVerifyIdToken.mockReset();
    mockCollectionQuery.mockReset();
    mockDocGet.mockReset();

    // First request: user is not suspended, gets cached
    mockUser('susp-clear-uid', 10000090, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000090')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    const firstDocCalls = mockDocGet.mock.calls.length;

    // Clear the suspension cache for this user
    clearSuspensionCache(10000090);

    // Second request: should re-check Firestore (cache was cleared)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'susp-clear-uid' });
    // uniqueId still cached, so no collection query
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000090') {
        return Promise.resolve({ exists: true, data: () => ({ isSuspended: true }) });
      }
      return Promise.resolve({ exists: false });
    });

    await request(app)
      .post('/api/users/10000090/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({})
      .expect(403); // Now suspended after cache clear

    // Doc get was called again (cache was cleared)
    expect(mockDocGet.mock.calls.length).toBeGreaterThan(firstDocCalls);
  });
});

describe('clearUniqueIdCache', () => {
  test('clears specific uid entry so next request re-queries', async () => {
    // First request: populates cache
    mockUser('clear-uid-1', 10000091, false);
    const app = createApp();
    await request(app)
      .get('/api/users/10000091')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);

    // Clear the specific uid entry
    clearUniqueIdCache('clear-uid-1');

    // Second request: should re-query Firestore
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'clear-uid-1' });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: '10000091', data: () => ({ uniqueId: 10000091, firebaseUid: 'clear-uid-1' }) }],
    });
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000091') {
        return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
      }
      return Promise.resolve({ exists: false });
    });

    await request(app)
      .get('/api/users/10000091')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Collection query should have been called again
    expect(mockCollectionQuery).toHaveBeenCalledTimes(2);
  });

  test('clears all entries when called without uid', () => {
    // Just verify it does not throw — functional test is that
    // subsequent requests re-query Firestore (covered by beforeEach)
    expect(() => clearUniqueIdCache()).not.toThrow();
    expect(() => clearUniqueIdCache(null)).not.toThrow();
    expect(() => clearUniqueIdCache(undefined)).not.toThrow();
  });
});

describe('updateUniqueIdCache', () => {
  test('pre-populates cache so resolveUniqueId skips Firestore', async () => {
    // Reset mocks to ensure no leftover once-values from previous tests
    mockVerifyIdToken.mockReset();
    mockCollectionQuery.mockReset();
    mockDocGet.mockReset();

    // Pre-populate the cache
    updateUniqueIdCache('prepop-uid', 10000083);

    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'prepop-uid' });
    // No collection query mock — it should not be called
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000083') {
        return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app)
      .get('/api/users/10000083')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Collection query should NOT have been called (cache was pre-populated)
    expect(mockCollectionQuery).not.toHaveBeenCalled();
  });
});

// ─── Cache eviction ──────────────────────────────────────────────

describe('cache eviction', () => {
  test('evicts oldest uniqueId entry when cache exceeds MAX_CACHE_SIZE (500)', async () => {
    // Fill the uniqueId cache to 501 entries to trigger eviction
    for (let i = 0; i < 501; i++) {
      updateUniqueIdCache(`uid-${i}`, i);
    }

    // The first entry (uid-0) should have been evicted.
    // Verify by pre-populating uid-0 again — if eviction worked, it was removed.
    // We test this by making a request with uid-0: it should need a Firestore query
    // because the cache entry was evicted.
    mockVerifyIdToken.mockReset();
    mockCollectionQuery.mockReset();
    mockDocGet.mockReset();

    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-0' });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: '0', data: () => ({ uniqueId: 0, firebaseUid: 'uid-0' }) }],
    });
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    await request(app).get('/api/users/0').set('Authorization', 'Bearer valid-token').expect(200);

    // Collection query WAS called because uid-0 was evicted from cache
    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);
  });
});

// ─── PR #502 (audit L2): requireAdmin defensive optional chaining ──

describe('requireAdmin defensive checks', () => {
  test('returns 403 when req.auth is undefined (defensive)', async () => {
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const blocked = await requireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when req.auth.token is undefined (defensive)', async () => {
    // Pre-fix used `req.auth?.token.admin` — would throw TypeError
    // here. Now `req.auth?.token?.admin` returns undefined → falsy →
    // 403. Fail closed.
    const req = { auth: { uid: 'some-uid' /* no token field */ } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const blocked = await requireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when admin claim is false', async () => {
    const req = { auth: { uid: 'some-uid', token: { admin: false } } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const blocked = await requireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns false (allows) when admin claim is true', async () => {
    const req = { auth: { uid: 'admin-uid', token: { admin: true } } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const blocked = await requireAdmin(req, res);
    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// Phase 2H finding #5: in-flight Promise dedup. Without these, N concurrent
// first-touch requests for the same key fire N parallel Firestore reads
// — a quota grenade on cold-start where 5-10 parallel calls per user each
// miss the cache. The fix caches the in-flight Promise itself so the
// second+ caller awaits the first caller's lookup. These tests pin the
// behaviour so a regression that drops the dedup fails CI.
describe('in-flight Promise dedup (resolveUniqueId)', () => {
  test('5 concurrent same-uid requests issue ONE Firestore query, not 5', async () => {
    // Slow Firestore mock so all 5 requests land in the inflight window.
    let resolveQuery;
    const queryPromise = new Promise((r) => {
      resolveQuery = r;
    });
    mockCollectionQuery.mockReturnValueOnce(queryPromise);
    // verifyIdToken returns the same uid for all 5 requests.
    mockVerifyIdToken.mockResolvedValue({ uid: 'concurrent-uid' });
    // suspension check is uid-keyed; resolve immediately.
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ isSuspended: false }) });

    const app = createApp();
    const fired = Array.from({ length: 5 }, () =>
      request(app).get('/api/users/10000080').set('Authorization', 'Bearer t'),
    );
    // Let all 5 requests dispatch through middleware up to the inflight await.
    await new Promise((r) => setTimeout(r, 10));

    // Resolve the slow Firestore query with a real result so the dedup'd
    // callers all return the same uniqueId.
    resolveQuery({
      empty: false,
      docs: [
        { id: '10000080', data: () => ({ uniqueId: 10000080, firebaseUid: 'concurrent-uid' }) },
      ],
    });
    await Promise.all(fired);

    // Single Firestore call across the 5 concurrent requests — the dedup
    // contract is real, not just a happy-path optimisation.
    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);
  });

  test('inflight slot released on Firestore error so retry refetches', async () => {
    // First call: rejects.
    mockCollectionQuery.mockRejectedValueOnce(new Error('Firestore down'));
    // Second call: succeeds.
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: '10000081', data: () => ({ uniqueId: 10000081, firebaseUid: 'retry-uid' }) }],
    });
    mockVerifyIdToken.mockResolvedValue({ uid: 'retry-uid' });
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ isSuspended: false }) });

    const app = createApp();
    // First request hits the rejecting query path. Middleware catches and
    // returns 401 (auth boundary fails closed). The inflight slot must be
    // released regardless — the next retry should re-issue the query.
    await request(app).get('/api/users/10000081').set('Authorization', 'Bearer t');
    await request(app).get('/api/users/10000081').set('Authorization', 'Bearer t');

    // Both calls fired Firestore — second wasn't pinned to the rejected Promise.
    expect(mockCollectionQuery).toHaveBeenCalledTimes(2);
  });
});

// Phase 2H finding #2: live admin claim re-fetch via auth.getUser.
// Default test mode (JEST_WORKER_ID set) skips the live check so most
// admin tests don't need to mock auth.getUser. AUTH_FORCE_LIVE_ADMIN_CHECK=1
// forces the live path on so we can pin its behaviour explicitly.
describe('requireAdmin — live customClaims re-fetch (Phase 2H finding #2)', () => {
  let originalForceLiveCheck;
  let mockGetUser;

  beforeEach(() => {
    originalForceLiveCheck = process.env.AUTH_FORCE_LIVE_ADMIN_CHECK;
    process.env.AUTH_FORCE_LIVE_ADMIN_CHECK = '1';
    jest.resetModules();
    mockGetUser = jest.fn();
    jest.doMock('../../src/utils/firebase', () => ({
      auth: {
        verifyIdToken: jest.fn(),
        getUser: (...args) => mockGetUser(...args),
      },
      db: {
        doc: jest.fn(() => ({ get: jest.fn() })),
        collection: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn() })) })),
        })),
      },
    }));
    jest.doMock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
  });

  afterEach(() => {
    if (originalForceLiveCheck === undefined) {
      delete process.env.AUTH_FORCE_LIVE_ADMIN_CHECK;
    } else {
      process.env.AUTH_FORCE_LIVE_ADMIN_CHECK = originalForceLiveCheck;
    }
  });

  test('denies even when token.admin=true if live customClaims show admin=false (demoted admin)', async () => {
    const { requireAdmin: liveRequireAdmin } = require('../../src/middleware/auth');
    mockGetUser.mockResolvedValue({ customClaims: { admin: false } });
    const req = { auth: { uid: 'demoted-admin-uid', token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const blocked = await liveRequireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockGetUser).toHaveBeenCalledWith('demoted-admin-uid');
  });

  test('allows when both token.admin=true AND live customClaims confirm admin=true', async () => {
    const { requireAdmin: liveRequireAdmin } = require('../../src/middleware/auth');
    mockGetUser.mockResolvedValue({ customClaims: { admin: true } });
    const req = { auth: { uid: 'real-admin-uid', token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const blocked = await liveRequireAdmin(req, res);
    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('caches the live result for TTL — second call within TTL skips auth.getUser', async () => {
    const { requireAdmin: liveRequireAdmin } = require('../../src/middleware/auth');
    mockGetUser.mockResolvedValue({ customClaims: { admin: true } });
    const req = { auth: { uid: 'cached-uid', token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await liveRequireAdmin(req, res);
    await liveRequireAdmin(req, res);
    await liveRequireAdmin(req, res);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  test('clearAdminClaimCache forces a fresh live re-check on the next call', async () => {
    const {
      requireAdmin: liveRequireAdmin,
      clearAdminClaimCache,
    } = require('../../src/middleware/auth');
    mockGetUser.mockResolvedValue({ customClaims: { admin: true } });
    const req = { auth: { uid: 'invalidate-uid', token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await liveRequireAdmin(req, res);
    expect(mockGetUser).toHaveBeenCalledTimes(1);

    // Simulate admin demotion: clear cache + change live response.
    clearAdminClaimCache('invalidate-uid');
    mockGetUser.mockResolvedValue({ customClaims: { admin: false } });

    const blocked = await liveRequireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  test('fail-closed when auth.getUser throws (Firebase Auth outage)', async () => {
    const { requireAdmin: liveRequireAdmin } = require('../../src/middleware/auth');
    mockGetUser.mockRejectedValue(new Error('Firebase Auth unavailable'));
    const req = { auth: { uid: 'outage-uid', token: { admin: true } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const blocked = await liveRequireAdmin(req, res);
    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
