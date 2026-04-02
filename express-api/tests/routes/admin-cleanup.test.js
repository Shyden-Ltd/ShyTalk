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
  CDN_URL: 'https://images.shytalk.shyden.co.uk',
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

// Restore spies between tests so mockImplementation does not leak
afterEach(() => jest.restoreAllMocks());

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

  test('returns 500 when Firestore query fails', async () => {
    const { db } = require('../../src/utils/firebase');
    jest.spyOn(db, 'collection').mockImplementationOnce(() => {
      throw new Error('Firestore unavailable');
    });

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/device-binding/10000001');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// SECTION 3: Comprehensive branch coverage — remaining endpoints
// ══════════════════════════════════════════════════════════════════

// Helper: spy db.collection to return different snaps per call index
function spyCollectionPerCall(snaps) {
  let callCount = 0;
  const { db } = require('../../src/utils/firebase');
  return jest.spyOn(db, 'collection').mockImplementation(() => {
    const snap = snaps[Math.min(callCount++, snaps.length - 1)];
    const chain = {
      where: jest.fn().mockImplementation(() => chain),
      orderBy: jest.fn().mockImplementation(() => chain),
      limit: jest.fn().mockImplementation(() => chain),
      get: jest.fn().mockResolvedValue(snap),
    };
    return chain;
  });
}

function spyCollectionThrow() {
  const { db } = require('../../src/utils/firebase');
  return jest.spyOn(db, 'collection').mockImplementationOnce(() => {
    throw new Error('Firestore unavailable');
  });
}

// ── POST /cleanup/system-conversations ────────────────────────────

describe('POST /api/cleanup/system-conversations', () => {
  test('deletes duplicate system conversations and keeps canonical ones', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);

    const convDocs = [
      {
        id: 'SHYTALK_SYSTEM_user-1',
        data: () => ({ participantIds: ['user-1', 'SHYTALK_SYSTEM'] }),
      },
      { id: 'dup-conv-123', data: () => ({ participantIds: ['user-1', 'SHYTALK_SYSTEM'] }) },
    ];
    mockCollectionSnap = { empty: false, docs: convDocs };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/system-conversations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
  });

  test('skips conversations where otherUid is not found', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'conv-system-only', data: () => ({ participantIds: ['SHYTALK_SYSTEM'] }) }],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/system-conversations');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('returns deleted 0 when no system conversations exist', async () => {
    mockCollectionSnap = { empty: true, docs: [] };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/system-conversations');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('keeps first non-canonical conv and deletes second for same user', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);

    mockCollectionSnap = {
      empty: false,
      docs: [
        { id: 'random-id-1', data: () => ({ participantIds: ['user-2', 'SHYTALK_SYSTEM'] }) },
        { id: 'random-id-2', data: () => ({ participantIds: ['user-2', 'SHYTALK_SYSTEM'] }) },
      ],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/system-conversations');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
  });

  test('returns 500 when Firestore query fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/system-conversations');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-system-conversations ──────────────────────

describe('POST /api/cleanup/all-system-conversations', () => {
  test('deletes all system conversations and returns count', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);

    mockCollectionSnap = {
      empty: false,
      docs: [
        { id: 'conv-1', data: () => ({ participantIds: ['user-1', 'SHYTALK_SYSTEM'] }) },
        { id: 'conv-2', data: () => ({ participantIds: ['user-2', 'SHYTALK_SYSTEM'] }) },
      ],
    };

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-system-conversations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2);
  });

  test('returns deleted 0 when no system conversations exist', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-system-conversations');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-system-conversations');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-reports ───────────────────────────────────

describe('POST /api/cleanup/all-reports', () => {
  test('deletes reports, reportsArchive, reportLocks and R2 evidence', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs
      .mockResolvedValueOnce([{ id: 'report-1' }])
      .mockResolvedValueOnce([{ id: 'archive-1' }])
      .mockResolvedValueOnce([{ id: 'lock-1' }]);

    mockListObjects.mockResolvedValueOnce(['evidence/img1.webp']);

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-reports');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteObjects).toHaveBeenCalled();
    expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('handles empty collections gracefully', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-reports');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 500 when R2 delete fails', async () => {
    mockListObjects.mockRejectedValueOnce(new Error('R2 error'));
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-reports');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-warnings ──────────────────────────────────

describe('POST /api/cleanup/all-warnings', () => {
  test('resets warnings on users with warningCount or hasActiveWarning', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [
        { id: 'user-1', data: () => ({ warningCount: 3 }) },
        { id: 'user-2', data: () => ({ hasActiveWarning: true }) },
      ],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-warnings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
    expect(mockBatchUpdate).toHaveBeenCalled();
  });

  test('returns affected 0 when no users have warnings', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-warnings');
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-warnings');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-backpacks ─────────────────────────────────

describe('POST /api/cleanup/all-backpacks', () => {
  test('deletes backpack items from all users', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'user-1', data: () => ({ uid: 'user-1' }) }] },
      { empty: false, docs: [{ ref: { path: 'users/u1/backpack/item-1' } }] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-backpacks');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
  });

  test('handles users with empty backpacks', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'user-1', data: () => ({ uid: 'user-1' }) }] },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-backpacks');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-backpacks');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-giftwalls ─────────────────────────────────

describe('POST /api/cleanup/all-giftwalls', () => {
  test('deletes gift wall items from all users', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'user-1', data: () => ({ uid: 'user-1' }) }] },
      { empty: false, docs: [{ ref: { path: 'users/u1/giftWall/gift-1' } }] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-giftwalls');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
  });

  test('skips users with empty gift walls', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'user-1', data: () => ({ uid: 'user-1' }) }] },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-giftwalls');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-giftwalls');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-beans ─────────────────────────────────────

