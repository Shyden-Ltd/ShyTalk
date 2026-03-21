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

    const app = createAppWithAuthExemption();
    const res = await request(app).get('/api/config/startingScreens');

    // Pre-computed SHA-256 of sorted JSON:
    // {"backgroundImage":null,"dismissable":false,"frequency":"every_launch","imageType":"police_duck","message":"This is a golden hash test message.","template":"warning","title":"Golden Test"}
    expect(res.body.golden.contentHash).toBe(
      '52f993a29fdd316d7e345ec3124a69d997ab0ccf50ae53a0cc27fbd6d160ec8b',
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
    if (res.headers.etag) {
      expect(res.headers.etag).not.toMatch(/^"[a-f0-9]{16}"$/);
    }
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

describe('PUT /api/config/startingScreens — auth', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
  });

  test('non-admin returns 403', async () => {
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const res = await putScreens(app, { screen1: makePutScreen() });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  test('admin is accepted', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();

    const res = await putScreens(app, { screen1: makePutScreen() });

    expect(res.status).toBe(200);
  });
});

// ─── PUT — Validation: body ──────────────────────────────────────

describe('PUT /api/config/startingScreens — body validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
  });

  test('null body returns 400', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .set('Content-Type', 'application/json')
      .send('null');

    expect(res.status).toBe(400);
  });

  test('array body returns 400', async () => {
    const res = await putScreens(app, [makePutScreen()]);

    expect(res.status).toBe(400);
  });

  test('empty object body is accepted (no-op)', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
    mockDocSet.mockResolvedValue();

    const res = await putScreens(app, {});

    expect(res.status).toBe(200);
  });
});

// ─── PUT — Validation: screen ID ─────────────────────────────────

describe('PUT /api/config/startingScreens — screen ID validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
  });

  test('dots in screen ID returns 400', async () => {
    const res = await putScreens(app, { 'screen.1': makePutScreen() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('slashes in screen ID returns 400', async () => {
    const res = await putScreens(app, { 'screen/1': makePutScreen() });

    expect(res.status).toBe(400);
  });

  test('spaces in screen ID returns 400', async () => {
    const res = await putScreens(app, { 'screen 1': makePutScreen() });

    expect(res.status).toBe(400);
  });

  test('unicode in screen ID returns 400', async () => {
    const res = await putScreens(app, { '\u{1F600}': makePutScreen() });

    expect(res.status).toBe(400);
  });

  test('empty string screen ID returns 400', async () => {
    const res = await putScreens(app, { '': makePutScreen() });

    expect(res.status).toBe(400);
  });

  test('alphanumeric with hyphens and underscores accepted', async () => {
    mockDocSet.mockResolvedValue();

    const res = await putScreens(app, { 'my-screen_01': makePutScreen() });

    expect(res.status).toBe(200);
  });
});

// ─── PUT — Validation: title ─────────────────────────────────────

describe('PUT /api/config/startingScreens — title validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('too short (2 chars) returns 400 with field name', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 'AB' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('title');
  });

  test('too long (101 chars) returns 400 with field name', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 'A'.repeat(101) }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('title');
  });

  test('exactly 3 chars accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 'ABC' }) });

    expect(res.status).toBe(200);
  });

  test('exactly 100 chars accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 'A'.repeat(100) }) });

    expect(res.status).toBe(200);
  });

  test('only whitespace returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: '   \t\n  ' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('title');
  });

  test('unicode/emoji accepted (char length, not bytes)', async () => {
    // 3 emoji chars — each is >1 byte but counts as chars
    const res = await putScreens(app, {
      s1: makePutScreen({ title: '\u{1F600}\u{1F601}\u{1F602}' }),
    });

    expect(res.status).toBe(200);
  });

  test('HTML tags accepted (stored as plain text)', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: '<b>Bold Title</b>' }) });

    expect(res.status).toBe(200);
  });

  test('zero-width characters stripped (except ZWJ)', async () => {
    // U+200B zero-width space should be stripped, U+200D ZWJ should remain
    const title = 'Hel\u200Blo\u200D World!';
    const res = await putScreens(app, { s1: makePutScreen({ title }) });

    expect(res.status).toBe(200);
    // The stored title should have U+200B stripped but U+200D retained
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.title).not.toContain('\u200B');
    expect(setCall.s1.title).toContain('\u200D');
  });

  test('title as number returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 12345 }) });

    expect(res.status).toBe(400);
  });
});

// ─── PUT — Validation: message ───────────────────────────────────

