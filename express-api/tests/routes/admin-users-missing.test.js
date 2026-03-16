const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
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
      update: jest.fn(),
      set: jest.fn(),
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
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  // Default: getDoc returns null (doc not found) unless overridden per test
  getDoc.mockResolvedValue(null);
  requireAdmin.mockReturnValue(false); // allow by default
});

// ─── GET /api/user/:uniqueId ─────────────────────────────────────

describe('GET /api/user/:uniqueId', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(403);
  });

  it('returns 404 when user does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with enriched user profile for admin', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        uniqueId: 10000001,
        displayName: 'Alice',
        gcsScore: 90,
        gcsLastDeductionAt: null,
        email: 'alice@example.com',
        firebaseUid: 'uid-alice',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(200);
    expect(res.body.uniqueId).toBe(10000001);
    expect(res.body.displayName).toBe('Alice');
    expect(res.body.gcsDisplayScore).toBeDefined();
  });
});

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

    // Warning should be marked revoked
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001/warnings/warn-1',
      expect.objectContaining({ revoked: true, revokedBy: 'admin-uid' }),
    );
    // User GCS should be restored
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001',
      expect.objectContaining({ gcsScore: 90, warningCount: 1 }),
    );
  });
});

// ─── POST /api/user/:uniqueId/reset-gcs ──────────────────────────

describe('POST /api/user/:uniqueId/reset-gcs', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-gcs');
    expect(res.status).toBe(403);
  });

  it('returns 200 and resets GCS to 100 with cleared warning fields', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-gcs');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001',
      expect.objectContaining({
        gcsScore: 100,
        gcsLastDeductionAt: null,
        warningCount: 0,
        hasActiveWarning: false,
        hasNewWarning: false,
        warningReason: null,
        warningIssuedAt: null,
      }),
    );
  });

  it('creates an audit log entry on GCS reset', async () => {
    const app = createAdminApp();
    await request(app).post('/api/user/10000001/reset-gcs').expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      'adminAuditLog/warn-id',
      expect.objectContaining({
        action: 'RESET_GCS',
        targetUserId: '10000001',
      }),
    );
  });
});

// ─── GET /api/user/:uniqueId/stalkers ────────────────────────────

describe('GET /api/user/:uniqueId/stalkers', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/stalkers');
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty stalkers array when no stalkers exist', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/stalkers');
    expect(res.status).toBe(200);
    expect(res.body.stalkers).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns 200 with stalker IDs and count when stalkers exist', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      docs: [{ id: 'stalker-A' }, { id: 'stalker-B' }, { id: 'stalker-C' }],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/stalkers');
    expect(res.status).toBe(200);
    expect(res.body.stalkers).toEqual(['stalker-A', 'stalker-B', 'stalker-C']);
    expect(res.body.count).toBe(3);
  });
});
