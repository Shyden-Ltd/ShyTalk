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

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

// ─── GET /api/user/:uniqueId — backfillAuthInfo branch ──

describe('GET /api/user/:uniqueId — backfillAuthInfo', () => {
  it('backfills email from Firebase Auth when user doc has no email', async () => {
    const { auth } = require('../../src/utils/firebase');
    auth.getUser.mockResolvedValueOnce({
      uid: 'uid-no-email',
      email: 'backfilled@example.com',
      providerData: [],
    });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000003',
      data: () => ({
        uniqueId: 10000003,
        displayName: 'NoEmail',
        gcsScore: 100,
        gcsLastDeductionAt: null,
        email: null,
        firebaseUid: 'uid-no-email',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000003');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('backfilled@example.com');
    // The backfill should also update the Firestore doc (fire-and-forget)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000003',
      expect.objectContaining({ email: 'backfilled@example.com' }),
    );
  });

  it('falls back to provider email when Firebase Auth has no direct email', async () => {
    const { auth } = require('../../src/utils/firebase');
    auth.getUser.mockResolvedValueOnce({
      uid: 'uid-provider',
      email: null,
      providerData: [{ providerId: 'google.com', email: 'provider@gmail.com' }],
    });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000004',
      data: () => ({
        uniqueId: 10000004,
        displayName: 'ProviderOnly',
        gcsScore: 100,
        gcsLastDeductionAt: null,
        email: null,
        firebaseUid: 'uid-provider',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000004');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('provider@gmail.com');
  });

  it('handles Firebase Auth lookup failure gracefully', async () => {
    const { auth } = require('../../src/utils/firebase');
    auth.getUser.mockRejectedValueOnce(new Error('Auth service down'));

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000005',
      data: () => ({
        uniqueId: 10000005,
        displayName: 'AuthFail',
        gcsScore: 100,
        gcsLastDeductionAt: null,
        email: null,
        firebaseUid: 'uid-auth-fail',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000005');
    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });
});

// ─── GET /api/user/:uniqueId — 500 error branch ──

// ─── GET /api/user/:uid/auth-debug ──────────────────────────────────

describe('GET /api/user/:uid/auth-debug', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/firebase-uid-1/auth-debug');
    expect(res.status).toBe(403);
  });

  it('returns 200 with raw Firebase Auth data for admin', async () => {
    const { auth } = require('../../src/utils/firebase');
    auth.getUser.mockResolvedValueOnce({
      uid: 'firebase-uid-1',
      email: 'user@example.com',
      providerData: [{ providerId: 'google.com' }],
      disabled: false,
      metadata: { creationTime: '2024-01-01' },
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/firebase-uid-1/auth-debug');
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('firebase-uid-1');
    expect(res.body.email).toBe('user@example.com');
    expect(res.body.disabled).toBe(false);
    expect(res.body.providerData).toEqual([{ providerId: 'google.com' }]);
    expect(res.body.metadata).toBeDefined();
  });

  it('returns 500 when Firebase Auth lookup throws', async () => {
    const { auth } = require('../../src/utils/firebase');
    auth.getUser.mockRejectedValueOnce(new Error('Auth service unavailable'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/bad-uid/auth-debug');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── PATCH /api/user/:uniqueId — additional branches ────────────────

// ─── POST /api/user/:uniqueId/notify-changes ────────────────────────

describe('POST /api/user/:uniqueId/notify-changes', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/notify-changes')
      .send({ fields: ['displayName'] });
    expect(res.status).toBe(403);
  });

  it('returns 400 when fields is not a non-empty array', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/notify-changes').send({ fields: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fields.*non-empty/i);
  });

  it('returns 400 when fields is missing', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/user/10000001/notify-changes').send({});
    expect(res.status).toBe(400);
  });

  it('returns notified=false when fields are not notifiable', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/notify-changes')
      .send({ fields: ['shyCoins', 'luckScore'] });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(false);
    expect(res.body.reason).toMatch(/no notifiable/i);
  });

  it('sends system PM for notifiable fields and returns notified=true', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/notify-changes')
      .send({ fields: ['displayName', 'profilePhotoUrl', 'shyCoins'] });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(true);
    expect(res.body.fields).toEqual(['displayName', 'profilePhotoUrl']);
    expect(sendSystemPm).toHaveBeenCalledWith('10000001', expect.stringContaining('display name'));
  });

  it('returns 500 on error', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/user/10000001/notify-changes')
      .send({ fields: ['displayName'] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/user/:uniqueId/warn — additional branches ────────────

// ─── GET /api/user/:uniqueId/warnings — startAfter branch ──────────

// ─── POST /api/user/:uniqueId/warnings/:id/revoke — error branches ─

// ─── POST /api/user/:uniqueId/reset-gcs — error branch ─────────────

// ─── GET /api/user/:uniqueId/stalkers — error branch ────────────────

describe('GET /api/user/:uniqueId/stalkers — error handling', () => {
  it('returns 500 when Firestore throws', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Stalkers query failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/stalkers');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/conversations/:id/messages ────────────────────────────

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

// ─── DELETE /api/report-locks/:uniqueId ─────────────────────────────

// ─── GET /api/user/:uniqueId/auth-status ────────────────────────────

describe('GET /api/user/:uniqueId/auth-status', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/auth-status');
    expect(res.status).toBe(403);
  });

  it('returns 404 when user not found', async () => {
    getDoc.mockResolvedValueOnce(null);

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/auth-status');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it('returns 200 with auth status including biometric keys', async () => {
    getDoc.mockResolvedValueOnce({
      pinHash: 'hashed-pin',
      pinSetAt: 1700000000000,
      pinAttempts: 2,
      pinLockedUntil: null,
      pinLockoutCount: 1,
    });
    mockCollectionGet = jest.fn().mockResolvedValue({
      docs: [
        {
          id: '10000001:device-abc',
          data: () => ({ createdAt: 1700000000000 }),
        },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/auth-status');
    expect(res.status).toBe(200);
    expect(res.body.pinSet).toBe(true);
    expect(res.body.pinAttempts).toBe(2);
    expect(res.body.isLocked).toBe(false);
    expect(res.body.biometricKeys).toHaveLength(1);
    expect(res.body.biometricKeys[0].deviceId).toBe('device-abc');
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('Read failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001/auth-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get auth status/i);
  });
});

// ─── POST /api/user/:uniqueId/reset-pin-lockout ────────────────────

// ─── DELETE /api/user/:uniqueId/biometric-keys/:deviceId ────────────

// ─── GET /api/metrics/otp ───────────────────────────────────────────

describe('GET /api/metrics/otp', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/metrics/otp');
    expect(res.status).toBe(403);
  });

  it('returns default values when metrics doc does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createAdminApp();
    const res = await request(app).get('/api/metrics/otp');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, date: null, limit: 100 });
  });

  it('returns metrics when doc exists', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: 42, date: '2026-04-01' }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/metrics/otp');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(42);
    expect(res.body.date).toBe('2026-04-01');
    expect(res.body.limit).toBe(100);
  });

  it('returns 500 on error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/metrics/otp');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get otp metrics/i);
  });
});
