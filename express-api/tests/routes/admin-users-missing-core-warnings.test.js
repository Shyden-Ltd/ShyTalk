/* eslint-disable no-unused-vars */
const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
// Promoted to module-level so the Pass-13 atomicity regression test can
// assert the EXACT batch op counts (warning + user-doc + audit = 3 ops).
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
// mockCollectionGet is a mutable reference — the factory closure captures the
// outer variable by reference, and tests reassign it to control collection responses.
// Named with the "mock" prefix so Jest's scope guard allows it inside jest.mock().
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        get: () => mockCollectionGet(),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: mockBatchUpdate,
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'firebase-uid',
      email: 'user@example.com',
      providerData: [],
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'warn-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // allow by default
  clearSuspensionCache: jest.fn(),
}));

// firestore-helpers goes through our mockDocGet
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');
const { requireAdmin } = require('../../src/middleware/auth');

// ─── App setup ───────────────────────────────────────────────────

const adminUsersRouter = require('../../src/routes/admin-users');

function createAdminApp({ uid = 'admin-uid', uniqueId = 'admin-1', isAdmin = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: { admin: isAdmin } };
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

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset drains queues + clears implementations (clearAllMocks does not)
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchCommit.mockReset();
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  getDoc.mockReset();
  requireAdmin.mockReset();

  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  // Default: getDoc returns null (doc not found) unless overridden per test
  getDoc.mockResolvedValue(null);
  requireAdmin.mockReturnValue(false); // allow by default
});

// ─── GET /api/user/:uniqueId ─────────────────────────────────────

// ─── POST /api/user/:uniqueId/warn ───────────────────────────────

describe('POST /api/user/:uniqueId/warn', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Spamming', severity: 2 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when reason is missing', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warn').send({ severity: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it('returns 400 when severity is out of range', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Bad behaviour', severity: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  // ─── Length-cap validators: must protect against admin-side
  // storage exhaustion of warning subcollection + audit log ─────

  it('returns 400 when reason exceeds 500 chars', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'x'.repeat(501), severity: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason exceeds 500 chars/);
  });

  it('returns 400 when adminNote exceeds 2000 chars', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'spam', severity: 2, adminNote: 'n'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adminNote exceeds 2000 chars/);
  });

  it('returns 404 when target user does not exist', async () => {
    // createWarning: first reads db.doc().get() for the user — not found → throws before getDoc
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Spamming', severity: 2 });
    expect(res.status).toBe(404);
  });

  it('returns 200 with warningId, newGcs, deduction on success', async () => {
    // createWarning: 1st db.doc().get() = user doc, 2nd getDoc = admin doc
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        gcsScore: 90,
        warningCount: 1,
      }),
    });
    getDoc.mockResolvedValueOnce({ displayName: 'Admin User' }); // admin user lookup

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Inappropriate content', severity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warningId).toBeDefined();
    expect(res.body.newGcs).toBe(80); // 90 - 10 (severity 2 deduction)
    expect(res.body.deduction).toBe(10);
    expect(res.body.warningCount).toBe(2);
  });
});

// ─── GET /api/user/:uniqueId/warnings ────────────────────────────

describe('GET /api/user/:uniqueId/warnings', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/warnings');
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty warnings list when none exist', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/warnings');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns 200 with warnings and hasMore=false when under limit', async () => {
    const warnDocs = [
      {
        id: 'warn-1',
        data: () => ({ reason: 'Spam', severity: 1, createdAt: 1709913600000, revoked: false }),
      },
      {
        id: 'warn-2',
        data: () => ({
          reason: 'Harassment',
          severity: 3,
          createdAt: 1709913500000,
          revoked: false,
        }),
      },
    ];
    mockCollectionGet = jest.fn().mockResolvedValue({ docs: warnDocs });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/warnings?limit=20');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(2);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns hasMore=true when there are more results than the limit', async () => {
    // Route fetches limit+1 docs to detect "has more"
    const warnDocs = Array.from({ length: 4 }, (_, i) => ({
      id: `warn-${i}`,
      data: () => ({ reason: 'Test', severity: 1, createdAt: 1709913600000 - i }),
    }));
    mockCollectionGet = jest.fn().mockResolvedValue({ docs: warnDocs });

    const app = createAdminApp();
    // Request limit=3, we return 4 docs → hasMore should be true
    const res = await request(app).get('/api/user/10000001/warnings?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(3);
    expect(res.body.hasMore).toBe(true);
  });
});

// ─── POST /api/user/:id/warnings/:warnId/revoke ──────────────────

describe('POST /api/user/:uniqueId/warnings/:warningId/revoke', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-1/revoke');
    expect(res.status).toBe(403);
  });

  it('returns 404 when warning does not exist', async () => {
    getDoc.mockResolvedValueOnce(null); // warning doc not found

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-999/revoke');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/warning not found/i);
  });

  it('returns 400 when warning is already revoked', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'warn-1',
      revoked: true,
      gcsDeduction: 10,
    });

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-1/revoke');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already revoked/i);
  });

  it('returns 200 and restores GCS on successful revoke', async () => {
    // First getDoc call = warning doc
    getDoc.mockResolvedValueOnce({
      id: 'warn-1',
      revoked: false,
      gcsDeduction: 10,
    });
    // Second db.doc().get() call = user doc (for current GCS)
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({ gcsScore: 80, warningCount: 2 }),
    });

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-1/revoke');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.restoredGcs).toBe(90); // 80 + 10
    expect(res.body.deduction).toBe(10);

    // PR #491: revoke now uses db.batch() for atomicity (audit H7).
    // The 3 writes (warning revoke, user GCS restore, audit log) are
    // committed in ONE atomic batch — assert on mockBatchUpdate /
    // mockBatchSet rather than the global mockDocUpdate / mockDocSet.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ revoked: true, revokedBy: 'admin-uid' }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gcsScore: 90, warningCount: 1 }),
    );
    // Single batch.commit — proves the 3 writes are atomic, not
    // 3 separate Promise.all awaits as in the pre-fix code.
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /api/user/:uniqueId/reset-gcs ──────────────────────────

