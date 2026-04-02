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

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

describe('GET /api/user/:uniqueId — normalizeUser for suspended users', () => {
  it('restores pre-suspension display name, profile photo, and cover photo for admin view', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        uniqueId: 10000001,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        isSuspended: true,
        preSuspensionDisplayName: 'RealName',
        preSuspensionProfilePhotoUrl: 'https://r2.example.com/profiles/10000001/photo.jpg',
        preSuspensionCoverPhotoUrl: 'https://r2.example.com/covers/10000001/cover.jpg',
        gcsScore: 0,
        gcsLastDeductionAt: null,
        email: 'suspended@example.com',
        firebaseUid: 'uid-suspended',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(200);
    // Admin sees real name, not "Suspended Account"
    expect(res.body.displayName).toBe('RealName');
    expect(res.body.profilePhotoUrl).toBe('https://r2.example.com/profiles/10000001/photo.jpg');
    expect(res.body.coverPhotoUrl).toBe('https://r2.example.com/covers/10000001/cover.jpg');
    expect(res.body._preSuspension).toEqual({
      displayName: 'RealName',
      profilePhotoUrl: 'https://r2.example.com/profiles/10000001/photo.jpg',
      coverPhotoUrl: 'https://r2.example.com/covers/10000001/cover.jpg',
    });
  });

  it('handles suspended user with only partial pre-suspension data', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000002',
      data: () => ({
        uniqueId: 10000002,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        isSuspended: true,
        preSuspensionDisplayName: 'PartialUser',
        // no preSuspensionProfilePhotoUrl or preSuspensionCoverPhotoUrl
        gcsScore: 50,
        gcsLastDeductionAt: null,
        email: 'partial@example.com',
        firebaseUid: 'uid-partial',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000002');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('PartialUser');
    expect(res.body._preSuspension).toEqual({
      displayName: 'PartialUser',
      profilePhotoUrl: null,
      coverPhotoUrl: null,
    });
  });
});

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

describe('GET /api/user/:uniqueId — error handling', () => {
  it('returns 500 when Firestore throws', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore connection failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

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

describe('PATCH /api/user/:uniqueId — additional branches', () => {
  it('returns 400 when string field exceeds max length', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001')
      .send({ displayName: 'A'.repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/displayName.*20/);
  });

  it('returns 400 when array field is not an array', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001')
      .send({ blockedUserIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blockedUserIds.*array/i);
  });

  it('accepts snake_case field names and converts to camelCase', async () => {
    const app = createAdminApp();
    const res = await request(app).patch('/api/user/10000001').send({ display_name: 'SnakeName' });
    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('displayName');
  });

  it('returns 500 when db.doc().update throws', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore write failed'));

    const app = createAdminApp();
    const res = await request(app).patch('/api/user/10000001').send({ displayName: 'Valid' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });

  it('skips PMs when ?silent=true', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001?silent=true')
      .send({ displayName: 'SilentUpdate' });
    expect(res.status).toBe(200);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });
});

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

describe('POST /api/user/:uniqueId/warn — additional branches', () => {
  it('returns 500 on unexpected createWarning error', async () => {
    // Make the user doc fetch succeed, but the set (warning creation) fail
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({ gcsScore: 90, warningCount: 1 }),
    });
    getDoc.mockResolvedValueOnce({ displayName: 'Admin User' });
    mockDocSet.mockRejectedValueOnce(new Error('Batch write failed'));

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

describe('GET /api/conversations/:id/messages', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(403);
  });

  it('returns 200 with messages in chronological order', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      docs: [
        { id: 'msg-2', data: () => ({ text: 'Second', createdAt: 200 }) },
        { id: 'msg-1', data: () => ({ text: 'First', createdAt: 100 }) },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Reversed from desc order -> chronological
    expect(res.body[0].text).toBe('First');
    expect(res.body[1].text).toBe('Second');
  });

  it('returns 500 on Firestore error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Messages query failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

describe('GET /api/search/uniqueId/:id', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(403);
  });

  it('returns user when found by uniqueId', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: '10000001',
          data: () => ({
            uniqueId: 10000001,
            displayName: 'SearchUser',
            gcsScore: 100,
            gcsLastDeductionAt: null,
            email: 'search@example.com',
            firebaseUid: 'uid-search',
          }),
        },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('SearchUser');
  });

  it('falls back to tempUniqueId when uniqueId search is empty', async () => {
    // First call: uniqueId search returns empty
    // Second call: tempUniqueId search returns a result
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: '10000099',
            data: () => ({
              uniqueId: null,
              tempUniqueId: 10000099,
              displayName: 'TempUser',
              gcsScore: 100,
              gcsLastDeductionAt: null,
              email: 'temp@example.com',
              firebaseUid: 'uid-temp',
            }),
          },
        ],
      });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000099');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('TempUser');
  });

  it('returns 404 when neither uniqueId nor tempUniqueId match', async () => {
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: true, docs: [] });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/99999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 500 on error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Search failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

describe('POST /api/resolve/uids-to-uniqueIds', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-1'] });
    expect(res.status).toBe(403);
  });

  it('returns empty object when uids array is empty', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/resolve/uids-to-uniqueIds').send({ uids: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('resolves UIDs to uniqueIds and display names', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000001, displayName: 'Alice' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000002, displayName: 'Bob' }),
      });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-alice', 'uid-bob'] });
    expect(res.status).toBe(200);
    expect(res.body.mapping['uid-alice']).toEqual({
      uniqueId: 10000001,
      displayName: 'Alice',
    });
    expect(res.body.mapping['uid-bob']).toEqual({
      uniqueId: 10000002,
      displayName: 'Bob',
    });
  });

  it('skips non-existent UIDs', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000001, displayName: 'Alice' }),
      })
      .mockResolvedValueOnce({ exists: false });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-alice', 'uid-ghost'] });
    expect(res.status).toBe(200);
    expect(res.body.mapping['uid-alice']).toBeDefined();
    expect(res.body.mapping['uid-ghost']).toBeUndefined();
  });

  it('returns 500 on error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-1'] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

describe('POST /api/resolve/uniqueIds-to-uids', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(403);
  });

  it('returns empty object when uniqueIds array is empty', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/resolve/uniqueIds-to-uids').send({ uniqueIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('resolves uniqueIds to UIDs', async () => {
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: '10000001', data: () => ({ uid: 'uid-alice' }) }],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: '10000002', data: () => ({ uid: 'uid-bob' }) }],
      });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001, 10000002] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[10000001]).toBe('uid-alice');
    expect(res.body.mapping[10000002]).toBe('uid-bob');
  });

  it('uses doc.id as fallback when uid field is missing', async () => {
    mockCollectionGet = jest.fn().mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'doc-id-fallback', data: () => ({}) }],
    });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[10000001]).toBe('doc-id-fallback');
  });

  it('skips unresolvable uniqueIds', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [99999999] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[99999999]).toBeUndefined();
  });

  it('returns 500 on error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Query failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

describe('POST /api/report-locks/:uniqueId/lock', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(403);
  });

  it('creates a report lock with admin display name', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: 'AdminUser' }),
    });

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.displayName).toBe('AdminUser');
    expect(mockDocSet).toHaveBeenCalledWith(
      'reportLocks/10000001',
      expect.objectContaining({
        reportId: '10000001',
        lockedBy: 'admin-uid',
        displayName: 'AdminUser',
      }),
    );
  });

  it('handles missing admin doc gracefully', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false, data: () => null });

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBeNull();
  });

  it('returns 500 on error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read failed'));

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

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
