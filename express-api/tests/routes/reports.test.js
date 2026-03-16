const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();

const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
      delete: mockDocDelete,
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet,
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue(),
    })),
  },
  FieldValue: {
    arrayRemove: jest.fn(),
    arrayUnion: jest.fn(),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
}));

// Mock firestore-helpers to use our mock db
jest.mock('../../src/utils/firestore-helpers', () => {
  const { db } = require('../../src/utils/firebase');
  return {
    getDoc: jest.fn(async (path) => {
      const snap = await db.doc(path).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }),
    queryDocs: jest.fn(async () => []),
  };
});

// ─── App setup ──────────────────────────────────────────────────

const reportsRouter = require('../../src/routes/reports');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /api/reports', () => {
  let app;
  const { queryDocs } = require('../../src/utils/firestore-helpers');

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return resolved reports filtered by userId', async () => {
    const mockReports = [
      {
        id: 'report-1',
        reportedUserId: 'user-1',
        reporterId: 'reporter-1',
        reason: 'spam',
        status: 'resolved',
        actionTaken: 'warned',
        createdAt: 1699000000000,
        resolvedAt: 1699500000000,
      },
    ];

    // queryDocs is called for: reports query, then reportedUser docs, reporter docs, reportLocks
    queryDocs
      .mockResolvedValueOnce(mockReports) // reports query
      .mockResolvedValueOnce([]); // reportLocks

    // getDoc calls for user enrichment
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({ id: 'user-1', displayName: 'Test User', gcsScore: 80 }) // reported user
      .mockResolvedValueOnce({ id: 'reporter-1', displayName: 'Reporter' }); // reporter

    const res = await request(app).get('/api/reports?status=resolved&userId=user-1');

    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('should return 200 with empty list when no resolved reports exist for user', async () => {
    queryDocs
      .mockResolvedValueOnce([]) // reports query returns empty
      .mockResolvedValueOnce([]); // reportLocks

    const res = await request(app).get('/api/reports?status=resolved&userId=user-1');

    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
  });

  it('should return grouped results for pending reports', async () => {
    const mockReports = [
      {
        id: 'report-1',
        reportedUserId: 'user-1',
        reporterId: 'reporter-1',
        reason: 'harassment',
        status: 'pending',
        createdAt: 1699000000000,
      },
      {
        id: 'report-2',
        reportedUserId: 'user-1',
        reporterId: 'reporter-2',
        reason: 'spam',
        status: 'pending',
        createdAt: 1699100000000,
      },
    ];

    queryDocs
      .mockResolvedValueOnce(mockReports) // reports query
      .mockResolvedValueOnce([]); // reportLocks

    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({ id: 'user-1', displayName: 'Test User', gcsScore: 100 })
      .mockResolvedValueOnce({ id: 'reporter-1', displayName: 'Reporter 1' })
      .mockResolvedValueOnce({ id: 'reporter-2', displayName: 'Reporter 2' });

    const res = await request(app).get('/api/reports?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    // Pending reports are grouped by reported user
    expect(res.body.users.length).toBe(1);
    expect(res.body.users[0].reportCount).toBe(2);
  });

  it('should filter resolved reports by userId client-side', async () => {
    // Firestore returns all resolved reports; userId filtering happens in JS
    const mockReports = [
      {
        id: 'report-1',
        reportedUserId: 'user-1',
        reporterId: 'reporter-1',
        reason: 'spam',
        status: 'resolved',
        actionTaken: 'warned',
        createdAt: 1699000000000,
        resolvedAt: 1699500000000,
      },
      {
        id: 'report-2',
        reportedUserId: 'user-2',
        reporterId: 'reporter-2',
        reason: 'harassment',
        status: 'resolved',
        actionTaken: 'dismissed',
        createdAt: 1699200000000,
        resolvedAt: 1699600000000,
      },
    ];

    queryDocs
      .mockResolvedValueOnce(mockReports) // all resolved reports
      .mockResolvedValueOnce([]); // reportLocks

    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({ id: 'user-1', displayName: 'Target User', gcsScore: 80 })
      .mockResolvedValueOnce({ id: 'reporter-1', displayName: 'Reporter' });

    const res = await request(app).get('/api/reports?status=resolved&userId=user-1');

    expect(res.status).toBe(200);
    // Only report-1 should be returned (user-2's report is filtered out)
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].reportedUserId).toBe('user-1');
  });

  it('should handle Firestore query errors gracefully for resolved reports with userId filter', async () => {
    // Simulate Firestore index error
    queryDocs.mockRejectedValueOnce(
      new Error('9 FAILED_PRECONDITION: The query requires an index'),
    );

    const res = await request(app).get('/api/reports?status=resolved&userId=user-1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
