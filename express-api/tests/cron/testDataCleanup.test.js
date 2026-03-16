// Mock Firebase — chainable collection/where/limit/get + batch
const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn(() => ({ where: mockWhere, limit: mockLimit }));
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      where: mockWhere,
    })),
    batch: mockBatch,
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

function makeSnapshot(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({
      id: d.id,
      data: () => {
        const { id: _id, ...rest } = d;
        return rest;
      },
      ref: { path: `col/${d.id}` },
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('testDataCleanup cron', () => {
  test('skips cleanup in production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await testDataCleanup();

    expect(db.collection).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('queries all expected collections with correct filters', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockGet.mockResolvedValue(makeSnapshot([]));

    await testDataCleanup();

    const expectedCollections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
    expect(db.collection).toHaveBeenCalledTimes(expectedCollections.length);

    for (const col of expectedCollections) {
      expect(db.collection).toHaveBeenCalledWith(col);
    }

    // Verify where clauses: _testRun >= 'test_' and createdAt < cutoff
    // Each collection triggers two where() calls
    const whereCalls = mockWhere.mock.calls;
    // First where per collection: _testRun >= TEST_PREFIX
    expect(whereCalls[0]).toEqual(['_testRun', '>=', 'test_']);
    // Second where per collection: createdAt < cutoff (a number)
    expect(whereCalls[1][0]).toBe('createdAt');
    expect(whereCalls[1][1]).toBe('<');
    expect(typeof whereCalls[1][2]).toBe('number');

    // Verify limit(500) called for each collection
    expect(mockLimit).toHaveBeenCalledWith(500);

    process.env.NODE_ENV = originalEnv;
  });

  test('deletes stale test documents using batch', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testDocs = [
      { id: 'test_user_1', _testRun: 'test_abc', createdAt: 0 },
      { id: 'test_user_2', _testRun: 'test_abc', createdAt: 0 },
    ];

    // First collection (users) returns docs, rest return empty
    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(makeSnapshot(testDocs));
      }
      return Promise.resolve(makeSnapshot([]));
    });

    await testDataCleanup();

    // batch() should be created for the non-empty collection
    expect(mockBatch).toHaveBeenCalledTimes(1);
    // Two docs deleted
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    // batch.commit() called once
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    // Log should report deletion count
    expect(log.info).toHaveBeenCalledWith('cron', 'testDataCleanup: removed stale test data', {
      deleted: 2,
    });

    process.env.NODE_ENV = originalEnv;
  });

  test('does not log when no documents are deleted', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockGet.mockResolvedValue(makeSnapshot([]));

    await testDataCleanup();

    expect(log.info).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  test('handles multiple collections with stale data', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const userDocs = [{ id: 'test_u1', _testRun: 'test_run1', createdAt: 0 }];
    const roomDocs = [
      { id: 'test_r1', _testRun: 'test_run1', createdAt: 0 },
      { id: 'test_r2', _testRun: 'test_run1', createdAt: 0 },
    ];

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeSnapshot(userDocs));
      if (callCount === 2) return Promise.resolve(makeSnapshot(roomDocs));
      return Promise.resolve(makeSnapshot([]));
    });

    await testDataCleanup();

    // Two non-empty collections => two batches
    expect(mockBatch).toHaveBeenCalledTimes(2);
    // 1 + 2 = 3 deletions total
    expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);

    expect(log.info).toHaveBeenCalledWith('cron', 'testDataCleanup: removed stale test data', {
      deleted: 3,
    });

    process.env.NODE_ENV = originalEnv;
  });

  test('uses 1 hour cutoff for stale data', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    mockGet.mockResolvedValue(makeSnapshot([]));

    await testDataCleanup();

    // The second where clause should use cutoff = now - 3600000
    const createdAtWheres = mockWhere.mock.calls.filter((c) => c[0] === 'createdAt');
    expect(createdAtWheres.length).toBeGreaterThan(0);

    for (const call of createdAtWheres) {
      expect(call[2]).toBe(now - 60 * 60 * 1000);
    }

    Date.now.mockRestore();

    process.env.NODE_ENV = originalEnv;
  });

  test('skips batch for empty collections', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    mockGet.mockResolvedValue(makeSnapshot([]));

    await testDataCleanup();

    // No batch should be created for empty snapshots
    expect(mockBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});
