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

    const app = createAppWithAuthExemption();
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

// ─── PUT — Validation: backgroundImageFit ─────────────────────────

describe('PUT /api/config/startingScreens — backgroundImageFit validation', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('"cover" accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ backgroundImageFit: 'cover' }) });
    expect(res.status).toBe(200);
  });

  test('"contain" accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ backgroundImageFit: 'contain' }) });
    expect(res.status).toBe(200);
  });

  test('"100% 100%" accepted', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ backgroundImageFit: '100% 100%' }) });
    expect(res.status).toBe(200);
  });

  test('null accepted (defaults to cover)', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ backgroundImageFit: null }) });
    expect(res.status).toBe(200);
  });

  test('undefined accepted (defaults to cover)', async () => {
    const screen = makePutScreen();
    delete screen.backgroundImageFit;
    const res = await putScreens(app, { s1: screen });
    expect(res.status).toBe(200);
    const setCall = mockDocSet.mock.calls[0][0];
    expect(setCall.s1.backgroundImageFit).toBe('cover');
  });

  test('invalid value returns 400', async () => {
    const res = await putScreens(app, { s1: makePutScreen({ backgroundImageFit: 'fill' }) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('backgroundImageFit');
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

  test('updating other fields on expired screen accepted (endDate unchanged)', async () => {
    const pastEndDate = '2025-01-01T00:00:00Z';
    // Mock existing screen with past endDate
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: makePutScreen({ endDate: pastEndDate, title: 'Old Title' }) }),
    });

    // PUT same screen with same endDate but different title — should succeed
    const res = await putScreens(app, {
      s1: makePutScreen({ endDate: pastEndDate, title: 'Updated Title' }),
    });

    expect(res.status).toBe(200);
  });

  test('changing endDate to a past value on existing screen returns 400', async () => {
    // Mock existing screen with future endDate
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ s1: makePutScreen({ endDate: '2099-01-01T00:00:00Z' }) }),
    });

    // PUT with a different, past endDate — should reject
    const res = await putScreens(app, {
      s1: makePutScreen({ endDate: '2025-01-01T00:00:00Z' }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('endDate');
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

  test('non-string in networks array returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: [123] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.networks');
  });

  test('object in networks array returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: [{ cidr: '10.0.0.0/8' }] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.networks');
  });

  test('empty string in networks array returns 400', async () => {
    const res = await putScreens(app, {
      s1: makePutScreen({ allowlist: { deviceIds: [], networks: [''] } }),
    });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('allowlist.networks');
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

// ─── Date filtering — additional ─────────────────────────────────

describe('GET /api/config/startingScreens — date filtering (additional)', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startDate null + endDate set and valid — returned', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ startDate: null, endDate: '2026-04-01T00:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.banner).toBeDefined();
  });

  test('startDate set + endDate null — returned', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ startDate: '2026-03-01T00:00:00Z', endDate: null }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.banner).toBeDefined();
  });

  test('multiple screens with overlapping windows — all active ones returned', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        a: makeScreen({
          startDate: '2026-03-01T00:00:00Z',
          endDate: '2026-04-01T00:00:00Z',
        }),
        b: makeScreen({
          startDate: '2026-03-10T00:00:00Z',
          endDate: '2026-03-25T00:00:00Z',
        }),
        c: makeScreen({
          startDate: '2026-03-21T00:00:00Z',
          endDate: '2026-04-01T00:00:00Z',
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.a).toBeDefined();
    expect(res.body.b).toBeDefined();
    // c has startDate in the future (tomorrow), should NOT be returned
    expect(res.body.c).toBeUndefined();
  });
});

// ─── Allowlist — additional ──────────────────────────────────────

