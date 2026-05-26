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
  // mockReset drains queues + clears implementations (clearAllMocks does not)
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchCommit.mockReset();
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

// ─── GET /api/user/:uniqueId/warnings ────────────────────────────

// ─── POST /api/user/:id/warnings/:warnId/revoke ──────────────────

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

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

// ─── GET /api/user/:uniqueId — backfillAuthInfo branch ──

// ─── GET /api/user/:uniqueId — 500 error branch ──

// ─── GET /api/user/:uid/auth-debug ──────────────────────────────────

// ─── PATCH /api/user/:uniqueId — additional branches ────────────────

// ─── POST /api/user/:uniqueId/notify-changes ────────────────────────

// ─── POST /api/user/:uniqueId/warn — additional branches ────────────

// ─── GET /api/user/:uniqueId/warnings — startAfter branch ──────────

// ─── POST /api/user/:uniqueId/warnings/:id/revoke — error branches ─

// ─── POST /api/user/:uniqueId/reset-gcs — error branch ─────────────

describe('POST /api/user/:uniqueId/reset-gcs — error handling', () => {
  it('returns 500 when Firestore throws', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Write failed'));

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-gcs');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/user/:uniqueId/stalkers — error branch ────────────────

// ─── GET /api/conversations/:id/messages ────────────────────────────

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

// ─── DELETE /api/report-locks/:uniqueId ─────────────────────────────

describe('DELETE /api/report-locks/:uniqueId', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).delete('/api/report-locks/10000001');
    expect(res.status).toBe(403);
  });

  it('deletes the report lock', async () => {
    const app = createAdminApp();
    const res = await request(app).delete('/api/report-locks/10000001');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocDelete).toHaveBeenCalledWith('reportLocks/10000001');
  });

  it('returns 500 on error', async () => {
    mockDocDelete.mockRejectedValueOnce(new Error('Delete failed'));

    const app = createAdminApp();
    const res = await request(app).delete('/api/report-locks/10000001');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/user/:uniqueId/auth-status ────────────────────────────

// ─── POST /api/user/:uniqueId/reset-pin-lockout ────────────────────

describe('POST /api/user/:uniqueId/reset-pin-lockout', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-pin-lockout');
    expect(res.status).toBe(403);
  });

  it('resets pin lockout fields and returns success', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-pin-lockout');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/pin lockout reset/i);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000001',
      expect.objectContaining({
        pinAttempts: 0,
        pinLockedUntil: null,
        pinLockoutCount: 0,
      }),
    );
  });

  it('returns 500 on error', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Update failed'));

    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/reset-pin-lockout');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to reset lockout/i);
  });
});

// ─── DELETE /api/user/:uniqueId/biometric-keys/:deviceId ────────────

describe('DELETE /api/user/:uniqueId/biometric-keys/:deviceId', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).delete('/api/user/10000001/biometric-keys/device-abc');
    expect(res.status).toBe(403);
  });

  it('deletes the biometric key and returns success', async () => {
    const app = createAdminApp();
    const res = await request(app).delete('/api/user/10000001/biometric-keys/device-abc');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/biometric key revoked/i);
    expect(mockDocDelete).toHaveBeenCalledWith('biometricKeys/10000001:device-abc');
  });

  it('returns 500 on error', async () => {
    mockDocDelete.mockRejectedValueOnce(new Error('Delete failed'));

    const app = createAdminApp();
    const res = await request(app).delete('/api/user/10000001/biometric-keys/device-abc');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to revoke key/i);
  });
});

// ─── GET /api/metrics/otp ───────────────────────────────────────────
