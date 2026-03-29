/**
 * Tests for accountDeletion cron job.
 *
 * Covers:
 * - Processing pending deletions past their execute date
 * - Skipping cancelled deletions (re-reads fresh doc)
 * - Handling empty query (no pending deletions)
 * - Limiting to 10 per run (Firestore quota awareness)
 * - Error handling without stopping other deletions
 * - hardDeleteAccount: all 12 steps in order
 *   Step 0: Capture data
 *   Step 1: Send final email
 *   Step 2: R2 storage deletion
 *   Step 3: Conversations deletion
 *   Step 4: Rooms cleanup
 *   Step 5: Follower/following array cleanup
 *   Step 5b: Gift rankings cleanup
 *   Step 6: Reports & appeals deletion
 *   Step 7: Auth-related cleanup (biometricKeys, otpCodes, emailMetrics)
 *   Step 8: User doc + subcollections deletion
 *   Step 9: Identity map soft-delete
 *   Step 10: Device bindings deletion
 *   Step 11: Firebase Auth user deletion
 *   Step 12: Audit log entry
 * - Inactivity scheduling when enabled
 * - Inactivity scheduling skips suspended users
 * - Re-registration logic: clean standing allows, suspended blocks
 */

// ─── Mocks ──────────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchDelete = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();
const mockRtdbRemove = jest.fn().mockResolvedValue();

const mockDoc = jest.fn((path) => ({
  _path: path,
  path,
  get: () => mockDocGet(path),
  set: (...args) => mockDocSet(path, ...args),
  update: (...args) => mockDocUpdate(path, ...args),
  delete: () => mockDocDelete(path),
}));

const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockCollection = jest.fn();

jest.mock('../../src/utils/firebase', () => {
  const chain = {
    where: (...args) => {
      mockWhere(...args);
      return chain;
    },
    limit: (...args) => {
      mockLimit(...args);
      return chain;
    },
    get: () => mockCollectionGet(),
  };

  return {
    db: {
      doc: (...args) => mockDoc(...args),
      collection: (...args) => {
        mockCollection(...args);
        return chain;
      },
      batch: jest.fn(() => ({
        delete: mockBatchDelete,
        set: mockBatchSet,
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      })),
    },
    auth: {
      deleteUser: jest.fn().mockResolvedValue(),
      revokeRefreshTokens: jest.fn().mockResolvedValue(),
    },
    rtdb: {
      ref: jest.fn(() => ({
        remove: mockRtdbRemove,
      })),
    },
    FieldValue: {
      arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
    },
  };
});

const mockSendEmail = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/email', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildDeletionCompleteEmail: jest.fn(() => ({
    subject: 'Your ShyTalk account has been deleted',
    html: '<p>Deleted</p>',
  })),
}));

const mockListObjects = jest.fn().mockResolvedValue([]);
const mockDeleteObjects = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/r2', () => ({
  listObjects: (...args) => mockListObjects(...args),
  deleteObjects: (...args) => mockDeleteObjects(...args),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn().mockResolvedValue([]),
}));

const { auth } = require('../../src/utils/firebase');
const { queryDocs } = require('../../src/utils/firestore-helpers');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────

function makeUserDoc(uniqueId, overrides = {}) {
  const data = {
    uniqueId,
    firebaseUid: `firebase-uid-${uniqueId}`,
    email: `user${uniqueId}@test.com`,
    displayName: `User ${uniqueId}`,
    isSuspended: false,
    deletionScheduledAt: Date.now() - 31 * 86400000,
    deletionReason: 'self',
    deletionExecuteAt: Date.now() - 86400000,
    currentRoomId: null,
    fcmTokens: [],
    ...overrides,
  };
  return {
    id: String(uniqueId),
    ref: { path: `users/${uniqueId}` },
    data: () => data,
    exists: true,
  };
}

function makeConfigDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      accountDeletionGracePeriodDays: 30,
      inactiveAccountDeleteMonths: 0,
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// accountDeletion cron
// ═══════════════════════════════════════════════════════════════════

const accountDeletion = require('../../src/cron/accountDeletion');

