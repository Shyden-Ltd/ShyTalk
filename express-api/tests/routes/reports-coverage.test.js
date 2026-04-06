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
describe('POST /api/reports - FCM + cleanupInvalidAdminTokens', () => {
  let app, getDoc, queryDocs;
  const { sendFcmToTokens } = require('../../src/utils/fcm');

  beforeEach(() => {
    app = createUserApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-123',
      data: () => ({ displayName: 'Reporter', uniqueId: 'user-123' }),
    });
  });

  it('sends FCM to admin tokens', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', fcmTokens: ['t1', 't2'] },
      { id: 'a2', fcmTokens: ['t3'] },
    ]);
    sendFcmToTokens.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendFcmToTokens).toHaveBeenCalledWith(
      ['t1', 't2', 't3'],
      expect.objectContaining({ type: 'ADMIN_NEW_REPORT' }),
    );
  });

  it('cleans up invalid admin tokens', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', fcmTokens: ['valid', 'invalid'] },
      { id: 'a2', fcmTokens: ['ok'] },
    ]);
    sendFcmToTokens.mockResolvedValueOnce(['invalid']);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockBatchSet).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('skips cleanup when no invalid tokens', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([{ id: 'a1', fcmTokens: ['t1'] }]);
    sendFcmToTokens.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('skips FCM when no admin tokens exist', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2', fcmTokens: [] }]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendFcmToTokens).not.toHaveBeenCalled();
  });

  it('skips non-array fcmTokens', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', fcmTokens: 'str' },
      { id: 'a2', fcmTokens: ['valid'] },
    ]);
    sendFcmToTokens.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendFcmToTokens).toHaveBeenCalledWith(['valid'], expect.any(Object));
  });

  it('logs error when FCM fails', async () => {
    const log = require('../../src/utils/log');
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockRejectedValueOnce(new Error('Firestore down'));
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(log.error).toHaveBeenCalled();
  });

  it('uses Unknown when reportedUserName not provided', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([{ id: 'a1', fcmTokens: ['t1'] }]);
    sendFcmToTokens.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendFcmToTokens).toHaveBeenCalledWith(
      ['t1'],
      expect.objectContaining({ reportedUserName: 'Unknown' }),
    );
  });

  it('returns 500 on internal error', async () => {
    getDoc.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam' });
    expect(res.status).toBe(500);
  });
});

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

  it('handles null reportedUserUniqueId', async () => {
    queryDocs
      .mockResolvedValueOnce([
        {
          id: 'r1',
          reportedUserId: 'u1',
          reportedUserUniqueId: null,
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
describe('POST /api/reports/:id/resolve - edge cases', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('logs error when createWarning fails', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    const log = require('../../src/utils/log');
    createWarning.mockRejectedValueOnce(new Error('fail'));
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to create warning from report',
      expect.objectContaining({ reportId: 'r1' }),
    );
  });

  it('logs error when warning PM fails', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    const log = require('../../src/utils/log');
    sendSystemPm.mockRejectedValueOnce(new Error('PM fail'));
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to send warning PM',
      expect.any(Object),
    );
  });

  it('logs error when suspension fails from resolve', async () => {
    const log = require('../../src/utils/log');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    mockDocUpdate.mockResolvedValueOnce().mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to suspend user from resolve',
      expect.objectContaining({ reportId: 'r1' }),
    );
  });

  it('sends PM for warned_severe action', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    const { createWarning } = require('../../src/routes/admin-users');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'severe',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'warned_severe', severity: 4 });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith('u1', expect.objectContaining({ severity: 4 }));
    expect(sendSystemPm).toHaveBeenCalledWith('rep1', expect.stringContaining('severe warning'));
  });

  it('sends reviewed text for unknown action', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'custom_action' });
    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith('rep1', expect.stringContaining('reviewed'));
  });

  it('sends suspended PM with appeal text', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'x',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'U' });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'suspended', canAppeal: true });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const pm = sendSystemPm.mock.calls.find((c) => c[0] === 't' && c[1].includes('suspended'));
    expect(pm[1]).toContain('submit an appeal');
  });

  it('sends suspended PM without appeal text', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'x',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'U' });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'suspended', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const pm = sendSystemPm.mock.calls.find((c) => c[0] === 't' && c[1].includes('suspended'));
    expect(pm[1]).not.toContain('submit an appeal');
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(500);
  });

  it('skips reporter PM when reporterId is null', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({ id: 'r1', reportedUserId: 't', reporterId: null, reason: 'x' });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });

  it('uses suspensionDays for endTimestamp', async () => {
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'x',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'U' });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'suspended', suspensionDays: 7 });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].suspensionEndDate).not.toBeNull();
  });

  it('falls back to reportedUserId when uniqueId null', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'target',
      reportedUserUniqueId: null,
      reporterId: 'rep1',
      reason: 'spam',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith('target', expect.any(Object));
  });

  it('uses body.reason and adminNote', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'original',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'warned', reason: 'custom', adminNote: 'note' });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ reason: 'custom', adminNote: 'note' }),
    );
  });
});

