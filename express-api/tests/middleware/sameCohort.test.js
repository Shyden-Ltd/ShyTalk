/**
 * Tests for `middleware/sameCohort.js` — the cross-cohort gate that
 * UK OSA #17 PR 4 wires into all user-to-user Express endpoints.
 *
 * Contract pinned by these tests:
 *   1. Same-cohort caller → not blocked, no audit doc written.
 *   2. Cross-cohort caller → 404 with body `{ error: 'Not found' }`
 *      AND a `segregationEvents` audit doc with the full pair.
 *   3. Admin caller → always allowed, no audit doc.
 *   4. Target user with `cohortOverride` is honoured (override wins).
 *   5. Target user missing → 404 with same `{ error: 'Not found' }`
 *      body. Byte-identical to the cross-cohort 404 — that's the
 *      existence-hiding semantic (no shape leak between "not there"
 *      and "wrong cohort").
 *   6. Stripped/invalid caller cohort claim → treated as 'minor'
 *      (defensive fail-closed via `cohortFromClaim`).
 *   7. Audit write failure → response is STILL 404 and `log.error`
 *      is called (fire-and-forget; we never leak the audit failure
 *      to the caller).
 *   8. Surface tag captures the URL contour for aggregation.
 */

// ─── Firebase + logger + isLiveAdmin mocks ──────────────────────

const mockAdd = jest.fn();
const mockCollection = jest.fn(() => ({ add: mockAdd }));
const mockIsLiveAdmin = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');
const {
  requireSameCohort,
  writeSegregationEvent,
  _resetAuditDedup,
} = require('../../src/middleware/sameCohort');

// ─── Helpers ────────────────────────────────────────────────────

function mockReq(overrides = {}) {
  const hasRoute = Object.prototype.hasOwnProperty.call(overrides, 'route');
  const { auth = {}, baseUrl = '/api', path = '/users/200/follow', route, id, ...rest } = overrides;
  return {
    auth: { uniqueId: 1, token: { cohort: 'adult' }, ...auth },
    baseUrl,
    path,
    route: hasRoute ? route : { path: '/users/:uniqueId/follow' },
    id,
    ...rest,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdd.mockReset();
  mockAdd.mockResolvedValue({ id: 'evt_abc' });
  mockCollection.mockClear();
  log.error.mockReset();
  // Default: admin claim = real admin. Tests that need the demoted-
  // admin case explicitly override mockIsLiveAdmin.mockResolvedValueOnce(false).
  mockIsLiveAdmin.mockReset();
  mockIsLiveAdmin.mockResolvedValue(true);
  // Reset the dedup LRU between tests so audit-write counts are
  // independent.
  _resetAuditDedup();
});

// ─── Core contract ──────────────────────────────────────────────

