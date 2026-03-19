const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockBatchDelete = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

const makeBatch = () => ({
  delete: mockBatchDelete,
  update: mockBatchUpdate,
  commit: mockBatchCommit,
});

// Flexible collection chain — tests override mockCollectionSnap
let mockCollectionSnap = { empty: true, docs: [] };

const makeChain = (snap) => {
  const chain = {
    where: jest.fn().mockImplementation(() => chain),
    orderBy: jest.fn().mockImplementation(() => chain),
    limit: jest.fn().mockImplementation(() => chain),
    get: jest.fn().mockImplementation(() => Promise.resolve(snap ?? mockCollectionSnap)),
  };
  return chain;
};

const _mockCollection = jest.fn().mockImplementation(() => makeChain());
const mockDoc = jest.fn().mockImplementation(() => ({
  get: jest.fn().mockResolvedValue({ exists: false }),
  update: jest.fn().mockResolvedValue(),
  set: jest.fn().mockResolvedValue(),
  delete: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (..._args) => {
      // Return a fresh chain each call, sharing mockCollectionSnap
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockImplementation(() => Promise.resolve(mockCollectionSnap)),
      };
      return chain;
    },
    doc: (...args) => mockDoc(...args),
    batch: () => makeBatch(),
  },
  rtdb: {
    ref: jest.fn().mockReturnValue({ remove: jest.fn().mockResolvedValue() }),
  },
}));

// ─── R2 mock ─────────────────────────────────────────────────────

const mockListObjects = jest.fn().mockResolvedValue([]);
const mockListObjectsWithMetadata = jest.fn().mockResolvedValue([]);
const mockDeleteObjects = jest.fn().mockResolvedValue();
const mockDeleteObject = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/r2', () => ({
  listObjects: (...args) => mockListObjects(...args),
  listObjectsWithMetadata: (...args) => mockListObjectsWithMetadata(...args),
  deleteObjects: (...args) => mockDeleteObjects(...args),
  deleteObject: (...args) => mockDeleteObject(...args),
}));

// ─── Firestore helpers mock ───────────────────────────────────────

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn().mockResolvedValue([]),
}));

// ─── Auth middleware mock ─────────────────────────────────────────

const { requireAdmin: _requireAdmin } = jest.requireActual('../../src/middleware/auth');
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn((req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    }
    return false;
  }),
}));

// ─── Log mock ────────────────────────────────────────────────────

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ────────────────────────────────────────────────────

const adminCleanupRouter = require('../../src/routes/admin-cleanup');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: isAdmin ? 'admin-uid' : 'user-uid',
      uniqueId: isAdmin ? 'admin-1' : 'user-1',
      token: { admin: isAdmin },
    };
    next();
  });
  app.use('/api', adminCleanupRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockListObjects.mockResolvedValue([]);
  mockListObjectsWithMetadata.mockResolvedValue([]);
  mockDeleteObjects.mockResolvedValue();
  mockDeleteObject.mockResolvedValue();
  mockCollectionSnap = { empty: true, docs: [] };

  // Default: requireAdmin allows admins (returns false) and blocks non-admins (returns true + 403)
  const authMod = require('../../src/middleware/auth');
  authMod.requireAdmin.mockImplementation((req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    }
    return false;
  });
});

// ══════════════════════════════════════════════════════════════════
// SECTION 1: Admin guard — ALL endpoints must return 403 for non-admins
// ══════════════════════════════════════════════════════════════════

const cleanupEndpoints = [
  ['POST', '/api/cleanup/system-conversations'],
  ['POST', '/api/cleanup/all-system-conversations'],
  ['POST', '/api/cleanup/all-reports'],
  ['POST', '/api/cleanup/all-warnings'],
  ['POST', '/api/cleanup/all-backpacks'],
  ['POST', '/api/cleanup/all-giftwalls'],
  ['POST', '/api/cleanup/all-coins'],
  ['POST', '/api/cleanup/all-beans'],
  ['POST', '/api/cleanup/all-spin-history'],
  ['POST', '/api/cleanup/all-supershy'],
  ['POST', '/api/cleanup/all-transactions'],
  ['POST', '/api/cleanup/all-appeals'],
  ['POST', '/api/cleanup/backfill-user-type'],
  ['POST', '/api/cleanup/all-private-messages'],
  ['POST', '/api/cleanup/all-group-chats'],
  ['POST', '/api/cleanup/all-rooms'],
  ['POST', '/api/cleanup/all-broadcasts'],
  ['POST', '/api/cleanup/all-audit-logs'],
  ['POST', '/api/cleanup/destroyed-users'],
  ['POST', '/api/cleanup/all-device-bindings'],
  ['POST', '/api/cleanup/device-binding/some-unique-id'],
  ['GET', '/api/storage/audit'],
  ['POST', '/api/cleanup/orphaned-storage'],
  ['POST', '/api/cleanup/all-stalkers'],
  ['POST', '/api/cleanup/user-coins/some-unique-id'],
  ['POST', '/api/cleanup/user-beans/some-unique-id'],
];

