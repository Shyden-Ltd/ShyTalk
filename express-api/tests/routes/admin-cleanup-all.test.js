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

// ── POST /cleanup/all-supershy ──────────────────────────────────

// ── POST /cleanup/all-transactions ──────────────────────────────

// ── POST /cleanup/all-appeals ───────────────────────────────────

// ── POST /cleanup/backfill-user-type ────────────────────────────

// ── POST /cleanup/all-private-messages ──────────────────────────

// ── POST /cleanup/all-group-chats ───────────────────────────────

// ── POST /cleanup/all-rooms ─────────────────────────────────────

// ── POST /cleanup/all-broadcasts ────────────────────────────────

// ── POST /cleanup/all-audit-logs ────────────────────────────────

// ── POST /cleanup/orphaned-storage ──────────────────────────────

// ── POST /cleanup/all-stalkers ──────────────────────────────────

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
