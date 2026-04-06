/**
 * Tests for POST /api/test/create-user route.
 *
 * This route:
 *   - Is blocked in production
 *   - Requires either an X-Test-Api-Key header OR a Bearer token
 *   - Creates a user doc
 *   - Optionally skips identity graph creation (skipIdentity flag)
 *   - Returns { uid, uniqueId }
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-id-xyz'),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-create';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocSet.mockResolvedValue();
  mockDocGet.mockResolvedValue({ exists: false });
  process.env.TEST_API_KEY = VALID_API_KEY;
  // Default to non-production
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
  process.env.NODE_ENV = 'test';
});

// ═══════════════════════════════════════════════════════════════
// POST /api/test/create-user
// ═══════════════════════════════════════════════════════════════

describe('POST /api/test/create-user', () => {
  test('creates user with valid API key (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uid');
    expect(res.body).toHaveProperty('uniqueId');
    expect(typeof res.body.uid).toBe('string');
    expect(typeof res.body.uniqueId).toBe('number');
  });

  test('creates user with Bearer token (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('Authorization', 'Bearer some-valid-token')
      .send({ name: 'Bob' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uid');
    expect(res.body).toHaveProperty('uniqueId');
  });

  test('returns 403 when no credentials provided', async () => {
    const app = createApp();
    const res = await request(app).post('/api/test/create-user').send({ name: 'Charlie' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/api key or bearer/i);
  });

  test('returns 403 when wrong API key provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', 'wrong-key')
      .send({ name: 'Dave' });

    expect(res.status).toBe(403);
  });

  test('returns 403 in production environment', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Eve' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not available in production/i);
  });

  test('creates user doc and identity graph by default', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Frank' })
      .expect(200);

    // Should set user doc
    const userSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('users/'),
    );
    expect(userSetCall).toBeDefined();
    expect(userSetCall[1]).toMatchObject({
      displayName: 'Frank',
      isSuspended: false,
    });

    // Should also set identity graph doc
    const graphSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('identityGraphs/'),
    );
    expect(graphSetCall).toBeDefined();
    expect(graphSetCall[1].nodes).toBeDefined();
    expect(graphSetCall[1].nodes.length).toBe(1);
  });

  test('skips identity graph creation when skipIdentity=true', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Grace', skipIdentity: true })
      .expect(200);

    // Should set user doc
    const userSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('users/'),
    );
    expect(userSetCall).toBeDefined();

    // Should NOT set identity graph doc
    const graphSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('identityGraphs/'),
    );
    expect(graphSetCall).toBeUndefined();
  });

  test('uses default display name when name not provided', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    const userSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('users/'),
    );
    expect(userSetCall).toBeDefined();
    expect(userSetCall[1].displayName).toBe('Test User');
  });

  test('uid starts with test_noidentity_ prefix', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Heidi' });

    expect(res.status).toBe(200);
    expect(res.body.uid).toMatch(/^test_noidentity_/);
  });

  test('uniqueId is in range [900000000, 999999999]', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Ivan' });

    expect(res.status).toBe(200);
    expect(res.body.uniqueId).toBeGreaterThanOrEqual(900000000);
    expect(res.body.uniqueId).toBeLessThan(1000000000);
  });

  test('identity graph node label is the uniqueId string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/create-user')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Judy' });

    expect(res.status).toBe(200);
    const { uniqueId } = res.body;

    const graphSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('identityGraphs/'),
    );
    expect(graphSetCall).toBeDefined();
    const node = graphSetCall[1].nodes[0];
    expect(node.label).toBe(String(uniqueId));
    expect(node.suspended).toBe(false);
  });
});
