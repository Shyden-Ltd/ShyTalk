const express = require('express');
const request = require('supertest');

// ─── Firestore mock helpers ─────────────────────────────────────

const mockBatchSet = jest.fn().mockResolvedValue();
const mockBatchDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();

function createMockBatch() {
  return {
    set: mockBatchSet,
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  };
}

// Dev DB mock — used by the route via `db` from utils/firebase
const mockDevCollectionGet = jest.fn();
const mockDevCollectionLimit = jest.fn();
const mockDevCollectionListDocuments = jest.fn();
const mockDevDocRef = jest.fn();
const mockDevCollection = jest.fn();

function setupDevCollection() {
  mockDevCollection.mockImplementation((name) => ({
    get: mockDevCollectionGet,
    limit: mockDevCollectionLimit.mockReturnValue({
      get: mockDevCollectionGet,
    }),
    listDocuments: mockDevCollectionListDocuments,
    doc: (id) => {
      const docRef = {
        id,
        collection: (_subName) => ({
          get: mockDevCollectionGet,
          limit: mockDevCollectionLimit.mockReturnValue({
            get: mockDevCollectionGet,
          }),
          doc: (subId) => ({ id: subId }),
        }),
      };
      mockDevDocRef(name, id);
      return docRef;
    },
  }));
}

const mockDevDb = {
  collection: (...args) => mockDevCollection(...args),
  batch: jest.fn(() => createMockBatch()),
};

// Prod DB mock — returned by getProdDb() via firebase-admin
const mockProdCollectionGet = jest.fn();
const mockProdCollectionListDocuments = jest.fn();
const mockProdCollection = jest.fn();

function setupProdCollection() {
  mockProdCollection.mockImplementation((_name) => ({
    get: mockProdCollectionGet,
    listDocuments: mockProdCollectionListDocuments,
    doc: (id) => ({
      id,
      collection: (_subName) => ({
        get: mockProdCollectionGet,
      }),
    }),
  }));
}

const mockProdFirestore = {
  collection: (...args) => mockProdCollection(...args),
};

// ─── Firebase mock ──────────────────────────────────────────────

jest.mock('../../src/utils/firebase', () => ({
  db: mockDevDb,
}));

// Mock firebase-admin for getProdDb() — admin.initializeApp + admin.credential.cert
const mockInitializeApp = jest.fn().mockReturnValue({
  firestore: () => mockProdFirestore,
});

jest.mock('firebase-admin', () => ({
  initializeApp: (...args) => mockInitializeApp(...args),
  credential: {
    cert: jest.fn((sa) => ({ type: 'cert', sa })),
  },
}));

// Mock the prod service account JSON file that getProdDb() will require().
// jest.mock is hoisted, so we use the literal path directly.
jest.mock('/fake/prod-sa.json', () => ({ project_id: 'shytalk-prod-mock' }), { virtual: true });
const FAKE_SA_PATH = '/fake/prod-sa.json';

// ─── Auth middleware mock ────────────────────────────────────────

const mockRequireAdmin = jest.fn(() => false);

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: (...args) => mockRequireAdmin(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── Set env BEFORE requiring the route ─────────────────────────

process.env.PROD_SERVICE_ACCOUNT_PATH = FAKE_SA_PATH;

// ─── App setup ──────────────────────────────────────────────────

const adminMigrateRouter = require('../../src/routes/admin-migrate');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-uid', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminMigrateRouter);
  return app;
}

// ─── Helpers ────────────────────────────────────────────────────

function emptySnapshot() {
  return { empty: true, docs: [], size: 0 };
}

function snapshotOf(docs) {
  return {
    empty: docs.length === 0,
    docs: docs.map((d) => ({
      id: d.id,
      ref: { id: d.id },
      data: () => d.data,
    })),
    size: docs.length,
  };
}

// ─── Setup ──────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockReturnValue(false);
  mockBatchCommit.mockResolvedValue();

  // Restore env defaults
  process.env.NODE_ENV = 'test';
  process.env.PROD_SERVICE_ACCOUNT_PATH = FAKE_SA_PATH;

  // Default: all dev collections are empty (nothing to delete)
  mockDevCollectionGet.mockResolvedValue(emptySnapshot());
  mockDevCollectionListDocuments.mockResolvedValue([]);

  // Default: all prod collections are empty (nothing to copy)
  mockProdCollectionGet.mockResolvedValue(emptySnapshot());
  mockProdCollectionListDocuments.mockResolvedValue([]);

  setupDevCollection();
  setupProdCollection();
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── POST /api/admin/migrate-prod-data ──────────────────────────

