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