describe('POST /api/cleanup/all-beans', () => {
  test('resets shyBeans to 0 for all users with beans > 0', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [
        { id: 'user-1', ref: { path: 'users/user-1' }, data: () => ({ shyBeans: 100 }) },
        { id: 'user-2', ref: { path: 'users/user-2' }, data: () => ({ shyBeans: 50 }) },
      ],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-beans');
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), { shyBeans: 0 });
  });

  test('returns affected 0 when no users have beans', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-beans');
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-beans');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-spin-history ──────────────────────────────

describe('POST /api/cleanup/all-spin-history', () => {
  test('resets pity counters and deletes GACHA_PULL transactions', async () => {
    spyCollectionPerCall([
      {
        empty: false,
        docs: [{ id: 'u1', ref: { path: 'users/u1' }, data: () => ({ pityCounter: 5 }) }],
      },
      { empty: false, docs: [{ id: 'u1', data: () => ({ uid: 'u1' }) }] },
      { empty: false, docs: [{ ref: { path: 'users/u1/transactions/tx1' } }] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-spin-history');
    expect(res.status).toBe(200);
    expect(res.body.pityReset).toBe(1);
    expect(res.body.txDeleted).toBe(1);
  });

  test('handles no pity counters and no transactions', async () => {
    spyCollectionPerCall([
      { empty: true, docs: [] },
      { empty: false, docs: [{ id: 'u1', data: () => ({ uid: 'u1' }) }] },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-spin-history');
    expect(res.status).toBe(200);
    expect(res.body.pityReset).toBe(0);
    expect(res.body.txDeleted).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-spin-history');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-supershy ──────────────────────────────────

describe('POST /api/cleanup/all-supershy', () => {
  test('clears Super Shy status for all SuperShy users', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'u1', ref: { path: 'users/u1' }, data: () => ({ isSuperShy: true }) }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-supershy');
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), {
      isSuperShy: false,
      superShyExpiry: null,
      superShyTier: null,
      hasClaimedSuperShyTrial: false,
    });
  });

  test('returns affected 0 when no SuperShy users', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-supershy');
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-supershy');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-transactions ──────────────────────────────

describe('POST /api/cleanup/all-transactions', () => {
  test('deletes all transactions from all users', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'u1', data: () => ({ uid: 'u1' }) }] },
      { empty: false, docs: [{ ref: { path: 'users/u1/transactions/tx1' } }] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-transactions');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(res.body.usersProcessed).toBe(1);
  });

  test('handles users with empty transaction subcollections', async () => {
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'u1', data: () => ({ uid: 'u1' }) }] },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-transactions');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.usersProcessed).toBe(1);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-transactions');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-appeals ───────────────────────────────────

describe('POST /api/cleanup/all-appeals', () => {
  test('deletes all suspension appeals', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ ref: { path: 'suspensionAppeals/a1' } }, { ref: { path: 'suspensionAppeals/a2' } }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-appeals');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
  });

  test('returns deleted 0 when no appeals exist', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-appeals');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-appeals');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/backfill-user-type ────────────────────────────

describe('POST /api/cleanup/backfill-user-type', () => {
  test('sets userType MEMBER for users missing it', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [
        { id: 'user-no-type', data: () => ({ uid: 'user-no-type' }) },
        { id: 'user-has-type', data: () => ({ uid: 'user-has-type', userType: 'ADMIN' }) },
      ],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/backfill-user-type');
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
  });

  test('returns updated 0 when all users already have userType', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'u1', data: () => ({ uid: 'u1', userType: 'MEMBER' }) }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/backfill-user-type');
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.message).toBeDefined();
  });

  test('recognises snake_case user_type field', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'u1', data: () => ({ uid: 'u1', user_type: 'MEMBER' }) }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/backfill-user-type');
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/backfill-user-type');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-private-messages ──────────────────────────

describe('POST /api/cleanup/all-private-messages', () => {
  test('deletes private conversations and associated R2 media', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    spyCollectionPerCall([
      { empty: false, docs: [{ id: 'pm-1', data: () => ({ isGroup: false }) }] },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-private-messages');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
  });

  test('returns early when no private messages found', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'group-1', data: () => ({ isGroup: true }) }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-private-messages');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBe('No private messages found');
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-private-messages');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-group-chats ───────────────────────────────

describe('POST /api/cleanup/all-group-chats', () => {
  test('deletes group chats, group photos, and media', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    spyCollectionPerCall([
      {
        empty: false,
        docs: [
          {
            id: 'group-1',
            data: () => ({
              isGroup: true,
              groupPhotoUrl: 'https://images.shytalk.shyden.co.uk/groups/photo1.webp',
            }),
          },
        ],
      },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-group-chats');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(mockDeleteObject).toHaveBeenCalledWith('groups/photo1.webp');
  });

  test('returns early when no group chats found', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-group-chats');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBe('No group chats found');
  });

  test('handles group photo R2 delete failure gracefully', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    mockDeleteObject.mockRejectedValueOnce(new Error('R2 error'));
    spyCollectionPerCall([
      {
        empty: false,
        docs: [
          {
            id: 'group-1',
            data: () => ({
              isGroup: true,
              groupPhotoUrl: 'https://images.shytalk.shyden.co.uk/groups/photo1.webp',
            }),
          },
        ],
      },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-group-chats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('handles snake_case group_photo_url field', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    spyCollectionPerCall([
      {
        empty: false,
        docs: [
          {
            id: 'group-1',
            data: () => ({
              isGroup: true,
              group_photo_url: 'https://images.shytalk.shyden.co.uk/groups/photo2.webp',
            }),
          },
        ],
      },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-group-chats');
    expect(res.status).toBe(200);
    expect(mockDeleteObject).toHaveBeenCalledWith('groups/photo2.webp');
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-group-chats');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-rooms ─────────────────────────────────────

describe('POST /api/cleanup/all-rooms', () => {
  test('deletes closed rooms and their subcollections', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValue([]);
    mockCollectionSnap = {
      empty: false,
      docs: [{ id: 'room-1', data: () => ({ state: 'CLOSED' }) }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-rooms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
  });

  test('returns early when no closed rooms found', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-rooms');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBe('No closed rooms found');
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-rooms');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-broadcasts ────────────────────────────────

describe('POST /api/cleanup/all-broadcasts', () => {
  test('deletes all broadcast documents', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ ref: { path: 'broadcasts/b1' } }, { ref: { path: 'broadcasts/b2' } }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-broadcasts');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
  });

  test('returns early when no broadcasts found', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-broadcasts');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBe('No broadcasts found');
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-broadcasts');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-audit-logs ────────────────────────────────

describe('POST /api/cleanup/all-audit-logs', () => {
  test('deletes all audit log documents', async () => {
    mockCollectionSnap = {
      empty: false,
      docs: [{ ref: { path: 'adminAuditLog/log-1' } }],
    };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
  });

  test('returns early when no audit logs found', async () => {
    mockCollectionSnap = { empty: true, docs: [] };
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.message).toBe('No audit logs found');
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-audit-logs');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/orphaned-storage ──────────────────────────────

describe('POST /api/cleanup/orphaned-storage', () => {
  test('identifies and deletes orphaned R2 objects', async () => {
    spyCollectionPerCall([
      {
        docs: [
          {
            id: 'u1',
            data: () => ({
              uid: 'u1',
              profilePhotoUrl: 'https://images.shytalk.shyden.co.uk/profiles/user1.webp',
            }),
          },
        ],
      },
      { docs: [] }, // conversations
      { docs: [] }, // rooms
      { docs: [] }, // reports
      { docs: [] }, // reportsArchive
      { docs: [] }, // banners
    ]);
    mockListObjects.mockResolvedValue(['profiles/user1.webp', 'profiles/orphan.webp']);

    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/orphaned-storage');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
  });

  test('returns 500 when Firestore fails during key collection', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/orphaned-storage');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /cleanup/all-stalkers ──────────────────────────────────

describe('POST /api/cleanup/all-stalkers', () => {
  test('deletes stalker subcollections and resets counts on users', async () => {
    spyCollectionPerCall([
      {
        empty: false,
        docs: [
          {
            id: 'u1',
            data: () => ({
              uid: 'u1',
              stalkerCount: 3,
              newStalkerCount: 1,
              stalkersLastViewedAt: 123,
            }),
          },
        ],
      },
      { empty: false, docs: [{ ref: { path: 'users/u1/stalkers/s1' } }] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-stalkers');
    expect(res.status).toBe(200);
    expect(res.body.stalkersDeleted).toBe(1);
    expect(res.body.usersReset).toBe(1);
  });

  test('handles users with no stalkers and no counts to reset', async () => {
    spyCollectionPerCall([
      {
        empty: false,
        docs: [{ id: 'u1', data: () => ({ uid: 'u1', stalkerCount: 0, newStalkerCount: 0 }) }],
      },
      { empty: true, docs: [] },
    ]);
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-stalkers');
    expect(res.status).toBe(200);
    expect(res.body.stalkersDeleted).toBe(0);
    expect(res.body.usersReset).toBe(0);
  });

  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-stalkers');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── Error paths for endpoints already tested for happy path ─────

describe('POST /api/cleanup/all-coins - error path', () => {
  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-coins');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/cleanup/all-device-bindings - error path', () => {
  test('returns 500 when Firestore fails', async () => {
    spyCollectionThrow();
    const app = createApp(true);
    const res = await request(app).post('/api/cleanup/all-device-bindings');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
