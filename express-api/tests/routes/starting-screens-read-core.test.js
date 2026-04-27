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

describe('GET /api/config/startingScreens auth exemption', () => {
  test('GET /api/config/startingScreens succeeds without auth header', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: makeScreen() }),
    });

    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/startingScreens');

    // Should NOT get 401 — the GET endpoint is exempt from auth
    expect(res.status).not.toBe(401);
  });

  test('GET /api/config/startingScreens returns active screens when config exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        screen1: makeScreen(),
        screen2: makeScreen({ title: 'Second Screen' }),
      }),
    });

    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toHaveLength(2);
    expect(res.body.screen1).toBeDefined();
    expect(res.body.screen2).toBeDefined();
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

// ─── Core functionality ─────────────────────────────────────────

describe('GET /api/config/startingScreens — core', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('returns empty object when config doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('returns active screens with all expected fields', async () => {
    const screen = makeScreen();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner1: screen }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    const s = res.body.banner1;
    expect(s).toBeDefined();
    expect(s.enabled).toBe(true);
    expect(s.dismissable).toBe(false);
    expect(s.frequency).toBe('every_launch');
    expect(s.template).toBe('warning');
    expect(s.title).toBe('Test Title Here');
    expect(s.message).toBe('Test message that is long enough.');
    expect(s.imageType).toBe('police_duck');
    expect(s.backgroundImage).toBeNull();
    expect(s.backgroundImageFit).toBe('cover');
    expect(s.startDate).toBeNull();
    expect(s.endDate).toBeNull();
    expect(s.lastModifiedAt).toBe('2026-03-20T12:00:00Z');
    expect(s.contentHash).toBeDefined();
  });

  test('contentHash is a 64-character hex string', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner1: makeScreen() }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner1.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('omits disabled screens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        disabled: makeScreen({ enabled: false }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(Object.keys(res.body)).toEqual(['active']);
    expect(res.body.disabled).toBeUndefined();
  });
});

// ─── Date filtering ─────────────────────────────────────────────

describe('GET /api/config/startingScreens — date filtering', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('omits screens with future startDate', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        future: makeScreen({ startDate: '2026-04-01T00:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.future).toBeUndefined();
  });

  test('omits screens with past endDate', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        expired: makeScreen({ endDate: '2026-03-19T00:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.expired).toBeUndefined();
  });

  test('includes screens with null startDate and null endDate', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        always: makeScreen({ startDate: null, endDate: null }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.always).toBeDefined();
  });

  test('includes screens with past startDate and future endDate', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        inWindow: makeScreen({
          startDate: '2026-03-01T00:00:00Z',
          endDate: '2026-04-01T00:00:00Z',
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.inWindow).toBeDefined();
  });

  test('startDate exactly at frozen time — screen IS active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        exact: makeScreen({ startDate: '2026-03-20T12:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.exact).toBeDefined();
  });

  test('endDate exactly at frozen time — screen NOT active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        expired: makeScreen({ endDate: '2026-03-20T12:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.expired).toBeUndefined();
  });

  test('startDate 1ms after frozen time — NOT active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        future: makeScreen({ startDate: '2026-03-20T12:00:00.001Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.future).toBeUndefined();
  });

  test('endDate 1ms after frozen time — active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        stillActive: makeScreen({ endDate: '2026-03-20T12:00:00.001Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.stillActive).toBeDefined();
  });
});

// ─── Allowlist ──────────────────────────────────────────────────

describe('GET /api/config/startingScreens — allowlist', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('device ID match overrides dismissable to true', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['dev-123'], networks: [] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'dev-123');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('IP match overrides dismissable to true', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: ['127.0.0.1'] },
        }),
      }),
    });

    // supertest requests come from 127.0.0.1 by default
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('CIDR match overrides dismissable to true', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: ['127.0.0.0/8'] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('no match leaves dismissable unchanged', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['other-device'], networks: ['10.0.0.0/8'] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'dev-999');

    expect(res.body.banner.dismissable).toBe(false);
  });

  test('already-dismissable screen stays dismissable regardless of allowlist', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: true,
          allowlist: { deviceIds: [], networks: [] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });
});

