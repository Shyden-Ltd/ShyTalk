const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockVerifyIdToken = jest.fn();
const mockDocGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  auth: {
    verifyIdToken: (...args) => mockVerifyIdToken(...args),
  },
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { authMiddleware } = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup helper ────────────────────────────────────────────

/**
 * Creates a test app mounted at /api so req.path matches production behavior.
 * When Express mounts middleware at /api, req.path strips the /api prefix.
 */
function createApp() {
  const app = express();
  app.use(express.json());

  const router = express.Router();

  // Apply auth middleware to all routes under /api
  router.use(authMiddleware);

  // Dummy routes for testing
  router.get('/users/:uid', (req, res) => res.json({ ok: true }));
  router.post('/users/:uid/appeal', (req, res) => res.json({ ok: true }));
  router.post('/users/:uid/lift-suspension', (req, res) => res.json({ ok: true }));
  router.post('/users/:uid/follow', (req, res) => res.json({ ok: true }));

  app.use('/api', router);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('authMiddleware', () => {
  test('returns 401 when no Authorization header', async () => {
    const app = createApp();
    await request(app).get('/api/users/user-1').expect(401);
  });

  test('returns 401 when Authorization header has no Bearer prefix', async () => {
    const app = createApp();
    await request(app)
      .get('/api/users/user-1')
      .set('Authorization', 'Basic abc')
      .expect(401);
  });

  test('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));
    const app = createApp();
    await request(app)
      .get('/api/users/user-1')
      .set('Authorization', 'Bearer bad-token')
      .expect(401);
  });

  test('sets req.auth and passes through for non-suspended user', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1' });
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ isSuspended: false }),
    });

    const app = createApp();
    const res = await request(app)
      .get('/api/users/user-1')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  test('returns 403 for suspended user on normal routes', async () => {
    // Use a different uid to avoid hitting the in-memory suspension cache
    // from the previous test (which cached user-1 as non-suspended)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'suspended-user-2' });
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ isSuspended: true }),
    });

    const app = createApp();
    await request(app)
      .post('/api/users/suspended-user-2/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: 'user-2' })
      .expect(403);
  });
});

describe('suspension exemption paths', () => {
  beforeEach(() => {
    // All tests in this block use a suspended user
    mockVerifyIdToken.mockResolvedValue({ uid: 'suspended-user' });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isSuspended: true }),
    });
  });

  test('allows suspended user to POST /users/:uid/appeal', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/users/suspended-user/appeal')
      .set('Authorization', 'Bearer valid-token')
      .send({ appealText: 'Please unban me' })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  test('allows suspended user to POST /users/:uid/lift-suspension', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/users/suspended-user/lift-suspension')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  test('blocks suspended user from GET /users/:uid', async () => {
    const app = createApp();
    await request(app)
      .get('/api/users/suspended-user')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });

  test('blocks suspended user from POST /users/:uid/follow', async () => {
    const app = createApp();
    await request(app)
      .post('/api/users/suspended-user/follow')
      .set('Authorization', 'Bearer valid-token')
      .send({ targetUserId: 'other-user' })
      .expect(403);
  });
});
