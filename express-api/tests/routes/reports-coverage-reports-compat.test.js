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

// =================================================================
// POST /api/reports/:id/resolve - edge cases (lines 372-378,418,430,453,465-469)
// =================================================================

// =================================================================
// POST /api/reports/resolve-all/:userId (lines 505-532,541-607,647,656-660)
// =================================================================

// =================================================================
// GET /api/reports/stats - error (lines 723-724)
// =================================================================

// =================================================================
// GET /api/reports/export - date filters (lines 743,786-787)
// =================================================================

// =================================================================
// POST/DELETE lock - error paths (lines 811-815, 828-832)
// =================================================================

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

describe('POST /api/reports - snake_case reporter fields', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createUserApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-123',
      data: () => ({ display_name: 'Reporter', unique_id: 'user-123' }),
    });
  });

  it('uses display_name and unique_id fallbacks', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'user-123',
      display_name: 'Reporter',
      unique_id: 'user-123',
    });
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ reporterName: 'Reporter', reporterUniqueId: 'user-123' }),
      { merge: true },
    );
  });
});

describe('GET /api/reports - snake_case user fields in enrichment', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('uses snake_case fields for user enrichment and grouping', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '601',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({
        id: '601',
        display_name: 'SnakeUser',
        profile_photo_url: 'sphoto.jpg',
        unique_id: 601,
        warning_count: 3,
        is_suspended: true,
        gcs_score: 70,
        gcs_last_deduction_at: 1699e9,
      })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });

    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    const u = res.body.users[0];
    expect(u.displayName).toBe('SnakeUser');
    expect(u.uniqueId).toBe(601);
    expect(u.warningCount).toBe(3);
    expect(u.isSuspended).toBe(true);
  });

  it('uses reportedUserUniqueId from report when user doc unique_id absent in resolved grouping', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '701',
          reporterId: 'rep1',
          status: 'resolved',
          reason: 'spam',
          createdAt: 1699e9,
          actionTaken: 'dismissed',
          resolvedAt: 1699.5e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({
        id: '701',
        display_name: 'User',
        profile_photo_url: null,
        warning_count: 0,
        is_suspended: false,
        gcs_score: 100,
      })
      .mockResolvedValueOnce({ id: 'rep1', displayName: 'Reporter' });

    const res = await request(app).get('/api/reports?status=resolved');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });

  it('handles reporter doc being null', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: '801',
          reporterId: 'rep1',
          status: 'pending',
          reason: 'spam',
          createdAt: 1699e9,
        },
      ])
      .mockResolvedValueOnce([]);
    getDoc
      .mockResolvedValueOnce({ id: '801', displayName: 'User', gcsScore: 100 })
      .mockResolvedValueOnce(null); // reporter not found

    const res = await request(app).get('/api/reports?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.users[0].reports[0].reporter).toBeNull();
  });
});

describe('POST /api/reports/:id/resolve - severity fallback and snake_case', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('warned_severe defaults severity to 4 when body.severity absent', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'warned_severe' });
    expect(res.status).toBe(200);
    // Server re-resolves from reportedUserId='t' (identity mock), ignoring the
    // stored reportedUserUniqueId='u1' to defeat client-injected IDOR.
    expect(createWarning).toHaveBeenCalledWith('t', expect.objectContaining({ severity: 4 }));
  });

  it('suspension uses snake_case pre-suspension fields', async () => {
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'x',
      })
      .mockResolvedValueOnce({
        id: 'u1',
        display_name: 'SnakeName',
        profile_photo_url: 'sp.jpg',
        cover_photo_url: 'sc.jpg',
      });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].preSuspensionDisplayName).toBe('SnakeName');
    expect(call[0].preSuspensionProfilePhotoUrl).toBe('sp.jpg');
    expect(call[0].preSuspensionCoverPhotoUrl).toBe('sc.jpg');
  });

  it('sends suspended action text in reporter PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'x',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    const reporterPm = sendSystemPm.mock.calls.find((c) => c[0] === 'rep1');
    expect(reporterPm[1]).toContain('suspended');
  });

  it('sends warned action text in reporter PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    const reporterPm = sendSystemPm.mock.calls.find((c) => c[0] === 'rep1');
    expect(reporterPm[1]).toContain('warning was issued');
  });

  it('sends dismissed action text in reporter PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: null,
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    const reporterPm = sendSystemPm.mock.calls.find((c) => c[0] === 'rep1');
    expect(reporterPm[1]).toContain('dismissed');
  });

  it('suspension without reason uses Moderation action default', async () => {
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: null,
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].suspensionReason).toBe('Moderation action');
  });
});

describe('POST /api/reports/resolve-all - snake_case fields', () => {
  let app, queryDocs, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs, getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockBatchCommit.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
    mockDocDelete.mockResolvedValue();
  });

  it('suspension uses snake_case user fields', async () => {
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    getDoc.mockResolvedValueOnce({
      id: 'ut',
      display_name: 'Snake',
      profile_photo_url: 'sp.jpg',
      cover_photo_url: 'sc.jpg',
    });
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].preSuspensionDisplayName).toBe('Snake');
    expect(call[0].preSuspensionProfilePhotoUrl).toBe('sp.jpg');
  });

  it('uses userId fallback for suspension uniqueId', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    getDoc.mockResolvedValueOnce({ id: 'target', displayName: 'User' });
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ isSuspended: true }));
  });
});

// GET /api/admin/audit-log - admin name enrichment — removed from reports.js;
// now served by admin-audit-log.js. See admin-audit-log-suggestions.test.js.

describe('GET /api/reports/:id/lock - display_name fallback', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('uses display_name fallback for admin', async () => {
    getDoc.mockResolvedValueOnce({ id: 'admin-1', display_name: 'SnakeAdmin' });
    const res = await request(app).post('/api/reports/r1/lock');
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'SnakeAdmin' }),
      { merge: true },
    );
  });
});