describe('PUT /api/config/startingScreens — message validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('too short (9 chars) returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ message: '123456789' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('message');
  });

  test('too long (501 chars) returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ message: 'A'.repeat(501) }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('message');
  });

  test('exactly 10 chars accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ message: '1234567890' }) });

    expect(res.status).toBe(200);
  });

  test('exactly 500 chars accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ message: 'A'.repeat(500) }) });

    expect(res.status).toBe(200);
  });

  test('only whitespace returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ message: '              ' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('message');
  });

  test('control characters stripped', async () => {
    // Control char \x01 should be stripped
    const message = 'Hello\x01 World test msg';
    const res = await putScreens(app, { s1: makePutScreen({ message }) });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.message).not.toContain('\x01');
  });

  test('excessive newlines collapsed to 2', async () => {
    const message = 'Hello\n\n\n\n\nWorld test msg';
    const res = await putScreens(app, { s1: makePutScreen({ message }) });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.message).toBe('Hello\n\nWorld test msg');
    expect(setCall.s1.message).not.toContain('\n\n\n');
  });
});

// ─── PUT — Validation: enums ─────────────────────────────────────

describe('PUT /api/config/startingScreens — enum validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('invalid frequency returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ frequency: 'daily' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('frequency');
  });

  test('invalid template returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ template: 'popup' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('template');
  });

  test('invalid imageType returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ imageType: 'cat_meme' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('imageType');
  });

  test('imageType null accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ imageType: null }) });

    expect(res.status).toBe(200);
  });
});

// ─── PUT — Validation: dates ─────────────────────────────────────

describe('PUT /api/config/startingScreens — date validation', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startDate after endDate returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-03-25T00:00:00Z',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('startDate equals endDate returns 400 (zero-length window)', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-01T00:00:00Z',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('endDate in the past returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        endDate: '2026-03-19T00:00:00Z',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('startDate 1ms before endDate accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-01T00:00:00.001Z',
      }),
    });

    expect(res.status).toBe(200);
  });

  test('invalid ISO 8601 returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ startDate: 'not-a-date' }),
    });

    expect(res.status).toBe(400);
  });

  test('date without time component returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ startDate: '2026-04-01' }),
    });

    expect(res.status).toBe(400);
  });

  test('date with timezone offset accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        startDate: '2026-04-01T00:00:00+05:30',
        endDate: '2026-05-01T00:00:00+05:30',
      }),
    });

    expect(res.status).toBe(200);
  });

  test('startDate in the past accepted (already active)', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        startDate: '2026-03-01T00:00:00Z',
        endDate: '2026-04-01T00:00:00Z',
      }),
    });

    expect(res.status).toBe(200);
  });

  test('startDate as epoch number returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ startDate: 1711929600000 }),
    });

    expect(res.status).toBe(400);
  });
});

// ─── PUT — Validation: background image ──────────────────────────

describe('PUT /api/config/startingScreens — backgroundImage validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('valid R2 key accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ backgroundImage: 'starting-screens/banner.webp' }),
    });

    expect(res.status).toBe(200);
  });

  test('null accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ backgroundImage: null }),
    });

    expect(res.status).toBe(200);
  });

  test('empty string returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ backgroundImage: '' }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('backgroundImage');
  });
});

// ─── PUT — Validation: allowlist ─────────────────────────────────

describe('PUT /api/config/startingScreens — allowlist validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('deviceIds is array of strings accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: ['dev-1', 'dev-2'], networks: [] } }),
    });

    expect(res.status).toBe(200);
  });

  test('networks is array of strings accepted', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: ['10.0.0.0/8'] } }),
    });

    expect(res.status).toBe(200);
  });

  test('deviceIds not array returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: 'dev-1', networks: [] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.deviceIds');
  });

  test('networks not array returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: '10.0.0.0/8' } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.networks');
  });

  test('empty string in deviceIds returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [''], networks: [] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.deviceIds');
  });

  test('CIDR /0 returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: ['0.0.0.0/0'] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.networks');
  });

  test('allowlist missing defaults to empty', async () => {
    const screen = makePutScreen();
    delete screen.allowlist;

    const res = await putScreens(app, { s1: screen });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.allowlist).toEqual({ deviceIds: [], networks: [] });
  });
});

// ─── PUT — Validation: types ─────────────────────────────────────

describe('PUT /api/config/startingScreens — type validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('enabled as string "true" returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ enabled: 'true' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('enabled');
  });

  test('enabled as number 1 returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ enabled: 1 }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('enabled');
  });

  test('dismissable as string "true" returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ dismissable: 'true' }) });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('dismissable');
  });

  test('nested object where string expected returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: { nested: 'value' } }) });

    expect(res.status).toBe(400);
  });

  test('array where object expected returns 400', async () => {
    const res = await putScreens(app, { s1: ['not', 'an', 'object'] });

    expect(res.status).toBe(400);
  });

  test('extra unknown fields ignored', async () => {
    const screen = makePutScreen({ unknownField: 'should be ignored', anotherExtra: 42 });

    const res = await putScreens(app, { s1: screen });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.unknownField).toBeUndefined();
    expect(setCall.s1.anotherExtra).toBeUndefined();
  });
});

