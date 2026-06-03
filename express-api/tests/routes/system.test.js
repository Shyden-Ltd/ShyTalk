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

// Mock log at module scope (used by both production code under test
// and the assertion in test 3). Lifting the require out of the test
// body avoids the sonarjs/no-require-or-internal-modules pattern.
const mockLog = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../src/utils/log', () => mockLog);

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
    mockServerHealth.mockRejectedValueOnce(new Error('PM2 unavailable'));

    const app = createApp();
    const res = await request(app).get('/api/system/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });

    // Flush the microtask + macrotask queue so the catch handler runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockLog.error).toHaveBeenCalledWith(
      'system',
      'serverHealth metrics check failed',
      expect.objectContaining({ error: 'PM2 unavailable' }),
    );
  });

  test('responds before awaiting serverHealth (structural fire-and-forget assertion)', async () => {
    // Replace wall-clock timing with a structural check: the heartbeat
    // response must complete BEFORE the metrics check resolves. A
    // pending Promise that we hold open simulates a slow PM2 jlist
    // (10-sec timeout). The response should arrive while that Promise
    // is still pending; the metrics check is only OBSERVABLY called
    // after we let the event loop flush, but the response has long
    // since been sent.
    let resolveSlowCheck;
    const slowMetricsPromise = new Promise((resolve) => {
      resolveSlowCheck = resolve;
    });
    mockServerHealth.mockReturnValueOnce(slowMetricsPromise);

    const app = createApp();
    const res = await request(app).get('/api/system/health');

    // The supertest await resolved → response was sent. The metrics
    // check is still pending. If the handler awaited serverHealth, the
    // supertest await would not have resolved yet.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });

    // Cleanup the dangling Promise so Jest doesn't warn about open handles.
    resolveSlowCheck();
    await slowMetricsPromise;
  });
});
