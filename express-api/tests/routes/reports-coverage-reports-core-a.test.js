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
  // Server-resolves the report target's uniqueId from the Firebase Auth UID so a
  // malicious reporter can't supply an arbitrary victim. Default fixture returns
  // `${uid}-uniq` which is the convention used by the test data builders here.
  resolveUniqueId: jest.fn(async (uid) => (uid ? `${uid}-uniq` : null)),
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

  // ─── F1: IDOR fix — server-resolves reportedUserUniqueId ──────
  // Previously `reportedUserUniqueId` was accepted from the request body. A
  // malicious reporter could submit a different victim's uniqueId and admin
  // resolution would suspend them. Cascade is now synchronous so the eviction
  // happens immediately on suspend — guarding the value at submission time
  // is the only safe place.

  it('rejects POST /reports when reportedUserId does not resolve to a known user', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    resolveUniqueId.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'unknown-uid', reason: 'spam' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match any known user/i);
  });

  it('ignores client-supplied reportedUserUniqueId and uses server-resolved value', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    resolveUniqueId.mockResolvedValueOnce('SERVER_VALUE');
    const res = await request(app).post('/api/reports').send({
      reportedUserId: 'target',
      reportedUserUniqueId: 'CLIENT_INJECTED_VICTIM',
      reason: 'spam',
    });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ reportedUserUniqueId: 'SERVER_VALUE' }),
      { merge: true },
    );
  });

  // ─── F2: length caps on reporter-supplied text ─────────────────

  it('rejects reason longer than 500 chars at the report-submission boundary', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason exceeds 500 chars/);
  });

  it('rejects description longer than 2000 chars', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam', description: 'd'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description exceeds 2000 chars/);
  });

  it('rejects messageText longer than 1000 chars', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'spam', messageText: 'm'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messageText exceeds 1000 chars/);
  });

  it('accepts reason at the 500-char boundary (off-by-one direction guard)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'target', reason: 'x'.repeat(500) });
    expect(res.status).toBe(200);
  });
});

// =================================================================
// GET /api/reports - search + enrichment (lines 172,190,205,213-222,237)
// =================================================================

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

// =================================================================
// GET /api/reports/export - date filters (lines 743,786-787)
// =================================================================

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

// GET /api/admin/audit-log - admin name enrichment — removed from reports.js;
// now served by admin-audit-log.js. See admin-audit-log-suggestions.test.js.
