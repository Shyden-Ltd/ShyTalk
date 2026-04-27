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

// ── POST /cleanup/all-device-bindings ────────────────────────────

// ── GET /storage/audit ───────────────────────────────────────────

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

// ── POST /cleanup/all-reports ───────────────────────────────────

// ── POST /cleanup/all-warnings ──────────────────────────────────

// ── POST /cleanup/all-backpacks ─────────────────────────────────

// ── POST /cleanup/all-giftwalls ─────────────────────────────────

// ── POST /cleanup/all-beans ─────────────────────────────────────

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
