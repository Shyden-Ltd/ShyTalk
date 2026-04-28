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
  // Default to identity so test fixtures can use any string as reportedUserId
  // and have it resolve to the same value (matches the IDOR-fix re-resolve
  // behaviour that defeats client-injected reportedUserUniqueId).
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
    // Server re-resolves from reportedUserId='t' (identity mock), ignoring the
    // stored reportedUserUniqueId='u1' to defeat client-injected IDOR.
    expect(createWarning).toHaveBeenCalledWith('t', expect.objectContaining({ severity: 4 }));
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
      // Deliberately set the stored uniqueId to a DIFFERENT value than the auth-uid
      // resolution returns. The route re-resolves from reportedUserId at resolve
      // time, so the stored 'u1' must be ignored and the server-resolved value used.
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'original',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'warned', reason: 'custom', adminNote: 'note' });
    expect(res.status).toBe(200);
    // Server re-resolves 't' to 't' via the identity mock, NOT the client-injected 'u1'.
    expect(createWarning).toHaveBeenCalledWith(
      't',
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
    // Server re-resolves from req.params.userId='target' (identity mock).
    // Stored reports[0].reportedUserUniqueId='ut' is ignored to defeat IDOR.
    expect(createWarning).toHaveBeenCalledWith(
      'target',
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
    // Server re-resolves from req.params.userId='target'; stored 'ut' is ignored.
    expect(createWarning).toHaveBeenCalledWith('target', expect.objectContaining({ severity: 4 }));
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

// =================================================================
// Pass-6 backfill: regression tests for round 1-5 fixes
// =================================================================

// Helper: locate the most recent set call against `adminAuditLog/`
function findLastAuditWrite(mockSetFn) {
  for (let i = mockSetFn.mock.calls.length - 1; i >= 0; i--) {
    const call = mockSetFn.mock.calls[i];
    if (call[0] && typeof call[0] === 'object' && call[0].action) return call[0];
  }
  return null;
}

describe('Pass-6 backfill: F2-RES caps on POST /reports', () => {
  let app;
  beforeEach(() => {
    app = createUserApp();
    jest.clearAllMocks();
  });

  it('rejects reportedUserName exceeding 50 chars (FCM payload protection)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: 'target',
        reason: 'spam',
        reportedUserName: 'x'.repeat(51),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportedUserName exceeds 50 chars/);
  });

  it('accepts reportedUserName at the 50-char boundary', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: 'target',
        reason: 'spam',
        reportedUserName: 'x'.repeat(50),
      });
    expect(res.status).toBe(200);
  });

  it('rejects non-string reportedUserName', async () => {
    const res = await request(app).post('/api/reports').send({
      reportedUserId: 'target',
      reason: 'spam',
      reportedUserName: 123,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportedUserName exceeds 50 chars/);
  });

  it('rejects evidenceUrls when not an array (orphan-cleanup cron protection)', async () => {
    const res = await request(app).post('/api/reports').send({
      reportedUserId: 'target',
      reason: 'spam',
      evidenceUrls: 'https://e.com/proof.jpg',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/evidenceUrls must be an array/);
  });

  it('rejects evidenceUrls with more than 10 entries', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: 'target',
        reason: 'spam',
        evidenceUrls: Array.from({ length: 11 }, (_, i) => `https://e.com/${i}.jpg`),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/evidenceUrls exceeds 10 entries/);
  });

  it('rejects evidenceUrls entries longer than 500 chars', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: 'target',
        reason: 'spam',
        evidenceUrls: ['https://e.com/' + 'x'.repeat(490)],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/evidenceUrls entry exceeds 500 chars/);
  });

  it('rejects non-string evidenceUrls entries', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: 'target',
        reason: 'spam',
        evidenceUrls: [42],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/evidenceUrls entry exceeds 500 chars/);
  });
});

describe('Pass-6 backfill: CRIT-3 404 when target user no longer exists', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('returns 404 on /reports/:id/resolve warned action when resolveUniqueId returns null', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValueOnce(null);
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'deleted-uid',
      reporterId: 'rep1',
      reason: 'spam',
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer exists/i);
    // Critical: must NOT have updated the report status before the 404
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 on /reports/:id/resolve suspended action when resolveUniqueId returns null', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValueOnce(null);
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'deleted-uid',
      reporterId: 'rep1',
      reason: 'spam',
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer exists/i);
  });
});

