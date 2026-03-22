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
const mockDoc = jest.fn().mockReturnValue({
  set: jest.fn().mockResolvedValue(undefined),
});
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
    mockDoc.mockReturnValue({ set: counterSetMock });

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
});
