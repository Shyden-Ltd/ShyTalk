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

  it('surfaces warning.failed in response when createWarning throws (single-resolve)', async () => {
    // Pass-9 partial-failure contract: a warn that failed silently used to return
    // {success:true} and only log.error — the admin UI showed "Resolved" while no
    // warning ever landed. The route now surfaces a `warning: { failed: true,
    // error: 'warning_create_failed' }` block so the admin can retry.
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
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        warning: { failed: true, error: 'warning_create_failed' },
      }),
    );
    expect(res.body.suspension).toBeUndefined();
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

  it('surfaces suspension.failed in response when user-doc update throws (single-resolve)', async () => {
    // Pass-9 partial-failure contract: a suspension that failed silently used to
    // return {success:true} and only log.error — admin UI claimed the user was
    // banned while their account stayed unrestricted. Route now surfaces
    // `suspension: { failed: true, error: 'suspension_update_failed' }`.
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
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        suspension: { failed: true, error: 'suspension_update_failed' },
      }),
    );
    expect(res.body.warning).toBeUndefined();
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

  it('surfaces warning.failed in response when createWarning throws (bulk-resolve)', async () => {
    // Pass-9 partial-failure contract: bulk-resolve must propagate the same
    // failure flag as single-resolve so the admin sees the warning didn't land
    // even when reports.length>0.
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
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        resolved: 1,
        warning: { failed: true, error: 'warning_create_failed' },
      }),
    );
    expect(res.body.suspension).toBeUndefined();
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

  it('surfaces suspension.failed in response when user-doc update throws (bulk-resolve)', async () => {
    // Pass-9 partial-failure contract: bulk-resolve suspension must surface the
    // same flag as single-resolve. Without this, an admin clicking "Resolve all
    // and suspend" sees success while the target's account is still active.
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
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        resolved: 1,
        suspension: { failed: true, error: 'suspension_update_failed' },
      }),
    );
    expect(res.body.warning).toBeUndefined();
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

describe('Pass-7/8 backfill: bulk-resolve audit-log resilience', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('survives a resolveUniqueId throw and falls back to raw req.params.userId in the audit row', async () => {
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
    // Lock release IS critical-path even on resolveUniqueId throw.
    // Path-tight: assert the *correct* document was deleted (the per-target
    // throttle lock), not just that *some* delete fired. A path-blind
    // assertion would pass even if the route accidentally deleted the report
    // row or the audit log instead.
    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('reportLocks/firebase-uid-77');
    expect(mockDocDelete).toHaveBeenCalled();
  });

  it('returns 200 when the audit-log .set() itself rejects (Pass-7 fire-and-forget contract)', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    const log = require('../../src/utils/log');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue('CANONICAL-77');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'firebase-uid-77', reporterId: 'rep1', status: 'pending' },
    ]);
    // Reject the audit .set() write itself. Other .set() calls in the test
    // (none on this dismissed path beyond audit) will use the default resolved value.
    mockDocSet.mockReset();
    mockDocSet.mockRejectedValueOnce(new Error('Firestore quota exceeded'));
    mockDocSet.mockResolvedValue();

    const res = await request(app)
      .post('/api/reports/resolve-all/firebase-uid-77')
      .send({ action: 'dismissed' });

    // Critical: audit-log throw must not 500 the request after state has committed.
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to write RESOLVE_ALL_REPORTS audit log',
      expect.any(Object),
    );
    // Lock release IS critical-path even when audit fails.
    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('reportLocks/firebase-uid-77');
    expect(mockDocDelete).toHaveBeenCalled();
  });
});

