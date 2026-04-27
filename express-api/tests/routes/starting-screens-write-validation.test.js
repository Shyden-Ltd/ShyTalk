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

// ─── DELETE with ?permanent=true — hard-delete ───────────────────

// ─── POST /api/config/startingScreens/:screenId/restore ─────────

// ─── GET /api/config/startingScreens/admin ──────────────────────

// ─── Content hash with backgroundImageFit ────────────────────────