describe('requireSameCohort — same-cohort allow path', () => {
  test('returns false (not blocked) when caller + target are both adult', async () => {
    const req = mockReq();
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'adult' }));

    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('returns false when caller + target are both minor', async () => {
    const req = mockReq({ auth: { uniqueId: 50, token: { cohort: 'minor' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 51, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('requireSameCohort — cross-cohort block path', () => {
  test('adult → minor target: 404 + segregationEvents audit doc written', async () => {
    const req = mockReq({
      auth: { uniqueId: 1, token: { cohort: 'adult' } },
      id: 'req_xyz',
    });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });

    expect(mockCollection).toHaveBeenCalledWith('segregationEvents');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const evt = mockAdd.mock.calls[0][0];
    expect(evt).toMatchObject({
      sourceUniqueId: '1',
      sourceCohort: 'adult',
      targetUniqueId: '200',
      targetCohort: 'minor',
      action: 'blocked',
      requestId: 'req_xyz',
    });
    expect(typeof evt.timestamp).toBe('number');
    expect(typeof evt.surface).toBe('string');
    expect(evt.surface.length).toBeGreaterThan(0);
  });

  test('minor → adult target: same 404 shape (symmetry)', async () => {
    const req = mockReq({ auth: { uniqueId: 50, token: { cohort: 'minor' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 100, async () => ({ cohort: 'adult' }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      sourceCohort: 'minor',
      targetCohort: 'adult',
    });
  });

  test('captures surface tag from req.baseUrl + req.route.path', async () => {
    const req = mockReq({
      baseUrl: '/api',
      route: { path: '/users/:uniqueId/follow' },
    });
    const res = mockRes();

    await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(mockAdd.mock.calls[0][0].surface).toBe('/api/users/:uniqueId/follow');
  });

  test('surface falls back to req.path when route.path is unavailable', async () => {
    const req = mockReq({
      baseUrl: '/api',
      path: '/users/200/follow',
      route: undefined,
    });
    const res = mockRes();

    await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(mockAdd.mock.calls[0][0].surface).toBe('/api/users/200/follow');
  });

  test('requestId is null when req.id is absent', async () => {
    const req = mockReq();
    delete req.id;
    const res = mockRes();

    await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(mockAdd.mock.calls[0][0].requestId).toBeNull();
  });
});

describe('requireSameCohort — admin bypass', () => {
  test('admin caller is allowed even when target cohort differs', async () => {
    const req = mockReq({
      auth: { uid: 'fb-uid', uniqueId: 1, token: { admin: true, cohort: 'adult' } },
    });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('admin caller does not need to fetch target user', async () => {
    const fetchUser = jest.fn();
    const req = mockReq({ auth: { uid: 'fb-uid', uniqueId: 1, token: { admin: true } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, fetchUser);

    expect(blocked).toBe(false);
    expect(fetchUser).not.toHaveBeenCalled();
  });
});

describe('requireSameCohort — cohortOverride precedence', () => {
  test('target.cohortOverride beats target.cohort', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({
      cohort: 'minor',
      cohortOverride: 'adult',
    }));

    expect(blocked).toBe(false);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('invalid cohortOverride is ignored — falls back to derived cohort', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({
      cohort: 'minor',
      cohortOverride: 'super-admin',
    }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('requireSameCohort — existence-hiding', () => {
  test('missing target returns 404 with identical body to cross-cohort block', async () => {
    const req = mockReq();
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 999, async () => null);

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    // Existence-hiding: no audit write — the user genuinely does not
    // exist, so there's no cross-cohort interaction to log.
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('undefined target user (returns undefined rather than null) also 404s', async () => {
    const req = mockReq();
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 999, async () => undefined);

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});

describe('requireSameCohort — fail-closed caller claim', () => {
  test('stripped cohort claim is treated as minor; blocks against adult target', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: {} } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'adult' }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      sourceCohort: 'minor',
      targetCohort: 'adult',
    });
  });

  test('invalid cohort claim string is treated as minor', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'staff' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'adult' }));

    expect(blocked).toBe(true);
    expect(mockAdd.mock.calls[0][0].sourceCohort).toBe('minor');
  });
});

describe('requireSameCohort — fire-and-forget audit', () => {
  test('responds 404 and logs error if segregationEvents write fails', async () => {
    mockAdd.mockRejectedValueOnce(new Error('firestore offline'));
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });

    // Give the catch handler a tick to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(log.error).toHaveBeenCalledWith(
      'segregationEvents',
      'write failed',
      expect.objectContaining({ error: 'firestore offline' }),
    );
  });
});

describe('writeSegregationEvent', () => {
  test('writes to the segregationEvents collection', async () => {
    await writeSegregationEvent({
      sourceUniqueId: '1',
      sourceCohort: 'adult',
      targetUniqueId: '200',
      targetCohort: 'minor',
      surface: '/api/users/:uniqueId/follow',
      action: 'blocked',
      timestamp: 1234567890,
      requestId: null,
    });

    expect(mockCollection).toHaveBeenCalledWith('segregationEvents');
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });
});

// ─── Self-target short-circuit (MEDIUM 4) ───────────────────────

describe('requireSameCohort — self-target short-circuit', () => {
  test('caller targeting their own uniqueId is allowed without fetching', async () => {
    const fetchUser = jest.fn();
    const req = mockReq({ auth: { uniqueId: 100, token: { cohort: 'adult' } } });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 100, fetchUser);

    expect(blocked).toBe(false);
    expect(fetchUser).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('string vs number self-id mismatch is coerced (no false self-skip)', async () => {
    const fetchUser = jest.fn();
    const req = mockReq({ auth: { uniqueId: 100, token: { cohort: 'adult' } } });
    const res = mockRes();

    // String "100" should still match number 100 via String() coercion.
    const blocked = await requireSameCohort(req, res, '100', fetchUser);

    expect(blocked).toBe(false);
    expect(fetchUser).not.toHaveBeenCalled();
  });
});

// ─── Live-admin check (HIGH 2) ──────────────────────────────────

describe('requireSameCohort — live admin verification', () => {
  test('admin token AND live-admin true → bypass (no audit)', async () => {
    mockIsLiveAdmin.mockResolvedValueOnce(true);
    const req = mockReq({
      auth: { uid: 'fb-uid', uniqueId: 1, token: { admin: true, cohort: 'adult' } },
    });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(false);
    expect(mockIsLiveAdmin).toHaveBeenCalledWith('fb-uid');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('admin token BUT live-admin false (demoted) → gate fires normally', async () => {
    mockIsLiveAdmin.mockResolvedValueOnce(false);
    const req = mockReq({
      auth: { uid: 'demoted-uid', uniqueId: 1, token: { admin: true, cohort: 'adult' } },
    });
    const res = mockRes();

    const blocked = await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockIsLiveAdmin).toHaveBeenCalledWith('demoted-uid');
    await new Promise((r) => setImmediate(r));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  test('no admin claim → live check skipped entirely', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const res = mockRes();

    await requireSameCohort(req, res, 200, async () => ({ cohort: 'adult' }));

    expect(mockIsLiveAdmin).not.toHaveBeenCalled();
  });
});

// ─── Audit-write dedup (HIGH 1) ─────────────────────────────────

describe('requireSameCohort — audit-write dedup', () => {
  test('repeated cross-cohort attempts (same source/target/surface) write ONE audit doc', async () => {
    const req1 = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const req2 = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const req3 = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });

    for (const req of [req1, req2, req3]) {
      const res = mockRes();
      await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));
      expect(res.status).toHaveBeenCalledWith(404);
    }

    await new Promise((r) => setImmediate(r));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  test('distinct targets from same source each write their own audit doc', async () => {
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });

    for (const targetId of [200, 201, 202]) {
      const res = mockRes();
      await requireSameCohort(req, res, targetId, async () => ({ cohort: 'minor' }));
    }

    await new Promise((r) => setImmediate(r));
    expect(mockAdd).toHaveBeenCalledTimes(3);
  });

  test('distinct sources targeting same victim each write their own audit doc', async () => {
    for (const sourceId of [10, 11, 12]) {
      const req = mockReq({ auth: { uniqueId: sourceId, token: { cohort: 'adult' } } });
      const res = mockRes();
      await requireSameCohort(req, res, 200, async () => ({ cohort: 'minor' }));
    }

    await new Promise((r) => setImmediate(r));
    expect(mockAdd).toHaveBeenCalledTimes(3);
  });

  test('dedup does not affect the 404 response — every attempt still 404s', async () => {
    // Critical: dedup throttles AUDIT writes only. The caller MUST
    // get a 404 on every cross-cohort attempt, otherwise the gate
    // itself is bypassable post-first-write.
    const req = mockReq({ auth: { uniqueId: 1, token: { cohort: 'adult' } } });
    const res1 = mockRes();
    const res2 = mockRes();

    await requireSameCohort(req, res1, 200, async () => ({ cohort: 'minor' }));
    await requireSameCohort(req, res2, 200, async () => ({ cohort: 'minor' }));

    expect(res1.status).toHaveBeenCalledWith(404);
    expect(res2.status).toHaveBeenCalledWith(404);
  });
});

// UK OSA #17 PR 8 — `_resetAuditDedup` export hardening.
// In test env (NODE_ENV=test OR JEST_WORKER_ID set), the export is
// the real reset function. In production it's a no-op. Both branches
// must be exercised for SonarCloud coverage; the in-test branch is
// covered by every other test that calls `_resetAuditDedup`. The
// no-op branch needs an isolated module re-load with the env vars
// cleared.
describe('_resetAuditDedup export-hardening (production no-op branch)', () => {
  test('returns a no-op function in non-test env (NODE_ENV unset + JEST_WORKER_ID unset)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalJestWorkerId = process.env.JEST_WORKER_ID;
    try {
      delete process.env.NODE_ENV;
      delete process.env.JEST_WORKER_ID;
      jest.isolateModules(() => {
        const mod = require('../../src/middleware/sameCohort');
        // The function exists but is a no-op — calling it must NOT
        // throw and must NOT touch any underlying state.
        expect(typeof mod._resetAuditDedup).toBe('function');
        expect(() => mod._resetAuditDedup()).not.toThrow();
        // No return value contract — just verify it's callable.
        expect(mod._resetAuditDedup()).toBeUndefined();
      });
    } finally {
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
      if (originalJestWorkerId !== undefined) process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
  });

  test('returns the real reset function when JEST_WORKER_ID is set (Jest worker env)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      process.env.JEST_WORKER_ID = '1';
      jest.isolateModules(() => {
        const mod = require('../../src/middleware/sameCohort');
        // Calling reset should not throw — it actually resets the
        // dedup. This is the "Jest worker auto-detect" branch.
        expect(() => mod._resetAuditDedup()).not.toThrow();
      });
    } finally {
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