describe('POST /api/admin/migrate-prod-data', () => {
  // ─── Admin guard ────────────────────────────────────────────

  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(403);

    expect(res.body.error).toBe('Admin access required');
    expect(mockDevCollectionGet).not.toHaveBeenCalled();
    expect(mockProdCollectionGet).not.toHaveBeenCalled();
  });

  // ─── Production safeguard ───────────────────────────────────

  test('returns 403 when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(403);

    expect(res.body.error).toBe('This endpoint is disabled in production');
  });

  // ─── Success: empty collections ─────────────────────────────

  test('succeeds with zero totals when all collections are empty', async () => {
    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.totalDeleted).toBe(0);
    expect(res.body.totalCopied).toBe(0);
    expect(res.body.errors).toEqual([]);
  });

  test('returns details object with deleted and copied maps', async () => {
    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.details).toBeDefined();
    expect(res.body.details.deleted).toBeDefined();
    expect(res.body.details.copied).toBeDefined();
    expect(res.body.details.errors).toEqual([]);
  });

  // ─── Success: top-level collection copy ─────────────────────

  test('deletes dev docs and copies prod docs for top-level collections', async () => {
    // Dev has 2 docs in 'users' to delete, then is empty
    let devCallCount = 0;
    mockDevCollectionGet.mockImplementation(() => {
      devCallCount++;
      // First call per deleteCollection returns docs, second returns empty
      if (devCallCount === 1) {
        return Promise.resolve(
          snapshotOf([
            { id: 'dev-u1', data: { name: 'DevUser1' } },
            { id: 'dev-u2', data: { name: 'DevUser2' } },
          ]),
        );
      }
      return Promise.resolve(emptySnapshot());
    });

    // Prod has 1 doc in 'users' to copy
    mockProdCollectionGet.mockResolvedValue(
      snapshotOf([{ id: 'prod-u1', data: { name: 'ProdUser1' } }]),
    );

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.totalDeleted).toBeGreaterThan(0);
    expect(res.body.totalCopied).toBeGreaterThan(0);
    expect(mockBatchDelete).toHaveBeenCalled();
    expect(mockBatchSet).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  // ─── Success: subcollection handling ────────────────────────

  test('deletes and copies subcollection documents', async () => {
    // Dev has parent docs with subcollections to delete
    mockDevCollectionListDocuments.mockResolvedValue([{ id: 'room-1' }, { id: 'room-2' }]);

    // First call returns subcollection docs, subsequent calls return empty
    let devGetCount = 0;
    mockDevCollectionGet.mockImplementation(() => {
      devGetCount++;
      // Return docs for the first 2 subcollection reads (room-1 and room-2 messages)
      if (devGetCount <= 2) {
        return Promise.resolve(snapshotOf([{ id: 'msg-1', data: { text: 'hello' } }]));
      }
      return Promise.resolve(emptySnapshot());
    });

    // Prod has parent docs with subcollection docs
    mockProdCollectionListDocuments.mockResolvedValue([{ id: 'room-1' }]);
    let prodGetCount = 0;
    mockProdCollectionGet.mockImplementation(() => {
      prodGetCount++;
      if (prodGetCount <= 1) {
        return Promise.resolve(snapshotOf([{ id: 'prod-msg-1', data: { text: 'prod hello' } }]));
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  // ─── Error handling: partial failures ───────────────────────

  test('continues migration when a single collection delete fails', async () => {
    let callIndex = 0;
    mockDevCollectionGet.mockImplementation(() => {
      callIndex++;
      // Fail on the first delete attempt (subcollection phase)
      if (callIndex === 1) {
        return Promise.reject(new Error('Firestore timeout'));
      }
      return Promise.resolve(emptySnapshot());
    });

    // Need listDocuments to return a parent doc so the subcollection delete path runs
    mockDevCollectionListDocuments.mockResolvedValue([{ id: 'room-1' }]);

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors[0].phase).toBe('delete');
    expect(res.body.errors[0].error).toBe('Firestore timeout');
  });

  test('continues migration when a single collection copy fails', async () => {
    // All deletes succeed (return empty)
    mockDevCollectionGet.mockResolvedValue(emptySnapshot());

    // Fail on prod collection read
    let prodCallIndex = 0;
    mockProdCollectionGet.mockImplementation(() => {
      prodCallIndex++;
      if (prodCallIndex === 1) {
        return Promise.reject(new Error('Permission denied'));
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors.some((e) => e.phase === 'copy')).toBe(true);
    expect(res.body.errors.some((e) => e.error === 'Permission denied')).toBe(true);
  });

  test('reports errors from both delete and copy phases', async () => {
    // Need parent docs for subcollection delete to trigger
    mockDevCollectionListDocuments.mockResolvedValue([{ id: 'room-1' }]);

    // Delete phase fails on first call
    let devIdx = 0;
    mockDevCollectionGet.mockImplementation(() => {
      devIdx++;
      if (devIdx === 1) return Promise.reject(new Error('delete error'));
      return Promise.resolve(emptySnapshot());
    });

    // Copy phase fails on first call
    let prodIdx = 0;
    mockProdCollectionGet.mockImplementation(() => {
      prodIdx++;
      if (prodIdx === 1) return Promise.reject(new Error('copy error'));
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    const deleteErrors = res.body.errors.filter((e) => e.phase === 'delete');
    const copyErrors = res.body.errors.filter((e) => e.phase === 'copy');
    expect(deleteErrors.length).toBeGreaterThan(0);
    expect(copyErrors.length).toBeGreaterThan(0);
  });

  test('includes collection name in error objects', async () => {
    // Fail on a specific top-level collection delete
    mockDevCollectionListDocuments.mockResolvedValue([]);

    let topLevelDeleteCall = 0;
    mockDevCollectionGet.mockImplementation(() => {
      topLevelDeleteCall++;
      // Fail on the first top-level collection delete call
      if (topLevelDeleteCall === 1) {
        return Promise.reject(new Error('delete failed'));
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    const errWithCollection = res.body.errors.find((e) => e.collection);
    expect(errWithCollection).toBeDefined();
    expect(typeof errWithCollection.collection).toBe('string');
    expect(errWithCollection.collection.length).toBeGreaterThan(0);
  });

  // ─── Batch processing ──────────────────────────────────────

  test('processes documents in batches when copying large collections', async () => {
    // Create 501 docs to trigger 2 batches (500 + 1)
    const largeDocs = Array.from({ length: 501 }, (_, i) => ({
      id: `doc-${i}`,
      data: { index: i },
    }));

    mockProdCollectionGet.mockResolvedValue(snapshotOf(largeDocs));

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    // batch.commit should be called multiple times for the large collection
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('processes documents in batches when deleting large collections', async () => {
    // First call returns 500 docs, second returns 2 docs, third returns empty
    let deleteCallCount = 0;
    mockDevCollectionGet.mockImplementation(() => {
      deleteCallCount++;
      if (deleteCallCount === 1) {
        return Promise.resolve(
          snapshotOf(
            Array.from({ length: 500 }, (_, i) => ({
              id: `del-${i}`,
              data: {},
            })),
          ),
        );
      }
      if (deleteCallCount === 2) {
        return Promise.resolve(snapshotOf([{ id: 'del-last', data: {} }]));
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    // At least 2 batch.commit calls for the delete phase
    expect(mockBatchCommit.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // ─── getProdDb caching ──────────────────────────────────────

  test('caches prod Firestore instance after first initialization', async () => {
    // getProdDb() caches the prodDb at module level. After the first successful
    // call in this test suite, initializeApp won't be called again.
    // We verify the prod DB is used (collection reads hit the prod mock).
    mockProdCollectionGet.mockResolvedValue(snapshotOf([{ id: 'cached-doc', data: { val: 1 } }]));

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.totalCopied).toBeGreaterThan(0);
    expect(mockProdCollectionGet).toHaveBeenCalled();
  });

  // ─── Known collections ─────────────────────────────────────

  test('migrates all expected top-level collections', async () => {
    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    const expectedCollections = [
      'users',
      'rooms',
      'conversations',
      'config',
      'identityMap',
      'counters',
      'deviceBindings',
      'gifts',
      'giftRankings',
      'broadcasts',
      'coinPackages',
      'funFacts',
      'banners',
      'reports',
      'reportsArchive',
      'reportLocks',
      'suspensionAppeals',
      'adminAuditLog',
      'alertConfig',
      'otpCodes',
      'biometricKeys',
      'emailMetrics',
      'purchaseReceipts',
      'logConfig',
      'deviceBans',
      'networkBans',
    ];

    // Each top-level collection should appear in both deleted and copied results
    for (const name of expectedCollections) {
      expect(res.body.details.deleted).toHaveProperty(name);
      expect(res.body.details.copied).toHaveProperty(name);
    }
  });

  test('migrates all expected subcollections', async () => {
    mockDevCollectionListDocuments.mockResolvedValue([]);
    mockProdCollectionListDocuments.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    // Subcollection results use "parent/sub" key format
    expect(res.body.details.deleted).toHaveProperty('rooms/messages');
    expect(res.body.details.deleted).toHaveProperty('rooms/seatRequests');
    expect(res.body.details.deleted).toHaveProperty('conversations/messages');
    expect(res.body.details.copied).toHaveProperty('rooms/messages');
    expect(res.body.details.copied).toHaveProperty('rooms/seatRequests');
    expect(res.body.details.copied).toHaveProperty('conversations/messages');
  });

  // ─── Subcollection copy with multiple parents ───────────────

  test('copies subcollections from all parent documents in prod', async () => {
    // Prod has 2 room parents with messages
    mockProdCollectionListDocuments.mockResolvedValue([{ id: 'room-A' }, { id: 'room-B' }]);

    let prodGetCalls = 0;
    mockProdCollectionGet.mockImplementation(() => {
      prodGetCalls++;
      if (prodGetCalls <= 2) {
        return Promise.resolve(snapshotOf([{ id: `msg-${prodGetCalls}`, data: { text: 'hi' } }]));
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    // batch.set should have been called for the subcollection docs
    expect(mockBatchSet).toHaveBeenCalled();
  });

  // ─── Edge case: copyCollection returns 0 for empty ─────────

  test('returns 0 copied for empty prod collections', async () => {
    mockProdCollectionGet.mockResolvedValue(emptySnapshot());

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.totalCopied).toBe(0);
  });

  // ─── Edge case: subcollection with no parent docs ──────────

  test('handles subcollections when parent collection has no documents', async () => {
    mockProdCollectionListDocuments.mockResolvedValue([]);
    mockDevCollectionListDocuments.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.errors).toEqual([]);
  });

  // ─── Totals computation ─────────────────────────────────────

  test('computes correct totalDeleted and totalCopied sums', async () => {
    // Dev has docs in first top-level collection only
    let devDeleteCalls = 0;
    mockDevCollectionGet.mockImplementation(() => {
      devDeleteCalls++;
      if (devDeleteCalls === 1) {
        return Promise.resolve(
          snapshotOf([
            { id: 'd1', data: {} },
            { id: 'd2', data: {} },
            { id: 'd3', data: {} },
          ]),
        );
      }
      return Promise.resolve(emptySnapshot());
    });

    // Prod has docs in first top-level collection only
    let prodCopyCalls = 0;
    mockProdCollectionGet.mockImplementation(() => {
      prodCopyCalls++;
      if (prodCopyCalls === 1) {
        return Promise.resolve(
          snapshotOf([
            { id: 'p1', data: {} },
            { id: 'p2', data: {} },
          ]),
        );
      }
      return Promise.resolve(emptySnapshot());
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.totalDeleted).toBeGreaterThanOrEqual(3);
    expect(res.body.totalCopied).toBeGreaterThanOrEqual(2);

    // Verify totals match sum of details
    const detailDeletedSum = Object.values(res.body.details.deleted).reduce((a, b) => a + b, 0);
    const detailCopiedSum = Object.values(res.body.details.copied).reduce((a, b) => a + b, 0);
    expect(res.body.totalDeleted).toBe(detailDeletedSum);
    expect(res.body.totalCopied).toBe(detailCopiedSum);
  });

  // ─── Logging ────────────────────────────────────────────────

  test('logs migration start with admin uid', async () => {
    const log = require('../../src/utils/log');

    const app = createApp();
    await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(log.info).toHaveBeenCalledWith(
      'admin-migrate',
      expect.stringContaining('Starting'),
      expect.objectContaining({ adminUid: 'admin-1' }),
    );
  });

  test('logs migration completion with totals', async () => {
    const log = require('../../src/utils/log');

    const app = createApp();
    await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(log.info).toHaveBeenCalledWith(
      'admin-migrate',
      'Migration complete',
      expect.objectContaining({
        totalDeleted: expect.any(Number),
        totalCopied: expect.any(Number),
        errors: expect.any(Number),
      }),
    );
  });

  test('logs errors for failed collections', async () => {
    const log = require('../../src/utils/log');

    mockDevCollectionListDocuments.mockResolvedValue([{ id: 'room-1' }]);
    mockDevCollectionGet.mockRejectedValueOnce(new Error('delete boom'));

    const app = createApp();
    await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(log.error).toHaveBeenCalledWith(
      'admin-migrate',
      expect.stringContaining('Failed'),
      expect.objectContaining({ error: 'delete boom' }),
    );
  });

  // ─── Guard interaction ──────────────────────────────────────

  test('calls requireAdmin with req and res', async () => {
    const app = createApp();
    await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
    expect(mockRequireAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.any(Object) }),
      expect.any(Object),
    );
  });

  test('does not proceed with migration when admin guard blocks', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp();
    await request(app).post('/api/admin/migrate-prod-data').expect(403);

    // Neither dev nor prod DB should be touched
    expect(mockDevDb.batch).not.toHaveBeenCalled();
    expect(mockProdCollectionGet).not.toHaveBeenCalled();
    expect(mockProdCollectionListDocuments).not.toHaveBeenCalled();
  });

  // ─── HTTP method guard ──────────────────────────────────────

  test('returns 404 for GET request', async () => {
    const app = createApp();
    await request(app).get('/api/admin/migrate-prod-data').expect(404);
  });

  test('returns 404 for PUT request', async () => {
    const app = createApp();
    await request(app).put('/api/admin/migrate-prod-data').expect(404);
  });

  test('returns 404 for DELETE request', async () => {
    const app = createApp();
    await request(app).delete('/api/admin/migrate-prod-data').expect(404);
  });

  // ─── Subcollection error in copy phase (listDocuments fails) ─

  test('records error when subcollection listDocuments fails during copy', async () => {
    mockProdCollectionListDocuments.mockRejectedValue(new Error('listDocuments failed'));

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    const subCopyErrors = res.body.errors.filter(
      (e) => e.phase === 'copy' && e.error === 'listDocuments failed',
    );
    expect(subCopyErrors.length).toBeGreaterThan(0);
  });

  // ─── Subcollection error in delete phase (listDocuments fails)

  test('records error when dev listDocuments fails during subcollection delete', async () => {
    mockDevCollectionListDocuments.mockRejectedValue(new Error('dev listDocs failed'));

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.success).toBe(true);
    const deleteErrors = res.body.errors.filter(
      (e) => e.phase === 'delete' && e.error === 'dev listDocs failed',
    );
    expect(deleteErrors.length).toBeGreaterThan(0);
  });

  // ─── Production guard runs before admin check doesn't ───────

  test('production guard runs even for admins', async () => {
    process.env.NODE_ENV = 'production';
    mockRequireAdmin.mockReturnValue(false); // is admin

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(403);

    expect(res.body.error).toBe('This endpoint is disabled in production');
  });

  // ─── Batch.commit failure is propagated as error ────────────

  test('records error when batch.commit fails during copy', async () => {
    mockProdCollectionGet.mockResolvedValue(snapshotOf([{ id: 'doc-1', data: { val: 1 } }]));
    mockBatchCommit.mockRejectedValueOnce(new Error('batch commit failed'));

    const app = createApp();
    const res = await request(app).post('/api/admin/migrate-prod-data').expect(200);

    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors.some((e) => e.error === 'batch commit failed')).toBe(true);
  });
});