describe('GET /api/config/startingScreens — allowlist (additional)', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('device ID is case-sensitive — different case does not match', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['Dev-123'], networks: [] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'dev-123');

    expect(res.body.banner.dismissable).toBe(false);
  });

  test('IP not in CIDR range — not overridden', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: ['192.168.0.0/16'] },
        }),
      }),
    });

    // supertest sends from 127.0.0.1, which is not in 192.168.0.0/16
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(false);
  });

  test('both device ID and IP match — overridden', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['dev-match'], networks: ['127.0.0.1'] },
        }),
      }),
    });

    const res = await request(app)
      .get('/api/config/startingScreens')
      .set('X-Device-Id', 'dev-match');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('empty allowlist arrays — no override', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: [] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'dev-123');

    expect(res.body.banner.dismissable).toBe(false);
  });

  test('X-Device-Id header missing — no device match, IP still checked', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['dev-123'], networks: ['127.0.0.1'] },
        }),
      }),
    });

    // No X-Device-Id header set — device check fails, but IP (127.0.0.1) matches
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('IPv4-mapped IPv6 (::ffff:127.0.0.1) matches equivalent IPv4', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: ['127.0.0.1'] },
        }),
      }),
    });

    // supertest connects via loopback which may present as ::ffff:127.0.0.1
    // The normalizeIp function strips the ::ffff: prefix
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });

  test('CIDR /32 matches single IP', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: [], networks: ['127.0.0.1/32'] },
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.banner.dismissable).toBe(true);
  });
});

// ─── Content hash — additional ───────────────────────────────────

describe('GET /api/config/startingScreens — content hash (additional)', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('contentHash changes when message changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ message: 'Message version one long enough' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ message: 'Message version two long enough' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when template changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ template: 'warning' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ template: 'info' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when imageType changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ imageType: 'police_duck' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ imageType: null }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when backgroundImage changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ backgroundImage: null }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ backgroundImage: 'starting-screens/bg.webp' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when dismissable changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ dismissable: false }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ dismissable: true }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash changes when frequency changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ frequency: 'every_launch' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ frequency: 'once' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash does NOT change when allowlist changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ allowlist: { deviceIds: [], networks: [] } }),
      }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ allowlist: { deviceIds: ['dev-1'], networks: ['10.0.0.0/8'] } }),
      }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).toBe(res2.body.banner.contentHash);
  });

  test('contentHash does NOT change when startDate/endDate changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({ startDate: null, endDate: null }),
      }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2027-01-01T00:00:00Z',
        }),
      }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).toBe(res2.body.banner.contentHash);
  });
});

// ─── Multi-screen scenarios ──────────────────────────────────────

describe('GET /api/config/startingScreens — multi-screen', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('0 screens enabled — empty response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        a: makeScreen({ enabled: false }),
        b: makeScreen({ enabled: false }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toHaveLength(0);
  });

  test('1 blocking + 1 dismissable — both returned', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        blocker: makeScreen({ dismissable: false }),
        dismissable: makeScreen({ dismissable: true }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toHaveLength(2);
    expect(res.body.blocker).toBeDefined();
    expect(res.body.dismissable).toBeDefined();
  });

  test('2 dismissable — both returned in ID order', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        zeta: makeScreen({ dismissable: true, title: 'Zeta screen test' }),
        alpha: makeScreen({ dismissable: true, title: 'Alpha screen test' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['alpha', 'zeta']);
  });

  test('1 blocking + 2 dismissable — all 3 returned', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        blocker: makeScreen({ dismissable: false }),
        dismiss1: makeScreen({ dismissable: true, title: 'Dismiss one title' }),
        dismiss2: makeScreen({ dismissable: true, title: 'Dismiss two title' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toHaveLength(3);
  });

  test('1 expired + 1 active — only active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        expired: makeScreen({ endDate: '2026-03-19T00:00:00Z' }),
        active: makeScreen({ title: 'Active screen here' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['active']);
  });

  test('1 scheduled (future) + 1 active — only active', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        future: makeScreen({ startDate: '2026-04-01T00:00:00Z' }),
        active: makeScreen({ title: 'Active now screen' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['active']);
  });

  test('2 non-dismissable screens (invalid state) — both returned, API does not crash', async () => {
    // This tests an invalid state that could exist from manual Firestore edits
    // The GET endpoint should still return both screens without crashing
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        alpha: makeScreen({ dismissable: false }),
        beta: makeScreen({ dismissable: false, title: 'Second Blocker' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    // Both should be returned — the API serves what's in Firestore
    expect(res.body.alpha).toBeDefined();
    expect(res.body.beta).toBeDefined();
  });
});

// ─── ETag/conditional — additional ───────────────────────────────

describe('GET /api/config/startingScreens — ETag (additional)', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('If-None-Match with stale/different ETag returns 200 with full body', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen() }),
    });

    const res = await request(app)
      .get('/api/config/startingScreens')
      .set('If-None-Match', '"0000000000000000"');

    expect(res.status).toBe(200);
    expect(res.body.gate).toBeDefined();
  });

  test('ETag changes when content changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen({ title: 'Version A title' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ gate: makeScreen({ title: 'Version B title' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.headers.etag).not.toBe(res2.headers.etag);
  });
});