// ─── Content hash ───────────────────────────────────────────────

describe('GET /api/config/startingScreens — content hash', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('contentHash is deterministic for same content', async () => {
    const screen = makeScreen();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when title changes', async () => {
    const screen1 = makeScreen({ title: 'Title A' });
    const screen2 = makeScreen({ title: 'Title B' });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen1 }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen2 }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash does NOT change when enabled toggles', async () => {
    const screenEnabled = makeScreen({ enabled: true });
    // Compute expected hash — enabled is not part of hash fields
    const hash = expectedContentHash(screenEnabled);

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screenEnabled }),
    });
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.contentHash).toBe(hash);
  });

  test('contentHash matches expected SHA-256', async () => {
    const screen = makeScreen();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.contentHash).toBe(expectedContentHash(screen));
  });

  test('contentHash matches known golden value', async () => {
    const screen = makeScreen({
      title: 'Golden Test',
      message: 'This is a golden hash test message.',
      template: 'warning',
      imageType: 'police_duck',
      backgroundImage: null,
      dismissable: false,
      frequency: 'every_launch',
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ golden: screen }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    // Pre-computed SHA-256 of sorted JSON:
    // {"backgroundImage":null,"dismissable":false,"frequency":"every_launch","imageType":"police_duck","message":"This is a golden hash test message.","template":"warning","title":"Golden Test"}
    expect(res.body.golden.contentHash).toBe(
      '7335f427d736af7d1a5bf56d9fd3acd07c51542506c7e2f8afacacbd4c2d2c81',
    );
  });
});

// ─── Absence of internal fields ─────────────────────────────────

describe('GET /api/config/startingScreens — field exclusion', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('does NOT include allowlist in response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ allowlist: { deviceIds: ['dev-1'], networks: ['10.0.0.0/8'] } }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.allowlist).toBeUndefined();
  });

  test('does NOT include lastModifiedBy in response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ lastModifiedBy: 'admin-1' }) }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.lastModifiedBy).toBeUndefined();
  });
});

// ─── ETag and caching ───────────────────────────────────────────

describe('GET /api/config/startingScreens — ETag and caching', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('response includes ETag header', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen() }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  test('If-None-Match with matching ETag returns 304', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen() }),
    });

    const res1 = await request(app).get('/api/config/startingScreens');
    const etag = res1.headers.etag;

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen() }),
    });

    const res2 = await request(app).get('/api/config/startingScreens').set('If-None-Match', etag);

    expect(res2.status).toBe(304);
  });

  test('X-Content-Type-Options header is nosniff', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen() }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('custom ETag not set when allowlist override applies', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        gate: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['my-dev'], networks: [] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'my-dev');

    // Our custom strong ETag (SHA-256 hex) should NOT be present
    // Express may still add its own weak ETag (W/"...")
    // Remove the if guard — assert directly that our custom strong ETag is NOT present
    expect(res.headers.etag).not.toMatch(/^"[a-f0-9]{16}"$/);
  });
});

// ─── Alphabetical ordering ──────────────────────────────────────

describe('GET /api/config/startingScreens — ordering', () => {
  test('screens are returned in alphabetical order by ID', async () => {
    const app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        zebra: makeScreen({ title: 'Zebra' }),
        alpha: makeScreen({ title: 'Alpha' }),
        mango: makeScreen({ title: 'Mango' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(Object.keys(res.body)).toEqual(['alpha', 'mango', 'zebra']);
  });
});

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

describe('/api/config/startingScreens — 405 catch-all', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('POST returns 405', async () => {
    const res = await request(app)
      .post('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(405);
    expect(res.body.error).toBeDefined();
  });

  test('DELETE returns 405', async () => {
    const res = await request(app)
      .delete('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(405);
  });

  test('PATCH returns 405', async () => {
    const res = await request(app)
      .patch('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(405);
  });
});

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

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

// ─── GET /api/config/startingScreens/admin ──────────────────────

// ─── Content hash with backgroundImageFit ────────────────────────
