const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();

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
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
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
    increment: jest.fn((n) => `increment(${n})`),
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

jest.mock('../../src/routes/admin-users', () => ({
  createWarning: jest.fn().mockResolvedValue(),
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

// ─── App setup ───────────────────────────────────────────────────

const reportsRouter = require('../../src/routes/reports');

function createApp({ uid = 'admin-firebase-uid', uniqueId = 'admin-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: { admin: true } };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/reports/stats', () => {
  let app;
  let queryDocs;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
  });

  it('returns 200 with counts', async () => {
    // queryDocs is called 3 times in parallel: pending, resolvedToday, allResolved
    queryDocs
      .mockResolvedValueOnce([
        { id: 'r1', status: 'pending', createdAt: 1699000000000 },
        { id: 'r2', status: 'pending', createdAt: 1699100000000 },
      ])
      .mockResolvedValueOnce([
        {
          id: 'r3',
          status: 'resolved',
          resolvedAt: 1700000000000,
          resolvedBy: 'admin-firebase-uid',
          createdAt: 1699900000000,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'r3',
          status: 'resolved',
          resolvedAt: 1700000000000,
          createdAt: 1699900000000,
        },
      ]);

    const res = await request(app).get('/api/reports/stats');

    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(2);
    expect(res.body.resolvedToday).toBe(1);
    expect(typeof res.body.avgResponseHours).toBe('number');
    expect(Array.isArray(res.body.activeReviewers)).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app).get('/api/reports/stats');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/reports/export', () => {
  let app;
  let queryDocs;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
  });

  it('returns CSV string with correct content-type', async () => {
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reporterName: 'Alice',
        reportedUserName: 'Bob',
        reason: 'spam',
        description: 'Sent spam messages',
        actionTaken: 'warned',
        resolvedAt: 1700000000000,
        resolvedBy: 'admin-firebase-uid',
        createdAt: 1699000000000,
      },
    ]);

    const res = await request(app).get('/api/reports/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    // Response body should be a string (CSV)
    expect(typeof res.text).toBe('string');
    // Should contain the CSV header row
    expect(res.text).toMatch(/id,reporterName,reportedUserName,reason/);
    // Should contain data from the mock report
    expect(res.text).toMatch(/spam/);
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app).get('/api/reports/export');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/reports/:id/lock', () => {
  let app;
  let getDoc;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
    // Admin user doc lookup returns a display name
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'admin-1',
      data: () => ({ displayName: 'Admin User', uniqueId: 'admin-1' }),
    });
  });

  it('returns 200 and writes reportLocks doc', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'admin-1',
      displayName: 'Admin User',
      uniqueId: 'admin-1',
    });

    const res = await request(app).post('/api/reports/report-1/lock');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedBy: 'admin-firebase-uid',
      }),
      { merge: true },
    );
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app).post('/api/reports/report-1/lock');

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/reports/:id/lock', () => {
  let app;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
  });

  it('returns 200 and deletes reportLocks doc', async () => {
    const res = await request(app).delete('/api/reports/report-1/lock');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocDelete).toHaveBeenCalled();
  });

  it('deletes lock using reportLocks/${reportId} path (not reportedUserId)', async () => {
    const { db } = require('../../src/utils/firebase');

    const res = await request(app).delete('/api/reports/report-42/lock');

    expect(res.status).toBe(200);
    // Verify db.doc was called with the reportId-based path
    const docPaths = db.doc.mock.calls.map((call) => call[0]);
    expect(docPaths).toContain('reportLocks/report-42');
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app).delete('/api/reports/report-1/lock');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/reports/:id/lock — lock path correctness', () => {
  let app;
  let getDoc;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'admin-1',
      data: () => ({ displayName: 'Admin User', uniqueId: 'admin-1' }),
    });
  });

  it('writes lock using reportLocks/${reportId} path (not reportedUserId)', async () => {
    const { db } = require('../../src/utils/firebase');
    getDoc.mockResolvedValueOnce({
      id: 'admin-1',
      displayName: 'Admin User',
      uniqueId: 'admin-1',
    });

    const res = await request(app).post('/api/reports/report-99/lock');

    expect(res.status).toBe(200);
    // Verify db.doc was called with the reportId-based path, not some userId-based path
    const docPaths = db.doc.mock.calls.map((call) => call[0]);
    expect(docPaths).toContain('reportLocks/report-99');
  });
});

describe('POST /api/reports/resolve-all/:userId', () => {
  let app;
  let queryDocs;
  let requireAdmin;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
    mockBatchCommit.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockDocDelete.mockResolvedValue();
  });

  it('resolves all pending reports and returns resolved count', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target-user', reporterId: 'reporter-1', status: 'pending' },
      { id: 'r2', reportedUserId: 'target-user', reporterId: 'reporter-2', status: 'pending' },
    ]);

    const res = await request(app)
      .post('/api/reports/resolve-all/target-user')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resolved).toBe(2);
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
  });

  it('returns resolved: 0 when no pending reports exist', async () => {
    queryDocs.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/reports/resolve-all/target-user')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resolved).toBe(0);
    // No batch writes when there's nothing to resolve
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app)
      .post('/api/reports/resolve-all/target-user')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(403);
  });
});

// GET /api/admin/audit-log — removed from reports.js; now served by
// admin-audit-log.js which supports filtering, pagination, and reads
// from all three audit collections. See admin-audit-log-suggestions.test.js.