// =================================================================
// POST /api/reports/resolve-all/:userId (lines 505-532,541-607,647,656-660)
// =================================================================
describe('POST /api/reports/resolve-all/:userId - warn + suspend', () => {
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

  it('creates warning when action is warned', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned', reason: 'Spam' });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith(
      'ut',
      expect.objectContaining({ reason: 'Spam', severity: 2 }),
    );
  });

  it('creates warned_severe with severity 4', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned_severe' });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith('ut', expect.objectContaining({ severity: 4 }));
  });

  it('logs error when createWarning fails in bulk', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    const log = require('../../src/utils/log');
    createWarning.mockRejectedValueOnce(new Error('fail'));
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to create warning from bulk resolve',
      expect.any(Object),
    );
  });

  it('suspends user in bulk resolve', async () => {
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
      displayName: 'Bad User',
      profilePhotoUrl: 'p.jpg',
      coverPhotoUrl: 'c.jpg',
    });
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended', canAppeal: true, suspensionDays: 30 });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ isSuspended: true, displayName: 'Suspended Account' }),
    );
  });

  it('suspends permanently (0 days)', async () => {
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    getDoc.mockResolvedValueOnce({ id: 'ut', displayName: 'User' });
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].suspensionEndDate).toBeNull();
  });

  it('logs error when suspension fails in bulk', async () => {
    const log = require('../../src/utils/log');
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    getDoc.mockResolvedValueOnce({ id: 'ut', displayName: 'User' });
    mockDocUpdate.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to suspend user from bulk resolve',
      expect.any(Object),
    );
  });

  it('sends reporter PMs to unique reporters', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
      { id: 'r2', reportedUserId: 'target', reporterId: 'rep2', status: 'pending' },
      { id: 'r3', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const calls = sendSystemPm.mock.calls.filter((c) => c[1].includes('reviewed'));
    expect(calls).toHaveLength(2);
  });

  it('returns 500 on error', async () => {
    queryDocs.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(500);
  });

  it('sends warning PM in bulk', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const pm = sendSystemPm.mock.calls.find((c) => c[1].includes('warning'));
    expect(pm).toBeDefined();
  });

  it('sends suspension PM with appeal text in bulk', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    queryDocs.mockResolvedValueOnce([
      {
        id: 'r1',
        reportedUserId: 'target',
        reportedUserUniqueId: 'ut',
        reporterId: 'rep1',
        status: 'pending',
      },
    ]);
    getDoc.mockResolvedValueOnce({ id: 'ut', displayName: 'User' });
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended', canAppeal: true });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const pm = sendSystemPm.mock.calls.find((c) => c[1].includes('suspended'));
    expect(pm[1]).toContain('submit an appeal');
  });

  it('uses userId when reportedUserUniqueId missing', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(createWarning).toHaveBeenCalledWith('target', expect.any(Object));
  });
});

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
describe('POST /api/reports/:id/lock - error', () => {
  it('returns 500 when lock fails', async () => {
    const app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    require('../../src/utils/firestore-helpers').getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/reports/r1/lock');
    expect(res.status).toBe(500);
  });
});

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
describe('POST /api/admin/users/:uniqueId/suspend', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
  });

  it('returns 400 when reason missing', async () => {
    const res = await request(app).post('/api/admin/users/u1/suspend').send({ canAppeal: true });
    expect(res.status).toBe(400);
  });

  it('returns 400 when canAppeal not boolean', async () => {
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when endDate is invalid', async () => {
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when endDate in past', async () => {
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true });
    expect(res.status).toBe(404);
  });

  it('returns 200 permanent suspension', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      displayName: 'Bad',
      profilePhotoUrl: 'p.jpg',
      coverPhotoUrl: 'c.jpg',
    });
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Severe', canAppeal: false });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuspended: true,
        suspensionEndDate: null,
        displayName: 'Suspended Account',
      }),
    );
  });

  it('returns 200 with endDate', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const future = new Date(Date.now() + 86400000 * 30).toISOString();
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: future });
    expect(res.status).toBe(200);
    const call = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === true);
    expect(call[0].suspensionEndDate).not.toBeNull();
  });

  it('writes audit log', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUSPEND' }), {
      merge: true,
    });
  });

  it('returns 403 for non-admin', async () => {
    require('../../src/middleware/auth').requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true });
    expect(res.status).toBe(403);
  });

  it('returns 500 on error', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    mockDocUpdate.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Spam', canAppeal: true });
    expect(res.status).toBe(500);
  });
});

