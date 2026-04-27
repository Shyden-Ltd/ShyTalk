/* eslint-disable no-unused-vars */
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
  CDN_URL: 'https://images.shytalk.shyden.co.uk', // localhost: not used in tests
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

// ── POST /cleanup/all-device-bindings ────────────────────────────

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

// ── POST /cleanup/user-coins/:uniqueId ───────────────────────────

// ── POST /cleanup/user-beans/:uniqueId ───────────────────────────

// ── POST /cleanup/device-binding/:uniqueId ──────────────────────

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

// ── POST /cleanup/all-system-conversations ──────────────────────

// ── POST /cleanup/all-reports ───────────────────────────────────

// ── POST /cleanup/all-warnings ──────────────────────────────────

// ── POST /cleanup/all-backpacks ─────────────────────────────────

// ── POST /cleanup/all-giftwalls ─────────────────────────────────

// ── POST /cleanup/all-beans ─────────────────────────────────────

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
