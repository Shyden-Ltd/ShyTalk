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

// ─── Absence ─────────────────────────────────────────────────────

// ─── Security ────────────────────────────────────────────────────

// ─── HTTP correctness ────────────────────────────────────────────

// ─── GET Idempotency ─────────────────────────────────────────────

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

// ─── DELETE /api/config/startingScreens/:screenId — soft-delete ──

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

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