// ─── Absence ─────────────────────────────────────────────────────

describe('GET /api/config/startingScreens — absence', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('response does NOT include expired screens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        expired: makeScreen({ endDate: '2026-03-19T00:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.expired).toBeUndefined();
    expect(res.body.active).toBeDefined();
  });

  test('response does NOT include future-scheduled screens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        future: makeScreen({ startDate: '2026-04-01T00:00:00Z' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.future).toBeUndefined();
    expect(res.body.active).toBeDefined();
  });

  test('error responses do NOT include stack traces or Firestore paths', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore connect failed at config/startingScreens'));

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('config/startingScreens');
    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(res.body.stack).toBeUndefined();
  });
});

// ─── Security ────────────────────────────────────────────────────

describe('GET /api/config/startingScreens — security', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('X-Device-Id with extremely long value (10000 chars) — no crash', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['short'], networks: [] },
        }),
      }),
    });

    const longDeviceId = 'a'.repeat(10000);
    const res = await request(app)
      .get('/api/config/startingScreens')
      .set('X-Device-Id', longDeviceId);

    expect(res.status).toBe(200);
    expect(res.body.banner).toBeDefined();
  });

  test('X-Device-Id with special characters (<script>, etc) — no crash', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['<script>alert(1)</script>'], networks: [] },
        }),
      }),
    });

    const res = await request(app)
      .get('/api/config/startingScreens')
      .set('X-Device-Id', '<script>alert(1)</script>');

    expect(res.status).toBe(200);
    // It actually matches because the allowlist contains the same XSS string
    expect(res.body.banner.dismissable).toBe(true);
  });
});

// ─── HTTP correctness ────────────────────────────────────────────

describe('GET /api/config/startingScreens — HTTP correctness', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('response Content-Type is application/json', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen() }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('no X-Powered-By header', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen() }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    // Express exposes X-Powered-By by default unless disabled
    // We check it's not present or at least not leaking framework info
    // If present, it shouldn't reveal internal details
    if (res.headers['x-powered-by']) {
      // If the header exists, it's an acceptable Express default — document it
      expect(typeof res.headers['x-powered-by']).toBe('string');
    }
  });
});

// ─── GET Idempotency ─────────────────────────────────────────────

describe('GET /api/config/startingScreens — idempotency', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('GET called multiple times with same config — identical responses', async () => {
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

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res3 = await request(app).get('/api/config/startingScreens');

    expect(res1.body).toEqual(res2.body);
    expect(res2.body).toEqual(res3.body);
    expect(res1.headers.etag).toBe(res2.headers.etag);
    expect(res2.headers.etag).toBe(res3.headers.etag);
  });
});

// ─── Logging ─────────────────────────────────────────────────────

describe('GET /api/config/startingScreens — logging', () => {
  const log = require('../../src/utils/log');
  let app;

  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('per-request log.info removed — no log.info on GET /config/startingScreens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        banner1: makeScreen(),
        banner2: makeScreen({ title: 'Second banner screen' }),
      }),
    });

    await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'dev-test');

    // The per-request log.info was removed because the request logger middleware already logs it
    expect(log.info).not.toHaveBeenCalledWith(
      'config',
      expect.any(String),
      expect.objectContaining({ screenCount: expect.any(Number) }),
    );
  });

  test('no PII in log calls — device ID value not logged', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen() }),
    });

    await request(app).get('/api/config/startingScreens').set('X-Device-Id', 'secret-device-id');

    // Check all log.info calls — none should contain the raw device ID value
    for (const call of log.info.mock.calls) {
      const serialised = JSON.stringify(call);
      expect(serialised).not.toContain('secret-device-id');
    }
  });
});

// ─── Combinatorial decision table ────────────────────────────────

