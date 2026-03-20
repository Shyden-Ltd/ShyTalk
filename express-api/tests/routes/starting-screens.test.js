const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
      orderBy: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [] }),
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
    })),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  authMiddleware: jest.fn((req, res, next) => {
    // Simulate real auth middleware: reject requests without auth header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    req.auth = { uid: 'user-A', token: { admin: true } };
    next();
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup (mirrors index.js auth exemption pattern) ─────────

const { authMiddleware } = require('../../src/middleware/auth');
const configRouter = require('../../src/routes/config');

/**
 * Creates an app that mirrors the index.js auth middleware pattern,
 * including the auth exemption for GET /config/startingScreens.
 * This tests that the exemption logic correctly bypasses auth.
 */
function createAppWithAuthExemption() {
  const app = express();
  app.use(express.json());

  // Auth middleware with exemptions — mirrors index.js
  app.use('/api', (req, res, next) => {
    if (
      req.path === '/health' ||
      req.path === '/log-config' ||
      req.path.startsWith('/auth/') ||
      (req.method === 'GET' && req.path === '/config/startingScreens') ||
      (req.path.startsWith('/test/') && process.env.NODE_ENV !== 'production')
    )
      return next();
    authMiddleware(req, res, next);
  });

  // Mount config routes (same as index.js)
  app.use('/api', configRouter);

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/config/startingScreens auth exemption', () => {
  test('GET /api/config/startingScreens succeeds without auth header', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screens: [{ imageUrl: 'https://example.com/img.webp' }] }),
    });

    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/startingScreens');

    // Should NOT get 401 — the GET endpoint is exempt from auth
    expect(res.status).not.toBe(401);
  });

  test('GET /api/config/startingScreens returns config data when it exists', async () => {
    const screenData = {
      screens: [
        { imageUrl: 'https://example.com/screen1.webp', order: 0 },
        { imageUrl: 'https://example.com/screen2.webp', order: 1 },
      ],
    };
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'startingScreens',
      data: () => screenData,
    });

    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.screens).toHaveLength(2);
  });

  test('PUT /api/config/startingScreens returns 401 without auth header', async () => {
    const app = createAppWithAuthExemption();
    const res = await request(app).put('/api/config/startingScreens').send({ screens: [] });

    // PUT is NOT exempt — should hit auth middleware and get 401
    expect(res.status).toBe(401);
  });

  test('PUT /api/config/startingScreens passes through with valid auth', async () => {
    const app = createAppWithAuthExemption();
    const res = await request(app)
      .put('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({ screens: [] });

    // With auth, it should reach the route handler (not 401)
    expect(res.status).not.toBe(401);
  });

  test('other GET config routes still require auth', async () => {
    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/app');

    // /config/app is NOT exempt — should get 401
    expect(res.status).toBe(401);
  });
});
