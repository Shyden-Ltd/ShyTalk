/* eslint-disable no-unused-vars */
const crypto = require('crypto');
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

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  authMiddleware: jest.fn((req, res, next) => {
    // Simulate real auth middleware: reject requests without auth header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    req.auth = { uid: 'user-A', uniqueId: 'user-A-unique', token: { admin: true } };
    next();
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  // Drain mockResolvedValueOnce queues + clear implementations (clearAllMocks
  // does not). Without this, queued values bleed across tests.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocSet.mockResolvedValue();
});

// ─── App setup (mirrors index.js auth exemption pattern) ─────────

const { authMiddleware, requireAdmin } = require('../../src/middleware/auth');
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

// ─── Helper ─────────────────────────────────────────────────────

function makeScreen(overrides = {}) {
  return {
    enabled: true,
    dismissable: false,
    frequency: 'every_launch',
    template: 'warning',
    title: 'Test Title Here',
    message: 'Test message that is long enough.',
    imageType: 'police_duck',
    backgroundImage: null,
    backgroundImageFit: 'cover',
    startDate: null,
    endDate: null,
    allowlist: { deviceIds: [], networks: [] },
    lastModifiedBy: 'admin-1',
    lastModifiedAt: '2026-03-20T12:00:00Z',
    ...overrides,
  };
}

function expectedContentHash(screen) {
  const hashFields = {
    title: screen.title,
    message: screen.message,
    template: screen.template,
    imageType: screen.imageType || null,
    backgroundImage: screen.backgroundImage || null,
    backgroundImageFit: screen.backgroundImageFit || 'cover',
    dismissable: screen.dismissable,
    frequency: screen.frequency,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(hashFields, Object.keys(hashFields).sort()))
    .digest('hex');
}

// ─── Tests ───────────────────────────────────────────────────────

// ─── Core functionality ─────────────────────────────────────────

// ─── Date filtering ─────────────────────────────────────────────

// ─── Allowlist ──────────────────────────────────────────────────

// ─── Content hash ───────────────────────────────────────────────

// ─── Absence of internal fields ─────────────────────────────────

// ─── ETag and caching ───────────────────────────────────────────

// ─── Alphabetical ordering ──────────────────────────────────────

// ─── PUT /api/config/startingScreens ────────────────────────────

