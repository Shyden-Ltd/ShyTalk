const emptySnap = { empty: true, size: 0, docs: [] };

function makeDoc(id, data) {
  const subcollections = {};
  return {
    id,
    data: () => data,
    ref: {
      path: `col/${id}`,
      delete: jest.fn().mockResolvedValue(undefined),
      collection: jest.fn((name) => {
        if (!subcollections[name]) {
          subcollections[name] = {
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue(emptySnap),
            }),
          };
        }
        return subcollections[name];
      }),
    },
  };
}

function makeDocWithSubcollectionData(id, data, subData) {
  const subcollections = {};
  return {
    id,
    data: () => data,
    ref: {
      path: `col/${id}`,
      delete: jest.fn().mockResolvedValue(undefined),
      collection: jest.fn((name) => {
        if (!subcollections[name]) {
          const subDocs = (subData[name] || []).map((subId) => ({
            ref: { path: `col/${id}/${name}/${subId}` },
          }));
          subcollections[name] = {
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({
                empty: subDocs.length === 0,
                size: subDocs.length,
                docs: subDocs,
              }),
            }),
          };
        }
        return subcollections[name];
      }),
    },
  };
}

function makeSnapshot(docs) {
  return { empty: docs.length === 0, size: docs.length, docs };
}

// Track all collection queries
const collectionQueries = {};
const mockOrderBy = jest.fn().mockReturnValue({
  limit: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(emptySnap),
  }),
});
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue(undefined);
const mockDocSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn().mockImplementation(() => ({
  get: mockDocGet,
  update: mockDocUpdate,
  set: mockDocSet,
}));
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((name) => {
      if (!collectionQueries[name]) {
        collectionQueries[name] = [];
      }
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      collectionQueries[name].push(chain);
      return chain;
    }),
    batch: jest.fn(() => ({
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
    doc: mockDoc,
    runTransaction: jest.fn(),
  },
  FieldValue: {
    delete: jest.fn(() => '__FIELD_DELETE__'),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const testDataCleanup = require('../../src/cron/testDataCleanup');
const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(collectionQueries)) {
    delete collectionQueries[key];
  }
  // Default: mockDoc returns get/update/set
  mockDocGet.mockResolvedValue({ exists: false });
});