describe('Pass-8 backfill: single-resolve audit-log .set() fire-and-forget', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('returns 200 when the RESOLVE_REPORT audit .set() itself rejects', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    const log = require('../../src/utils/log');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue('CANONICAL-12345');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'firebase-auth-uid',
      reporterId: 'rep1',
      reason: 'spam',
    });
    // Reject only the audit .set() write — must not 500 the request.
    mockDocSet.mockReset();
    mockDocSet.mockRejectedValueOnce(new Error('Firestore quota exceeded'));
    mockDocSet.mockResolvedValue();

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(log.error).toHaveBeenCalledWith(
      'reports',
      'Failed to write RESOLVE_REPORT audit log',
      expect.any(Object),
    );
    // Lock release IS critical-path even when audit fails. Path-tight to
    // catch a regression where the route deletes a different document.
    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('reportLocks/r1');
    expect(mockDocDelete).toHaveBeenCalled();
  });

  it('still updates the report status before the audit .set() throw', async () => {
    const { resolveUniqueId } = require('../../src/middleware/auth');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    resolveUniqueId.mockReset();
    resolveUniqueId.mockResolvedValue('CANONICAL-12345');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 'firebase-auth-uid',
      reporterId: 'rep1',
      reason: 'spam',
    });
    mockDocSet.mockReset();
    mockDocSet.mockRejectedValueOnce(new Error('Firestore quota'));
    mockDocSet.mockResolvedValue();

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    // Report status update is the awaited write at the top of the handler;
    // it must have committed BEFORE the fire-and-forget audit .set() rejected.
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved', actionTaken: 'dismissed' }),
    );
  });
});

// =================================================================
// Pass-9 backfill: positive assertions on the partial-failure response shape.
//
// The four "logs error when ... fails" tests above prove that *when* a
// downstream action throws, the route surfaces a `warning.failed` /
// `suspension.failed` block. They do NOT prove the converse: that the success
// path is *clean* of these flags. Without the negative case, a regression that
// always emits `warning: { failed: true }` would still pass — log.error wasn't
// asserted on the success path either.
//
// These tests lock both directions:
//   1. happy path: response is `{success:true}` (plus cascade), no warning/suspension keys
//   2. dual-failure: warn-throw AND suspend-throw on the same handler must produce
//      both flags. (Single-action paths can only fail one at a time, so dual is only
//      meaningful where one handler invokes both — bulk-resolve with action that
//      cascades. We test the simpler scope here: action='warned' fails warning;
//      action='suspended' fails suspension; the response shape never co-mingles.)
// =================================================================
describe('Pass-9: positive partial-failure response shape', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('single-resolve happy path: warned action returns no warning/suspension flags when createWarning succeeds', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Critical: success path MUST NOT pollute the response with stale flags.
    expect(res.body.warning).toBeUndefined();
    expect(res.body.suspension).toBeUndefined();
  });

  it('single-resolve happy path: suspended action returns no warning/suspension flags when user-doc updates succeed', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warning).toBeUndefined();
    expect(res.body.suspension).toBeUndefined();
  });

  it('bulk-resolve happy path: dismissed action returns success+resolved with no failure flags', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
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
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, resolved: 1 }));
    expect(res.body.warning).toBeUndefined();
    expect(res.body.suspension).toBeUndefined();
  });

  it('single-resolve: warning.failed flag is structurally exact (no extra keys leak in)', async () => {
    // Lock the contract: the failure block must be EXACTLY { failed, error }.
    // A regression that adds `error.stack` or the raw Error object would leak
    // server internals to the admin client — which has happened before in
    // similar Express handlers across the repo.
    const { createWarning } = require('../../src/routes/admin-users');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    createWarning.mockRejectedValueOnce(new Error('boom: secret stack trace'));
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(res.body.warning).toEqual({ failed: true, error: 'warning_create_failed' });
    // Defense-in-depth: nothing from the thrown Error should leak.
    expect(JSON.stringify(res.body)).not.toContain('secret stack trace');
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  it('single-resolve: suspension.failed flag is structurally exact (no extra keys leak in)', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    mockDocUpdate
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('boom: secret stack trace'));
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.suspension).toEqual({ failed: true, error: 'suspension_update_failed' });
    expect(JSON.stringify(res.body)).not.toContain('secret stack trace');
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });
});

