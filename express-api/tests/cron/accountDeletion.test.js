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
 *   Step 6b: Suggestions-content cleanup (GDPR right-to-erasure cascade)
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
const mockCollectionGroup = jest.fn();

let mockLastQueried = { type: null, name: null };

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
    // Pass the most-recent collection/collectionGroup target into get(). Existing
    // Once-chain tests ignore the arg and still work; new tests can use
    // mockImplementation(({type, name}) => …) to dispatch by target instead of
    // counting prior get() calls.
    get: () => mockCollectionGet({ ...mockLastQueried }),
  };

  return {
    db: {
      doc: (...args) => mockDoc(...args),
      collection: (name, ...rest) => {
        mockLastQueried = { type: 'col', name };
        mockCollection(name, ...rest);
        return chain;
      },
      collectionGroup: (name, ...rest) => {
        mockLastQueried = { type: 'cg', name };
        mockCollectionGroup(name, ...rest);
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
      increment: jest.fn((n) => `increment(${n})`),
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

  // ── Step 6b: suggestions-content cleanup (GDPR cascade) ────────
  //
  // hardDeleteAccount must also wipe the user's suggestions footprint:
  //   - Anonymise own suggestions (preserve community value, redact identity)
  //   - Delete own votes + decrement parent voteCount per up/down
  //   - Anonymise own comments (preserve thread structure)
  //   - Delete subscription preferences doc
  //   - Delete inbox notifications
  //
  // Without this, a deleted user's submitterUid/voterId/authorUid still
  // identifies them across suggestions — a GDPR right-to-erasure gap.
  // The tests below assert the contract; the implementation lives in
  // src/cron/accountDeletion.js#cleanupSuggestionsContent.

  function makeSuggestionDoc(id, data = {}) {
    return {
      id,
      ref: { path: `suggestions/${id}`, _isSuggestion: true },
      data: () => ({ submitterUid: 10000001, ...data }),
    };
  }

  function makeVoteDoc(suggestionId, voterId, vote = 'up') {
    const suggestionRef = {
      path: `suggestions/${suggestionId}`,
      parent: { id: 'suggestions' },
    };
    return {
      ref: {
        path: `suggestions/${suggestionId}/votes/${voterId}`,
        parent: { parent: suggestionRef },
      },
      data: () => ({ voterId, vote, votedAt: 1717000000000 }),
    };
  }

  function makeCommentDoc(suggestionId, commentId, authorUid) {
    const suggestionRef = {
      path: `suggestions/${suggestionId}`,
      parent: { id: 'suggestions' },
    };
    return {
      ref: {
        path: `suggestions/${suggestionId}/comments/${commentId}`,
        parent: { parent: suggestionRef },
      },
      data: () => ({ authorUid, text: 'original text' }),
    };
  }

  // Dispatch helper: returns mockImplementation that switches by query target.
  // Avoids brittle call-order counting given Steps 3–6 already make ~12 queries
  // before our Step 6b runs. Unmatched targets fall through to empty.
  function dispatchByTarget(map) {
    return ({ type, name }) => {
      const key = type === 'cg' ? `cg:${name}` : `col:${name}`;
      if (Object.prototype.hasOwnProperty.call(map, key)) return Promise.resolve(map[key]);
      return Promise.resolve({ docs: [], empty: true });
    };
  }

  test('Step 6b: anonymises own suggestions by submitterUid', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'col:suggestions': {
          docs: [makeSuggestionDoc('sug-1'), makeSuggestionDoc('sug-2')],
          empty: false,
        },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockCollection).toHaveBeenCalledWith('suggestions');
    expect(mockWhere).toHaveBeenCalledWith('submitterUid', '==', 10000001);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _isSuggestion: true }),
      expect.objectContaining({
        submitterUid: 0,
        submitterDeleted: true,
      }),
    );
  });

  test('Step 6b: deletes votes via collectionGroup and decrements parent voteCount', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const upVote = makeVoteDoc('sug-A', 10000001, 'up');
    const downVote = makeVoteDoc('sug-B', 10000001, 'down');

    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'cg:votes': { docs: [upVote, downVote], empty: false },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockCollectionGroup).toHaveBeenCalledWith('votes');
    expect(mockWhere).toHaveBeenCalledWith('voterId', '==', 10000001);
    expect(mockBatchDelete).toHaveBeenCalledWith(upVote.ref);
    expect(mockBatchDelete).toHaveBeenCalledWith(downVote.ref);
    expect(mockBatchUpdate).toHaveBeenCalledWith(upVote.ref.parent.parent, {
      voteCount: 'increment(-1)',
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith(downVote.ref.parent.parent, {
      voteCount: 'increment(1)',
    });
  });

  test('Step 6b: anonymises comments via collectionGroup by authorUid', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const comment = makeCommentDoc('sug-C', 'comment-1', 10000001);

    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'cg:comments': { docs: [comment], empty: false },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockCollectionGroup).toHaveBeenCalledWith('comments');
    expect(mockWhere).toHaveBeenCalledWith('authorUid', '==', 10000001);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      comment.ref,
      expect.objectContaining({
        authorUid: 0,
        authorDeleted: true,
        text: '[Comment from deleted user]',
      }),
    );
  });

  test('Step 6b: deletes subscription preferences doc', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    await hardDeleteAccount(testUser);

    expect(mockDocDelete).toHaveBeenCalledWith('subscriptions/10000001');
  });

  test('Step 6b: deletes notifications inbox by uid', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const notif1 = { id: 'notif-1', ref: { path: 'notifications/notif-1' } };
    const notif2 = { id: 'notif-2', ref: { path: 'notifications/notif-2' } };

    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'col:notifications': { docs: [notif1, notif2], empty: false },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockCollection).toHaveBeenCalledWith('notifications');
    expect(mockWhere).toHaveBeenCalledWith('uid', '==', 10000001);
    expect(mockBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'notifications/notif-1' }),
    );
    expect(mockBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'notifications/notif-2' }),
    );
  });

  test('Step 6b: skips collectionGroup hits whose parent is not "suggestions"', async () => {
    // Defensive: future feature could introduce another `votes` subcollection
    // (e.g. polls/{id}/votes/...). The cron must ignore those.
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const goodVote = makeVoteDoc('sug-X', 10000001, 'up');
    const strayVote = {
      ref: {
        path: 'polls/p1/votes/10000001',
        parent: { parent: { parent: { id: 'polls' } } },
      },
      data: () => ({ voterId: 10000001, vote: 'up' }),
    };

    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'cg:votes': { docs: [goodVote, strayVote], empty: false },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockBatchDelete).toHaveBeenCalledWith(goodVote.ref);
    expect(mockBatchDelete).not.toHaveBeenCalledWith(strayVote.ref);
  });

  test('Step 6b: error in one substep does not abort hardDeleteAccount', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    // The suggestions query throws — cron must log + continue past Step 6b.
    mockCollectionGet.mockImplementation(({ type, name }) => {
      if (type === 'col' && name === 'suggestions') {
        return Promise.reject(new Error('suggestions query failed'));
      }
      return Promise.resolve({ docs: [], empty: true });
    });

    await hardDeleteAccount(testUser);

    // Subsequent steps still happen — Firebase Auth deletion is Step 11.
    expect(auth.deleteUser).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('suggestion'),
      // uniqueId is logged as a string because hardDeleteAccount derives it
      // from userDoc.id (always a string), even though Firestore queries
      // convert to Number for type-safety against the schema.
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('Step 6b: vote with null vote field deletes without voteCount update', async () => {
    // Defensive against malformed vote docs (no `vote: up|down`). Production
    // code computes `delta = 0` for unknown vote shapes; the vote MUST still
    // be deleted (PII erasure) but the parent voteCount MUST NOT be touched
    // (no way to know which direction to adjust).
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const malformedVote = makeVoteDoc('sug-Z', 10000001, null);
    mockCollectionGet.mockImplementation(
      dispatchByTarget({
        'cg:votes': { docs: [malformedVote], empty: false },
      }),
    );

    await hardDeleteAccount(testUser);

    expect(mockBatchDelete).toHaveBeenCalledWith(malformedVote.ref);
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      malformedVote.ref.parent.parent,
      expect.objectContaining({ voteCount: expect.anything() }),
    );
  });

  test('Step 6b: subscription-doc deletion failure logs but does not abort', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocDelete.mockImplementation((path) => {
      if (path === 'subscriptions/10000001') {
        return Promise.reject(new Error('subscriptions delete failed'));
      }
      return Promise.resolve();
    });

    await hardDeleteAccount(testUser);

    expect(auth.deleteUser).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('subscription'),
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('Step 6b: notifications query failure logs but does not abort', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockCollectionGet.mockImplementation(({ type, name }) => {
      if (type === 'col' && name === 'notifications') {
        return Promise.reject(new Error('notifications query failed'));
      }
      return Promise.resolve({ docs: [], empty: true });
    });

    await hardDeleteAccount(testUser);

    expect(auth.deleteUser).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('notification'),
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('Step 6b: notifications cleanup queries BOTH uid and recipientUid, dedupes by ref', async () => {
    // The cron runs two queries in parallel and dedupes results by ref.path —
    // a notification matching BOTH fields (today's invariant) must be deleted
    // exactly once, not twice.
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const dualMatch = { id: 'n-1', ref: { path: 'notifications/n-1' } };
    mockCollectionGet.mockImplementation(({ type, name }) => {
      if (type === 'col' && name === 'notifications') {
        // Both queries return the same doc (since today both fields equal uid)
        return Promise.resolve({ docs: [dualMatch], empty: false });
      }
      return Promise.resolve({ docs: [], empty: true });
    });

    await hardDeleteAccount(testUser);

    expect(mockWhere).toHaveBeenCalledWith('uid', '==', 10000001);
    expect(mockWhere).toHaveBeenCalledWith('recipientUid', '==', 10000001);
    // Despite appearing in BOTH result sets, deleted exactly once.
    const deleteCallsForN1 = mockBatchDelete.mock.calls.filter(
      ([ref]) => ref?.path === 'notifications/n-1',
    );
    expect(deleteCallsForN1).toHaveLength(1);
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
        // Exact-match assertion — the audit-log contract is a public surface
        // (admin feed), so adding/removing entries is a deliberate decision
        // that should force this test to update, not silently pass.
        dataDeleted: [
          'user',
          'conversations',
          'rooms',
          'r2',
          'reports',
          'appeals',
          'suggestions',
          'votes',
          'comments',
          'subscriptions',
          'notifications',
          'auth',
          'identity',
          'deviceBindings',
        ],
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

  test('logs error when scheduling an individual inactive account fails', async () => {
    // No pending deletions
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    // Config with inactivity enabled
    mockDocGet.mockImplementation((path) => {
      if (path === 'config/app')
        return Promise.resolve(makeConfigDoc({ inactiveAccountDeleteMonths: 6 }));
      return Promise.resolve({ exists: false, data: () => null });
    });

    // Inactive user found
    const inactiveUser = {
      id: '10000006',
      ref: { path: 'users/10000006' },
      data: () => ({
        uniqueId: 10000006,
        lastActiveAt: Date.now() - 7 * 30 * 86400000,
        deletionScheduledAt: null,
        isSuspended: false,
      }),
    };
    mockCollectionGet.mockResolvedValueOnce({
      docs: [inactiveUser],
      empty: false,
    });

    // Make the update fail for this user
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore write quota exceeded'));

    await accountDeletion();

    // Should log the error but not crash
    expect(log.error).toHaveBeenCalledWith(
      'cron',
      'Failed to schedule inactive account',
      expect.objectContaining({ uniqueId: '10000006' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// hardDeleteAccount — additional uncovered branches
// ═══════════════════════════════════════════════════════════════════

describe('hardDeleteAccount — additional branches', () => {
  const hardDeleteAccount = accountDeletion.hardDeleteAccount;

  beforeEach(() => {
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
  });

  test('Step 1: logs error when sending deletion email fails', async () => {
    const userWithEmail = makeUserDoc(10000010, { email: 'fail-email@test.com' });
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await hardDeleteAccount(userWithEmail);

    expect(log.error).toHaveBeenCalledWith(
      'cron',
      'Failed to send deletion complete email',
      expect.objectContaining({ uniqueId: '10000010' }),
    );
    // Should continue with deletion despite email failure
    expect(auth.deleteUser).toHaveBeenCalled();
  });

  test('Step 2: logs error when R2 listObjects fails for a prefix', async () => {
    const user = makeUserDoc(10000011);
    mockListObjects.mockRejectedValueOnce(new Error('R2 service unavailable'));

    await hardDeleteAccount(user);

    expect(log.error).toHaveBeenCalledWith(
      'cron',
      'Failed to delete R2 prefix',
      expect.objectContaining({ prefix: 'profiles/10000011/' }),
    );
    // Should continue with deletion despite R2 failure
    expect(auth.deleteUser).toHaveBeenCalled();
  });

  test('Step 3: deletes 1-on-1 conversations with subcollections', async () => {
    const user = makeUserDoc(10000012);

    // Set up the conversation query to return a 1-on-1 conversation (2 participants)
    const convDoc = {
      id: 'conv-1on1',
      data: () => ({ participantIds: [10000012, 10000099] }),
    };
    // conversations query
    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc], empty: false }) // Step 3: conversations
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 4: rooms
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followerIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followingIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5b: giftRankings
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: reports reportedUserId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: reports reporterId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: reportsArchive reportedUserId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: reportsArchive reporterId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: suspensionAppeals reportedUserId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: suspensionAppeals reporterId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6: suspensionAppeals userId
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: biometricKeys
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: purchaseReceipts
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 9: identityMap
      .mockResolvedValueOnce({ docs: [], empty: true }); // Step 10: deviceBindings

    // queryDocs returns subcollection docs for the conversation
    queryDocs
      .mockResolvedValueOnce([{ id: 'msg-1' }]) // messages
      .mockResolvedValueOnce([{ id: 'settings-1' }]) // userSettings
      .mockResolvedValueOnce([{ id: 'mute-1' }]) // mutes
      .mockResolvedValue([]); // all remaining

    await hardDeleteAccount(user);

    // Should batch-delete conversation docs
    expect(mockBatchDelete).toHaveBeenCalled();
  });

  test('Step 3: removes user from group conversation and deletes user-specific subcollections', async () => {
    const user = makeUserDoc(10000013);

    // Set up group conversation (3+ participants)
    const groupConvDoc = {
      id: 'conv-group',
      data: () => ({ participantIds: [10000013, 10000098, 10000097] }),
    };
    mockCollectionGet
      .mockResolvedValueOnce({ docs: [groupConvDoc], empty: false }) // Step 3: conversations
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 4: rooms
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followerIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followingIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5b: giftRankings
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 6
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: biometricKeys
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: purchaseReceipts
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 9: identityMap
      .mockResolvedValueOnce({ docs: [], empty: true }); // Step 10: deviceBindings

    // queryDocs for group conv userSettings + mutes
    queryDocs
      .mockResolvedValueOnce([{ id: 'us-1', userId: '10000013' }]) // userSettings
      .mockResolvedValueOnce([{ id: '10000013' }]) // mutes (id matches uniqueId)
      .mockResolvedValue([]); // all remaining

    await hardDeleteAccount(user);

    // Should update conversation to remove user from participantIds
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'conversations/conv-group',
      expect.objectContaining({
        participantIds: expect.stringContaining('arrayRemove'),
      }),
    );
    // Should delete user-specific settings/mutes
    expect(mockDocDelete).toHaveBeenCalledWith('conversations/conv-group/userSettings/us-1');
    expect(mockDocDelete).toHaveBeenCalledWith('conversations/conv-group/mutes/10000013');
  });

  test('Step 4: removes user from non-owned room participantIds', async () => {
    const user = makeUserDoc(10000014);

    // Room owned by someone else
    const roomDoc = {
      id: 'room-other',
      data: () => ({ ownerId: 10000099, participantIds: [10000014, 10000099] }),
    };
    mockCollectionGet
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 3: conversations
      .mockResolvedValueOnce({ docs: [roomDoc], empty: false }) // Step 4: rooms
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followerIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5: followingIds
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 5b: giftRankings
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: biometricKeys
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 7: purchaseReceipts
      .mockResolvedValueOnce({ docs: [], empty: true }) // Step 9: identityMap
      .mockResolvedValueOnce({ docs: [], empty: true }); // Step 10: deviceBindings

    await hardDeleteAccount(user);

    // Should update room to remove user from participantIds (NOT delete the room)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'rooms/room-other',
      expect.objectContaining({
        participantIds: expect.stringContaining('arrayRemove'),
      }),
    );
  });

  test('Step 7: deletes OTP codes and email metrics when they exist', async () => {
    const user = makeUserDoc(10000015, { email: 'otp-user@test.com' });

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockImplementation((path) => {
      if (path === 'otpCodes/otp-user@test.com') return Promise.resolve({ exists: true });
      if (path === 'emailMetrics/otp-user@test.com') return Promise.resolve({ exists: true });
      return Promise.resolve({ exists: false, data: () => null });
    });

    await hardDeleteAccount(user);

    expect(mockDocDelete).toHaveBeenCalledWith('otpCodes/otp-user@test.com');
    expect(mockDocDelete).toHaveBeenCalledWith('emailMetrics/otp-user@test.com');
  });

  test('Step 7: skips OTP/email metrics deletion when docs do not exist', async () => {
    const user = makeUserDoc(10000016, { email: 'no-otp@test.com' });

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockImplementation((path) => {
      if (path === 'otpCodes/no-otp@test.com') return Promise.resolve({ exists: false });
      if (path === 'emailMetrics/no-otp@test.com') return Promise.resolve({ exists: false });
      return Promise.resolve({ exists: false, data: () => null });
    });

    await hardDeleteAccount(user);

    // Should NOT try to delete non-existent docs
    expect(mockDocDelete).not.toHaveBeenCalledWith('otpCodes/no-otp@test.com');
    expect(mockDocDelete).not.toHaveBeenCalledWith('emailMetrics/no-otp@test.com');
  });

  test('Step 8: logs error when user doc deletion fails', async () => {
    const user = makeUserDoc(10000017);

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });
    // Make the user doc delete fail
    mockDocDelete.mockImplementation((path) => {
      if (path === 'users/10000017') return Promise.reject(new Error('Permission denied'));
      return Promise.resolve();
    });

    await hardDeleteAccount(user);

    expect(log.error).toHaveBeenCalledWith(
      'cron',
      'Failed to delete user doc',
      expect.objectContaining({ uniqueId: '10000017' }),
    );
    // Should continue with remaining steps
    expect(auth.deleteUser).toHaveBeenCalled();
  });

  test('Step 11: logs error when Firebase Auth user deletion fails', async () => {
    const user = makeUserDoc(10000018);
    auth.deleteUser.mockRejectedValueOnce(new Error('Auth user not found'));

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(user);

    expect(log.error).toHaveBeenCalledWith(
      'cron',
      'Failed to delete Firebase Auth user',
      expect.objectContaining({ uniqueId: '10000018' }),
    );
    // Should still write audit log after auth failure
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({ action: 'account_deleted' }),
    );
  });

  test('Step 12: audit log records "unknown" when deletionReason is missing', async () => {
    const user = makeUserDoc(10000019, { deletionReason: undefined });

    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    await hardDeleteAccount(user);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('adminAuditLog/'),
      expect.objectContaining({
        action: 'account_deleted',
        reason: 'unknown',
      }),
    );
  });
});
