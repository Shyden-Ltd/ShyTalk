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
  authMiddlewareStrict,
  clearSuspensionCache,
  clearUniqueIdCache,
} = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  clearUniqueIdCache(); // Reset uniqueId cache
  // Clear suspension cache for keys used in tests
  [
    10000101, 10000102, 10000103, 10000104, 10000105, 10000106, 10000107, 10000108, 10000109,
  ].forEach((id) => {
    clearSuspensionCache(id);
  });
});

// ─── App setup helper ────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(authMiddlewareStrict);

  // Dummy routes for testing
  router.get('/users/:uniqueId', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/appeal', (req, res) => res.json({ success: true }));
  router.post('/users/:uniqueId/follow', (req, res) => res.json({ success: true }));
  router.get('/portal/me', (req, res) => res.json({ success: true }));
  router.post('/portal/sign-out', (req, res) => res.json({ success: true }));

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

describe('authMiddlewareStrict', () => {
  test('valid token passes through with checkRevoked: true', async () => {
    mockUser('user-strict-1', 10000101, false);

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000101')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
    // Verify checkRevoked was passed as true (second argument)
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  test('revoked token returns 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Firebase ID token has been revoked'), {
        code: 'auth/id-token-revoked',
      }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000102')
      .set('Authorization', 'Bearer revoked-token')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('missing Authorization header returns 401', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000103').expect(401);

    expect(res.body.error).toBe('Missing or invalid Authorization header');
  });

  test('expired token returns 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Firebase ID token has expired'), {
        code: 'auth/id-token-expired',
      }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000104')
      .set('Authorization', 'Bearer expired-token')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('malformed token returns 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Decoding Firebase ID token failed'), {
        code: 'auth/argument-error',
      }),
    );

    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000105')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .expect(401);

    expect(res.body.error).toBe('Authentication failed');
  });

  test('suspended user on non-exempt path returns 403', async () => {
    mockUser('suspended-strict-1', 10000106, true);

    const app = createApp();
    const res = await request(app)
      .post('/api/users/10000106/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: '10000003' })
      .expect(403);

    expect(res.body.error).toBe('Account suspended');
  });

  test('suspended user on /portal/me passes through (exempt)', async () => {
    mockUser('suspended-strict-2', 10000107, true);

    const app = createApp();
    const res = await request(app)
      .get('/api/portal/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('suspended user on /portal/sign-out passes through (exempt)', async () => {
    mockUser('suspended-strict-3', 10000108, true);

    const app = createApp();
    const res = await request(app)
      .post('/api/portal/sign-out')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('suspended user on /users/:id/appeal passes through (exempt)', async () => {
    mockUser('suspended-strict-4', 10000109, true);

    const app = createApp();
    const res = await request(app)
      .post('/api/users/10000109/appeal')
      .set('Authorization', 'Bearer valid-token')
      .send({ appealText: 'Please unban me' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('sets req.auth with uid, uniqueId, and decoded token', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'auth-check-uid', admin: true });
    mockCollectionQuery.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: '10000101', data: () => ({ uniqueId: 10000101, firebaseUid: 'auth-check-uid' }) },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000101') {
        return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
      }
      return Promise.resolve({ exists: false });
    });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    router.use(authMiddlewareStrict);
    router.get('/check-auth', (req, res) =>
      res.json({
        uid: req.auth.uid,
        uniqueId: req.auth.uniqueId,
        hasToken: !!req.auth.token,
        admin: req.auth.token.admin,
      }),
    );
    app.use('/api', router);

    const res = await request(app)
      .get('/api/check-auth')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.uid).toBe('auth-check-uid');
    expect(res.body.uniqueId).toBe(10000101);
    expect(res.body.hasToken).toBe(true);
    expect(res.body.admin).toBe(true);
  });

  test('returns 401 when Authorization header has no Bearer prefix', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/users/10000101')
      .set('Authorization', 'Basic abc')
      .expect(401);

    expect(res.body.error).toBe('Missing or invalid Authorization header');
  });
});
