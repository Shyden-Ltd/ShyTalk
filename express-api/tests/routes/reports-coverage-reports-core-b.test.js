/* eslint-disable no-unused-vars */
/**
 * Comprehensive coverage tests for src/routes/reports.js
 */
const express = require('express');
const request = require('supertest');

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockRtdbSet = jest.fn().mockResolvedValue();
const mockRtdbRemove = jest.fn().mockResolvedValue();

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
    batch: jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  },
  rtdb: { ref: jest.fn(() => ({ set: mockRtdbSet, remove: mockRtdbRemove })) },
  FieldValue: {
    arrayRemove: jest.fn(),
    arrayUnion: jest.fn(),
    increment: jest.fn((n) => 'increment(' + n + ')'),
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
  resolveUniqueId: jest.fn(async (uid) => uid || null),
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

function createUserApp({ uid = 'user-firebase-uid', uniqueId = 'user-123' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

// =================================================================
// cleanupInvalidAdminTokens + FCM (lines 36-54, 117, 120-133)
// =================================================================

// =================================================================
// GET /api/reports - search + enrichment (lines 172,190,205,213-222,237)
// =================================================================
describe('GET /api/reports - search and enrichment', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('filters by search across name, reason, description', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '101',
          reporterId: 'rep1',
          reportedUserName: 'Alice',
          reporterName: 'Bob',
          reason: 'spam',
          description: 'Ads',
          status: 'pending',
          createdAt: 1699e9,
        },
        {
          id: 'r2',
          reportedUserId: 'u2',
          reportedUserUniqueId: '102',
          reporterId: 'rep2',
          reportedUserName: 'Charlie',
          reporterName: 'Dave',
          reason: 'harass',
          description: 'Mean',
          status: 'pending',
          createdAt: 1699e9 + 1e8,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: '101', displayName: 'Alice', gcsScore: 80 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Bob' });
    const res = await request(app).get('/api/reports?status=pending&search=alice');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('search matches reporterName', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '101',
          reporterId: 'rep1',
          reportedUserName: 'A',
          reporterName: 'BobHit',
          reason: 'spam',
          description: null,
          status: 'resolved',
          createdAt: 1699e9,
          actionTaken: 'dismissed',
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: '101', displayName: 'A', gcsScore: 90 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'BobHit' });
    const res = await request(app).get('/api/reports?status=resolved&search=bobhit');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('search matches description', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '101',
          reporterId: 'rep1',
          reportedUserName: 'A',
          reporterName: 'B',
          reason: 'spam',
          description: 'UniqueText',
          status: 'pending',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: '101', displayName: 'A', gcsScore: 90 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'B' });
    const res = await request(app).get('/api/reports?status=pending&search=uniquetext');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('enriches with gcsDisplayScore', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '201',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({
        id: '201',
        displayName: 'User',
        gcsScore: 75,
        gcsLastDeductionAt: 1699e9,
      })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });
    const { computeDisplayScore } = require('../../src/utils/gcs');
    computeDisplayScore.mockReturnValueOnce(80);
    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(computeDisplayScore).toHaveBeenCalledWith(75, 1699e9);
  });

  it('handles null reportedUserUniqueId — server re-resolves so the field is irrelevant', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          // Stored value is null; new enrichment re-resolves from reportedUserId
          // via the identity mock, so this field is ignored entirely.
          reportedUserUniqueId: null,
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    // Two getDoc calls now: one for the resolved reported user ('u1'), one for rep1.
    getDoc
      .mockResolvedValueOnce({ id: 'u1', displayName: 'Reported' })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });
    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('handles null reportedUser doc', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '301',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });
    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('enriches report locks', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '401',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([{ id: 'u1', lockedBy: 'admin-1', lockedAt: 1699.5e9 }]);
    getDoc
      .mockResolvedValueOnce({ id: '401', displayName: 'Reported', gcsScore: 90 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });
    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.users[0].lock).toBeDefined();
  });

  it('returns resolved reports grouped by user', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '501',
          reporterId: 'rep1',
          reason: 'spam',
          status: 'resolved',
          actionTaken: 'warned',
          createdAt: 1699e9,
          resolvedAt: 1699.5e9,
        },
        {
          id: 'r2',
          reportedUserId: 'u1',
          reportedUserUniqueId: '501',
          reporterId: 'rep2',
          reason: 'harass',
          status: 'resolved',
          actionTaken: 'warned',
          createdAt: 1699.1e9,
          resolvedAt: 1699.6e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({
        id: '501',
        displayName: 'User',
        uniqueId: 501,
        warningCount: 2,
        isSuspended: false,
        gcsScore: 85,
      })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'R1' })
      .mockResolvedValueOnce({ id: 'rep2', displayName: 'R2' });
    const res = await request(app).get('/api/reports?status=resolved');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].reportCount).toBe(2);
  });
});