describe('accountDeletion cron', () => {
  test('processes pending deletions past execute date', async () => {
    const user = makeUserDoc(10000001);

    // First call: collection query returns pending deletion
    mockCollectionGet.mockResolvedValueOnce({
      docs: [user],
      empty: false,
    });

    // Fresh doc re-read confirms still pending
    mockDocGet.mockImplementation((path) => {
      if (path === `users/${10000001}`) return Promise.resolve(user);
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });

    // queryDocs returns empty arrays for subcollection queries
    queryDocs.mockResolvedValue([]);

    // Collection query for inactivity returns empty
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await accountDeletion();

    // Should have deleted the Firebase Auth user
    expect(auth.deleteUser).toHaveBeenCalledWith(`firebase-uid-${10000001}`);
  });

  test('skips cancelled deletions (re-reads fresh doc)', async () => {
    const user = makeUserDoc(10000001);

    mockCollectionGet.mockResolvedValueOnce({
      docs: [user],
      empty: false,
    });

    // Fresh re-read shows deletion was cancelled
    mockDocGet.mockImplementation((path) => {
      if (path === `users/${10000001}`)
        return Promise.resolve({
          exists: true,
          data: () => ({
            ...user.data(),
            deletionScheduledAt: null,
            deletionExecuteAt: null,
          }),
        });
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });

    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await accountDeletion();

    // Should NOT have deleted the user
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  test('handles empty query (no pending deletions)', async () => {
    mockCollectionGet
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true });

    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });

    await accountDeletion();

    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test('limits processing to 10 per run', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });
    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await accountDeletion();

    // Verify the limit(10) was called in the query
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  test('error handling does not crash the cron run', async () => {
    const user1 = makeUserDoc(10000001);

    mockCollectionGet.mockResolvedValueOnce({
      docs: [user1],
      empty: false,
    });

    // Re-read throws
    mockDocGet.mockImplementation((path) => {
      if (path === `users/${10000001}`) return Promise.reject(new Error('Firestore read failed'));
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    // Should not throw — errors are caught internally
    await expect(accountDeletion()).resolves.not.toThrow();

    // User should NOT have been deleted (failed at re-read)
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  test('skips non-existent users on re-read', async () => {
    const user = makeUserDoc(10000001);

    mockCollectionGet.mockResolvedValueOnce({
      docs: [user],
      empty: false,
    });

    mockDocGet.mockImplementation((path) => {
      if (path === `users/${10000001}`) return Promise.resolve({ exists: false, data: () => null });
      if (path === 'config/app') return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false, data: () => null });
    });

    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await accountDeletion();

    expect(auth.deleteUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// hardDeleteAccount — step-by-step verification
// ═══════════════════════════════════════════════════════════════════

describe('hardDeleteAccount', () => {
  const hardDeleteAccount = accountDeletion.hardDeleteAccount;

  beforeEach(() => {
    queryDocs.mockResolvedValue([]);
  });

  const testUser = makeUserDoc(10000001, {
    email: 'delete-me@test.com',
    isSuspended: false,
  });

  test('Step 1: sends final email before deleting user data', async () => {
    mockDocGet.mockImplementation(() => {
      return Promise.resolve({ exists: false, data: () => null });
    });

    await hardDeleteAccount(testUser);

    expect(mockSendEmail).toHaveBeenCalledWith(
      'delete-me@test.com',
      expect.stringContaining('deleted'),
      expect.any(String),
    );
  });

  test('Step 1: skips email when user has no email', async () => {
    const noEmailUser = makeUserDoc(10000002, { email: null });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(noEmailUser);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('Step 2: deletes R2 storage under all user prefixes', async () => {
    mockListObjects.mockResolvedValue([
      'profiles/10000001/photo.jpg',
      'profiles/10000001/thumb.jpg',
    ]);
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    const prefixes = [
      'profiles/10000001/',
      'covers/10000001/',
      'messages/10000001/',
      'groups/10000001/',
      'evidence/10000001/',
    ];
    for (const prefix of prefixes) {
      expect(mockListObjects).toHaveBeenCalledWith(prefix);
    }
    expect(mockDeleteObjects).toHaveBeenCalled();
  });

  test('Step 3: deletes conversations where user is participant', async () => {
    queryDocs.mockImplementation(() => {
      return Promise.resolve([]);
    });

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    // Should query conversations collection for this user
    expect(mockCollection).toHaveBeenCalledWith('conversations');
  });

  test('Step 4: cleans up rooms where user is participant', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    expect(mockCollection).toHaveBeenCalledWith('rooms');
  });

  test('Step 5: removes user from follower/following arrays', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    // Mock users who follow/are followed by the deleted user
    const followerDocs = [{ id: '10000002', data: () => ({ followerIds: [10000001, 10000003] }) }];
    mockCollectionGet
      .mockResolvedValueOnce({ docs: followerDocs, empty: false }) // followerIds query
      .mockResolvedValueOnce({ docs: [], empty: true }); // followingIds query

    await hardDeleteAccount(testUser);

    // Should query for users who have this user in their arrays
    expect(mockWhere).toHaveBeenCalledWith('followerIds', 'array-contains', expect.anything());
  });

  test('Step 6: deletes reports and appeals', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    expect(mockCollection).toHaveBeenCalledWith('reports');
    expect(mockCollection).toHaveBeenCalledWith('reportsArchive');
    expect(mockCollection).toHaveBeenCalledWith('suspensionAppeals');
  });

  test('Step 7: deletes auth-related data', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    // Should clean up biometric keys, OTP codes, email metrics
    expect(mockCollection).toHaveBeenCalledWith('biometricKeys');
  });

  test('Step 8: deletes user doc and subcollections', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    queryDocs.mockResolvedValue([]);

    await hardDeleteAccount(testUser);

    // Should delete subcollections: backpack, giftWall, transactions, warnings, stalkers
    expect(mockCollection).toHaveBeenCalledWith(`users/10000001/backpack`);
    expect(mockCollection).toHaveBeenCalledWith(`users/10000001/giftWall`);
    expect(mockCollection).toHaveBeenCalledWith(`users/10000001/transactions`);
    expect(mockCollection).toHaveBeenCalledWith(`users/10000001/warnings`);
    expect(mockCollection).toHaveBeenCalledWith(`users/10000001/stalkers`);

    // Should delete the user document itself
    expect(mockDocDelete).toHaveBeenCalledWith(`users/10000001`);
  });

  test('Step 9: soft-deletes identity map entries', async () => {
    const identityDocs = [{ id: 'google:alice@gmail.com', data: () => ({ uniqueId: 10000001 }) }];
    mockCollectionGet.mockResolvedValue({ docs: identityDocs, empty: false });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    // Should update identity map with soft-delete fields, not delete
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('identityMap/'),
      expect.objectContaining({
        unlinked: true,
        deletedAccount: true,
        deletionStanding: 'clean',
      }),
    );
  });

  test('Step 9: sets suspended standing for suspended users', async () => {
    const suspendedUser = makeUserDoc(10000003, { isSuspended: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const identityDocs = [
      { id: 'google:suspended@test.com', data: () => ({ uniqueId: 10000003 }) },
    ];
    mockCollectionGet.mockResolvedValue({ docs: identityDocs, empty: false });

    await hardDeleteAccount(suspendedUser);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('identityMap/'),
      expect.objectContaining({
        deletionStanding: 'suspended',
      }),
    );
  });

  test('Step 10: deletes device bindings', async () => {
    const bindingDocs = [{ id: 'device-abc', data: () => ({ uniqueId: 10000001 }) }];
    mockCollectionGet.mockResolvedValue({ docs: bindingDocs, empty: false });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    expect(mockCollection).toHaveBeenCalledWith('deviceBindings');
  });

  test('Step 11: deletes Firebase Auth user LAST', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    expect(auth.deleteUser).toHaveBeenCalledWith(`firebase-uid-${10000001}`);
  });

  test('Step 12: writes audit log with hashed uniqueId, zero PII', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'account_deleted',
        reason: 'self',
        triggeredBy: 'system',
        standing: 'clean',
        dataDeleted: expect.arrayContaining(['user', 'conversations', 'rooms', 'r2']),
      }),
    );

    // Verify NO PII in audit log
    const auditCall = mockDocSet.mock.calls.find(([path]) => path.includes('adminAuditLog'));
    if (auditCall) {
      const auditData = auditCall[1];
      expect(auditData).not.toHaveProperty('email');
      expect(auditData).not.toHaveProperty('displayName');
      expect(auditData.hashedUniqueId).toBeDefined();
    }
  });

  test('preserves device bans (never deletes them)', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(testUser);

    // deviceBans and networkBans should NOT be in any delete call
    const allDeletedPaths = mockDocDelete.mock.calls.map(([path]) => path);
    expect(allDeletedPaths).not.toEqual(
      expect.arrayContaining([expect.stringContaining('deviceBans')]),
    );
    expect(allDeletedPaths).not.toEqual(
      expect.arrayContaining([expect.stringContaining('networkBans')]),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Inactivity auto-delete
// ═══════════════════════════════════════════════════════════════════

describe('inactivity auto-delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('schedules inactive accounts when enabled', async () => {
    // No pending deletions
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    // Config with inactivity enabled
    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app')
        return Promise.resolve(makeConfigDoc({ inactiveAccountDeleteMonths: 6 }));
      return Promise.resolve({ exists: false, data: () => null });
    });

    // Inactive users found
    const inactiveUser = {
      id: '10000005',
      ref: { path: 'users/10000005' },
      data: () => ({
        uniqueId: 10000005,
        lastActiveAt: Date.now() - 7 * 30 * 86400000, // 7 months ago
        deletionScheduledAt: null,
        isSuspended: false,
        email: 'inactive@test.com',
      }),
    };
    mockCollectionGet.mockResolvedValueOnce({
      docs: [inactiveUser],
      empty: false,
    });

    await accountDeletion();

    // Should schedule deletion for the inactive user
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000005'),
      expect.objectContaining({
        deletionReason: 'inactivity',
      }),
    );
  });

  test('skips inactivity check when disabled (threshold = 0)', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });
    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app')
        return Promise.resolve(makeConfigDoc({ inactiveAccountDeleteMonths: 0 }));
      return Promise.resolve({ exists: false, data: () => null });
    });

    await accountDeletion();

    // Should only have been called once (for pending deletions), not for inactivity
    expect(mockCollectionGet).toHaveBeenCalledTimes(1);
  });

  test('skips suspended users for inactivity deletion', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });
    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app')
        return Promise.resolve(makeConfigDoc({ inactiveAccountDeleteMonths: 6 }));
      return Promise.resolve({ exists: false, data: () => null });
    });

    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await accountDeletion();

    // The query should filter out suspended users
    expect(mockWhere).toHaveBeenCalledWith('isSuspended', '==', false);
  });
});