function makePutScreen(overrides = {}) {
  return {
    enabled: true,
    dismissable: true,
    frequency: 'every_launch',
    template: 'warning',
    title: 'Valid Title',
    message: 'This is a valid message for testing.',
    imageType: 'police_duck',
    backgroundImage: null,
    backgroundImageFit: 'cover',
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

function putScreens(app, body) {
  return request(app)
    .put('/api/config/startingScreens')
    .set('Authorization', 'Bearer valid-token')
    .send(body);
}

// ─── PUT — Auth ─────────────────────────────────────────────────

// ─── PUT — Validation: body ──────────────────────────────────────

// ─── PUT — Validation: screen ID ─────────────────────────────────

// ─── PUT — Validation: title ─────────────────────────────────────

// ─── PUT — Validation: message ───────────────────────────────────

// ─── PUT — Validation: enums ─────────────────────────────────────

// ─── PUT — Validation: backgroundImageFit ─────────────────────────

// ─── PUT — Validation: dates ─────────────────────────────────────

// ─── PUT — Validation: background image ──────────────────────────

// ─── PUT — Validation: allowlist ─────────────────────────────────

// ─── PUT — Validation: types ─────────────────────────────────────

// ─── PUT — Blocking constraint ───────────────────────────────────

// ─── PUT — Merge behaviour ───────────────────────────────────────

// ─── PUT — Audit ─────────────────────────────────────────────────

// ─── PUT — Idempotency ───────────────────────────────────────────

// ─── PUT — Error format ──────────────────────────────────────────

// ─── 405 catch-all ───────────────────────────────────────────────

// ─── Date filtering — additional ─────────────────────────────────

// ─── Allowlist — additional ──────────────────────────────────────

// ─── Content hash — additional ───────────────────────────────────

// ─── Multi-screen scenarios ──────────────────────────────────────

// ─── ETag/conditional — additional ───────────────────────────────

// ─── Absence ─────────────────────────────────────────────────────

// ─── Security ────────────────────────────────────────────────────

// ─── HTTP correctness ────────────────────────────────────────────

// ─── GET Idempotency ─────────────────────────────────────────────

// ─── Logging ─────────────────────────────────────────────────────

// ─── Combinatorial decision table ────────────────────────────────

// ─── PUT logging ─────────────────────────────────────────────────

// ─── DELETE /api/config/startingScreens/:screenId — soft-delete ──

describe('DELETE /api/config/startingScreens/:screenId — soft-delete (default)', () => {
  const log = require('../../src/utils/log');
  let app;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires auth', async () => {
    const res = await request(app).delete('/api/config/startingScreens/screen1');
    expect(res.status).toBe(401);
  });

  test('requires admin', async () => {
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const res = await request(app)
      .delete('/api/config/startingScreens/screen1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalled();
  });

  test('rejects invalid screen ID', async () => {
    const res = await request(app)
      .delete('/api/config/startingScreens/invalid screen!')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid screen id/i);
  });

  test('returns 404 when no screens configured', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const res = await request(app)
      .delete('/api/config/startingScreens/screen1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no starting screens/i);
  });

  test('returns 404 when screen ID not found', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ other: makeScreen() }),
    });
    const res = await request(app)
      .delete('/api/config/startingScreens/nonexistent')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('soft-deletes screen (sets deleted: true, deletedAt, deletedBy)', async () => {
    const screen1 = makeScreen();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: { ...screen1 } }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/screen1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe('screen1');
    expect(res.body.permanent).toBe(false);

    // Verify the screen still exists but is marked deleted
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.screen1).toBeDefined();
    expect(setCall.screen1.deleted).toBe(true);
    expect(setCall.screen1.deletedAt).toBe('2026-03-20T12:00:00.000Z');
    expect(setCall.screen1.deletedBy).toBe('user-A-unique');
  });

  test('soft-deleted screen NOT returned by public GET', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        deleted_screen: makeScreen({
          deleted: true,
          deletedAt: '2026-03-20T00:00:00Z',
          deletedBy: 'admin-1',
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['active']);
    expect(res.body.deleted_screen).toBeUndefined();
  });

  test('soft-deleted screen IS returned by admin GET', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        deleted_screen: makeScreen({
          deleted: true,
          deletedAt: '2026-03-20T00:00:00Z',
          deletedBy: 'admin-1',
        }),
      }),
    });

    const res = await request(app)
      .get('/api/config/startingScreens/admin')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.active).toBeDefined();
    expect(res.body.deleted_screen).toBeDefined();
    expect(res.body.deleted_screen.deleted).toBe(true);
  });

  test('multiple soft-deletes do not stack (re-deleting already-deleted is idempotent)', async () => {
    const screen = makeScreen({
      deleted: true,
      deletedAt: '2026-03-19T00:00:00Z',
      deletedBy: 'admin-old',
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: { ...screen } }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/s1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.deleted).toBe(true);
    // deletedAt/deletedBy updated to latest
    expect(setCall.s1.deletedAt).toBe('2026-03-20T12:00:00.000Z');
    expect(setCall.s1.deletedBy).toBe('user-A-unique');
  });

  test('logs soft-deletion with admin info', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: makeScreen(), s2: makeScreen() }),
    });

    await request(app)
      .delete('/api/config/startingScreens/s1')
      .set('Authorization', 'Bearer valid-token');

    expect(log.info).toHaveBeenCalledWith('config', 'Starting screen soft-deleted', {
      screenId: 's1',
      remainingScreens: 1,
      admin: 'user-A-unique',
    });
  });

  test('accepts valid screen IDs with hyphens and underscores', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ 'my-screen_1': makeScreen() }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/my-screen_1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe('my-screen_1');
  });

  test('returns 500 on Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const res = await request(app)
      .delete('/api/config/startingScreens/screen1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

describe('DELETE /api/config/startingScreens/:screenId?permanent=true — hard-delete', () => {
  const log = require('../../src/utils/log');
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    jest.clearAllMocks();
  });

  test('permanently deletes existing screen and saves remaining', async () => {
    const screen1 = makeScreen();
    const screen2 = makeScreen({ title: 'Screen 2' });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1, screen2 }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/screen1?permanent=true')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe('screen1');
    expect(res.body.permanent).toBe(true);

    // Verify set was called with only screen2
    expect(mockDocSet).toHaveBeenCalledWith({ screen2 });
  });

  test('permanently deletes last remaining screen leaving empty doc', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ only_screen: makeScreen() }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/only_screen?permanent=true')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith({});
  });

  test('logs permanent deletion with admin info', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: makeScreen(), s2: makeScreen() }),
    });

    await request(app)
      .delete('/api/config/startingScreens/s1?permanent=true')
      .set('Authorization', 'Bearer valid-token');

    expect(log.info).toHaveBeenCalledWith('config', 'Starting screen permanently deleted', {
      screenId: 's1',
      remainingScreens: 1,
      admin: 'user-A-unique',
    });
  });

  test('can permanently delete a soft-deleted screen', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        s1: makeScreen({ deleted: true, deletedAt: '2026-03-20T00:00:00Z', deletedBy: 'admin-1' }),
      }),
    });

    const res = await request(app)
      .delete('/api/config/startingScreens/s1?permanent=true')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.permanent).toBe(true);
    expect(mockDocSet).toHaveBeenCalledWith({});
  });
});

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

