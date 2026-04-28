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
      'evict-suspended-user',
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
      'evict-suspended-user',
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

describe('POST /api/admin/users/:uniqueId/suspend — cascade wire-shape (Pass-18 LOW-1)', () => {
  // Pass-18 api-test-auditor LOW-1: the suspend admin route uses
  // buildCascadeFailure but no test asserts the wire-shape that arrives
  // in the response. Tests use mockReset() per feedback-test-mock-isolation
  // because mockOnce queues poison subsequent describes.
  let app, getDoc, queryDocs;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    const fh = require('../../src/utils/firestore-helpers');
    ({ getDoc, queryDocs } = fh);
    getDoc.mockReset();
    getDoc.mockImplementation(async (_path) => null);
    queryDocs.mockReset();
    queryDocs.mockResolvedValue([]);
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });
  afterEach(() => {
    // Drain any unconsumed .Once values so siblings inherit a clean state.
    getDoc.mockReset();
    queryDocs.mockReset();
  });

  it('happy path: cascade response includes all 7 canonical keys (with error: null per Pass-19)', async () => {
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Pass-19 unified the cascade success/failure shape — both now have 7
    // keys with `error` set to null on success or 'cascade_failed' on failure.
    expect(Object.keys(res.body.cascade).sort()).toEqual(
      [
        'error',
        'failedRoomIds',
        'partial',
        'roomsClosed',
        'roomsUpdated',
        'rtdbEventsFailed',
        'userDocFailed',
      ].sort(),
    );
    expect(res.body.cascade.error).toBeNull();
    expect(res.body.cascade.rtdbEventsFailed).toBe(0);
    expect(res.body.cascade.partial).toBe(false);
  });

  it('cascade-throw path: response uses buildCascadeFailure shape (8 keys with error)', async () => {
    // Force evictSuspendedUser to throw by rejecting its first queryDocs.
    const { queryDocs } = require('../../src/utils/firestore-helpers');
    getDoc.mockResolvedValueOnce({ id: 'u1', displayName: 'User' });
    queryDocs.mockRejectedValueOnce(new Error('Firestore timeout: project=secret'));

    const res = await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ reason: 'Test', canAppeal: false });
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
    // Defense: Firestore SDK message must NOT leak through cascade contract.
    expect(JSON.stringify(res.body)).not.toContain('Firestore timeout');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('error token MOD_ERROR.CASCADE_FAILED equals literal "cascade_failed" (cross-file drift guard)', async () => {
    // Pass-18 LOW-2: reports.js uses MOD_ERROR.CASCADE_FAILED, admin-users.js
    // uses a literal 'cascade_failed' (different file, no shared import to
    // avoid circular dep). Both MUST resolve to the same wire token.
    const { MOD_ERROR } = require('../../src/routes/reports');
    expect(MOD_ERROR.CASCADE_FAILED).toBe('cascade_failed');
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

// GET /api/admin/audit-log - admin name enrichment — removed from reports.js;
// now served by admin-audit-log.js. See admin-audit-log-suggestions.test.js.

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
