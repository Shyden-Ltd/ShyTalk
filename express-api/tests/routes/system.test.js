const express = require('express');
const request = require('supertest');

// Mock the serverHealth cron-style worker so we can assert it was
// invoked async without actually exercising PM2 / system memory.
const mockServerHealth = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/cron/serverHealth', () => mockServerHealth);

// Mock alertManager — its real init touches Firestore which we don't
// need for the heartbeat endpoint's contract.
jest.mock('../../src/utils/alertManagerInstance', () => ({
  send: jest.fn(),
  createAlert: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const systemRouter = require('../../src/routes/system');

function createApp() {
  const app = express();
  app.use('/api', systemRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerHealth.mockResolvedValue(undefined);
});

describe('GET /api/system/health', () => {
  test('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/system/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('async-fires the serverHealth metrics check', async () => {
    const app = createApp();
    await request(app).get('/api/system/health');

    // Heartbeat returns 200 before the metrics check resolves; flush
    // the microtask queue so the fire-and-forget invocation is observed.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockServerHealth).toHaveBeenCalledTimes(1);
  });

  test('returns 200 even when serverHealth rejects (logged, not surfaced)', async () => {
    const log = require('../../src/utils/log');
    mockServerHealth.mockRejectedValueOnce(new Error('PM2 unavailable'));

    const app = createApp();
    const res = await request(app).get('/api/system/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });

    // Flush the microtask + macrotask queue so the catch handler runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(log.error).toHaveBeenCalledWith(
      'system',
      'serverHealth metrics check failed',
      expect.objectContaining({ error: 'PM2 unavailable' }),
    );
  });

  test('responds quickly without awaiting serverHealth', async () => {
    // Simulate a slow serverHealth (e.g., PM2 jlist hanging at the
    // 10-sec timeout). Heartbeat should still return promptly.
    let resolveSlowCheck;
    mockServerHealth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSlowCheck = resolve;
      }),
    );

    const app = createApp();
    const start = Date.now();
    const res = await request(app).get('/api/system/health');
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // The endpoint should not block on the metrics check — 100ms is a
    // generous bound for a local supertest call.
    expect(elapsed).toBeLessThan(100);

    // Cleanup so the pending Promise doesn't dangle.
    resolveSlowCheck();
  });
});
