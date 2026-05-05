/**
 * Tests for the FCM-capture test-helper endpoints (added alongside Phase 3 PR J).
 *
 * GET  /api/test/fcm-captures        → returns buffered captures
 * POST /api/test/fcm-captures/clear  → empties the buffer
 *
 * Both gated on the X-Test-Api-Key header.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase + fcm mocks ────────────────────────────────────────

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

const mockGetFcmCaptures = jest.fn();
const mockClearFcmCaptures = jest.fn();
jest.mock('../../src/utils/fcm', () => ({
  getFcmCaptures: (...args) => mockGetFcmCaptures(...args),
  clearFcmCaptures: (...args) => mockClearFcmCaptures(...args),
}));

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
  mockGetFcmCaptures.mockReturnValue([]);
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

// ─── Tests ────────────────────────────────────────────────────────

describe('GET /api/test/fcm-captures', () => {
  test('returns the buffer wrapped in {captures: [...]}', async () => {
    const fakeCaptures = [
      { tokens: ['t1'], data: { type: 'PM' }, ts: 123 },
      { tokens: ['t2', 't3'], data: { type: 'GIFT' }, ts: 456 },
    ];
    mockGetFcmCaptures.mockReturnValue(fakeCaptures);

    const res = await request(createApp())
      .get('/api/test/fcm-captures')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .expect(200);

    expect(res.body).toEqual({ captures: fakeCaptures });
    expect(mockGetFcmCaptures).toHaveBeenCalledTimes(1);
  });

  test('returns 403 without X-Test-Api-Key header', async () => {
    const res = await request(createApp()).get('/api/test/fcm-captures').expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockGetFcmCaptures).not.toHaveBeenCalled();
  });

  test('returns 403 with wrong X-Test-Api-Key header', async () => {
    const res = await request(createApp())
      .get('/api/test/fcm-captures')
      .set('X-Test-Api-Key', 'wrong-key')
      .expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockGetFcmCaptures).not.toHaveBeenCalled();
  });
});

describe('POST /api/test/fcm-captures/clear', () => {
  test('calls clearFcmCaptures and returns success:true', async () => {
    const res = await request(createApp())
      .post('/api/test/fcm-captures/clear')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body).toEqual({ success: true });
    expect(mockClearFcmCaptures).toHaveBeenCalledTimes(1);
  });

  test('returns 403 without X-Test-Api-Key header', async () => {
    const res = await request(createApp())
      .post('/api/test/fcm-captures/clear')
      .send({})
      .expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockClearFcmCaptures).not.toHaveBeenCalled();
  });
});
