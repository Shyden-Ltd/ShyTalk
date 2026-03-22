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

const { authMiddleware, clearUniqueIdCache } = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  clearUniqueIdCache(); // Reset cache between tests
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
});