// =================================================================
// POST /api/reports/:id/resolve - edge cases (lines 372-378,418,430,453,465-469)
// =================================================================

// =================================================================
// POST /api/reports/resolve-all/:userId (lines 505-532,541-607,647,656-660)
// =================================================================

// =================================================================
// GET /api/reports/stats - error (lines 723-724)
// =================================================================
describe('GET /api/reports/stats - error', () => {
  it('returns 500 on error', async () => {
    const app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    require('../../src/utils/firestore-helpers').queryDocs.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/reports/stats');
    expect(res.status).toBe(500);
  });
});

// =================================================================
// GET /api/reports/export - date filters (lines 743,786-787)
// =================================================================
describe('GET /api/reports/export - date filters', () => {
  let app, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('applies from date filter', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/reports/export?from=2024-01-01');
    expect(res.status).toBe(200);
  });

  it('applies to date filter (client-side)', async () => {
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reporterName: 'A',
        reportedUserName: 'B',
        reason: 'spam',
        description: '',
        actionTaken: 'warned',
        resolvedAt: 1704067200000,
        resolvedBy: 'admin',
        createdAt: 1704000000000,
      },
      {
        id: 'r2',
        reporterName: 'C',
        reportedUserName: 'D',
        reason: 'x',
        description: '',
        actionTaken: 'dismissed',
        resolvedAt: 1706745600000,
        resolvedBy: 'admin',
        createdAt: 1706700000000,
      },
    ]);
    const res = await request(app).get('/api/reports/export?to=2024-01-15');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')).toHaveLength(2);
  });

  it('escapes quotes in CSV', async () => {
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reporterName: 'User "Nick"',
        reportedUserName: 'T',
        reason: 'spam',
        description: 'Has "quotes"',
        actionTaken: 'warned',
        resolvedAt: 1704067200000,
        resolvedBy: 'admin',
        createdAt: 1704000000000,
      },
    ]);
    const res = await request(app).get('/api/reports/export');
    expect(res.status).toBe(200);
    expect(res.text).toContain('""');
  });

  it('returns 500 on error', async () => {
    queryDocs.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/reports/export');
    expect(res.status).toBe(500);
  });

  it('returns empty CSV when no reports', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/reports/export');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')).toHaveLength(1);
  });

  it('handles from+to together', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', resolvedAt: 1704067200000, createdAt: 1704000000000 },
    ]);
    const res = await request(app).get('/api/reports/export?from=2023-12-01&to=2024-01-31');
    expect(res.status).toBe(200);
  });
});

// =================================================================
// POST/DELETE lock - error paths (lines 811-815, 828-832)
// =================================================================

describe('DELETE /api/reports/:id/lock - error', () => {
  it('returns 500 when unlock fails', async () => {
    const app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocDelete.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).delete('/api/reports/r1/lock');
    expect(res.status).toBe(500);
  });
});

// =================================================================
// POST /api/admin/users/:uniqueId/suspend (lines 842-909)
// =================================================================

// =================================================================
// POST /api/admin/users/:uniqueId/unsuspend (lines 915-963)
// =================================================================