describe('POST /api/config/startingScreens/:screenId/restore', () => {
  const log = require('../../src/utils/log');
  let app;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires auth', async () => {
    const res = await request(app).post('/api/config/startingScreens/screen1/restore');
    expect(res.status).toBe(401);
  });

  test('requires admin', async () => {
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const res = await request(app)
      .post('/api/config/startingScreens/screen1/restore')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  test('rejects invalid screen ID', async () => {
    const res = await request(app)
      .post('/api/config/startingScreens/invalid screen!/restore')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid screen id/i);
  });

  test('returns 404 when no screens configured', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const res = await request(app)
      .post('/api/config/startingScreens/screen1/restore')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
  });

  test('returns 404 when screen ID not found', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ other: makeScreen() }),
    });
    const res = await request(app)
      .post('/api/config/startingScreens/nonexistent/restore')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 400 when screen is not deleted', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: makeScreen() }),
    });
    const res = await request(app)
      .post('/api/config/startingScreens/screen1/restore')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not deleted/i);
  });

  test('restores a soft-deleted screen', async () => {
    const deletedScreen = makeScreen({
      deleted: true,
      deletedAt: '2026-03-19T00:00:00Z',
      deletedBy: 'admin-old',
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: { ...deletedScreen } }),
    });

    const res = await request(app)
      .post('/api/config/startingScreens/screen1/restore')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.restored).toBe('screen1');

    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.screen1.deleted).toBe(false);
    expect(setCall.screen1.deletedAt).toBeUndefined();
    expect(setCall.screen1.deletedBy).toBeUndefined();
    expect(setCall.screen1.restoredAt).toBe('2026-03-20T12:00:00.000Z');
    expect(setCall.screen1.restoredBy).toBe('user-A-unique');
  });

  test('restored screen appears in public GET again', async () => {
    // Simulate a restored screen (deleted=false, no deletedAt/deletedBy)
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        screen1: makeScreen({
          deleted: false,
          restoredAt: '2026-03-20T12:00:00.000Z',
          restoredBy: 'admin-1',
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');
    expect(res.status).toBe(200);
    expect(res.body.screen1).toBeDefined();
  });

  test('logs restoration with admin info', async () => {
    const deletedScreen = makeScreen({
      deleted: true,
      deletedAt: '2026-03-19T00:00:00Z',
      deletedBy: 'admin-old',
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: { ...deletedScreen } }),
    });

    await request(app)
      .post('/api/config/startingScreens/s1/restore')
      .set('Authorization', 'Bearer valid-token');

    expect(log.info).toHaveBeenCalledWith('config', 'Starting screen restored', {
      screenId: 's1',
      admin: 'user-A-unique',
    });
  });

  test('returns 500 on Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const res = await request(app)
      .post('/api/config/startingScreens/screen1/restore')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/config/startingScreens/admin ──────────────────────

// ─── Content hash with backgroundImageFit ────────────────────────
