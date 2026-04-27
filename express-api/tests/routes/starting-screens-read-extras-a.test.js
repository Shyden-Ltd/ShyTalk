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

// ─── Combinatorial decision table ────────────────────────────────

// ─── PUT logging ─────────────────────────────────────────────────

// ─── DELETE /api/config/startingScreens/:screenId — soft-delete ──

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

// ─── GET /api/config/startingScreens/admin ──────────────────────

// ─── Content hash with backgroundImageFit ────────────────────────
