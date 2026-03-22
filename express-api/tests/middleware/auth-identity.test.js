/**
 * Auth middleware tests — uniqueId resolution for identity system.
 *
 * After the identity system migration, the auth middleware must:
 * 1. Verify Firebase ID token (unchanged)
 * 2. Resolve Firebase UID → uniqueId via Firestore query
 * 3. Set req.auth.uniqueId (null for new/unresolvable users)
 * 4. Check suspension using uniqueId-based user doc path
 * 5. Cache uid → uniqueId mapping
 */

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
    collection: jest.fn((collectionPath) => ({
      where: jest.fn((field, op, value) => ({
        limit: jest.fn(() => ({
          get: () => mockCollectionQuery(collectionPath, field, value),
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

const { authMiddleware, clearUniqueIdCache } = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  // Clear the in-memory caches between tests
  if (clearUniqueIdCache) clearUniqueIdCache();
});

// ─── App setup helper ────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(authMiddleware);

  // Dummy routes for testing — capture req.auth
  router.get('/users/:uniqueId', (req, res) => res.json({ success: true, auth: req.auth }));
  router.post('/users', (req, res) => res.json({ success: true, auth: req.auth }));
  router.post('/users/sign-in', (req, res) => res.json({ success: true, auth: req.auth }));
  router.post('/users/:uniqueId/appeal', (req, res) => res.json({ success: true, auth: req.auth }));
  router.post('/users/:uniqueId/lift-suspension', (req, res) =>
    res.json({ success: true, auth: req.auth }),
  );
  router.post('/users/:uniqueId/follow', (req, res) => res.json({ success: true, auth: req.auth }));

  app.use('/api', router);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('authMiddleware — uniqueId resolution', () => {
  test('resolves uid → uniqueId via Firestore query and sets req.auth.uniqueId', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'firebase-uid-1' });

    // Query users where firebaseUid == 'firebase-uid-1' → found
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: '10000005',
          data: () => ({ uniqueId: 10000005, firebaseUid: 'firebase-uid-1' }),
        },
      ],
    });

    // Suspension check on users/10000005
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000005') {
        return Promise.resolve({
          exists: true,
          data: () => ({ isSuspended: false }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000005')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.auth.uid).toBe('firebase-uid-1');
    expect(res.body.auth.uniqueId).toBe(10000005);
  });

  test('sets uniqueId to null for new users (no user doc with matching firebaseUid)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'brand-new-uid' });

    // Query users where firebaseUid == 'brand-new-uid' → not found
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer valid-token')
      .send({ provider: 'google', identifier: 'new@gmail.com' })
      .expect(200);

    expect(res.body.auth.uid).toBe('brand-new-uid');
    expect(res.body.auth.uniqueId).toBeNull();
  });

  test('allows POST /users through without uniqueId (new user creation)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'new-uid' });
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer valid-token')
      .send({ provider: 'google', identifier: 'x@gmail.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('allows POST /users/sign-in through without uniqueId (cross-project)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'cross-project-uid' });
    mockCollectionQuery.mockResolvedValueOnce({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/users/sign-in')
      .set('Authorization', 'Bearer valid-token')
      .send({ provider: 'google', identifier: 'x@gmail.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('checks suspension using uniqueId-based user doc path', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'suspended-uid' });

    // Resolve uid → uniqueId
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: '10000099',
          data: () => ({ uniqueId: 10000099, firebaseUid: 'suspended-uid' }),
        },
      ],
    });

    // Suspension check on users/10000099
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000099') {
        return Promise.resolve({
          exists: true,
          data: () => ({ isSuspended: true }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app)
      .post('/api/users/10000099/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: '10000001' })
      .expect(403);
  });

  test('allows suspended user to POST /users/:uniqueId/appeal', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'suspended-uid-2' });

    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: '10000050',
          data: () => ({ uniqueId: 10000050, firebaseUid: 'suspended-uid-2' }),
        },
      ],
    });

    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000050') {
        return Promise.resolve({
          exists: true,
          data: () => ({ isSuspended: true }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/users/10000050/appeal')
      .set('Authorization', 'Bearer valid-token')
      .send({ appealText: 'Please reconsider' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('caches uid → uniqueId resolution (second request skips Firestore query)', async () => {
    // First request — resolves via query
    mockVerifyIdToken.mockResolvedValue({ uid: 'cached-uid' });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: '10000077',
          data: () => ({ uniqueId: 10000077, firebaseUid: 'cached-uid' }),
        },
      ],
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isSuspended: false }),
    });

    const app = createApp();

    // First request
    await request(app)
      .get('/api/users/10000077')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Second request — should use cache, not query again
    await request(app)
      .get('/api/users/10000077')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // collection().where().limit().get() should have been called only once
    expect(mockCollectionQuery).toHaveBeenCalledTimes(1);
  });
});
