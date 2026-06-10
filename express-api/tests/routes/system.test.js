const express = require('express');
const request = require('supertest');

// Mock the serverHealth cron-style worker so we can assert it was
// invoked async without actually exercising PM2 / system memory.
const mockServerHealth = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/cron/serverHealth', () => mockServerHealth);

// Mock the accountDeletion cron-style worker the same way — the
// sweep-account-deletions endpoint awaits this function synchronously.
const mockAccountDeletion = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/cron/accountDeletion', () => mockAccountDeletion);

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

// Pre-set a known secret so requireSystemAuth can validate. Stored
// reference so test cleanup restores the env's prior state.
const TEST_SECRET = 'test-shared-secret-for-sweep-endpoints';
let originalSecret;

beforeAll(() => {
  originalSecret = process.env.SYSTEM_SHARED_SECRET;
  process.env.SYSTEM_SHARED_SECRET = TEST_SECRET;
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.SYSTEM_SHARED_SECRET;
  } else {
    process.env.SYSTEM_SHARED_SECRET = originalSecret;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockServerHealth.mockResolvedValue(undefined);
  mockAccountDeletion.mockResolvedValue(undefined);
});

afterEach(() => {
  // Scrub any leaked in-flight flag from a Jest-aborted test
  // (e.g. testTimeout fires while a `mockReturnValueOnce(pending)`
  // Promise is held open and `finally` never runs). Without this,
  // a single timeout would cascade 409s across every subsequent test
  // in the suite. Per `[[feedback-test-isolation-no-leaks]]`.
  if (typeof systemRouter._resetInFlightForTesting === 'function') {
    systemRouter._resetInFlightForTesting();
  }
});

describe('GET /api/system/health', () => {
  test('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/system/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', translationQueueLength: 0 });
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
    expect(res.body).toEqual({ status: 'ok', translationQueueLength: 0 });

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
    expect(res.body).toEqual({ status: 'ok', translationQueueLength: 0 });

    // Cleanup the dangling Promise so Jest doesn't warn about open handles.
    resolveSlowCheck();
    await slowMetricsPromise;
  });
});

describe('POST /api/system/sweep-account-deletions', () => {
  test('returns 401 without bearer token', async () => {
    const app = createApp();
    const res = await request(app).post('/api/system/sweep-account-deletions');

    expect(res.status).toBe(401);
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('returns 401 with wrong bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', 'Bearer wrong-secret');

    expect(res.status).toBe(401);
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('returns 200 and invokes accountDeletion with correct secret', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when accountDeletion throws', async () => {
    mockAccountDeletion.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp();
    const res = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'sweep failed' });
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
    // Verify the error was logged so ops sees the failure.
    expect(mockLog.error).toHaveBeenCalledWith(
      'system',
      'sweep-account-deletions failed',
      expect.objectContaining({ error: 'Firestore down' }),
    );
  });

  test('returns 409 when a concurrent sweep is in flight', async () => {
    // Hold the first sweep open with a pending Promise. The second
    // request should bounce off the in-flight guard with 409 before
    // accountDeletion is called a second time.
    let resolveFirst;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockAccountDeletion.mockReturnValueOnce(firstPromise);

    const app = createApp();

    // Supertest's Test is lazy: HTTP doesn't fire until `.then()`,
    // `.end()`, or `await`. Use `.end()` with a callback Promise so
    // the first request actually starts (enters the handler, sets the
    // in-flight flag) BEFORE the second request goes out.
    let captureFirstResponse;
    const firstResponse = new Promise((resolve) => {
      captureFirstResponse = resolve;
    });
    request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .end((err, res) => captureFirstResponse({ err, res }));

    // Give the first request a tick to enter the handler and set
    // the in-flight flag (the accountDeletion mock is then awaiting
    // `firstPromise` which we hold open).
    await new Promise((resolve) => setImmediate(resolve));

    // Second request should see the guard and 409 immediately.
    const secondRes = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);

    expect(secondRes.status).toBe(409);
    expect(secondRes.body).toEqual({ error: 'sweep already in flight' });
    // accountDeletion was only invoked by the first request.
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);

    // Let the first sweep complete cleanly.
    resolveFirst();
    const { err, res: firstRes } = await firstResponse;
    expect(err).toBeNull();
    expect(firstRes.status).toBe(200);
  });

  test('clears in-flight guard after sweep completes (allows next sweep)', async () => {
    const app = createApp();

    // First sweep succeeds.
    const first = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(first.status).toBe(200);

    // Second sweep after the first completes should also succeed
    // (guard reset by the `finally` block).
    const second = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(second.status).toBe(200);

    expect(mockAccountDeletion).toHaveBeenCalledTimes(2);
  });

  test('clears in-flight guard after sweep throws (allows next sweep)', async () => {
    mockAccountDeletion.mockRejectedValueOnce(new Error('transient Firestore')); // first call fails
    mockAccountDeletion.mockResolvedValueOnce(undefined); // second call succeeds

    const app = createApp();

    const first = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(first.status).toBe(500);

    // Guard cleared in the `finally` even on throw, so the next sweep
    // can proceed.
    const second = await request(app)
      .post('/api/system/sweep-account-deletions')
      .set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(second.status).toBe(200);

    expect(mockAccountDeletion).toHaveBeenCalledTimes(2);
  });

  test('times out and returns 500 if accountDeletion hangs forever', async () => {
    // Simulate a permanently-stuck Firestore connection — the mock
    // returns a Promise that never resolves. Without the timeout race,
    // the handler would hang and the in-flight flag would wedge forever,
    // masking the failure under the 409-as-success workflow handling.
    mockAccountDeletion.mockReturnValueOnce(new Promise(() => {}));

    // Inject a 50ms timeout for the duration of this test. The route
    // reads SWEEP_TIMEOUT_MS_OVERRIDE per-request when NODE_ENV=test,
    // so we don't need to fake the clock (which breaks supertest's
    // HTTP transport because Node's HTTP server uses libuv timers).
    process.env.SWEEP_TIMEOUT_MS_OVERRIDE = '50';

    try {
      const app = createApp();
      const res = await request(app)
        .post('/api/system/sweep-account-deletions')
        .set('Authorization', `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'sweep failed' });

      // Verify the error was logged with the timeout message.
      expect(mockLog.error).toHaveBeenCalledWith(
        'system',
        'sweep-account-deletions failed',
        expect.objectContaining({ error: expect.stringContaining('timed out') }),
      );

      // Confirm the flag was cleared so the next sweep can proceed —
      // a follow-up request with the default (instant) mock should 200.
      mockAccountDeletion.mockResolvedValueOnce(undefined);
      const next = await request(app)
        .post('/api/system/sweep-account-deletions')
        .set('Authorization', `Bearer ${TEST_SECRET}`);
      expect(next.status).toBe(200);
    } finally {
      delete process.env.SWEEP_TIMEOUT_MS_OVERRIDE;
    }
  });
});