// =================================================================
// POST /api/appeals - edge cases (line 977, 1018-1019)
// =================================================================

// =================================================================
// GET /api/appeals - status filter + error (lines 1032, 1068-1069)
// =================================================================

// =================================================================
// PATCH /api/appeals/:id - edge cases (lines 1150-1154)
// =================================================================

// GET /api/admin/audit-log — removed from reports.js; now served by
// admin-audit-log.js. See admin-audit-log-suggestions.test.js.

// =================================================================
// evictSuspendedUser (lines 1214-1277) - via suspend endpoint
// =================================================================

// =================================================================
// Additional branch coverage tests
// =================================================================

describe('GET /api/reports - requireAdmin blocks', () => {
  it('returns 403 when requireAdmin blocks', async () => {
    const app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(403);
  });
});

// GET /api/admin/audit-log - admin name enrichment — removed from reports.js;
// now served by admin-audit-log.js. See admin-audit-log-suggestions.test.js.

describe('GET /api/reports/stats - no resolved reports + edge cases', () => {
  let app, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('returns 0 avgResponseHours when no resolved reports', async () => {
    queryDocs.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await request(app).get('/api/reports/stats');
    expect(res.status).toBe(200);
    expect(res.body.avgResponseHours).toBe(0);
    expect(res.body.activeReviewers).toEqual([]);
  });

  it('handles resolved reports without resolvedBy', async () => {
    queryDocs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'r1', status: 'resolved', resolvedAt: 1700e9, createdAt: 1699.9e9, resolvedBy: null },
      ])
      .mockResolvedValueOnce([
        { id: 'r1', status: 'resolved', resolvedAt: 1700e9, createdAt: 1699.9e9 },
      ]);
    const res = await request(app).get('/api/reports/stats');
    expect(res.status).toBe(200);
    expect(res.body.resolvedToday).toBe(1);
  });
});

// =================================================================
// Pass-6 backfill: GET /api/reports IDOR strip + allSettled resilience
// =================================================================

describe('Pass-6 backfill: GET /api/reports strips client-injectable reportedUserUniqueId', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('replaces stored reportedUserUniqueId with the server-resolved value (pending grouped response)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValueOnce('SERVER-12345');
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r-attack',
          reportedUserId: 'real-target-uid',
          reportedUserUniqueId: 'INJECTED-VICTIM',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: 'SERVER-12345', displayName: 'Real Target', uniqueId: 12345 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });

    const res = await request(app).get('/api/reports?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].uniqueId).not.toBe('INJECTED-VICTIM');
    expect(res.body.users[0].reports[0].reportedUserUniqueId).not.toBe('INJECTED-VICTIM');
  });

  it('returns null uniqueId when the user was deleted (no fallback to client-injected stored value)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValueOnce(null);
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r-stale',
          reportedUserId: 'deleted-user-uid',
          reportedUserUniqueId: 'INJECTED-VICTIM',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc.mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });

    const res = await request(app).get('/api/reports?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.users[0].uniqueId).toBeNull();
    expect(res.body.users[0].reports[0].reportedUserUniqueId).toBeNull();
  });
});

describe('Pass-6 backfill: GET /api/reports Promise.allSettled resilience', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('returns 200 (not 500) when one of N resolveUniqueId lookups rejects transiently', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    resolveUniqueId.mockReset();
    resolveUniqueId
      .mockResolvedValueOnce('uniq-good')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'uid-good',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
        {
          id: 'r2',
          reportedUserId: 'uid-fail',
          reporterId: 'rep2',
          status: 'pending',
          reason: 'harass',
          createdAt: 1699.1e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: 'uniq-good', displayName: 'Good', uniqueId: 100 })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'R1' })
      .mockResolvedValueOnce({ id: 'rep2', displayName: 'R2' });

    const res = await request(app).get('/api/reports?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    const failedUser = res.body.users.find((u) => u.reportedUserId === 'uid-fail');
    expect(failedUser).toBeDefined();
    expect(failedUser.uniqueId).toBeNull();
  });
});
