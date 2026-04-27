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

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

// ─── GET /api/config/startingScreens/admin ──────────────────────

// ─── Content hash with backgroundImageFit ────────────────────────