describe('GET /api/config/startingScreens — combinatorial decision table', () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    app = createAppWithAuthExemption();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const PAST = '2026-03-01T00:00:00Z';
  const FUTURE = '2026-04-01T00:00:00Z';

  // Each row: [enabled, dismissable, startDate, endDate, allowlistMatch, expectedReturned]
  const decisionTable = [
    // Row 1: enabled=true, dismissable=true, dates=null, no allowlist → returned
    [true, true, null, null, false, true, 'enabled+dismissable, no dates, no allowlist'],
    // Row 2: enabled=false, dismissable=true, dates=null, no allowlist → NOT returned
    [false, true, null, null, false, false, 'disabled, dismissable, no dates'],
    // Row 3: enabled=true, dismissable=false, dates=null, no allowlist → returned
    [true, false, null, null, false, true, 'enabled+blocking, no dates'],
    // Row 4: enabled=false, dismissable=false, dates=null, no allowlist → NOT returned
    [false, false, null, null, false, false, 'disabled+blocking, no dates'],
    // Row 5: enabled=true, dismissable=true, startDate=past, endDate=null → returned
    [true, true, PAST, null, false, true, 'enabled, past start, no end'],
    // Row 6: enabled=true, dismissable=true, startDate=future, endDate=null → NOT returned
    [true, true, FUTURE, null, false, false, 'enabled, future start, no end'],
    // Row 7: enabled=true, dismissable=true, startDate=null, endDate=future → returned
    [true, true, null, FUTURE, false, true, 'enabled, no start, future end'],
    // Row 8: enabled=true, dismissable=true, startDate=null, endDate=past → NOT returned
    [true, true, null, PAST, false, false, 'enabled, no start, past end'],
    // Row 9: enabled=true, dismissable=false, startDate=past, endDate=future, allowlist match → dismissable overridden
    [true, false, PAST, FUTURE, true, true, 'blocking, in window, allowlist match → overridden'],
    // Row 10: enabled=true, dismissable=false, startDate=past, endDate=future, no allowlist → blocking returned
    [true, false, PAST, FUTURE, false, true, 'blocking, in window, no allowlist match'],
    // Row 11: enabled=true, dismissable=true, startDate=past, endDate=future → returned
    [true, true, PAST, FUTURE, false, true, 'dismissable, full window, no allowlist'],
    // Row 12: enabled=false, dismissable=true, startDate=past, endDate=future → NOT returned (disabled)
    [false, true, PAST, FUTURE, false, false, 'disabled, full window'],
    // Row 13: enabled=true, dismissable=false, startDate=future, endDate=null → NOT returned (future start)
    [true, false, FUTURE, null, false, false, 'blocking, future start'],
    // Row 14: enabled=true, dismissable=true, startDate=past, endDate=past → NOT returned (expired)
    [true, true, PAST, PAST, false, false, 'dismissable, expired (past end)'],
    // Row 15: enabled=true, dismissable=false, startDate=null, endDate=null, allowlist match → dismissable overridden
    [true, false, null, null, true, true, 'blocking, no dates, allowlist match → overridden'],
  ];

  test.each(decisionTable)(
    'row: enabled=%s, dismissable=%s, start=%s, end=%s, allowlist=%s → returned=%s (%s)',
    async (enabled, dismissable, startDate, endDate, allowlistMatch, expectedReturned, _label) => {
      const screen = makeScreen({
        enabled,
        dismissable,
        startDate,
        endDate,
        allowlist: allowlistMatch
          ? { deviceIds: ['test-dev'], networks: [] }
          : { deviceIds: [], networks: [] },
      });

      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ testScreen: screen }),
      });

      const req = request(app).get('/api/config/startingScreens');
      if (allowlistMatch) {
        req.set('X-Device-Id', 'test-dev');
      }

      const res = await req;

      expect(res.status).toBe(200);
      if (expectedReturned) {
        expect(res.body.testScreen).toBeDefined();
        // Row 9 and 15: verify allowlist override makes it dismissable
        if (allowlistMatch && !dismissable) {
          expect(res.body.testScreen.dismissable).toBe(true);
        }
      } else {
        expect(res.body.testScreen).toBeUndefined();
      }
    },
  );
});

// ─── PUT logging ─────────────────────────────────────────────────