// =================================================================
// POST /api/admin/users/:uniqueId/unsuspend (lines 915-963)
// =================================================================
describe('POST /api/admin/users/:uniqueId/unsuspend', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
  });

  it('returns 404 when user not found', async () => {
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(404);
  });

  it('restores pre-suspension data', async () => {
    const { clearSuspensionCache } = require('../../src/middleware/auth');
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      isSuspended: true,
      preSuspensionDisplayName: 'Name',
      preSuspensionProfilePhotoUrl: 'p.jpg',
      preSuspensionCoverPhotoUrl: 'c.jpg',
    });
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuspended: false,
        displayName: 'Name',
        profilePhotoUrl: 'p.jpg',
        coverPhotoUrl: 'c.jpg',
      }),
    );
    expect(clearSuspensionCache).toHaveBeenCalled();
  });

  it('unsuspends without restoring when no pre-suspension data', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', isSuspended: true });
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(200);
    const arg = mockDocUpdate.mock.calls[0][0];
    expect(arg.isSuspended).toBe(false);
    expect(arg.displayName).toBeUndefined();
  });

  it('writes audit log', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', isSuspended: true });
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ action: 'UNSUSPEND' }), {
      merge: true,
    });
  });

  it('returns 403 for non-admin', async () => {
    require('../../src/middleware/auth').requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(403);
  });

  it('returns 500 on error', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', isSuspended: true });
    mockDocUpdate.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(500);
  });

  it('handles snake_case legacy fields', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      isSuspended: true,
      pre_suspension_display_name: 'Legacy',
      pre_suspension_profile_photo_url: 'lp.jpg',
      pre_suspension_cover_photo_url: 'lc.jpg',
    });
    const res = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Legacy',
        profilePhotoUrl: 'lp.jpg',
        coverPhotoUrl: 'lc.jpg',
      }),
    );
  });
});

// =================================================================
// POST /api/appeals - edge cases (line 977, 1018-1019)
// =================================================================
describe('POST /api/appeals - edge cases', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createUserApp({ uid: 'user-uid', uniqueId: 'sus-user' });
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
  });

  it('returns 400 when appealText too long', async () => {
    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'a'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when appealText not string', async () => {
    const res = await request(app).post('/api/appeals').send({ appealText: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/appeals').send({ appealText: 'Valid text' });
    expect(res.status).toBe(500);
  });
});

// =================================================================
// GET /api/appeals - status filter + error (lines 1032, 1068-1069)
// =================================================================
describe('GET /api/appeals - status filter and error', () => {
  let app, queryDocs, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs, getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('filters by status param', async () => {
    const { db } = require('../../src/utils/firebase');
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/appeals?status=approved');
    expect(res.status).toBe(200);
    const calls = db.collection.mock.results[0].value.where.mock.calls;
    expect(calls.some((c) => c[2] === 'approved')).toBe(true);
  });

  it('returns all when no status filter', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', userId: 'u1', appealText: 'text', status: 'pending', createdAt: 1700000000000 },
    ]);
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    queryDocs.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(500);
  });
});