// ─── GET /api/user/:uniqueId/stalkers ────────────────────────────

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

// ─── GET /api/user/:uniqueId — backfillAuthInfo branch ──

// ─── GET /api/user/:uniqueId — 500 error branch ──

// ─── GET /api/user/:uid/auth-debug ──────────────────────────────────

// ─── PATCH /api/user/:uniqueId — additional branches ────────────────

// ─── POST /api/user/:uniqueId/notify-changes ────────────────────────

// ─── POST /api/user/:uniqueId/warn — additional branches ────────────

describe('POST /api/user/:uniqueId/warn — additional branches', () => {
  it('returns 500 on unexpected createWarning error', async () => {
    // Make the user doc fetch succeed, but the set (warning creation) fail
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({ gcsScore: 90, warningCount: 1 }),
    });
    getDoc.mockResolvedValueOnce({ displayName: 'Admin User' });
    // createWarning was migrated to a Firestore batch in Pass-13; reject the
    // batch.commit so the route's outer try/catch fires the 500.
    mockBatchCommit.mockRejectedValueOnce(new Error('Batch write failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Test error', severity: 2 });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });

  it('defaults severity to 3 when not provided', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({ gcsScore: 100, warningCount: 0 }),
    });
    getDoc.mockResolvedValueOnce({ displayName: 'Admin User' });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Default severity test' });
    expect(res.status).toBe(200);
    // severity 3 -> deduction 15
    expect(res.body.deduction).toBe(15);
    expect(res.body.newGcs).toBe(85);
  });

  it('createWarning writes warning + user + audit atomically via Firestore batch (Pass-13 C2 fix)', async () => {
    // Regression test for the orphan-warning bug: previously Promise.all
    // would partially commit (warning doc lands but user-doc update fails)
    // leaving a warning record without the GCS deduction. Admin retries,
    // duplicate warning + double GCS hit. The batch makes all 3 writes
    // commit atomically — assert all 3 batch ops fired AND committed once.
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({ gcsScore: 100, warningCount: 0 }),
    });
    getDoc.mockResolvedValueOnce({ displayName: 'Admin User' });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/warn')
      .send({ reason: 'Atomicity regression', severity: 2 });
    expect(res.status).toBe(200);
    // Exactly one batch.commit() — all three writes go through it.
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    // EXACT batch op counts: warning subcollection doc + audit log = 2 sets,
    // user-doc = 1 update. Stronger than just "no direct .set to warnings/"
    // because it would catch a regression like:
    //   const batch = db.batch();
    //   await Promise.all([batch.set(...), db.doc(...).update(...), batch.set(...)]);
    //   await batch.commit();
    // — which leaks the user-doc update outside the batch.
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    // User-doc update must go through the batch (mockBatchUpdate), NOT direct
    // mockDocUpdate. mockDocUpdate.mock.calls captures direct .update() — the
    // warn flow should add nothing to it.
    expect(mockDocUpdate).not.toHaveBeenCalled();
    // Warning subcollection write goes through the batch — no direct .set().
    const setPathsForWarning = mockDocSet.mock.calls.filter((c) =>
      String(c[0] ?? '').includes('warnings/'),
    );
    expect(setPathsForWarning.length).toBe(0);
    // The batch.update payload IS the user doc with the warning side-effects.
    const userDocBatchUpdate = mockBatchUpdate.mock.calls[0][1];
    expect(userDocBatchUpdate).toEqual(
      expect.objectContaining({
        warningCount: expect.any(Number),
        gcsScore: expect.any(Number),
        hasActiveWarning: true,
        hasNewWarning: true,
      }),
    );
  });
});

// ─── GET /api/user/:uniqueId/warnings — startAfter branch ──────────

describe('GET /api/user/:uniqueId/warnings — pagination', () => {
  it('passes startAfter query param for pagination', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      docs: [
        {
          id: 'warn-5',
          data: () => ({ reason: 'Older', severity: 1, createdAt: 1709913400000 }),
        },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get(
      '/api/user/10000001/warnings?startAfter=1709913500000&limit=5',
    );
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns 500 when Firestore throws during list', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Query failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/warnings');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/user/:uniqueId/warnings/:id/revoke — error branches ─

describe('POST /api/user/:uniqueId/warnings/:warningId/revoke — additional', () => {
  it('returns 404 when user not found during revoke', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'warn-1',
      revoked: false,
      gcsDeduction: 10,
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-1/revoke');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it('returns 500 on Firestore error during revoke', async () => {
    getDoc.mockRejectedValueOnce(new Error('Firestore read error'));

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/warnings/warn-1/revoke');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/user/:uniqueId/reset-gcs — error branch ─────────────

// ─── GET /api/user/:uniqueId/stalkers — error branch ────────────────

// ─── GET /api/conversations/:id/messages ────────────────────────────

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

// ─── DELETE /api/report-locks/:uniqueId ─────────────────────────────

// ─── GET /api/user/:uniqueId/auth-status ────────────────────────────

// ─── POST /api/user/:uniqueId/reset-pin-lockout ────────────────────

// ─── DELETE /api/user/:uniqueId/biometric-keys/:deviceId ────────────

// ─── GET /api/metrics/otp ───────────────────────────────────────────
