/**
 * Tests for account deletion user-facing routes.
 *
 * POST   /api/users/:uniqueId/delete          → Schedule account deletion
 * POST   /api/users/:uniqueId/cancel-delete   → Cancel scheduled deletion
 * GET    /api/users/:uniqueId/deletion-status  → Check deletion status
 *
 * Covers:
 * - Owner-only access control
 * - PIN verification before deletion
 * - Biometric verification before deletion
 * - Deletion field updates on user doc
 * - Refresh token revocation
 * - Email and push notifications on schedule
 * - Room eviction on deletion
 * - Cancel flow (self-initiated only)
 * - Admin-initiated cannot be cancelled by user
 * - Deletion status reporting
 * - Config-driven grace period
 * - Edge cases: already scheduled, not found, server errors
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionWhere = jest.fn();
const mockCollectionGet = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

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
        get: mockCollectionGet,
      };
      mockCollectionWhere.mockReturnValue(chain);
      return chain;
    }),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  },
  auth: {
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

const mockBcryptCompare = jest.fn();
jest.mock('bcrypt', () => ({
  compare: (...args) => mockBcryptCompare(...args),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
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

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// getDoc imported for potential future use in tests
require('../../src/utils/firestore-helpers');
const { auth } = require('../../src/utils/firebase');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

function createApp(uid = 'firebase-uid-A', uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────

function mockUserDoc(uniqueId, overrides = {}) {
  const userData = {
    uniqueId,
    firebaseUid: 'firebase-uid-A',
    email: 'test@example.com',
    displayName: 'Test User',
    pinHash: '$2b$10$hashedpin',
    fcmTokens: ['token-1', 'token-2'],
    currentRoomId: null,
    isSuspended: false,
    deletionScheduledAt: null,
    deletionReason: null,
    deletionExecuteAt: null,
    ...overrides,
  };
  return {
    exists: true,
    data: () => userData,
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

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/delete
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/delete', () => {
  const app = createApp();

  test('schedules deletion with valid PIN', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: '123456' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleteAt).toBeDefined();
    expect(typeof res.body.deleteAt).toBe('number');

    // Should set deletion fields on user doc
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        deletionScheduledAt: expect.any(Number),
        deletionReason: 'self',
        deletionExecuteAt: expect.any(Number),
      }),
    );

    // Should revoke refresh tokens
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-A');

    // Should send email
    expect(mockSendEmail).toHaveBeenCalled();

    // Should send push notification
    expect(mockSendFcmToTokens).toHaveBeenCalled();
  });

  test('returns 403 when not the owner', async () => {
    const otherApp = createApp('other-uid', 99999999);
    await request(otherApp).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(403);
  });

  test('returns 400 when PIN not provided', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).post('/api/users/10000001/delete').send({}).expect(400);

    expect(res.body.error).toMatch(/pin.*required|verification required/i);
  });

  test('returns 401 when PIN is wrong', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(false);

    await request(app).post('/api/users/10000001/delete').send({ pin: 'wrong' }).expect(401);
  });

  // ── PR #495 (audit H4): bcrypt DoS via PIN length validation ──

  test('rejects PIN > 16 characters before bcrypt.compare (DoS guard)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: 'a'.repeat(1000) })
      .expect(400);

    expect(res.body.error).toMatch(/4-16 characters/i);
    // bcrypt.compare must NOT have been called — short-circuit guard
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  test('rejects PIN < 4 characters', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: '12' })
      .expect(400);

    expect(res.body.error).toMatch(/4-16 characters/i);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(404);
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
    mockBcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: '123456' })
      .expect(409);

    expect(res.body.error).toMatch(/already scheduled/i);
  });

  test('uses grace period from config', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(7));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: '123456' })
      .expect(200);

    // 7 days grace period
    const expectedDeleteAt = 1709913600000 + 7 * 86400000;
    expect(res.body.deleteAt).toBe(expectedDeleteAt);
  });

  test('evicts user from active room on deletion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(mockUserDoc(10000001, { currentRoomId: 'room-1' }));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      if (path === 'rooms/room-1')
        return Promise.resolve({
          exists: true,
          data: () => ({
            participantIds: [10000001, 10000002],
            seats: { 0: { userId: 10000001 }, 1: { userId: 10000002 } },
          }),
        });
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(200);

    // Should clear currentRoomId
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        currentRoomId: null,
      }),
    );
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(500);
  });

  test('handles user with no PIN set', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(mockUserDoc(10000001, { pinHash: null }));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/users/10000001/delete')
      .send({ pin: '123456' })
      .expect(400);

    expect(res.body.error).toMatch(/no pin set|pin not configured/i);
  });

  test('does not send email when user has no email', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001, { email: null }));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(200);

    expect(mockSendEmail).not.toHaveBeenCalled();
    // Push notification should still be sent
    expect(mockSendFcmToTokens).toHaveBeenCalled();
  });

  test('does not send push when user has no FCM tokens', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(mockUserDoc(10000001, { fcmTokens: [] }));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('writes audit log entry', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      if (path === 'config/app') return Promise.resolve(mockConfigDoc(30));
      return Promise.resolve({ exists: false });
    });
    mockBcryptCompare.mockResolvedValue(true);

    await request(app).post('/api/users/10000001/delete').send({ pin: '123456' }).expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'ACCOUNT_DELETION_SCHEDULED',
        targetUserId: '10000001',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/cancel-delete
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/cancel-delete', () => {
  const app = createApp();

  test('cancels self-initiated deletion', async () => {
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

    const res = await request(app).post('/api/users/10000001/cancel-delete').expect(200);

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

  test('returns 403 when not the owner', async () => {
    const otherApp = createApp('other-uid', 99999999);
    await request(otherApp).post('/api/users/10000001/cancel-delete').expect(403);
  });

  test('returns 403 when deletion was admin-initiated', async () => {
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

    const res = await request(app).post('/api/users/10000001/cancel-delete').expect(403);

    expect(res.body.error).toMatch(/admin.*cannot.*cancel|cannot cancel admin/i);
  });

  test('returns 404 when no deletion scheduled', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: null,
            deletionReason: null,
            deletionExecuteAt: null,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    await request(app).post('/api/users/10000001/cancel-delete').expect(404);
  });

  test('returns 410 when deletion already executed', async () => {
    // now() is mocked to 1709913600000, so set executeAt before that
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: 1709913600000 - 31 * 86400000,
            deletionReason: 'self',
            deletionExecuteAt: 1709913600000 - 86400000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    await request(app).post('/api/users/10000001/cancel-delete').expect(410);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    await request(app).post('/api/users/10000001/cancel-delete').expect(404);
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    await request(app).post('/api/users/10000001/cancel-delete').expect(500);
  });

  test('writes audit log on cancellation', async () => {
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

    await request(app).post('/api/users/10000001/cancel-delete').expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'ACCOUNT_DELETION_CANCELLED',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/deletion-status
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/deletion-status', () => {
  const app = createApp();

  test('returns scheduled status when deletion is pending', async () => {
    const scheduledAt = Date.now();
    const executeAt = scheduledAt + 30 * 86400000;
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            deletionScheduledAt: scheduledAt,
            deletionReason: 'self',
            deletionExecuteAt: executeAt,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).get('/api/users/10000001/deletion-status').expect(200);

    expect(res.body.scheduled).toBe(true);
    expect(res.body.scheduledAt).toBe(scheduledAt);
    expect(res.body.executeAt).toBe(executeAt);
    expect(res.body.reason).toBe('self');
    expect(typeof res.body.daysRemaining).toBe('number');
    expect(res.body.daysRemaining).toBeGreaterThan(0);
  });

  test('returns not-scheduled status when no deletion pending', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).get('/api/users/10000001/deletion-status').expect(200);

    expect(res.body.scheduled).toBe(false);
    expect(res.body.scheduledAt).toBeNull();
    expect(res.body.executeAt).toBeNull();
    expect(res.body.reason).toBeNull();
    expect(res.body.daysRemaining).toBeNull();
  });

  test('returns 403 when not owner', async () => {
    const otherApp = createApp('other-uid', 99999999);
    await request(otherApp).get('/api/users/10000001/deletion-status').expect(403);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    await request(app).get('/api/users/10000001/deletion-status').expect(404);
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    await request(app).get('/api/users/10000001/deletion-status').expect(500);
  });
});