describe('testDataCleanup cron', () => {
  test('skips cleanup in production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await testDataCleanup();
    expect(db.collection).not.toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  test('queries all expected tagged collections', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    await testDataCleanup();

    const expectedCollections = [
      'users',
      'rooms',
      'gifts',
      'conversations',
      'banners',
      'funFacts',
      'reports',
      'suspensionAppeals',
      'alerts',
      'deviceBindings',
      'reportLocks',
    ];
    for (const col of expectedCollections) {
      expect(db.collection).toHaveBeenCalledWith(col);
    }

    process.env.NODE_ENV = originalEnv;
  });

  test('filters stale docs by createdAt client-side', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const freshDoc = makeDoc('fresh', { _testRun: 'test_abc', createdAt: now - 1000 });
    const staleDoc = makeDoc('stale', {
      _testRun: 'test_abc',
      createdAt: now - 2 * 60 * 60 * 1000,
    });

    // Make first collection (users) return both docs
    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(callIdx++ === 0 ? makeSnapshot([freshDoc, staleDoc]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Only the stale doc should be deleted, not the fresh one
    expect(staleDoc.ref.delete).toHaveBeenCalled();
    expect(freshDoc.ref.delete).not.toHaveBeenCalled();

    Date.now.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  test('deletes docs without createdAt (treated as stale)', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const noCreatedAtDoc = makeDoc('no-ts', { _testRun: 'test_abc' }); // No createdAt

    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(callIdx++ === 0 ? makeSnapshot([noCreatedAtDoc]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Doc without createdAt should be treated as stale (returns true)
    expect(noCreatedAtDoc.ref.delete).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('does not log when no documents are deleted', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    await testDataCleanup();
    expect(log.info).not.toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  test('logs deletion count when stale docs are removed', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const doc1 = makeDoc('d1', { _testRun: 'test_abc', createdAt: 0 });
    const doc2 = makeDoc('d2', { _testRun: 'test_abc', createdAt: 0 });

    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(callIdx++ === 0 ? makeSnapshot([doc1, doc2]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    expect(log.info).toHaveBeenCalledWith(
      'cron',
      'testDataCleanup: removed stale test data',
      expect.objectContaining({ deleted: expect.any(Number) }),
    );

    process.env.NODE_ENV = originalEnv;
  });

  test('restores counter when test users are deleted', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testUser = makeDoc('u1', { _testRun: 'test_abc', createdAt: 0, uniqueId: 100000099 });

    let callIdx = 0;
    const counterSetMock = jest.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate, set: counterSetMock });

    // Counter restoration query: orderBy('uniqueId', 'desc').limit(1)
    const maxUserDoc = makeDoc('real_user', { uniqueId: 100000050 });
    mockOrderBy.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(makeSnapshot([maxUserDoc])),
      }),
    });

    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(callIdx++ === 0 ? makeSnapshot([testUser]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Counter should be restored
    expect(mockDoc).toHaveBeenCalledWith('counters/uniqueId');
    expect(counterSetMock).toHaveBeenCalledWith({ value: 100000050 }, { merge: true });

    process.env.NODE_ENV = originalEnv;
  });

  // --- User subcollection cleanup (lines 38-40, 70-73) ---

  test('deletes user subcollections before deleting user doc', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testUser = makeDocWithSubcollectionData(
      'u1',
      { _testRun: 'test_abc', createdAt: 0, uniqueId: 100000001 },
      {
        warnings: ['w1', 'w2'],
        transactions: ['t1'],
        backpack: [],
        stalkers: [],
        giftWall: [],
      },
    );

    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(callIdx++ === 0 ? makeSnapshot([testUser]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Verify subcollections were queried
    expect(testUser.ref.collection).toHaveBeenCalledWith('warnings');
    expect(testUser.ref.collection).toHaveBeenCalledWith('transactions');
    expect(testUser.ref.collection).toHaveBeenCalledWith('backpack');
    expect(testUser.ref.collection).toHaveBeenCalledWith('stalkers');
    expect(testUser.ref.collection).toHaveBeenCalledWith('giftWall');

    // Batch delete should have been called for warnings (2 docs) and transactions (1 doc)
    expect(mockBatchDelete).toHaveBeenCalledTimes(3); // w1, w2, t1
    expect(mockBatchCommit).toHaveBeenCalled();

    // User doc itself should be deleted
    expect(testUser.ref.delete).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  // --- Conversation subcollection cleanup (lines 74-75) ---

  test('deletes conversation subcollections before deleting conversation doc', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testConvo = makeDocWithSubcollectionData(
      'conv1',
      { _testRun: 'test_abc', createdAt: 0 },
      {
        messages: ['msg1', 'msg2'],
        userSettings: ['us1'],
        mutes: [],
        settings: [],
        mod_log: ['ml1'],
      },
    );

    // conversations is the 4th collection in the list (index 3)
    let callIdx = 0;
    db.collection.mockImplementation((name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(
              name === 'conversations' && callIdx++ === 0 ? makeSnapshot([testConvo]) : emptySnap,
            ),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Verify conversation subcollections were queried
    expect(testConvo.ref.collection).toHaveBeenCalledWith('messages');
    expect(testConvo.ref.collection).toHaveBeenCalledWith('userSettings');
    expect(testConvo.ref.collection).toHaveBeenCalledWith('mutes');
    expect(testConvo.ref.collection).toHaveBeenCalledWith('settings');
    expect(testConvo.ref.collection).toHaveBeenCalledWith('mod_log');

    // Batch delete for messages (2), userSettings (1), mod_log (1)
    expect(mockBatchDelete).toHaveBeenCalledTimes(4);

    // Conversation doc itself should be deleted
    expect(testConvo.ref.delete).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  // --- Device/network ban cleanup (lines 88-104) ---

  test('cleans up device and network bans linked to deleted test users', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testUser = makeDoc('u1', {
      _testRun: 'test_abc',
      createdAt: 0,
      uniqueId: 100000099,
    });

    const banDoc1 = { ref: { path: 'deviceBans/b1' } };
    const banDoc2 = { ref: { path: 'networkBans/b2' } };

    let userCallIdx = 0;
    let banCallCount = 0;

    db.collection.mockImplementation((name) => {
      if (name === 'deviceBans') {
        // Called twice per user (for uid and String(uid))
        const snap = banCallCount === 0 ? { empty: false, size: 1, docs: [banDoc1] } : emptySnap;
        banCallCount++;
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(snap),
          }),
          orderBy: mockOrderBy,
        };
      }
      if (name === 'networkBans') {
        const snap = banCallCount === 2 ? { empty: false, size: 1, docs: [banDoc2] } : emptySnap;
        banCallCount++;
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(snap),
          }),
          orderBy: mockOrderBy,
        };
      }
      // For the user collection (first call)
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(
              name === 'users' && userCallIdx++ === 0 ? makeSnapshot([testUser]) : emptySnap,
            ),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Should query both deviceBans and networkBans
    expect(db.collection).toHaveBeenCalledWith('deviceBans');
    expect(db.collection).toHaveBeenCalledWith('networkBans');

    // Should batch-delete the found bans
    expect(mockBatchDelete).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  // --- Starting screens cleanup (lines 107-125) ---

  test('cleans up test starting screens from config document', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    // Implementation uses exactly these three prefixes: 'pw-', 'screen-', 'test-'
    // Include edge-case keys that look similar but must NOT match
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        // Should be deleted (match prefixes: pw-, screen-, test-)
        'pw-screen-1': { url: '/test1' },
        'screen-abc': { url: '/test2' },
        'test-xyz': { url: '/test3' },
        // Should NOT be deleted (no matching prefix)
        'real-screen': { url: '/real' },
        'password-reset': { url: '/pw-like' },
        testing: { url: '/no-hyphen' },
        screensaver: { url: '/no-hyphen2' },
        'my-test-screen': { url: '/middle-match' },
      }),
    });

    await testDataCleanup();

    // Should have called doc for config/startingScreens
    expect(mockDoc).toHaveBeenCalledWith('config/startingScreens');

    // Should have called update with FieldValue.delete() for the 3 test-prefixed screens
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'pw-screen-1': '__FIELD_DELETE__',
        'screen-abc': '__FIELD_DELETE__',
        'test-xyz': '__FIELD_DELETE__',
      }),
    );

    // Verify ONLY 3 keys were targeted — no false positives
    const updateArg = mockDocUpdate.mock.calls[0][0];
    expect(Object.keys(updateArg)).toHaveLength(3);
    expect(updateArg['real-screen']).toBeUndefined();
    expect(updateArg['password-reset']).toBeUndefined();
    expect(updateArg['testing']).toBeUndefined();
    expect(updateArg['screensaver']).toBeUndefined();
    expect(updateArg['my-test-screen']).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  test('skips starting screens cleanup when config doc does not exist', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockDocGet.mockResolvedValue({ exists: false });

    await testDataCleanup();

    // update should not be called for starting screens
    expect(mockDocUpdate).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('skips starting screens cleanup when no test screen IDs found', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        'real-screen-1': { url: '/real1' },
        'production-screen': { url: '/prod' },
      }),
    });

    await testDataCleanup();

    // update should not be called since no test prefixes match
    expect(mockDocUpdate).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('handles starting screens doc with null data', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => null,
    });

    // Should not throw - ssData || {} handles null
    await testDataCleanup();

    // No update since there are no keys to filter
    expect(mockDocUpdate).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('handles starting screens cleanup error gracefully (best-effort)', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockDocGet.mockRejectedValue(new Error('Firestore permission denied'));

    // Should not throw
    await testDataCleanup();

    // No crash - best-effort cleanup
    process.env.NODE_ENV = originalEnv;
  });

  test('counts starting screen deletions in total', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        'pw-1': {},
        'pw-2': {},
        'test-3': {},
      }),
    });

    await testDataCleanup();

    // 3 test screens deleted -> totalDeleted = 3
    expect(log.info).toHaveBeenCalledWith('cron', 'testDataCleanup: removed stale test data', {
      deleted: 3,
    });

    process.env.NODE_ENV = originalEnv;
  });

  // --- Counter restoration edge cases ---

  test('uses 100000000 as fallback when no users exist after cleanup', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testUser = makeDoc('u1', { _testRun: 'test_abc', createdAt: 0, uniqueId: 100000001 });

    const counterSetMock = jest.fn().mockResolvedValue(undefined);
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate, set: counterSetMock });

    mockOrderBy.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(emptySnap), // No users left
      }),
    });

    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(callIdx++ === 0 ? makeSnapshot([testUser]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    expect(counterSetMock).toHaveBeenCalledWith({ value: 100000000 }, { merge: true });

    process.env.NODE_ENV = originalEnv;
  });

  test('uses doc.id as uniqueId fallback when uniqueId field is missing', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    // User without uniqueId field - should use doc.id instead
    const testUser = makeDoc('user-id-123', { _testRun: 'test_abc', createdAt: 0 });

    let callIdx = 0;
    db.collection.mockImplementation((_name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(callIdx++ === 0 ? makeSnapshot([testUser]) : emptySnap),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Should still trigger ban cleanup using doc.id as the uniqueId
    // (deviceBans and networkBans are queried for 'user-id-123' and String('user-id-123'))
    expect(db.collection).toHaveBeenCalledWith('deviceBans');
    expect(db.collection).toHaveBeenCalledWith('networkBans');

    process.env.NODE_ENV = originalEnv;
  });

  // --- Non-user collections don't trigger subcollection cleanup ---

  test('does not attempt subcollection cleanup for non-user non-conversation collections', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const giftDoc = makeDoc('g1', { _testRun: 'test_abc', createdAt: 0 });

    let callIdx = 0;
    db.collection.mockImplementation((name) => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({
          get: jest
            .fn()
            .mockResolvedValue(
              name === 'gifts' && callIdx++ === 0 ? makeSnapshot([giftDoc]) : emptySnap,
            ),
        }),
        orderBy: mockOrderBy,
      };
      return chain;
    });

    await testDataCleanup();

    // Gift doc should be deleted directly, no subcollection queries
    expect(giftDoc.ref.delete).toHaveBeenCalled();
    expect(giftDoc.ref.collection).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});
