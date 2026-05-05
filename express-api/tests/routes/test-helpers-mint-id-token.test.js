/**
 * Tests for POST /api/test/mint-id-token (Phase 3 PR B).
 *
 * Verifies the route correctly:
 *   - Gates on production (403)
 *   - Gates on TEST_API_KEY (403)
 *   - Validates uid (400)
 *   - Mints a custom token via Admin SDK
 *   - Exchanges custom token for ID token via Auth Emulator REST
 *   - Returns the ID token to the caller
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockCreateCustomToken = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(),
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  auth: {
    createCustomToken: (...args) => mockCreateCustomToken(...args),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'gen-id'),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

// Stub global fetch (Node 18+ has native fetch). Each test overrides
// per-call as needed.
let mockFetchResponse;
beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCustomToken.mockReset();
  process.env.TEST_API_KEY = VALID_API_KEY;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIREBASE_WEB_API_KEY;
  // Default fetch returns 200 with idToken
  mockFetchResponse = {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ idToken: 'test-id-token-abc' }),
    text: jest.fn().mockResolvedValue(''),
  };
  global.fetch = jest.fn().mockImplementation(() => Promise.resolve(mockFetchResponse));
});

afterEach(() => {
  delete global.fetch;
});

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /api/test/mint-id-token', () => {
  test('returns 403 when NODE_ENV=production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = createApp();
      const res = await request(app)
        .post('/api/test/mint-id-token')
        .set('x-test-api-key', VALID_API_KEY)
        .send({ uid: 'test-uid' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Not available in production/i);
      expect(mockCreateCustomToken).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  test('returns 403 when TEST_API_KEY missing on server', async () => {
    delete process.env.TEST_API_KEY;
    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', 'any')
      .send({ uid: 'test-uid' });

    // requireTestApiKey returns 500 if env var unset; 403 if mismatch
    expect([403, 500]).toContain(res.status);
  });

  test('returns 403 when X-Test-API-Key header is wrong', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', 'wrong-key')
      .send({ uid: 'test-uid' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invalid test API key/i);
  });

  test('returns 400 when uid is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid.*required/i);
  });

  test('returns 400 when uid is not a string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid.*string/i);
  });

  test('returns 200 with idToken on happy path', async () => {
    mockCreateCustomToken.mockResolvedValue('mock-custom-token');

    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 'test-uid-happy' });

    expect(res.status).toBe(200);
    expect(res.body.idToken).toBe('test-id-token-abc');
    expect(mockCreateCustomToken).toHaveBeenCalledWith('test-uid-happy');
    // Verify fetch was called with the emulator REST URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9099'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('uses FIREBASE_AUTH_EMULATOR_HOST env override when set', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'custom-host:9999';
    mockCreateCustomToken.mockResolvedValue('mock-custom-token');

    const app = createApp();
    await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 'test-uid' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('custom-host:9999'),
      expect.any(Object),
    );
  });

  test('returns 502 when emulator REST exchange fails', async () => {
    mockCreateCustomToken.mockResolvedValue('mock-custom-token');
    mockFetchResponse.ok = false;
    mockFetchResponse.status = 400;
    mockFetchResponse.text = jest.fn().mockResolvedValue('INVALID_CUSTOM_TOKEN');

    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 'test-uid' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Failed to exchange/i);
    expect(res.body.details).toMatch(/INVALID_CUSTOM_TOKEN/);
  });

  test('returns 502 when emulator returns no idToken', async () => {
    mockCreateCustomToken.mockResolvedValue('mock-custom-token');
    mockFetchResponse.json = jest.fn().mockResolvedValue({}); // missing idToken

    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 'test-uid' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/did not return idToken/i);
  });

  test('returns 500 when createCustomToken throws', async () => {
    mockCreateCustomToken.mockRejectedValue(new Error('Admin SDK down'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/mint-id-token')
      .set('x-test-api-key', VALID_API_KEY)
      .send({ uid: 'test-uid' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Admin SDK down/);
  });
});
