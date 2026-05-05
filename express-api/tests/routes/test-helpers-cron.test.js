/**
 * Tests for the test-helper cron-trigger endpoint (Phase 3 PR K).
 *
 * POST /api/test/run-cron/:cronName → manually invoke a whitelisted
 *   cron job. Whitelist enforced; 400 on unknown name; 403 in
 *   production; 500 on cron-internal error.
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(),
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  auth: { createCustomToken: jest.fn() },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'gen-id'),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock the cron module — the test-helpers route requires it via
// `require('../cron/accountDeletion')` and the result is assigned
// into the ALLOWED_CRONS map at module-load time.
const mockAccountDeletion = jest.fn();
jest.mock('../../src/cron/accountDeletion', () => mockAccountDeletion);

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TEST_API_KEY = VALID_API_KEY;
  mockAccountDeletion.mockResolvedValue();
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /api/test/run-cron/:cronName', () => {
  test('runs the whitelisted cron and returns success:true', async () => {
    const res = await request(createApp())
      .post('/api/test/run-cron/account-deletion')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body).toEqual({ success: true });
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
  });

  test('returns 400 for an unknown cron name with available list', async () => {
    const res = await request(createApp())
      .post('/api/test/run-cron/totally-fake-cron')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/not allowed/i);
    expect(res.body.error).toMatch(/account-deletion/);
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('returns 403 in production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(createApp())
        .post('/api/test/run-cron/account-deletion')
        .set('X-Test-Api-Key', VALID_API_KEY)
        .send({})
        .expect(403);

      expect(res.body.error).toMatch(/Not available in production/i);
      expect(mockAccountDeletion).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  test('returns 403 without X-Test-Api-Key header', async () => {
    const res = await request(createApp())
      .post('/api/test/run-cron/account-deletion')
      .send({})
      .expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('returns 500 when the cron throws', async () => {
    mockAccountDeletion.mockRejectedValue(new Error('Firestore down'));

    const res = await request(createApp())
      .post('/api/test/run-cron/account-deletion')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(500);

    expect(res.body.error).toBe('Firestore down');
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
  });
});