// =================================================================
// Pass-10 backfill: cascade-failure response shape, audit-log flag,
// reports-commit failure, and exact-keys structural assertions.
//
// Scope: the *glue code* in reports.js that converts an `evictSuspendedUser`
// throw into the on-wire `cascade: { partial: true, ... }` shape was
// previously uncovered. The util itself is tested in evict-suspended-user.test.js,
// but reports.js's catch block is its own contract — a regression that omits
// `userDocFailed` or swallows the throw would not be caught by util tests.
// =================================================================
describe('Pass-10: cascade + audit + commit failure response shape', () => {
  let app;
  // Pass-10 tests use mockOnce queues whose leftover values would poison
  // subsequent tests if not reset. Per feedback-test-mock-isolation.md the
  // canonical pattern is `mockReset()` + restore defaults — `clearAllMocks()`
  // only wipes call history, not queued .Once values.
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    mockDocSet.mockReset();
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockReset();
    mockDocUpdate.mockResolvedValue();
    mockBatchCommit.mockReset();
    mockBatchCommit.mockResolvedValue();
    const fh = require('../../src/utils/firestore-helpers');
    fh.queryDocs.mockReset();
    fh.queryDocs.mockResolvedValue([]);
    fh.getDoc.mockReset();
    fh.getDoc.mockImplementation(async (path) => {
      const { db } = require('../../src/utils/firebase');
      const snap = await db.doc(path).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    });
    require('../../src/utils/system-pm').sendSystemPm.mockReset();
    require('../../src/utils/system-pm').sendSystemPm.mockResolvedValue();
    require('../../src/routes/admin-users').createWarning.mockReset();
    require('../../src/routes/admin-users').createWarning.mockResolvedValue();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    require('../../src/middleware/auth').resolveUniqueId.mockReset();
    require('../../src/middleware/auth').resolveUniqueId.mockImplementation(
      async (uid) => uid || null,
    );
  });

  it('single-resolve: cascade response shape is exact when evictSuspendedUser throws (non-phase error)', async () => {
    // queryDocs is the first sync call inside evictSuspendedUser (Promise.all).
    // Reject it so evict throws; the route's catch builds the cascade contract.
    const { getDoc, queryDocs } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockRejectedValueOnce(new Error('Firestore timeout: project=secret'));

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.cascade).toEqual({
      roomsClosed: 0,
      roomsUpdated: 0,
      partial: true,
      failedRoomIds: [],
      userDocFailed: false,
      rtdbEventsFailed: 0,
      error: 'cascade_failed',
    });
    // Defense: the Firestore error message must NOT leak.
    expect(JSON.stringify(res.body)).not.toContain('Firestore timeout');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('single-resolve: cascade.userDocFailed=true when evict throws with phase=user_doc tag', async () => {
    const { getDoc, queryDocs } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    // Audit-log .set() (1st call) succeeds; evict's user-doc set+merge (2nd call)
    // rejects with phase tag. evict-suspended-user.js's catch tags then re-throws.
    const phaseErr = Object.assign(new Error('user doc gone'), { phase: 'user_doc' });
    mockDocSet.mockResolvedValueOnce();
    mockDocSet.mockRejectedValueOnce(phaseErr);

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.cascade).toEqual({
      roomsClosed: 0,
      roomsUpdated: 0,
      partial: true,
      failedRoomIds: [],
      userDocFailed: true,
      rtdbEventsFailed: 0,
      error: 'cascade_failed',
    });
  });

  it('single-resolve: auditLog.failed surfaces when audit .set() rejects', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    // First .set() in the dismissed-action flow IS the audit log — reject it.
    mockDocSet.mockRejectedValueOnce(new Error('Firestore quota'));

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.auditLog).toEqual({ failed: true, error: 'audit_write_failed' });
    expect(res.body.success).toBe(true);
  });

  it('bulk-resolve: reports.failed surfaces when chunk-commit throws after suspend committed', async () => {
    // Pass-10 C1: previously a chunk-commit throw bubbled to the outer catch
    // and 500'd the response — admin retried, double-suspending the user.
    // Now the throw is swallowed and surfaced via response.reports.
    const { queryDocs, getDoc } = require('../../src/utils/firestore-helpers');
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
    mockBatchCommit.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resolved).toBe(0);
    expect(res.body.reports).toEqual({
      committed: 0,
      failed: 1,
      total: 1,
      error: 'reports_commit_failed',
    });
    expect(res.body.suspension).toBeUndefined();
  });

  it('bulk-resolve: pms.failed counter records reporter PM throws', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    const { sendSystemPm } = require('../../src/utils/system-pm');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
      { id: 'r2', reportedUserId: 'target', reporterId: 'rep2', status: 'pending' },
    ]);
    sendSystemPm.mockResolvedValueOnce();
    sendSystemPm.mockRejectedValueOnce(new Error('FCM throttled'));

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toEqual({ failed: 1, total: 2 });
  });

  it('bulk-resolve: resolved=0 happy-path emits no failure flags', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/reports/resolve-all/no-such-user')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, resolved: 0 });
    expect(res.body.warning).toBeUndefined();
    expect(res.body.suspension).toBeUndefined();
    expect(res.body.cascade).toBeUndefined();
    expect(res.body.auditLog).toBeUndefined();
    expect(res.body.reports).toBeUndefined();
    expect(res.body.pms).toBeUndefined();
  });

  it('single-resolve: warned_severe happy-path emits no failure flags (parity with warned)', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'severe',
    });
    const res = await request(app)
      .post('/api/reports/r1/resolve')
      .send({ action: 'warned_severe' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warning).toBeUndefined();
    expect(res.body.suspension).toBeUndefined();
    expect(res.body.cascade).toBeUndefined();
    expect(res.body.auditLog).toBeUndefined();
  });

  it('warning.failed object has EXACTLY two keys (no leak via key-count regression)', async () => {
    // Tighter than JSON.stringify: a future addition of `error.detail` or
    // `originalError` carrying a safe-looking string would still fail this.
    const { createWarning } = require('../../src/routes/admin-users');
    const { getDoc } = require('../../src/utils/firestore-helpers');
    createWarning.mockRejectedValueOnce(new Error('boom'));
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.body.warning).toBeDefined();
    expect(Object.keys(res.body.warning).sort()).toEqual(['error', 'failed']);
  });

  it('suspension.failed object has EXACTLY two keys', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    mockDocUpdate.mockResolvedValueOnce().mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.body.suspension).toBeDefined();
    expect(Object.keys(res.body.suspension).sort()).toEqual(['error', 'failed']);
  });

  it('bulk-resolve: auditLog.failed surfaces when RESOLVE_ALL_REPORTS audit .set rejects', async () => {
    // Pass-11 test-analyzer Gap 1: bulk-resolve auditLog.failed had no positive
    // assertion. Pass-7/8 only asserted res.status===200 and that log.error
    // fired — a regression that swallowed bulkAuditFailed=true would pass.
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    // Order of .set() calls in dismissed bulk: [RESOLVE_ALL_REPORTS audit].
    mockDocSet.mockRejectedValueOnce(new Error('Firestore quota'));

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.auditLog).toEqual({ failed: true, error: 'audit_write_failed' });
  });

  it('bulk-resolve: auditLog.failed surfaces when SUSPEND audit .set rejects (suspendAuditFailed)', async () => {
    // Pass-11 test-analyzer Gap 1b: suspendAuditFailed had zero coverage.
    // Order of .set() calls in suspended bulk:
    //   1. user-doc set+merge inside evict (rooms.length===0 branch)
    //   2. SUSPEND audit log
    //   3. RESOLVE_ALL_REPORTS audit log
    // Reject call #2 to flip suspendAuditFailed.
    const { queryDocs, getDoc } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    queryDocs.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    getDoc.mockResolvedValueOnce({ id: 'target', displayName: 'User' });
    mockDocSet.mockResolvedValueOnce(); // evict user-doc set succeeds
    mockDocSet.mockRejectedValueOnce(new Error('SUSPEND audit quota')); // SUSPEND audit fails

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.auditLog).toEqual({ failed: true, error: 'audit_write_failed' });
  });

  it('bulk-resolve: cascade response shape matches single-resolve when evict throws (parity)', async () => {
    // Pass-11 test-analyzer Gap 2: bulk cascade catch is duplicated from
    // single-resolve at reports.js:826. A divergent typo would not be caught
    // by the single-resolve cascade test alone — assert the bulk shape too.
    const { queryDocs, getDoc } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    getDoc.mockResolvedValueOnce({ id: 'target', displayName: 'User' });
    queryDocs.mockRejectedValueOnce(new Error('Firestore timeout: project=secret'));

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.cascade).toEqual({
      roomsClosed: 0,
      roomsUpdated: 0,
      partial: true,
      failedRoomIds: [],
      userDocFailed: false,
      rtdbEventsFailed: 0,
      error: 'cascade_failed',
    });
    expect(JSON.stringify(res.body)).not.toContain('Firestore timeout');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('bulk-resolve: pms.failed counts target-user PMs alongside reporter PMs (Pass-11 HIGH-1)', async () => {
    // Pass-11 silent-failure HIGH-1: bulk-resolve previously only counted
    // reporter PM failures; warning/suspension PMs to the moderation target
    // were silently dropped. Now both feed into the same `pms.failed` counter.
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    const { sendSystemPm } = require('../../src/utils/system-pm');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    // Order of sendSystemPm calls in bulk warned: [warning PM to target, reporter PM to rep1]
    sendSystemPm.mockRejectedValueOnce(new Error('warn-pm fcm fail')); // warning PM fails
    sendSystemPm.mockResolvedValueOnce(); // reporter PM succeeds

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toEqual({ failed: 1, total: 2 });
  });

  it('MOD_ERROR token values are stable (snapshot)', async () => {
    // Pass-11 test-analyzer Gap 4: lock the wire-format tokens so a rename
    // can't silently drift the contract between server and admin client.
    const { MOD_ERROR } = require('../../src/routes/reports');
    expect(MOD_ERROR).toEqual({
      WARNING_CREATE_FAILED: 'warning_create_failed',
      SUSPENSION_UPDATE_FAILED: 'suspension_update_failed',
      CASCADE_FAILED: 'cascade_failed',
      AUDIT_WRITE_FAILED: 'audit_write_failed',
      REPORTS_COMMIT_FAILED: 'reports_commit_failed',
    });
    // Object.freeze: a runtime rename should throw in strict mode.
    expect(Object.isFrozen(MOD_ERROR)).toBe(true);
  });

  it('safeFireAndForget absorbs synchronous throws from a bad .set thunk (Pass-11 HIGH-2)', async () => {
    // Pass-11 silent-failure HIGH-2: db.doc(...).set(...) could throw
    // synchronously (bad path, mocking quirks) before returning a promise,
    // bypassing .catch and bubbling to the route's outer try → 500. Force
    // mockDocSet to throw synchronously and assert the route still returns 200.
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    mockDocSet.mockImplementationOnce(() => {
      throw new Error('synchronous throw from set');
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.auditLog).toEqual({ failed: true, error: 'audit_write_failed' });
    expect(res.body.success).toBe(true);
  });
});