// ─── PUT — Blocking constraint ───────────────────────────────────

describe('PUT /api/config/startingScreens — blocking constraint', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocSet.mockResolvedValue();
  });

  test('enable non-dismissable when none exist accepted', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await putScreens(app, {
      s1: makePutScreen({ dismissable: false }),
    });

    expect(res.status).toBe(200);
  });

  test('enable second non-dismissable returns 409 with existingBlocker', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await putScreens(app, {
      newScreen: makePutScreen({ enabled: true, dismissable: false }),
    });

    expect(res.status).toBe(409);
    expect(res.body.existingBlocker).toBe('existing');
  });

  test('change existing non-dismissable to dismissable then enable new accepted', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await putScreens(app, {
      // Change existing to dismissable
      existing: makePutScreen({ enabled: true, dismissable: true }),
      // Add new non-dismissable
      newScreen: makePutScreen({ enabled: true, dismissable: false }),
    });

    expect(res.status).toBe(200);
  });

  test('non-dismissable with startDate in future still counts toward limit', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        future: makeScreen({
          enabled: true,
          dismissable: false,
          startDate: '2026-04-01T00:00:00Z',
        }),
      }),
    });

    const res = await putScreens(app, {
      another: makePutScreen({ enabled: true, dismissable: false }),
    });

    expect(res.status).toBe(409);
    expect(res.body.existingBlocker).toBe('future');

    jest.useRealTimers();
  });

  test('modifying own non-dismissable screen not double-counting', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        blocker: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    // Updating same screen — should NOT conflict with itself
    const res = await putScreens(app, {
      blocker: makePutScreen({ enabled: true, dismissable: false, title: 'Updated Title' }),
    });

    expect(res.status).toBe(200);
  });
});

// ─── PUT — Merge behaviour ───────────────────────────────────────

describe('PUT /api/config/startingScreens — merge behaviour', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocSet.mockResolvedValue();
  });

  test('updating one screen preserves other existing screens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        screen1: makeScreen({ title: 'Screen One' }),
        screen2: makeScreen({ title: 'Screen Two' }),
      }),
    });

    const res = await putScreens(app, {
      screen1: makePutScreen({ title: 'Updated One' }),
    });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.screen1.title).toBe('Updated One');
    expect(setCall.screen2).toBeDefined();
    expect(setCall.screen2.title).toBe('Screen Two');
  });

  test('creating screen with same ID overwrites', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        screen1: makeScreen({ title: 'Original' }),
      }),
    });

    const res = await putScreens(app, {
      screen1: makePutScreen({ title: 'Overwritten' }),
    });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.screen1.title).toBe('Overwritten');
  });
});

// ─── PUT — Audit ─────────────────────────────────────────────────

describe('PUT /api/config/startingScreens — audit', () => {
  let app;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('lastModifiedBy set to admin uniqueId', async () => {
    const res = await putScreens(app, { s1: makePutScreen() });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.lastModifiedBy).toBe('user-A-unique');
  });

  test('lastModifiedAt set to current ISO timestamp', async () => {
    const res = await putScreens(app, { s1: makePutScreen() });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.lastModifiedAt).toBe('2026-03-20T12:00:00.000Z');
  });

  test('audit fields not settable by client', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({
        lastModifiedBy: 'hacker',
        lastModifiedAt: '2020-01-01T00:00:00Z',
      }),
    });

    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.lastModifiedBy).toBe('user-A-unique');
    expect(setCall.s1.lastModifiedAt).toBe('2026-03-20T12:00:00.000Z');
  });
});

// ─── PUT — Idempotency ───────────────────────────────────────────

describe('PUT /api/config/startingScreens — idempotency', () => {
  let app;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('same data PUT twice produces same result', async () => {
    const screen = makePutScreen();

    const res1 = await putScreens(app, { s1: screen });
    expect(res1.status).toBe(200);

    mockDocGet.mockResolvedValue({ exists: false });
    const res2 = await putScreens(app, { s1: screen });
    expect(res2.status).toBe(200);

    const call1 = mockDocSet.mock.calls[0][0];
    const call2 = mockDocSet.mock.calls[1][0];
    expect(call1).toEqual(call2);
  });
});

// ─── PUT — Error format ──────────────────────────────────────────

describe('PUT /api/config/startingScreens — error format', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
  });

  test('validation errors have { error, field }', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ title: 'AB' }) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.field).toBe('title');
  });

  test('blocking constraint has { error, existingBlocker }', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        blocker1: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await putScreens(app, {
      s2: makePutScreen({ enabled: true, dismissable: false }),
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.existingBlocker).toBe('blocker1');
  });
});

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