// =================================================================
// PATCH /api/appeals/:id - edge cases (lines 1150-1154)
// =================================================================
describe('PATCH /api/appeals/:id - edge cases', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
  });

  it('returns 404 when not found', async () => {
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(500);
  });

  it('includes adminNote when provided', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
    const res = await request(app)
      .patch('/api/appeals/a1')
      .send({ status: 'denied', adminNote: 'reason' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'denied', adminNote: 'reason' }),
    );
  });

  it('restores data on approval', async () => {
    const { clearSuspensionCache } = require('../../src/middleware/auth');
    getDoc
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' })
      .mockResolvedValueOnce({
        id: 'u1',
        isSuspended: true,
        preSuspensionDisplayName: 'Name',
        preSuspensionProfilePhotoUrl: 'p.jpg',
        preSuspensionCoverPhotoUrl: 'c.jpg',
      });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ isSuspended: false, displayName: 'Name' }),
    );
    expect(clearSuspensionCache).toHaveBeenCalledWith('u1');
  });

  it('writes APPEAL_DENIED audit log', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'denied' });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPEAL_DENIED' }), {
      merge: true,
    });
  });

  it('writes APPEAL_APPROVED audit log', async () => {
    getDoc
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' })
      .mockResolvedValueOnce({ id: 'u1', isSuspended: true });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPEAL_APPROVED' }),
      { merge: true },
    );
  });
});

// GET /api/admin/audit-log — removed from reports.js; now served by
// admin-audit-log.js. See admin-audit-log-suggestions.test.js.

// =================================================================
// evictSuspendedUser (lines 1214-1277) - via suspend endpoint
// =================================================================
describe('evictSuspendedUser - via suspend', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockRtdbSet.mockResolvedValue();
    mockRtdbRemove.mockResolvedValue();
  });

  it('evicts participant from room', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      {
        id: 'room-1',
        ownerId: 'other',
        participantIds: ['u1', 'other'],
        seats: {
          0: { userId: 'u1', state: 'OCCUPIED', isMuted: false },
          1: { userId: 'other', state: 'OCCUPIED', isMuted: false },
        },
      },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockBatchSet).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('closes room when user is owner', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'u1', participantIds: ['u1', 'guest'], seats: {} },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const closed = mockBatchSet.mock.calls.find((c) => c[1]?.state === 'CLOSED');
    expect(closed).toBeDefined();
    expect(mockRtdbSet).toHaveBeenCalled();
    expect(mockRtdbRemove).toHaveBeenCalled();
  });

  it('skips eviction when not in any rooms', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('handles null seats', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'other', participantIds: ['u1', 'other'], seats: null },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('handles RTDB event write failure', async () => {
    const log = require('../../src/utils/log');
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'other', participantIds: ['u1'], seats: {} },
    ]);
    mockRtdbSet.mockRejectedValueOnce(new Error('RTDB fail'));
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(log.warn).toHaveBeenCalledWith(
      'reports',
      expect.stringContaining('Failed to write'),
      expect.any(Object),
    );
  });

  it('handles RTDB remove failure for owner rooms', async () => {
    const log = require('../../src/utils/log');
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'u1', participantIds: ['u1'], seats: {} },
    ]);
    mockRtdbRemove.mockRejectedValueOnce(new Error('RTDB fail'));
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(log.warn).toHaveBeenCalledWith(
      'reports',
      expect.stringContaining('Failed to remove'),
      expect.any(Object),
    );
  });

  it('clears seat with user_id (snake_case)', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      {
        id: 'room-1',
        ownerId: 'other',
        participantIds: ['u1', 'other'],
        seats: {
          0: { user_id: 'u1', state: 'OCCUPIED', isMuted: false },
          1: { userId: 'other', state: 'OCCUPIED', isMuted: false },
        },
      },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const call = mockBatchSet.mock.calls.find((c) => c[1]?.seats !== undefined);
    expect(call[1].seats['0']).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
  });

  it('handles multiple rooms', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'other', participantIds: ['u1', 'other'], seats: {} },
      { id: 'room-2', ownerId: 'u1', participantIds: ['u1'], seats: {} },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockBatchSet).toHaveBeenCalledTimes(3);
  });
});

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
    expect(createWarning).toHaveBeenCalledWith('u1', expect.objectContaining({ severity: 4 }));
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