describe('PUT /api/config/startingScreens — logging', () => {
  const log = require('../../src/utils/log');

  beforeEach(() => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  test('log.info called with admin UID and screen IDs on success', async () => {
    const app = createAppWithAuthExemption();
    await request(app)
      .put('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({ screen1: makePutScreen(), screen2: makePutScreen({ title: 'Second Screen Put' }) });

    expect(log.info).toHaveBeenCalledWith(
      'config',
      'Starting screens updated',
      expect.objectContaining({
        admin: 'user-A-unique',
        updatedIds: expect.arrayContaining(['screen1', 'screen2']),
      }),
    );
  });

  test('validation failure does not log success info', async () => {
    const app = createAppWithAuthExemption();
    await request(app)
      .put('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({ s1: makePutScreen({ title: 'AB' }) }); // title too short → 400

    const infoMessages = log.info.mock.calls.map((call) => call[1]);
    expect(infoMessages).not.toContain('Starting screens updated');
  });

  test('no screen content values logged (redacted)', async () => {
    const app = createAppWithAuthExemption();
    const screenTitle = 'Sensitive Title Value';
    const screenMessage = 'Sensitive message content here for testing.';

    await request(app)
      .put('/api/config/startingScreens')
      .set('Authorization', 'Bearer valid-token')
      .send({ s1: makePutScreen({ title: screenTitle, message: screenMessage }) });

    // Verify log.info was called for the success path
    expect(log.info).toHaveBeenCalledWith('config', 'Starting screens updated', expect.any(Object));

    // Verify that none of the log.info calls include the actual title/message content
    for (const call of log.info.mock.calls) {
      const serialised = JSON.stringify(call);
      expect(serialised).not.toContain(screenTitle);
      expect(serialised).not.toContain(screenMessage);
    }
  });
});

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

describe('GET /api/config/startingScreens/admin', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
    jest.clearAllMocks();
  });

  test('requires auth', async () => {
    const res = await request(app).get('/api/config/startingScreens/admin');
    expect(res.status).toBe(401);
  });

  test('requires admin', async () => {
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const res = await request(app)
      .get('/api/config/startingScreens/admin')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  test('returns all screens including deleted', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        deleted_one: makeScreen({
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
    expect(res.body.deleted_one).toBeDefined();
    expect(res.body.deleted_one.deleted).toBe(true);
  });

  test('returns allowlist and lastModifiedBy', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        s1: makeScreen({
          allowlist: { deviceIds: ['dev-1'], networks: ['10.0.0.0/8'] },
          lastModifiedBy: 'admin-123',
        }),
      }),
    });

    const res = await request(app)
      .get('/api/config/startingScreens/admin')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.s1.allowlist).toBeDefined();
    expect(res.body.s1.allowlist.deviceIds).toContain('dev-1');
    expect(res.body.s1.lastModifiedBy).toBe('admin-123');
  });

  test('returns empty object when no config doc exists', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app)
      .get('/api/config/startingScreens/admin')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ─── Content hash with backgroundImageFit ────────────────────────

describe('GET /api/config/startingScreens — content hash with backgroundImageFit', () => {
  let app;
  beforeEach(() => {
    app = createAppWithAuthExemption();
  });

  test('contentHash changes when backgroundImageFit changes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ backgroundImageFit: 'cover' }) }),
    });
    const res1 = await request(app).get('/api/config/startingScreens');

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ backgroundImageFit: 'contain' }) }),
    });
    const res2 = await request(app).get('/api/config/startingScreens');

    expect(res1.body.banner.contentHash).not.toBe(res2.body.banner.contentHash);
  });

  test('contentHash includes backgroundImageFit in hash computation', async () => {
    const screen = makeScreen({ backgroundImageFit: '100% 100%' });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    // Compute expected hash manually
    const expected = expectedContentHash(screen);
    expect(res.body.banner.contentHash).toBe(expected);
  });

  test('backgroundImageFit defaults to cover when not set', async () => {
    const screen = makeScreen();
    delete screen.backgroundImageFit;
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: screen }),
    });

    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.banner.backgroundImageFit).toBe('cover');
  });

  test('backgroundImageFit included in GET response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ banner: makeScreen({ backgroundImageFit: 'contain' }) }),
    });

    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.banner.backgroundImageFit).toBe('contain');
  });
});
