/**
 * Tests for the admin cohort routes (UK OSA #17 PR 13):
 *   POST /api/user/:uniqueId/cohort-override
 *   GET  /api/admin/cohort-stats
 *
 * The cohort-override route is the admin-controlled escape hatch for
 * cohort assignment when DOB-derived cohort is wrong (test accounts,
 * staff, MC hosts whose recorded DOB is a placeholder). To stop the
 * override being weaponised against regular members, the route REFUSES
 * targets where `userType === 'MEMBER'` AND `isAdmin !== true` — only
 * staff / admin / non-MEMBER accounts may be overridden. The refusal
 * is a 422 with `error.code = 'CANNOT_OVERRIDE_REGULAR_USER'` so the
 * admin UI can distinguish it from generic 400s.
 *
 * Atomicity: the user-doc field write and the adminAuditLog entry MUST
 * commit in the same Firestore transaction. If the audit write fails,
 * the field update aborts. This is a regulatory contract — every
 * override must have a paper trail before the field is observable.
 *
 * Claim mint runs AFTER the transaction commits. A mint failure is
 * recoverable on the next pm-lock-check round-trip (the rules-layer
 * cohort gate would fall back to the cached `cohort` field until then),
 * so it does NOT abort the override.
 *
 * The stats endpoint returns aggregate counts for the admin sub-tab
 * dashboard. Uses count() aggregation queries to keep Firestore read
 * cost flat regardless of user-collection size.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxSet = jest.fn();
const mockRunTransaction = jest.fn();
const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockGetUser = jest
  .fn()
  .mockResolvedValue({ customClaims: { admin: true, uniqueId: 'target-1' } });
const mockRevokeRefreshTokens = jest.fn().mockResolvedValue();

// Aggregation-query mock state. Each call to `.count().get()` consumes
// the next item from this queue (FIFO). Tests push counts in the order
// the route is expected to issue queries.
let mockCountQueue = [];
function pushCount(n) {
  mockCountQueue.push(n);
}
const mockCountGet = jest.fn().mockImplementation(() => {
  if (mockCountQueue.length === 0) {
    return Promise.resolve({ data: () => ({ count: 0 }) });
  }
  return Promise.resolve({ data: () => ({ count: mockCountQueue.shift() }) });
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn((name) => {
      const chain = {
        _name: name,
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        count: () => ({ get: () => mockCountGet() }),
      };
      return chain;
    }),
    runTransaction: jest.fn((fn) => mockRunTransaction(fn)),
  },
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
    getUser: (...args) => mockGetUser(...args),
    revokeRefreshTokens: (...args) => mockRevokeRefreshTokens(...args),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'serverTimestamp'),
    delete: jest.fn(() => 'deleteField'),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'audit-id-1'),
  now: jest.fn(() => 1715000000000),
}));

const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../src/utils/log', () => mockLog);

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue({ successCount: 0 }),
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildDeletionScheduledEmail: jest.fn(() => ({ subject: '', html: '' })),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // allow by default
  clearSuspensionCache: jest.fn(),
  clearAdminClaimCache: jest.fn(),
}));

const { requireAdmin } = require('../../src/middleware/auth');
const { getDoc } = require('../../src/utils/firestore-helpers');

const adminUsersRouter = require('../../src/routes/admin-users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-fb-uid', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

function blockAdmin() {
  requireAdmin.mockImplementation((_req, res) => {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  });
}

function userDoc(overrides = {}) {
  return {
    uniqueId: 'target-1',
    firebaseUid: 'target-fb-uid',
    userType: 'MEMBER',
    isAdmin: false,
    dateOfBirth: 100000000, // arbitrary, valid
    cohort: 'adult',
    cohortOverride: null,
    ...overrides,
  };
}

// Default transaction harness: txGet returns the seeded doc, txUpdate/
// txSet record args. Per-test overrides can replace mockRunTransaction.
function defaultTxHarness(seedUserData) {
  mockRunTransaction.mockImplementation(async (fn) => {
    return fn({
      get: jest.fn(async (ref) => {
        if (ref._path === `users/${seedUserData.uniqueId}`) {
          return { exists: true, data: () => seedUserData, ref };
        }
        return { exists: false, data: () => null, ref };
      }),
      update: (ref, payload) => mockTxUpdate(ref._path, payload),
      set: (ref, payload) => mockTxSet(ref._path, payload),
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockTxGet.mockReset();
  mockTxUpdate.mockReset();
  mockTxSet.mockReset();
  mockRunTransaction.mockReset();
  mockSetCustomUserClaims.mockReset().mockResolvedValue();
  mockGetUser
    .mockReset()
    .mockResolvedValue({ customClaims: { admin: true, uniqueId: 'target-1' } });
  mockRevokeRefreshTokens.mockReset().mockResolvedValue();
  mockCountQueue = [];
  requireAdmin.mockReset().mockReturnValue(false);
  getDoc.mockReset().mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════
// POST /api/user/:uniqueId/cohort-override
// ═══════════════════════════════════════════════════════════════

describe('POST /api/user/:uniqueId/cohort-override', () => {
  test('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'test' });
    expect(res.status).toBe(403);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('rejects missing reason with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('rejects whitespace-only reason with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: '   \t\n' });
    expect(res.status).toBe(400);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('rejects override values not in {adult, minor, null}', async () => {
    const app = createApp();
    for (const bad of ['ADULT', 'super-admin', 'staff', '', 'children', 42, true]) {
      const res = await request(app)
        .post('/api/user/target-1/cohort-override')
        .send({ override: bad, reason: 'x' });
      expect(res.status).toBe(400);
    }
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('accepts override = null (clear) when reason is provided', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER', cohortOverride: 'adult' }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: null, reason: 'clear after staff role change' });
    expect(res.status).toBe(200);
    // Field write payload contains cohortOverride set to deleteField sentinel or null
    const writes = mockTxUpdate.mock.calls.map((c) => c[1]);
    const userWrite = writes.find(
      (p) => p && Object.prototype.hasOwnProperty.call(p, 'cohortOverride'),
    );
    expect(userWrite).toBeDefined();
    expect([null, 'deleteField']).toContain(userWrite.cohortOverride);
  });

  test('returns 404 when target user does not exist', async () => {
    mockRunTransaction.mockImplementation(async (fn) => {
      return fn({
        get: jest.fn(async (ref) => ({ exists: false, data: () => null, ref })),
        update: mockTxUpdate,
        set: mockTxSet,
      });
    });
    const app = createApp();
    const res = await request(app)
      .post('/api/user/missing/cohort-override')
      .send({ override: 'adult', reason: 'x' });
    expect(res.status).toBe(404);
  });

  test('rejects regular MEMBER target with 422 CANNOT_OVERRIDE_REGULAR_USER', async () => {
    defaultTxHarness(userDoc({ userType: 'MEMBER', isAdmin: false }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'attempted abuse' });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('CANNOT_OVERRIDE_REGULAR_USER');
    // Transaction must not write the override OR audit row for blocked target.
    expect(mockTxUpdate).not.toHaveBeenCalledWith(
      'users/target-1',
      expect.objectContaining({ cohortOverride: expect.anything() }),
    );
    expect(mockTxSet).not.toHaveBeenCalledWith(
      expect.stringMatching(/^adminAuditLog\//),
      expect.anything(),
    );
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('rejects undefined-userType target (treated as MEMBER) with 422', async () => {
    // userType missing entirely → defaults to MEMBER per normalizeUser;
    // must still be blocked, not silently allowed.
    defaultTxHarness(userDoc({ userType: undefined, isAdmin: false }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'r' });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('CANNOT_OVERRIDE_REGULAR_USER');
  });

  test('accepts MEMBER target when isAdmin === true (admin can override admin)', async () => {
    defaultTxHarness(userDoc({ userType: 'MEMBER', isAdmin: true }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'staff override' });
    expect(res.status).toBe(200);
  });

  test('accepts non-MEMBER staff target (TEACHER) with no isAdmin flag', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER', isAdmin: false }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'minor', reason: 'test account scoping' });
    expect(res.status).toBe(200);
  });

  test('field write and audit-log row commit in the SAME transaction', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER' }));
    const app = createApp();
    await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'minor', reason: 'demote for testing' })
      .expect(200);

    // Both writes must have happened. They are recorded by mockTxUpdate /
    // mockTxSet which are only invoked from inside the transaction
    // callback, not from a follow-up doc().update() outside the txn.
    const allTxnPaths = [
      ...mockTxUpdate.mock.calls.map((c) => c[0]),
      ...mockTxSet.mock.calls.map((c) => c[0]),
    ];
    expect(allTxnPaths).toEqual(
      expect.arrayContaining(['users/target-1', expect.stringMatching(/^adminAuditLog\//)]),
    );
  });

  test('audit-log entry captures action, admin, target, override, reason', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER' }));
    const app = createApp();
    await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'minor', reason: 'demote staff test account' })
      .expect(200);

    const auditCall = mockTxSet.mock.calls.find(([p]) => /^adminAuditLog\//.test(p));
    expect(auditCall).toBeDefined();
    const auditPayload = auditCall[1];
    expect(auditPayload).toMatchObject({
      adminId: 'admin-fb-uid',
      action: 'COHORT_OVERRIDE_SET',
      targetUserId: 'target-1',
      override: 'minor',
      previousOverride: null,
      reason: 'demote staff test account',
    });
    expect(typeof auditPayload.createdAt).toBe('number');
  });

  test('audit log records previousOverride when clearing existing override', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER', cohortOverride: 'adult' }));
    const app = createApp();
    await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: null, reason: 'clearing' })
      .expect(200);

    const auditCall = mockTxSet.mock.calls.find(([p]) => /^adminAuditLog\//.test(p));
    expect(auditCall[1]).toMatchObject({
      action: 'COHORT_OVERRIDE_CLEAR',
      previousOverride: 'adult',
      override: null,
    });
  });

  test('claim mint runs after transaction with new effective cohort + forceTokenRefresh', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER', dateOfBirth: 0, cohort: 'minor' }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'staff' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledTimes(1);
    const [uid, claims] = mockSetCustomUserClaims.mock.calls[0];
    expect(uid).toBe('target-fb-uid');
    expect(claims.cohort).toBe('adult');
    expect(res.body).toMatchObject({
      success: true,
      forceTokenRefresh: true,
      effectiveCohort: 'adult',
    });
  });

  test('claim mint failure does NOT roll back the override (recoverable)', async () => {
    defaultTxHarness(userDoc({ userType: 'TEACHER' }));
    mockSetCustomUserClaims.mockRejectedValue(new Error('Firebase Auth down'));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'minor', reason: 'r' });

    // Success status, but claim refresh is surfaced as `false` so the
    // admin UI can show a partial-failure banner ("override saved; user
    // will pick up new cohort on their next sign-in check").
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.forceTokenRefresh).toBe(false);
    // The field write + audit row still happened (inside the transaction).
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.stringMatching(/^adminAuditLog\//),
      expect.anything(),
    );
  });

  test('user doc missing firebaseUid → 200 success, mint skipped, forceTokenRefresh:false', async () => {
    // Legitimately possible state: user doc was created before the
    // firebaseUid backfill. The override doc-write must still commit;
    // the claim mint silently skips with a WARN log (review C1).
    defaultTxHarness(userDoc({ userType: 'TEACHER', firebaseUid: undefined }));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'minor', reason: 'unbackfilled account' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.forceTokenRefresh).toBe(false);
    // Mint was never attempted because firebaseUid was absent.
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    // Audit row + field write still landed inside the transaction.
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.stringMatching(/^adminAuditLog\//),
      expect.anything(),
    );
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/target-1',
      expect.objectContaining({ cohortOverride: 'minor' }),
    );
    // SIEM discriminator (security review): missing-firebaseUid path logs
    // WARN with `reason: 'unbackfilled'` — distinct from a real mint failure
    // which uses `reason: 'mint_error'`. This lets alerting rules page on
    // mint failures without firing on the benign backfill-gap path.
    expect(mockLog.warn).toHaveBeenCalledWith(
      'admin-users',
      expect.stringContaining('missing firebaseUid'),
      expect.objectContaining({ reason: 'unbackfilled' }),
    );
  });

  test('audit-log createdAt equals user-doc cohortOverrideUpdatedAt (review I2)', async () => {
    // Both writes share the same `ts` so an auditor can join the two
    // records by timestamp exactly. Pinning this prevents a future
    // refactor from accidentally calling now() twice and creating a
    // microsecond skew that breaks the join.
    defaultTxHarness(userDoc({ userType: 'TEACHER' }));
    const app = createApp();
    await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'pin-timestamp' })
      .expect(200);

    const userWrite = mockTxUpdate.mock.calls.find(([p]) => p === 'users/target-1');
    const auditWrite = mockTxSet.mock.calls.find(([p]) => /^adminAuditLog\//.test(p));
    expect(userWrite[1].cohortOverrideUpdatedAt).toBe(auditWrite[1].createdAt);
  });

  test('rejects reason longer than 500 chars with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('500 on transaction throw (covers Firestore-down code path)', async () => {
    mockRunTransaction.mockRejectedValue(new Error('Firestore down'));
    const app = createApp();
    const res = await request(app)
      .post('/api/user/target-1/cohort-override')
      .send({ override: 'adult', reason: 'r' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/cohort-stats
// ═══════════════════════════════════════════════════════════════

describe('GET /api/admin/cohort-stats', () => {
  test('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app).get('/api/admin/cohort-stats');
    expect(res.status).toBe(403);
    expect(mockCountGet).not.toHaveBeenCalled();
  });

  test('returns aggregated cohort counts + override counts + total', async () => {
    // Order tests must mirror the route. The implementation issues the
    // queries in this canonical sequence:
    //   1) where('cohort','==','adult').count()
    //   2) where('cohort','==','minor').count()
    //   3) where('cohortOverride','==','adult').count()
    //   4) where('cohortOverride','==','minor').count()
    //   5) collection.count()  (total users)
    pushCount(1200); // adult
    pushCount(340); // minor
    pushCount(8); // override adult
    pushCount(3); // override minor
    pushCount(1545); // total (= 1200 + 340 + 5 missing cohort)

    const app = createApp();
    const res = await request(app).get('/api/admin/cohort-stats').expect(200);

    expect(res.body).toMatchObject({
      counts: {
        adult: 1200,
        minor: 340,
        overrideAdult: 8,
        overrideMinor: 3,
        total: 1545,
        missing: 5,
      },
    });
  });

  test('handles empty user collection (all zeros)', async () => {
    for (let i = 0; i < 5; i++) pushCount(0);
    const app = createApp();
    const res = await request(app).get('/api/admin/cohort-stats').expect(200);
    expect(res.body.counts).toMatchObject({
      adult: 0,
      minor: 0,
      overrideAdult: 0,
      overrideMinor: 0,
      total: 0,
      missing: 0,
    });
  });

  test('clamps missing to >= 0 when total < adult+minor (data drift defence)', async () => {
    // If a doc transiently has BOTH cohort='adult' and cohort='minor'
    // recorded (impossible by design but defendable), adult+minor could
    // momentarily exceed total. The route must not return a negative
    // missing — it should clamp to 0 to keep the admin UI sane.
    pushCount(800); // adult
    pushCount(300); // minor
    pushCount(0); // override adult
    pushCount(0); // override minor
    pushCount(1000); // total — less than adult+minor

    const app = createApp();
    const res = await request(app).get('/api/admin/cohort-stats').expect(200);
    expect(res.body.counts.missing).toBeGreaterThanOrEqual(0);
  });

  test('returns 500 when count aggregation throws', async () => {
    mockCountGet.mockRejectedValueOnce(new Error('count() unsupported'));
    const app = createApp();
    const res = await request(app).get('/api/admin/cohort-stats');
    expect(res.status).toBe(500);
  });
});