describe('POST /api/admin/users/:uniqueId/suspend - snake_case user fields', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
  });

  it('uses snake_case pre-suspension fields', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      display_name: 'Snake',
      profile_photo_url: 'sp.jpg',
      cover_photo_url: 'sc.jpg',
    });
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        preSuspensionDisplayName: 'Snake',
        preSuspensionProfilePhotoUrl: 'sp.jpg',
        preSuspensionCoverPhotoUrl: 'sc.jpg',
      }),
    );
  });
});

describe('POST /api/appeals - snake_case user fields', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createUserApp({ uid: 'uid', uniqueId: 'sus' });
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
  });

  it('uses is_suspended and suspension_can_appeal snake_case fields', async () => {
    getDoc.mockResolvedValueOnce({ id: 'sus', is_suspended: true, suspension_can_appeal: true });
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).post('/api/appeals').send({ appealText: 'Please reconsider' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/appeals - snake_case enrichment', () => {
  let app, queryDocs, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs, getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('uses user_id from appeal and snake_case user fields', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', user_id: 'u1', appealText: 'text', status: 'pending', createdAt: 1700000000000 },
    ]);
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      unique_id: 42,
      display_name: 'Snake',
      profile_photo_url: 'sp.jpg',
      suspension_reason: 'spam',
      suspension_start_date: 1699e9,
      suspension_end_date: null,
    });
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body[0].userUniqueId).toBe(42);
    expect(res.body[0].userDisplayName).toBe('Snake');
    expect(res.body[0].userInfo.suspensionReason).toBe('spam');
  });

  it('sorts appeals by createdAt descending', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', userId: 'u1', appealText: 't1', status: 'pending', createdAt: 1699e9 },
      { id: 'a2', userId: 'u2', appealText: 't2', status: 'pending', createdAt: 1700e9 },
    ]);
    getDoc.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('a2');
    expect(res.body[1].id).toBe('a1');
  });
});

describe('PATCH /api/appeals/:id - requireAdmin blocks + user_id fallback', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
  });

  it('returns 403 when admin check fails', async () => {
    require('../../src/middleware/auth').requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  it('uses user_id when userId absent', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', user_id: 'u1', status: 'pending' });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'denied' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ suspensionAppealStatus: 'denied' }),
    );
  });

  it('approved appeal with null user doc still succeeds', async () => {
    getDoc
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' })
      .mockResolvedValueOnce(null); // user not found
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
  });

  it('approved appeal with user doc but no pre-suspension data', async () => {
    getDoc
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' })
      .mockResolvedValueOnce({ id: 'u1', isSuspended: true });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    const unsuspendCall = mockDocUpdate.mock.calls.find((c) => c[0]?.isSuspended === false);
    expect(unsuspendCall).toBeDefined();
    expect(unsuspendCall[0].displayName).toBeUndefined();
  });

  it('uses snake_case pre-suspension fields on approval', async () => {
    getDoc
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' })
      .mockResolvedValueOnce({
        id: 'u1',
        isSuspended: true,
        pre_suspension_display_name: 'LegacyName',
        pre_suspension_profile_photo_url: 'lp.jpg',
        pre_suspension_cover_photo_url: 'lc.jpg',
      });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'LegacyName',
        profilePhotoUrl: 'lp.jpg',
        coverPhotoUrl: 'lc.jpg',
      }),
    );
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

describe('evictSuspendedUser - seat with userId match via user_id', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockRtdbSet.mockResolvedValue();
    mockRtdbRemove.mockResolvedValue();
  });

  it('handles room with no participantIds field', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([
      { id: 'room-1', ownerId: 'other', participantIds: null, seats: {} },
    ]);
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});
