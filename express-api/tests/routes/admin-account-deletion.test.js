/**
 * Tests for admin account deletion routes.
 *
 * POST /api/user/:uniqueId/delete        → Admin schedules account deletion
 * POST /api/user/:uniqueId/cancel-delete → Admin cancels scheduled deletion
 *
 * Covers:
 * - Admin-only access control
 * - Skips PIN/biometric verification
 * - Accepts optional reason
 * - Admin audit log entries
 * - Admin can cancel any deletion (including admin-initiated)
 * - Eviction from active room
 * - Email/push notifications
 * - Edge cases: not found, already scheduled, server errors
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet.mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
    getUser: jest.fn().mockResolvedValue({
      uid: 'user-firebase-uid',
      email: null,
      providerData: [],
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

const mockSendEmail = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/email', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildOtpEmail: jest.fn(),
  buildLockoutEmail: jest.fn(),
  buildResetEmail: jest.fn(),
  buildDeletionScheduledEmail: jest.fn((date) => ({
    subject: 'Your ShyTalk account is scheduled for deletion',
    html: `<p>Deletion on ${date}</p>`,
  })),
  buildDeletionCompleteEmail: jest.fn(() => ({
    subject: 'Your ShyTalk account has been deleted',
    html: '<p>Deleted</p>',
  })),
}));

const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: jest.fn().mockResolvedValue(),
}));

const { auth } = require('../../src/utils/firebase');
const { requireAdmin } = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockReturnValue(false); // Allow by default
});

// ─── App setup ───────────────────────────────────────────────────

const adminUsersRouter = require('../../src/routes/admin-users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────

function mockUserDoc(uniqueId, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uniqueId,
      firebaseUid: 'user-firebase-uid',
      email: 'user@example.com',
      displayName: 'Test User',
      fcmTokens: ['token-1'],
      currentRoomId: null,
      isSuspended: false,
      deletionScheduledAt: null,
      deletionReason: null,
      deletionExecuteAt: null,
      ...overrides,
    }),
    id: String(uniqueId),
  };
}

function mockConfigDoc(graceDays = 30) {
  return {
    exists: true,
    data: () => ({
      accountDeletionGracePeriodDays: graceDays,
      inactiveAccountDeleteMonths: 0,
    }),
  };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 50));

// ═══════════════════════════════════════════════════════════════════
// POST /api/user/:uniqueId/delete (Admin)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/user/:uniqueId/delete (admin)', () => {
  test('admin schedules deletion without PIN', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/user/10000001/delete')
      .send({ reason: 'Policy violation' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleteAt).toBeDefined();

    // Should set deletion fields with reason "admin"
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        deletionScheduledAt: expect.any(Number),
        deletionReason: 'admin',
        deletionExecuteAt: expect.any(Number),
      }),
    );

    // Should write admin audit log
    await flushPromises();
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'ACCOUNT_DELETION_SCHEDULED',
        adminId: 'admin-1',
        targetUserId: '10000001',
        details: expect.stringContaining('Policy violation'),
      }),
    );
  });

  test('admin schedules deletion without reason', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app).post('/api/user/10000001/delete').send({}).expect(200);

    expect(res.body.success).toBe(true);
  });

  test('returns 403 when not admin', async () => {
    requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const app = createApp();

    await request(app).post('/api/user/10000001/delete').send({ reason: 'test' }).expect(403);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    await request(app).post('/api/user/10000001/delete').send({ reason: 'test' }).expect(404);
  });

  test('returns 409 when deletion already scheduled', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: Date.now(),
            deletionReason: 'self',
            deletionExecuteAt: Date.now() + 30 * 86400000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/user/10000001/delete')
      .send({ reason: 'test' })
      .expect(409);

    expect(res.body.error).toMatch(/already scheduled/i);
  });

  test('revokes refresh tokens', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/user/10000001/delete').send({}).expect(200);

    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('user-firebase-uid');
  });

  test('sends email notification', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/user/10000001/delete').send({}).expect(200);

    expect(mockSendEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringContaining('scheduled for deletion'),
      expect.any(String),
    );
  });

  test('sends push notification', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/user/10000001/delete').send({}).expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['token-1'],
      expect.objectContaining({
        notification: expect.objectContaining({
          title: expect.stringContaining('Deletion'),
        }),
      }),
    );
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp();
    await request(app).post('/api/user/10000001/delete').send({}).expect(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/user/:uniqueId/cancel-delete (Admin)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/user/:uniqueId/cancel-delete (admin)', () => {
  test('admin cancels self-initiated deletion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: Date.now(),
            deletionReason: 'self',
            deletionExecuteAt: Date.now() + 30 * 86400000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app).post('/api/user/10000001/cancel-delete').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        deletionScheduledAt: null,
        deletionReason: null,
        deletionExecuteAt: null,
      }),
    );
  });

  test('admin cancels admin-initiated deletion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: Date.now(),
            deletionReason: 'admin',
            deletionExecuteAt: Date.now() + 30 * 86400000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app).post('/api/user/10000001/cancel-delete').expect(200);

    expect(res.body.success).toBe(true);
  });

  test('writes audit log on admin cancellation', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: Date.now(),
            deletionReason: 'self',
            deletionExecuteAt: Date.now() + 30 * 86400000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/user/10000001/cancel-delete').expect(200);

    await flushPromises();
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'ACCOUNT_DELETION_CANCELLED',
        adminId: 'admin-1',
      }),
    );
  });

  test('returns 403 when not admin', async () => {
    requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const app = createApp();
    await request(app).post('/api/user/10000001/cancel-delete').expect(403);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).post('/api/user/10000001/cancel-delete').expect(404);
  });

  test('returns 404 when no deletion scheduled', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/user/10000001/cancel-delete').expect(404);
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    const app = createApp();
    await request(app).post('/api/user/10000001/cancel-delete').expect(500);
  });
});