describe('Pass-6 backfill: S3 admin caps on resolve handlers', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('POST /reports/:id/resolve rejects body.reason longer than 500 chars', async () => {
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({
        action: 'warned',
        reason: 'x'.repeat(501),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason exceeds 500 chars/);
  });

  it('POST /reports/:id/resolve rejects body.adminNote longer than 2000 chars', async () => {
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({
        action: 'warned',
        adminNote: 'x'.repeat(2001),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adminNote exceeds 2000 chars/);
  });

  it('POST /reports/resolve-all/:userId rejects body.reason longer than 500 chars', async () => {
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({
        action: 'warned',
        reason: 'x'.repeat(501),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason exceeds 500 chars/);
  });

  it('POST /reports/resolve-all/:userId rejects body.adminNote longer than 2000 chars', async () => {
    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({
        action: 'warned',
        adminNote: 'x'.repeat(2001),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adminNote exceeds 2000 chars/);
  });
});

describe('Pass-6 backfill: audit log targetUserId canonical uniqueId', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('RESOLVE_REPORT logs the server-resolved canonical uniqueId, not the Firebase Auth UID', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    // Firebase UID -> canonical uniqueId resolution
    resolveUniqueId.mockResolvedValue('CANONICAL-12345');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'firebase-auth-uid-xxx',
      reportedUserUniqueId: 'STORED-IGNORE-ME',
      reporterId: 'rep1',
      reason: 'spam',
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    const auditEntry = findLastAuditWrite(mockDocSet);
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.action).toBe('RESOLVE_REPORT');
    expect(auditEntry.targetUserId).toBe('CANONICAL-12345');
  });

  it('RESOLVE_REPORT falls back to raw reportedUserId when resolveUniqueId throws (does not 500 the request)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockRejectedValue(new Error('Firestore unavailable'));
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'firebase-auth-uid-xxx',
      reporterId: 'rep1',
      reason: 'spam',
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });

    // Critical: report-status update has already committed at this point.
    // A throw from audit-log resolution must NOT 500 the request.
    expect(res.status).toBe(200);
    const auditEntry = findLastAuditWrite(mockDocSet);
    expect(auditEntry.targetUserId).toBe('firebase-auth-uid-xxx');
  });

  it('RESOLVE_ALL_REPORTS logs canonical uniqueId for forensic queryability', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue('CANONICAL-99');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'firebase-uid-77', reporterId: 'rep1', status: 'pending' },
    ]);

    const res = await request(app)
      .post('/api/reports/resolve-all/firebase-uid-77')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    const auditEntry = findLastAuditWrite(mockDocSet);
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.action).toBe('RESOLVE_ALL_REPORTS');
    expect(auditEntry.targetUserId).toBe('CANONICAL-99');
  });

  it('RESOLVE_ALL_REPORTS skips the resolveUniqueId call entirely on empty-reports early-return (Firestore quota)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    queryDocs.mockResolvedValueOnce([]); // No pending reports

    const res = await request(app)
      .post('/api/reports/resolve-all/firebase-uid-77')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(0);
    // Per CLAUDE.md "Firestore quota awareness" — don't burn an op on a no-op call.
    expect(resolveUniqueId).not.toHaveBeenCalled();
  });
});

// =================================================================
// Pass-7 backfill: bulk-resolve 404 + audit throw fallback
// =================================================================

describe('Pass-7 backfill: bulk-resolve 404 when target user no longer exists', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('returns 404 on /reports/resolve-all/:userId warned action when resolveUniqueId returns null', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue(null);
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'deleted-uid', reporterId: 'rep1', status: 'pending' },
    ]);

    const res = await request(app)
      .post('/api/reports/resolve-all/deleted-uid')
      .send({ action: 'warned' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer exists/i);
  });

  it('returns 404 on /reports/resolve-all/:userId suspended action when resolveUniqueId returns null', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue(null);
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'deleted-uid', reporterId: 'rep1', status: 'pending' },
    ]);

    const res = await request(app)
      .post('/api/reports/resolve-all/deleted-uid')
      .send({ action: 'suspended' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer exists/i);
  });
});

describe('Pass-7 backfill: bulk-resolve audit-log fire-and-forget on throw', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('returns 200 even when audit-log resolveUniqueId throws (state already committed)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockRejectedValueOnce(new Error('Firestore unavailable'));
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'firebase-uid-77', reporterId: 'rep1', status: 'pending' },
    ]);

    const res = await request(app)
      .post('/api/reports/resolve-all/firebase-uid-77')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const auditEntry = findLastAuditWrite(mockDocSet);
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.action).toBe('RESOLVE_ALL_REPORTS');
    expect(auditEntry.targetUserId).toBe('firebase-uid-77');
  });
});