// =================================================================
// Pass-12 backfill: single-resolve pms tests + lockRelease guard.
// Pass-12 test analyzer Gap [8/10]: single-resolve pms.failed has zero
// coverage despite Pass-11 adding the bulk equivalent. Mirror the bulk
// tests for parity and lock the per-action arithmetic.
// =================================================================
describe('Pass-12: single-resolve pms.failed + lockRelease', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    mockDocSet.mockReset();
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockReset();
    mockDocUpdate.mockResolvedValue();
    mockDocDelete.mockReset();
    mockDocDelete.mockResolvedValue();
    const fh = require('../../src/utils/firestore-helpers');
    fh.queryDocs.mockReset();
    fh.queryDocs.mockResolvedValue([]);
    fh.getDoc.mockReset();
    fh.getDoc.mockImplementation(async (path) => {
      const { db } = require('../../src/utils/firebase');
      const snap = await db.doc(path).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    });
    require('../../src/utils/system-pm').sendSystemPm.mockReset();
    require('../../src/utils/system-pm').sendSystemPm.mockResolvedValue();
    require('../../src/routes/admin-users').createWarning.mockReset();
    require('../../src/routes/admin-users').createWarning.mockResolvedValue();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    require('../../src/middleware/auth').resolveUniqueId.mockReset();
    require('../../src/middleware/auth').resolveUniqueId.mockImplementation(
      async (uid) => uid || null,
    );
  });

  it('warned: warn-PM rejects → pms { failed: 1, total: 2 } (warn + reporter)', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    // Order of sendSystemPm in warned: [warn PM to target, reporter PM]
    sendSystemPm.mockRejectedValueOnce(new Error('warn-pm fcm fail'));
    sendSystemPm.mockResolvedValueOnce();

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'warned' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toEqual({ failed: 1, total: 2 });
  });

  it('suspended: suspend-PM rejects → pms { failed: 1, total: 2 } (suspend + reporter)', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc
      .mockResolvedValueOnce({
        id: 'r1',
        reportedUserId: 't',
        reportedUserUniqueId: 'u1',
        reporterId: 'rep1',
        reason: 'severe',
      })
      .mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    sendSystemPm.mockRejectedValueOnce(new Error('suspend-pm fcm fail'));
    sendSystemPm.mockResolvedValueOnce();

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toEqual({ failed: 1, total: 2 });
  });

  it('dismissed: only reporter-PM fires → pms { failed: 1, total: 1 } when it rejects', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    const { sendSystemPm } = require('../../src/utils/system-pm');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    sendSystemPm.mockRejectedValueOnce(new Error('reporter-pm fcm fail'));

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toEqual({ failed: 1, total: 1 });
  });

  it('happy path: pms key is OMITTED when all PMs succeed', async () => {
    // Pass-12 test analyzer Gap [7/10]: mirror the bulk
    // expect(res.body.pms).toBeUndefined() at line ~1633.
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.pms).toBeUndefined();
  });

  it('lockRelease.failed surfaces when lock-delete rejects (single-resolve)', async () => {
    // Pass-12 silent-failure MED-2: previously the bare await on
    // db.doc(reportLocks/...).delete() would 500 a fully-applied moderation.
    // Now wrapped in safeFireAndForget + flag.
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    mockDocDelete.mockRejectedValueOnce(new Error('Firestore lock-delete throttled'));

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.lockRelease).toEqual({ failed: true });
    expect(res.body.success).toBe(true);
  });

  it('lockRelease.failed surfaces when lock-delete rejects (bulk-resolve)', async () => {
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    queryDocs.mockResolvedValueOnce([
      { id: 'r1', reportedUserId: 'target', reporterId: 'rep1', status: 'pending' },
    ]);
    mockDocDelete.mockRejectedValueOnce(new Error('Firestore lock-delete throttled'));

    const res = await request(app)
      .post('/api/reports/resolve-all/target')
      .send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.lockRelease).toEqual({ failed: true });
    expect(res.body.success).toBe(true);
  });

  it('happy path: lockRelease key is OMITTED when delete succeeds', async () => {
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.lockRelease).toBeUndefined();
  });

  it('safeFireAndForget absorbs sync throws from the lock-delete thunk (Pass-13 nice-to-have)', async () => {
    // Pass-13 test-analyzer 4/10: the sync-throw absorption was tested for
    // the .set() thunk only. Cover the .delete() thunk path as well.
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({
      id: 'r1',
      reportedUserId: 't',
      reportedUserUniqueId: 'u1',
      reporterId: 'rep1',
      reason: 'x',
    });
    // Make the lock-release .delete() throw SYNCHRONOUSLY.
    mockDocDelete.mockImplementationOnce(() => {
      throw new Error('synchronous throw from delete');
    });

    const res = await request(app).post('/api/reports/r1/resolve').send({ action: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.lockRelease).toEqual({ failed: true });
    expect(res.body.success).toBe(true);
  });
});