describe('Admin guard: all cleanup endpoints return 403 for non-admin users', () => {
  const nonAdminApp = createApp(false);

  test.each(cleanupEndpoints)('%s %s returns 403', async (method, path) => {
    const res = await request(nonAdminApp)[method.toLowerCase()](path);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// SECTION 2: Representative happy paths
// ══════════════════════════════════════════════════════════════════

// ── POST /cleanup/all-coins ───────────────────────────────────────

describe('POST /api/cleanup/all-coins', () => {
  test('resets shyCoins to 0 for all users with coins > 0 and returns affected count', async () => {
    const userDocs = [
      { id: 'user-1', ref: { path: 'users/user-1' }, data: () => ({ shyCoins: 500 }) },
      { id: 'user-2', ref: { path: 'users/user-2' }, data: () => ({ shyCoins: 200 }) },
    ];
    mockCollectionSnap = { empty: false, docs: userDocs };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-coins');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affected).toBe(2);
    // Verify batch.update was called with shyCoins: 0 for each user
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), { shyCoins: 0 });
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('returns affected: 0 when no users have coins', async () => {
    mockCollectionSnap = { empty: true, docs: [] };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-coins');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affected).toBe(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── POST /cleanup/all-device-bindings ────────────────────────────

describe('POST /api/cleanup/all-device-bindings', () => {
  test('deletes all device bindings and returns deleted count', async () => {
    const bindingDocs = [
      { id: 'binding-1', ref: { path: 'deviceBindings/binding-1' } },
      { id: 'binding-2', ref: { path: 'deviceBindings/binding-2' } },
      { id: 'binding-3', ref: { path: 'deviceBindings/binding-3' } },
    ];
    mockCollectionSnap = { empty: false, docs: bindingDocs };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-device-bindings');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(3);
    expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('returns deleted: 0 with message when collection is empty', async () => {
    mockCollectionSnap = { empty: false, docs: [] };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-device-bindings');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBeDefined();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── GET /storage/audit ───────────────────────────────────────────

describe('GET /api/storage/audit', () => {
  test('returns folder counts and total size for all 7 R2 folders', async () => {
    // Each folder returns 2 objects with known sizes
    mockListObjectsWithMetadata.mockResolvedValue([
      { key: 'profiles/img1.webp', size: 1024 },
      { key: 'profiles/img2.webp', size: 2048 },
    ]);

    const app = createApp(true);
    const res = await request(app).get('/api/storage/audit');

    expect(res.status).toBe(200);
    expect(res.body.folders).toBeDefined();
    // Should have entries for all 7 folders
    const expectedFolders = [
      'profiles',
      'covers',
      'messages',
      'groups',
      'evidence',
      'stickers',
      'banners',
    ];
    for (const folder of expectedFolders) {
      expect(res.body.folders).toHaveProperty(folder);
      expect(res.body.folders[folder]).toHaveProperty('count');
      expect(res.body.folders[folder]).toHaveProperty('bytes');
    }
    expect(res.body.totalFiles).toBeDefined();
    expect(res.body.totalBytes).toBeDefined();
    // 7 folders × 2 files each = 14 total
    expect(res.body.totalFiles).toBe(14);
    // 7 folders × (1024 + 2048) = 7 × 3072 = 21504
    expect(res.body.totalBytes).toBe(21504);
  });

  test('returns zero counts when R2 folders are empty', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([]);

    const app = createApp(true);
    const res = await request(app).get('/api/storage/audit');

    expect(res.status).toBe(200);
    expect(res.body.totalFiles).toBe(0);
    expect(res.body.totalBytes).toBe(0);
  });

  test('returns 500 when R2 listing fails', async () => {
    mockListObjectsWithMetadata.mockRejectedValue(new Error('R2 unavailable'));

    const app = createApp(true);
    const res = await request(app).get('/api/storage/audit');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/destroyed-users ────────────────────────────────

describe('POST /api/cleanup/destroyed-users', () => {
  test('deletes users missing createdAt and returns count', async () => {
    const userDocs = [
      // Destroyed — no createdAt
      { id: 'user-bad-1', data: () => ({ uid: 'user-bad-1' }) },
      { id: 'user-bad-2', data: () => ({}) },
      // Intact — has createdAt
      { id: 'user-ok-1', data: () => ({ uid: 'user-ok-1', createdAt: '2025-01-01' }) },
    ];
    mockCollectionSnap = { empty: false, docs: userDocs };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/destroyed-users');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.destroyed).toBe(2);
    expect(res.body.intact).toBe(1);
    expect(Array.isArray(res.body.deletedUids)).toBe(true);
    expect(res.body.deletedUids).toContain('user-bad-1');
    expect(res.body.deletedUids).toContain('user-bad-2');
    // Batch delete should have been called for the 2 destroyed users
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('returns destroyed: 0 with message when all users are intact', async () => {
    const userDocs = [
      { id: 'user-ok-1', data: () => ({ uid: 'user-ok-1', createdAt: '2025-01-01' }) },
      { id: 'user-ok-2', data: () => ({ uid: 'user-ok-2', createdAt: '2025-06-01' }) },
    ];
    mockCollectionSnap = { empty: false, docs: userDocs };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/destroyed-users');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.destroyed).toBe(0);
    expect(res.body.intact).toBe(2);
    expect(res.body.message).toBeDefined();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('returns 500 when Firestore query fails', async () => {
    const { db } = require('../../src/utils/firebase');
    // Make the collection chain throw
    jest.spyOn(db, 'collection').mockImplementationOnce(() => {
      throw new Error('Firestore unavailable');
    });

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/destroyed-users');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/user-coins/:uniqueId ───────────────────────────

describe('POST /api/cleanup/user-coins/:uniqueId', () => {
  test('requires admin — returns 403 for non-admin', async () => {
    const app = createApp(false);
    const res = await request(app).post('/api/cleanup/user-coins/test-user-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  test('resets shyCoins to 0 for the specified user and returns success', async () => {
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/user-coins/test-user-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('users/test-user-1');
    const docRef = mockDoc.mock.results[0].value;
    expect(docRef.update).toHaveBeenCalledWith({ shyCoins: 0 });
  });

  test('returns 500 when Firestore update fails', async () => {
    mockDoc.mockImplementationOnce(() => ({
      update: jest.fn().mockRejectedValue(new Error('Firestore error')),
    }));

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/user-coins/test-user-1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/user-beans/:uniqueId ───────────────────────────

describe('POST /api/cleanup/user-beans/:uniqueId', () => {
  test('requires admin — returns 403 for non-admin', async () => {
    const app = createApp(false);
    const res = await request(app).post('/api/cleanup/user-beans/test-user-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  test('resets shyBeans to 0 for the specified user and returns success', async () => {
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/user-beans/test-user-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('users/test-user-1');
    const docRef = mockDoc.mock.results[0].value;
    expect(docRef.update).toHaveBeenCalledWith({ shyBeans: 0 });
  });

  test('returns 500 when Firestore update fails', async () => {
    mockDoc.mockImplementationOnce(() => ({
      update: jest.fn().mockRejectedValue(new Error('Firestore error')),
    }));

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/user-beans/test-user-1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/device-binding/:uniqueId ──────────────────────

describe('POST /api/cleanup/device-binding/:uniqueId', () => {
  test('requires admin — returns 403 for non-admin', async () => {
    const app = createApp(false);
    const res = await request(app).post('/api/cleanup/device-binding/10000001');
    expect(res.status).toBe(403);
  });

  test('parses numeric uniqueId string to number for Firestore query', async () => {
    const mockDeleteFn = jest.fn().mockResolvedValue();
    mockCollectionSnap = {
      empty: false,
      docs: [{ ref: { delete: mockDeleteFn }, id: 'device-1' }],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/device-binding/10000001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
  });

  test('keeps non-numeric uniqueId as string', async () => {
    mockCollectionSnap = {
      empty: true,
      docs: [],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/device-binding/abc123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toContain('No device bindings');
  });

  test('returns deleted count when bindings exist', async () => {
    const mockDeleteFn = jest.fn().mockResolvedValue();
    mockCollectionSnap = {
      empty: false,
      docs: [
        { ref: { delete: mockDeleteFn }, id: 'device-1' },
        { ref: { delete: mockDeleteFn }, id: 'device-2' },
      ],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/device-binding/10000001');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
  });

  test('returns deleted 0 with message when no bindings found', async () => {
    mockCollectionSnap = { empty: true, docs: [] };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/device-binding/99999999');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(0);
  });
});
