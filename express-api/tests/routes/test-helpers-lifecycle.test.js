/* eslint-disable no-unused-vars */
const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
  update: mockDocUpdate,
  delete: mockDocDelete,
}));

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

const mockQueryGet = jest.fn();
const mockWhere = jest.fn(() => ({ get: mockQueryGet }));
const mockOrderByLimitGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
const mockOrderByLimit = jest.fn(() => ({ get: mockOrderByLimitGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockOrderByLimit }));
const mockCollection = jest.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));

// Transaction mock: calls the callback with a transaction object that has get/set
let transactionUniqueIdCounter = 100000000;
const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockRunTransaction = jest.fn(async (callback) => {
  const transaction = {
    get: mockTransactionGet,
    set: mockTransactionSet,
  };
  return callback(transaction);
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    batch: (...args) => mockBatch(...args),
    collection: (...args) => mockCollection(...args),
    runTransaction: (...args) => mockRunTransaction(...args),
  },
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => `id${++mockIdCounter}`),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdCounter = 0;
  transactionUniqueIdCounter = 100000000;
  process.env.TEST_API_KEY = VALID_API_KEY;

  // mockReset drains mockResolvedValueOnce queues + clears implementations
  // (clearAllMocks does not). Without this, queued values bleed across tests.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchCommit.mockReset();
  mockQueryGet.mockReset();
  mockTransactionGet.mockReset();

  // Restore default mock implementations after reset
  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockBatchCommit.mockResolvedValue();
  mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

  // Transaction mock: simulate atomic counter increment
  // Start at 0 so the first call exercises the exists:false / cold-start branch
  transactionUniqueIdCounter = 0;
  mockTransactionGet.mockImplementation(() => {
    const current = transactionUniqueIdCounter;
    return Promise.resolve({
      exists: current > 0,
      data: () => ({ value: current }),
    });
  });
  mockTransactionSet.mockImplementation((ref, data) => {
    // Simulate the counter being incremented so next call gets the new value
    if (data && data.value) {
      transactionUniqueIdCounter = data.value;
    }
  });
  mockRunTransaction.mockImplementation(async (callback) => {
    const transaction = {
      get: mockTransactionGet,
      set: mockTransactionSet,
    };
    return callback(transaction);
  });
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

// ─── API key guard ──────────────────────────────────────────────

// ─── POST /api/test/setup ────────────────────────────────────────

// ─── GET /api/test/verify/:collection/:id ───────────────────────

// ─── POST /api/test/teardown ────────────────────────────────────

describe('POST /api/test/teardown', () => {
  test('returns 400 when testRunId is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('returns 400 when testRunId does not start with test_ prefix', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'invalid_prefix_123' })
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('returns 400 when testRunId is empty string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: '' })
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('deletes matching user docs with subcollections for given testRunId', async () => {
    // User doc refs need .collection() for subcollection traversal + .delete() + .data()
    const userRef1 = {
      id: 'user1',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };
    const userRef2 = {
      id: 'user2',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };

    // First query (users) returns 2 docs, rest return empty
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [
            { ref: userRef1, data: () => ({ uniqueId: 1001, _testRun: 'test_run123' }) },
            { ref: userRef2, data: () => ({ uniqueId: 1002, _testRun: 'test_run123' }) },
          ],
          size: 2,
        });
      }
      return Promise.resolve({ empty: true, docs: [], size: 0 });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run123' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2); // 2 user docs
    expect(mockWhere).toHaveBeenCalledWith('_testRun', '==', 'test_run123');
    // User docs themselves should be deleted via deleteDocWithSubcollections
    expect(userRef1.delete).toHaveBeenCalled();
    expect(userRef2.delete).toHaveBeenCalled();
    // Subcollections should be traversed (all 5 from deleteDocWithSubcollections)
    expect(userRef1.collection).toHaveBeenCalledWith('warnings');
    expect(userRef1.collection).toHaveBeenCalledWith('transactions');
    expect(userRef1.collection).toHaveBeenCalledWith('backpack');
    expect(userRef1.collection).toHaveBeenCalledWith('stalkers');
    expect(userRef1.collection).toHaveBeenCalledWith('giftWall');
  });

  test('queries all expected collections during teardown', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run456' })
      .expect(200);

    // New implementation queries: users, deviceBindings, deviceBans
    // (0 users so no ban queries), then the `otherCollections` list
    // in test-helpers.js — keep this in sync with that array.
    const expectedCollections = [
      'users',
      'deviceBindings',
      'gifts',
      'rooms',
      'banners',
      'funFacts',
      'conversations',
      'reports',
      'suspensionAppeals',
      'alerts',
      'reportLocks',
      'coinPackages',
    ];
    for (const col of expectedCollections) {
      expect(mockCollection).toHaveBeenCalledWith(col);
    }
  });

  test('returns deleted count of 0 when no test data found', async () => {
    mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_empty' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('returns 500 when Firestore query throws', async () => {
    mockQueryGet.mockRejectedValue(new Error('Firestore query failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_fail' })
      .expect(500);

    expect(res.body.error).toBe('Firestore query failed');
  });
});

// ─── POST /api/test/reset ───────────────────────────────────────

describe('POST /api/test/reset', () => {
  test('deletes ALL test data across all collections using range query', async () => {
    const userRef = {
      id: 'test-user',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First query is users
        return Promise.resolve({
          empty: false,
          docs: [{ ref: userRef, data: () => ({ uniqueId: 9999, _testRun: 'test_old' }) }],
          size: 1,
        });
      }
      return Promise.resolve({ empty: true, docs: [], size: 0 });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
    // Reset uses >= range query instead of == exact match
    expect(mockWhere).toHaveBeenCalledWith('_testRun', '>=', 'test_');
  });

  test('queries all expected collections during reset', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    const expectedCollections = [
      'users',
      'deviceBindings',
      'gifts',
      'rooms',
      'banners',
      'funFacts',
      'conversations',
      'reports',
      'suspensionAppeals',
      'alerts',
    ];
    for (const col of expectedCollections) {
      expect(mockCollection).toHaveBeenCalledWith(col);
    }
  });

  test('returns 500 when Firestore query throws during reset', async () => {
    mockQueryGet.mockRejectedValue(new Error('Firestore query failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(500);

    expect(res.body.error).toBe('Firestore query failed');
  });
});

// ─── deleteTestData (exported) ───────────────────────────────────
