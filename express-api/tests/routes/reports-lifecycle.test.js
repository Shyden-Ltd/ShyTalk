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

function createApp({ uid = 'firebase-uid', uniqueId = 'user-123' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

function createAdminApp() {
  return createApp({ uid: 'admin-firebase-uid', uniqueId: 'admin-1' });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/reports (submit report)', () => {
  let app;
  let getDoc, queryDocs;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
    // Default: reporter user doc exists
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-123',
      data: () => ({ displayName: 'Test User', uniqueId: 'user-123' }),
    });
  });

  it('returns 400 when reportedUserId is missing', async () => {
    const res = await request(app).post('/api/reports').send({ reason: 'spam' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportedUserId/i);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app).post('/api/reports').send({ reportedUserId: 'target-user' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it('returns 200 and creates report document when valid data provided', async () => {
    getDoc.mockResolvedValueOnce({ id: 'user-123', displayName: 'Reporter', uniqueId: 'user-123' });
    queryDocs.mockResolvedValueOnce([]); // admin users for FCM (fire-and-forget)

    const res = await request(app).post('/api/reports').send({
      reportedUserId: 'target-user',
      reportedUserName: 'Target',
      reason: 'harassment',
      description: 'Sent mean messages',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reportId).toBeDefined();
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedUserId: 'target-user',
        reason: 'harassment',
        status: 'pending',
      }),
      { merge: true },
    );
  });
});

describe('POST /api/reports/:id/resolve (admin resolve)', () => {
  let app;
  let getDoc;
  let requireAdmin;

  beforeEach(() => {
    app = createAdminApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    // Default: admin passes
    requireAdmin.mockReturnValue(false);
  });

  it('returns 403 for non-admin', async () => {
    requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });

    const res = await request(app)
      .post('/api/reports/report-1/resolve')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(403);
  });

  it('returns 404 when report not found', async () => {
    getDoc.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/reports/nonexistent/resolve')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 for dismissed action', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'report-1',
      reportedUserId: 'target-user',
      reporterId: 'reporter-user',
      reason: 'spam',
    });

    const res = await request(app)
      .post('/api/reports/report-1/resolve')
      .send({ action: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        actionTaken: 'dismissed',
      }),
    );
  });

  it('returns 200 for warned action and calls createWarning', async () => {
    const { createWarning } = require('../../src/routes/admin-users');
    getDoc.mockResolvedValueOnce({
      id: 'report-1',
      reportedUserId: 'target-user',
      reporterId: 'reporter-user',
      reason: 'harassment',
    });

    const res = await request(app).post('/api/reports/report-1/resolve').send({ action: 'warned' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(createWarning).toHaveBeenCalledWith(
      'target-user',
      expect.objectContaining({
        severity: 2,
        source: 'report',
        linkedReportId: 'report-1',
      }),
    );
  });

  it('returns 200 for suspended action', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'report-1',
      reportedUserId: 'target-user',
      reporterId: 'reporter-user',
      reason: 'severe violation',
    });

    const res = await request(app)
      .post('/api/reports/report-1/resolve')
      .send({ action: 'suspended' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        actionTaken: 'suspended',
      }),
    );
  });
});

describe('POST /api/appeals (user submit appeal)', () => {
  let app;
  let getDoc, queryDocs;

  beforeEach(() => {
    app = createApp({ uid: 'user-firebase-uid', uniqueId: 'suspended-user' });
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
  });

  it('returns 400 when user is not suspended', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'suspended-user',
      isSuspended: false,
      suspensionCanAppeal: true,
    });

    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'I was wrongly suspended' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not suspended/i);
  });

  it('returns 400 when appealText is empty or missing', async () => {
    const res = await request(app).post('/api/appeals').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/appealText/i);
  });

  it('returns 403 when canAppeal is false', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'suspended-user',
      isSuspended: true,
      suspensionCanAppeal: false,
    });

    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'Please reconsider my suspension' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('returns 409 when an appeal is already pending', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'suspended-user',
      isSuspended: true,
      suspensionCanAppeal: true,
    });
    queryDocs.mockResolvedValueOnce([{ id: 'existing-appeal', status: 'pending' }]);

    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'Please reconsider my suspension' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already pending/i);
  });

  it('returns 200 and creates appeal document when valid', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'suspended-user',
      isSuspended: true,
      suspensionCanAppeal: true,
    });
    queryDocs.mockResolvedValueOnce([]); // no existing pending appeals

    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'I believe this suspension was a mistake' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.appealId).toBeDefined();
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'suspended-user',
        appealText: 'I believe this suspension was a mistake',
        status: 'pending',
      }),
      { merge: true },
    );
  });
});

describe('PATCH /api/appeals/:id (admin review appeal)', () => {
  let app;
  let getDoc;
  let requireAdmin;

  beforeEach(() => {
    app = createAdminApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    ({ requireAdmin } = require('../../src/middleware/auth'));
    requireAdmin.mockReturnValue(false);
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app).patch('/api/appeals/appeal-1').send({ status: 'rejected' }); // invalid — must be "approved" or "denied"

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved.*denied|denied.*approved/i);
  });

  it('returns 200 for approved status and unsuspends user', async () => {
    const { clearSuspensionCache } = require('../../src/middleware/auth');

    getDoc
      .mockResolvedValueOnce({
        id: 'appeal-1',
        userId: 'suspended-user',
        status: 'pending',
      })
      .mockResolvedValueOnce({
        id: 'suspended-user',
        isSuspended: true,
        preSuspensionDisplayName: 'Original Name',
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl: null,
      });

    const res = await request(app).patch('/api/appeals/appeal-1').send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // User doc should be updated to unsuspend
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuspended: false,
        suspensionReason: null,
      }),
    );
    expect(clearSuspensionCache).toHaveBeenCalledWith('suspended-user');
  });

  it('returns 200 for denied status without unsuspending user', async () => {
    const { clearSuspensionCache } = require('../../src/middleware/auth');

    getDoc.mockResolvedValueOnce({
      id: 'appeal-1',
      userId: 'suspended-user',
      status: 'pending',
    });

    const res = await request(app).patch('/api/appeals/appeal-1').send({ status: 'denied' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Appeal doc updated with denied status
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'denied',
        reviewedBy: 'admin-firebase-uid',
      }),
    );
    // User should NOT be unsuspended — clearSuspensionCache not called
    expect(clearSuspensionCache).not.toHaveBeenCalled();
  });
});
