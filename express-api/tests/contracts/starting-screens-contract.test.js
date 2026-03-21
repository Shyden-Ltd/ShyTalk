/**
 * Starting Screens API — frozen response shape contract tests.
 *
 * These tests freeze the JSON shapes returned by GET and PUT
 * /api/config/startingScreens so that any breaking change to the
 * response structure is caught before it reaches the Kotlin client.
 *
 * Tests assert that specific fields EXIST with the correct TYPE.
 * They do NOT assert specific values; fixture data may vary freely.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ─────────────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({ get: mockDocGet, set: mockDocSet })),
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
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// firestore-helpers is imported by config.js (for gifts/coin-packages/broadcasts)
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

// ─── Router ────────────────────────────────────────────────────────────────

const configRouter = require('../../src/routes/config');

// ─── App factory ───────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: 'admin1',
      uniqueId: 'admin-1',
      isAdmin: true,
      token: { admin: true },
    };
    next();
  });
  app.use('/api', configRouter);
  return app;
}

// ─── Screen fixture builder ────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockDocSet.mockResolvedValue();
});

// ─── GET response shape ────────────────────────────────────────────────────

describe('GET /api/config/startingScreens — frozen response shape', () => {
  let app;
  let screen;

  beforeEach(() => {
    app = createApp();
    screen = makeScreen();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: screen }),
    });
  });

  it('returns 200', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.status).toBe(200);
  });

  it('response body is a plain object (not null, not array)', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body).not.toBeNull();
    expect(Array.isArray(res.body)).toBe(false);
    expect(typeof res.body).toBe('object');
  });

  it('screen entry: enabled is a boolean', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.enabled).toBe('boolean');
  });

  it('screen entry: dismissable is a boolean', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.dismissable).toBe('boolean');
  });

  it('screen entry: frequency is a string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.frequency).toBe('string');
  });

  it('screen entry: template is a string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.template).toBe('string');
  });

  it('screen entry: title is a string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.title).toBe('string');
  });

  it('screen entry: message is a string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.message).toBe('string');
  });

  it('screen entry: contentHash is a string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.contentHash).toBe('string');
  });

  it('screen entry: contentHash is a 64-character hex string', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('screen entry: lastModifiedAt is a string (when set)', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.lastModifiedAt).toBe('string');
  });

  it('screen entry: lastModifiedAt is null when not set in stored data', async () => {
    const screenWithoutTimestamp = makeScreen({ lastModifiedAt: undefined });
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: screenWithoutTimestamp }),
    });
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.lastModifiedAt).toBeNull();
  });

  it('screen entry: imageType is a string when set', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.imageType).toBe('string');
  });

  it('screen entry: imageType is null when not set', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: makeScreen({ imageType: null }) }),
    });
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.imageType).toBeNull();
  });

  it('screen entry: backgroundImage is null when not set', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.backgroundImage).toBeNull();
  });

  it('screen entry: backgroundImage is a string when set', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: makeScreen({ backgroundImage: 'https://example.com/bg.png' }) }),
    });
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.backgroundImage).toBe('string');
  });

  it('screen entry: startDate is null when not set', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.startDate).toBeNull();
  });

  it('screen entry: startDate is a string when set', async () => {
    // Use a past startDate so the screen is still active
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: makeScreen({ startDate: '2026-01-01T00:00:00Z' }) }),
    });
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.startDate).toBe('string');
  });

  it('screen entry: endDate is null when not set', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(res.body.screen1.endDate).toBeNull();
  });

  it('screen entry: endDate is a string when set', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: makeScreen({ endDate: '2099-01-01T00:00:00Z' }) }),
    });
    const res = await request(app).get('/api/config/startingScreens');
    expect(typeof res.body.screen1.endDate).toBe('string');
  });

  // ─── Exact field set (catches unexpected additions/removals) ─────────

  it('screen entry: contains exactly the expected set of keys', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect(Object.keys(res.body.screen1).sort()).toEqual([
      'backgroundImage',
      'backgroundImageFit',
      'contentHash',
      'dismissable',
      'enabled',
      'endDate',
      'frequency',
      'imageType',
      'lastModifiedAt',
      'message',
      'startDate',
      'template',
      'title',
    ]);
  });

  // ─── Fields that MUST NOT be present ──────────────────────────────────

  it('screen entry: allowlist is NOT present in GET response', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect('allowlist' in res.body.screen1).toBe(false);
  });

  it('screen entry: lastModifiedBy is NOT present in GET response', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect('lastModifiedBy' in res.body.screen1).toBe(false);
  });

  it('screen entry: deleted is NOT present in GET response', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect('deleted' in res.body.screen1).toBe(false);
  });

  it('screen entry: deletedAt is NOT present in GET response', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect('deletedAt' in res.body.screen1).toBe(false);
  });

  it('screen entry: deletedBy is NOT present in GET response', async () => {
    const res = await request(app).get('/api/config/startingScreens');
    expect('deletedBy' in res.body.screen1).toBe(false);
  });
});

// ─── Public GET excludes deleted screens ────────────────────────────────────

describe('GET /api/config/startingScreens — deleted screens excluded from public response', () => {
  it('soft-deleted screen does NOT appear in public GET response', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen(),
        removed: makeScreen({
          deleted: true,
          deletedAt: '2026-03-20T00:00:00Z',
          deletedBy: 'admin-1',
        }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.active).toBeDefined();
    expect(res.body.removed).toBeUndefined();
  });

  it('all screens deleted results in empty response', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        s1: makeScreen({ deleted: true, deletedAt: '2026-03-20T00:00:00Z', deletedBy: 'admin-1' }),
        s2: makeScreen({ deleted: true, deletedAt: '2026-03-20T00:00:00Z', deletedBy: 'admin-1' }),
      }),
    });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toHaveLength(0);
  });
});

// ─── GET empty config contract ─────────────────────────────────────────────

describe('GET /api/config/startingScreens — empty config shape', () => {
  it('returns {} (empty object) when no config doc exists', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('empty config: response is not null', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body).not.toBeNull();
  });

  it('empty config: response is not an array', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app).get('/api/config/startingScreens');

    expect(Array.isArray(res.body)).toBe(false);
  });
});

// ─── PUT success response shape ───────────────────────────────────────────

describe('PUT /api/config/startingScreens — success response shape', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    // Existing state: no existing screens
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
  });

  it('returns 200', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });
    expect(res.status).toBe(200);
  });

  it('success response: success is boolean true', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });
    expect(res.body.success).toBe(true);
  });

  it('success response: updated is an array', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });
    expect(Array.isArray(res.body.updated)).toBe(true);
  });

  it('success response: updated contains the screen id that was saved', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });
    expect(res.body.updated).toContain('screen1');
  });

  it('success response: updated contains all ids when multiple screens are sent', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({
        screen1: makeScreen(),
        screen2: makeScreen({ title: 'Second Screen', dismissable: true }),
      });
    expect(res.body.updated).toContain('screen1');
    expect(res.body.updated).toContain('screen2');
  });

  it('success response: does NOT contain error field', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });
    expect('error' in res.body).toBe(false);
  });
});

// ─── PUT validation error response shape ──────────────────────────────────

describe('PUT /api/config/startingScreens — validation error response shape', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 400 on validation error', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ enabled: 'yes' }) }); // wrong type
    expect(res.status).toBe(400);
  });

  it('validation error response: error is a string', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ enabled: 'yes' }) });
    expect(typeof res.body.error).toBe('string');
  });

  it('validation error response: field is a string', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ enabled: 'yes' }) });
    expect(typeof res.body.field).toBe('string');
  });

  it('validation error response: does NOT contain success field', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ enabled: 'yes' }) });
    expect('success' in res.body).toBe(false);
  });

  it('returns error with field=enabled when enabled is not boolean', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ enabled: 'yes' }) });
    expect(res.body.field).toBe('enabled');
  });

  it('returns error with field=dismissable when dismissable is not boolean', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ dismissable: 1 }) });
    expect(res.body.field).toBe('dismissable');
  });

  it('returns error with field=frequency when frequency is invalid', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ frequency: 'always' }) });
    expect(res.body.field).toBe('frequency');
  });

  it('returns error with field=template when template is invalid', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ template: 'danger' }) });
    expect(res.body.field).toBe('template');
  });

  it('returns error with field=title when title is too short', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ title: 'ab' }) });
    expect(res.body.field).toBe('title');
  });

  it('returns error with field=message when message is too short', async () => {
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen({ message: 'too short' }) });
    expect(res.body.field).toBe('message');
  });
});

// ─── PUT blocking error response shape ───────────────────────────────────

describe('PUT /api/config/startingScreens — blocking error response shape', () => {
  it('returns 409 when blocking constraint is violated', async () => {
    const app = createApp();
    // Existing: one non-dismissable screen already enabled
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    // Try to add a second non-dismissable screen
    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ newScreen: makeScreen({ enabled: true, dismissable: false }) });

    expect(res.status).toBe(409);
  });

  it('blocking error response: error is a string', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ newScreen: makeScreen({ enabled: true, dismissable: false }) });

    expect(typeof res.body.error).toBe('string');
  });

  it('blocking error response: existingBlocker is a string', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ newScreen: makeScreen({ enabled: true, dismissable: false }) });

    expect(typeof res.body.existingBlocker).toBe('string');
  });

  it('blocking error response: existingBlocker identifies the conflicting screen id', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ newScreen: makeScreen({ enabled: true, dismissable: false }) });

    // The blocker should be the pre-existing screen (not in the batch)
    expect(res.body.existingBlocker).toBe('existing');
  });

  it('blocking error response: does NOT contain success field', async () => {
    const app = createApp();
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        existing: makeScreen({ enabled: true, dismissable: false }),
      }),
    });

    const res = await request(app)
      .put('/api/config/startingScreens')
      .send({ newScreen: makeScreen({ enabled: true, dismissable: false }) });

    expect('success' in res.body).toBe(false);
  });
});

// ─── PUT stores correct shape (round-trip) ────────────────────────────────

describe('PUT then GET — round-trip shape contract', () => {
  it('PUT stores the screen, GET returns all expected fields', async () => {
    const app = createApp();

    // Step 1: PUT
    mockDocGet.mockResolvedValueOnce({ exists: false }); // GET before PUT (read existing)
    mockDocSet.mockResolvedValue();

    const putRes = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: makeScreen() });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Step 2: GET — simulate stored data (what was written by PUT)
    const storedScreen = {
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
      lastModifiedAt: expect.any(String),
    };

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        screen1: {
          ...storedScreen,
          lastModifiedAt: '2026-03-20T12:00:00Z', // concrete value for GET
        },
      }),
    });

    const getRes = await request(app).get('/api/config/startingScreens');
    expect(getRes.status).toBe(200);

    const s = getRes.body.screen1;
    expect(s).toBeDefined();

    // All required fields present with correct types
    expect(typeof s.enabled).toBe('boolean');
    expect(typeof s.dismissable).toBe('boolean');
    expect(typeof s.frequency).toBe('string');
    expect(typeof s.template).toBe('string');
    expect(typeof s.title).toBe('string');
    expect(typeof s.message).toBe('string');
    expect(typeof s.contentHash).toBe('string');
    expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof s.lastModifiedAt).toBe('string');

    // Nullable fields
    expect(s.imageType === null || typeof s.imageType === 'string').toBe(true);
    expect(s.backgroundImage === null || typeof s.backgroundImage === 'string').toBe(true);
    expect(s.startDate === null || typeof s.startDate === 'string').toBe(true);
    expect(s.endDate === null || typeof s.endDate === 'string').toBe(true);

    // Forbidden fields
    expect('allowlist' in s).toBe(false);
    expect('lastModifiedBy' in s).toBe(false);
  });

  it('stored values match sent values (title, message, template, frequency)', async () => {
    const app = createApp();

    const sentScreen = makeScreen({
      title: 'Round Trip Title',
      message: 'This is a round trip message for testing.',
      template: 'announcement',
      frequency: 'once',
    });

    // Capture what is written to Firestore
    let writtenData = null;
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockDocSet.mockImplementationOnce((data) => {
      writtenData = data;
      return Promise.resolve();
    });

    const putRes = await request(app)
      .put('/api/config/startingScreens')
      .send({ screen1: sentScreen });

    expect(putRes.status).toBe(200);
    expect(writtenData).not.toBeNull();

    const stored = writtenData.screen1;
    expect(stored.title).toBe('Round Trip Title');
    expect(stored.message).toBe('This is a round trip message for testing.');
    expect(stored.template).toBe('announcement');
    expect(stored.frequency).toBe('once');
    expect(stored.enabled).toBe(true);
    expect(stored.dismissable).toBe(false);
  });

  it('allowlist is stored internally (Firestore) but NOT returned in GET response', async () => {
    const app = createApp();

    const sentScreen = makeScreen({
      allowlist: { deviceIds: ['device-123'], networks: ['192.168.1.0/24'] },
    });

    let writtenData = null;
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockDocSet.mockImplementationOnce((data) => {
      writtenData = data;
      return Promise.resolve();
    });

    await request(app).put('/api/config/startingScreens').send({ screen1: sentScreen });

    // Confirm allowlist IS stored
    expect(writtenData.screen1.allowlist).toBeDefined();
    expect(writtenData.screen1.allowlist.deviceIds).toContain('device-123');

    // Now simulate GET — stored data includes allowlist
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ screen1: writtenData.screen1 }),
    });

    const getRes = await request(app).get('/api/config/startingScreens');

    // Confirm allowlist is NOT in the GET response
    expect('allowlist' in getRes.body.screen1).toBe(false);
  });
});
