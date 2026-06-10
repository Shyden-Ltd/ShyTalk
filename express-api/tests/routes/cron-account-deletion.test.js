/**
 * Integration tests for POST /api/system/sweep-account-deletions (SHY-0021).
 *
 * The cron-triggered, IRREVERSIBLE account-deletion sweep — the only
 * remaining server-side scheduled job. The auth middleware has its own
 * unit tests (tests/middleware/system-auth.test.js); what was missing —
 * and what this file pins — is the ROUTE-LEVEL integration: middleware
 * wiring on the mounted route, the inFlight 409 serialization, the
 * timeout → 500 path, fail-closed 503 on missing secret, and that the
 * sweep worker actually runs exactly once on an authorized request.
 *
 * Known limitation (documented per spec): the shared-secret protocol has
 * no nonce, so a captured request CAN be replayed. Mitigation (secret
 * rotation policy) is out of scope here.
 *
 * Harness mirrors tests/routes/admin-account-deletion.test.js (supertest
 * + inline jest.mock + createApp factory; per-test env isolation).
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ───────────────────────────────────────────────────────

const mockAccountDeletion = jest.fn();
jest.mock(
  '../../src/cron/accountDeletion',
  () =>
    (...args) =>
      mockAccountDeletion(...args),
);

jest.mock('../../src/cron/serverHealth', () => jest.fn().mockResolvedValue());
jest.mock('../../src/utils/alertManagerInstance', () => ({}));

const mockLogError = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
jest.mock('../../src/utils/log', () => ({
  error: (...a) => mockLogError(...a),
  warn: (...a) => mockLogWarn(...a),
  info: (...a) => mockLogInfo(...a),
}));

// Test-only synthetic secret — never the production value (spec Security AC).
const TEST_SECRET = 'shy-0021-test-secret-not-production';
const ROUTE = '/api/system/sweep-account-deletions';

const systemRouter = require('../../src/routes/system');

// Fail loudly at load if the test-only reset hook is missing (NODE_ENV
// must be "test" when the router module is evaluated) — otherwise every
// afterEach would throw a misleading TypeError instead of one clear error.
if (typeof systemRouter._resetInFlightForTesting !== 'function') {
  throw new Error(
    'NODE_ENV must be "test" for this file — systemRouter._resetInFlightForTesting is unavailable',
  );
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', systemRouter);
  return app;
}

let app;

beforeEach(() => {
  process.env.SYSTEM_SHARED_SECRET = TEST_SECRET;
  mockAccountDeletion.mockReset().mockResolvedValue(undefined);
  app = createApp();
});

afterEach(() => {
  // Scrub the closure-captured inFlight flag so a Jest-aborted test can
  // never leak a 409 into its neighbours (feedback-test-isolation-no-leaks).
  systemRouter._resetInFlightForTesting();
  delete process.env.SYSTEM_SHARED_SECRET;
  delete process.env.SWEEP_TIMEOUT_MS_OVERRIDE;
  // No clearAllMocks here: jest.config clearMocks:true clears call counts
  // before every test; the beforeEach mockReset+mockResolvedValue sets the
  // implementation default fresh. That pair is the whole isolation contract.
});

// ─── Auth integration on the mounted route ───────────────────────

describe('auth wiring', () => {
  test('no Authorization header → 401 Missing bearer token; sweep never runs', async () => {
    const res = await request(app).post(ROUTE);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing bearer token' });
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('wrong secret → 401 Invalid bearer token; sweep never runs', async () => {
    const res = await request(app).post(ROUTE).set('Authorization', 'Bearer wrong-secret-value');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid bearer token' });
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test.each([
    ['Basic scheme with the correct secret', `Basic ${TEST_SECRET}`],
    ['empty Bearer token', 'Bearer '],
    ['Bearer with extra space-separated tokens', 'Bearer foo bar baz'],
    ['10KB secret', `Bearer ${'x'.repeat(10 * 1024)}`],
  ])('%s → 401; sweep never runs', async (_label, header) => {
    const res = await request(app).post(ROUTE).set('Authorization', header);
    expect(res.status).toBe(401);
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('missing SYSTEM_SHARED_SECRET env → 503 fail-closed; sweep never runs', async () => {
    delete process.env.SYSTEM_SHARED_SECRET;
    const res = await request(app).post(ROUTE).set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'System authentication not configured' });
    expect(mockAccountDeletion).not.toHaveBeenCalled();
  });

  test('no auth-failure response or log ever contains the secret value', async () => {
    await request(app).post(ROUTE).set('Authorization', 'Bearer wrong-secret-value');
    await request(app).post(ROUTE);
    const allLogCalls = [
      ...mockLogError.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogInfo.mock.calls,
    ];
    expect(JSON.stringify(allLogCalls)).not.toContain(TEST_SECRET);
  });
});

// ─── Authorized sweep ────────────────────────────────────────────

describe('authorized sweep', () => {
  test('correct secret → 200 {status: ok}; sweep invoked exactly once', async () => {
    const res = await request(app).post(ROUTE).set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
  });

  test('sweep throws → 500 generic body (no stack leak) + error logged', async () => {
    mockAccountDeletion.mockRejectedValueOnce(new Error('Firestore unreachable mid-sweep'));
    const res = await request(app).post(ROUTE).set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'sweep failed' });
    expect(JSON.stringify(res.body)).not.toContain('Firestore');
    expect(mockLogError).toHaveBeenCalledWith('system', 'sweep-account-deletions failed', {
      error: 'Firestore unreachable mid-sweep',
    });
  });

  test('sweep exceeding the timeout → 500 sweep failed (timeout raced)', async () => {
    process.env.SWEEP_TIMEOUT_MS_OVERRIDE = '50';
    mockAccountDeletion.mockImplementationOnce(() => new Promise(() => {}));
    const res = await request(app).post(ROUTE).set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'sweep failed' });
    expect(mockLogError).toHaveBeenCalledWith('system', 'sweep-account-deletions failed', {
      error: 'sweep timed out after 50ms',
    });
  });

  test('10 concurrent authorized requests → exactly one 200, nine 409 (inFlight guard)', async () => {
    let resolveSweep;
    mockAccountDeletion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSweep = resolve;
        }),
    );
    // supertest requests are lazy thenables — attaching .then() is what
    // dispatches them, so map through .then to start all 10 NOW.
    const settled = [];
    const inFlightRequests = Array.from({ length: 10 }, () =>
      request(app)
        .post(ROUTE)
        .set('Authorization', `Bearer ${TEST_SECRET}`)
        .then((res) => {
          settled.push(res);
          return res;
        }),
    );
    // Deterministic, no fixed sleep: release the sweep only after the
    // holder has claimed the flag AND all nine rivals have their 409.
    // 5ms × 1600 = 8s worst-case budget, inside the 10s testTimeout, so a
    // slow CI worker exhausts into a clear count-assertion, never a hang.
    for (let i = 0; i < 1600 && !(resolveSweep && settled.length === 9); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(typeof resolveSweep).toBe('function');
    expect(settled).toHaveLength(9);
    resolveSweep();
    const responses = await Promise.all(inFlightRequests);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(r.body).toEqual({ error: 'sweep already in flight' });
    }
    expect(mockAccountDeletion).toHaveBeenCalledTimes(1);
  });
});

// ─── Workflow ↔ route contract ───────────────────────────────────

describe('cron workflow contract', () => {
  test('cron-account-deletion.yml sends the same env var the middleware validates', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const workflow = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '.github',
        'workflows',
        'cron-account-deletion.yml',
      ),
      'utf-8',
    );
    // Drift here means the workflow sends one secret while the route
    // validates another — both halves working, together broken.
    expect(workflow).toContain('SYSTEM_SHARED_SECRET');
    expect(workflow).toContain('/api/system/sweep-account-deletions');
  });
});
