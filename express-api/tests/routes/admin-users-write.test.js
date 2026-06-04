const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
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
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'user-1',
      email: null,
      providerData: [],
    }),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => 'arrayRemove(' + args.join(',') + ')'),
    arrayUnion: jest.fn((...args) => 'arrayUnion(' + args.join(',') + ')'),
    increment: jest.fn((n) => 'increment(' + n + ')'),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests
  clearSuspensionCache: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

const adminUsersRouter = require('../../src/routes/admin-users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

// ─── Utility ────────────────────────────────────────────────────

/** Flush micro-task queue so fire-and-forget promises settle. */
const flushPromises = () => new Promise((r) => setTimeout(r, 50));

// ─── Tests ──────────────────────────────────────────────────────

describe('PATCH /api/user/:uid', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should accept superShyExpiry as an allowed field', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ superShyExpiry: 1700000000000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain('superShyExpiry');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ superShyExpiry: 1700000000000 }),
    );
  });

  it('should accept superShyExpiry as null to clear it', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ superShyExpiry: null });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain('superShyExpiry');
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ superShyExpiry: null }));
  });

  it('should reject superShyTier as it is no longer an allowed field', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ superShyTier: 'monthly' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid fields to update');
  });

  it('should accept isSuperShy together with superShyExpiry', async () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ isSuperShy: true, superShyExpiry: expiry });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain('isSuperShy');
    expect(res.body.updatedFields).toContain('superShyExpiry');
  });

  it('should return 400 when no valid fields are provided', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ invalidField: 'value' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid fields to update');
  });

  it('should return 400 when body is empty', async () => {
    const res = await request(app).patch('/api/user/user-1').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid fields to update');
  });

  it('should accept other allowed fields like displayName', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain('displayName');
  });

  it('should create an audit log entry', async () => {
    await request(app).patch('/api/user/user-1').send({ displayName: 'Test' });

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        action: 'EDIT_USER',
        targetUserId: 'user-1',
      }),
    );
  });
});

// ─── autoApplyBans (via suspend route) ──────────────────────────

describe('POST /api/user/:uniqueId/suspend — autoApplyBans', () => {
  let app;
  const futureDate = new Date(Date.now() + 86400000).toISOString();

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should write device and network bans for all bound devices', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({ set: mockBatchSet, update: jest.fn(), commit: mockBatchCommit });

    // doc() for user get, user update, audit log, warning, gcs update
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-42',
      data: () => ({ displayName: 'Test', gcsScore: 80 }),
    });

    // collection() for deviceBindings query (autoApplyBans) and rooms query (evict)
    db.collection.mockImplementation((name) => {
      if (name === 'deviceBindings') {
        const chain = {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              { id: 'device-A', data: () => ({ lastIp: '10.0.0.1' }) },
              { id: 'device-B', data: () => ({ ip: '10.0.0.2' }) },
            ],
          }),
        };
        return chain;
      }
      // rooms collection for evictSuspendedUser
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/user-42/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: futureDate });

    expect(res.status).toBe(200);

    // Wait for fire-and-forget autoApplyBans to settle
    await flushPromises();

    // batch.set called for each device + one network ban for the last IP
    expect(mockBatchSet).toHaveBeenCalledTimes(3);

    // Verify device bans
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceId: 'device-A',
        reason: 'Auto-applied: user suspended',
        autoApplied: true,
        linkedUniqueId: 'user-42',
      }),
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceId: 'device-B',
        reason: 'Auto-applied: user suspended',
        autoApplied: true,
      }),
    );

    // Verify network ban uses last device's IP (device-B's ip)
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'ip',
        value: '10.0.0.2',
        reason: 'Auto-applied: user suspended',
        autoApplied: true,
      }),
    );

    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('should skip network ban when no device has an IP', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({ set: mockBatchSet, update: jest.fn(), commit: mockBatchCommit });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-42',
      data: () => ({ displayName: 'Test', gcsScore: 80 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'deviceBindings') {
        const chain = {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'device-no-ip', data: () => ({}) }],
          }),
        };
        return chain;
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    await request(app).post('/api/user/user-42/suspend').send({ reason: 'Spam', canAppeal: true });

    await flushPromises();

    // Only 1 device ban, no network ban
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deviceId: 'device-no-ip', autoApplied: true }),
    );
  });

  it('should set permanent duration when no endDate', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({ set: mockBatchSet, update: jest.fn(), commit: mockBatchCommit });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-42',
      data: () => ({ displayName: 'Test', gcsScore: 80 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'deviceBindings') {
        const chain = {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'dev-1', data: () => ({ lastIp: '1.2.3.4' }) }],
          }),
        };
        return chain;
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    await request(app).post('/api/user/user-42/suspend').send({ reason: 'Spam', canAppeal: false });

    await flushPromises();

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 'permanent', expiresAt: null }),
    );
  });
});

// ─── liftAutoAppliedBans (via unsuspend route) ──────────────────

describe('POST /api/user/:uniqueId/unsuspend — liftAutoAppliedBans', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should remove auto-applied bans using dual-type query', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '42',
      data: () => ({ isSuspended: true, displayName: 'Suspended Account' }),
    });

    const mockRefDelete = jest.fn().mockResolvedValue();
    const whereArgs = [];

    // Track which collections and where clauses are called
    db.collection.mockImplementation((collName) => {
      const chain = {
        where: jest.fn().mockImplementation((...args) => {
          whereArgs.push({ collection: collName, args });
          return chain;
        }),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({
          docs: [{ id: `${collName}-ban1`, ref: { delete: mockRefDelete } }],
        }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/42/unsuspend');

    expect(res.status).toBe(200);

    // Wait for fire-and-forget liftAutoAppliedBans to settle
    await flushPromises();

    // Should query both string and numeric forms of the uniqueId
    const linkedIdQueries = whereArgs.filter((w) => w.args[0] === 'linkedUniqueId');
    const queriedValues = linkedIdQueries.map((w) => w.args[2]);
    expect(queriedValues).toContain('42');
    expect(queriedValues).toContain(42);

    // autoApplied filter applied
    const autoAppliedQueries = whereArgs.filter((w) => w.args[0] === 'autoApplied');
    expect(autoAppliedQueries.length).toBeGreaterThanOrEqual(2);

    // Bans were deleted
    expect(mockRefDelete).toHaveBeenCalled();
  });

  it('should deduplicate bans across string and numeric queries', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '12345',
      data: () => ({ isSuspended: true }),
    });

    const mockRefDelete = jest.fn().mockResolvedValue();

    // All 4 queries return the same doc id — dedup should delete it only once
    db.collection.mockImplementation(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({
          docs: [{ id: 'same-ban', ref: { delete: mockRefDelete } }],
        }),
      };
      return chain;
    });

    await request(app).post('/api/user/12345/unsuspend');
    await flushPromises();

    // same-ban appears in all 4 queries, but dedup means deleted only once
    expect(mockRefDelete).toHaveBeenCalledTimes(1);
  });

  it('should not delete anything when no auto-applied bans exist', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '12345',
      data: () => ({ isSuspended: true }),
    });

    db.collection.mockImplementation(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/12345/unsuspend');
    expect(res.status).toBe(200);

    await flushPromises();

    // No audit log for LIFT_AUTO_BANS since there were none to lift
    // (the only set calls should be for UNSUSPEND audit log)
    const liftCalls = mockDocSet.mock.calls.filter((call) => call[0]?.action === 'LIFT_AUTO_BANS');
    expect(liftCalls).toHaveLength(0);
  });

  it('should query both deviceBans and networkBans collections', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '99',
      data: () => ({ isSuspended: true }),
    });

    const queriedCollections = [];
    db.collection.mockImplementation((collName) => {
      queriedCollections.push(collName);
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
      return chain;
    });

    await request(app).post('/api/user/99/unsuspend');
    await flushPromises();

    expect(queriedCollections).toContain('deviceBans');
    expect(queriedCollections).toContain('networkBans');
  });
});

// --- Suspend --- validation branches ----------------------------------------

describe('POST /api/user/:uniqueId/suspend --- validation', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return 400 when reason is missing', async () => {
    const res = await request(app).post('/api/user/user-1/suspend').send({ canAppeal: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it('should return 400 when canAppeal is not a boolean', async () => {
    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({ reason: 'Spam', canAppeal: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/canAppeal/i);
  });

  it('should return 400 when reason exceeds 500 chars', async () => {
    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({ reason: 'x'.repeat(501), canAppeal: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason exceeds 500 chars/);
  });

  it('should return 400 when endDate is not a valid date', async () => {
    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ISO-8601/i);
  });

  it('should return 400 when endDate is in the past', async () => {
    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({ reason: 'Spam', canAppeal: true, endDate: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  it('should return 404 when user does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({
        reason: 'Spam',
        canAppeal: true,
        endDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('should skip GCS deduction when user gcsScore is already 0', async () => {
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({ set: mockBatchSet, update: jest.fn(), commit: mockBatchCommit });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-zero',
      data: () => ({ displayName: 'Zero GCS', gcsScore: 0 }),
    });

    db.collection.mockImplementation(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/user-zero/suspend')
      .send({ reason: 'Ban evasion', canAppeal: false, endDate: futureDate });

    expect(res.status).toBe(200);

    await flushPromises();

    // No warning doc should be created for GCS deduction since GCS is already 0
    const warningSetCalls = mockDocSet.mock.calls.filter(
      (call) => typeof call[0] === 'object' && call[0].reason,
    );
    expect(warningSetCalls).toHaveLength(0);
  });
});

// --- Unsuspend --- validation branches --------------------------------------

describe('POST /api/user/:uniqueId/unsuspend --- validation', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return 404 when user does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(app).post('/api/user/nonexistent/unsuspend');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('should return alreadyUnsuspended without writing when isSuspended is false', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '42',
      data: () => ({
        isSuspended: false,
        displayName: 'Clean User',
      }),
    });

    const res = await request(app).post('/api/user/42/unsuspend');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, alreadyUnsuspended: true });

    // Confirm the route returned BEFORE any write side effects fired.
    // Without the early-return guard, a defensive beforeAll calling
    // unsuspend on a clean user would emit a spurious PM, write a
    // phantom UNSUSPEND audit log entry, run liftAutoAppliedBans, and
    // invalidate the suspension cache — polluting state for the suite.
    // Pin every side-effect channel explicitly so a future refactor
    // that moves any of them above the guard is caught.
    expect(mockDocUpdate).not.toHaveBeenCalled();
    // audit log writes use `db.doc('adminAuditLog/...').set(...)` →
    // mockDocSet (not mockDocUpdate); the guard must suppress this too.
    expect(mockDocSet).not.toHaveBeenCalled();
    // liftAutoAppliedBans queries `bans` via `db.collection`; on the
    // early-return path it must never execute.
    expect(db.collection).not.toHaveBeenCalled();
    // System PM ("Your suspension has been lifted") would surprise the
    // already-unsuspended user.
    const { sendSystemPm } = require('../../src/utils/system-pm');
    expect(sendSystemPm).not.toHaveBeenCalled();
    // Cache invalidation is only meaningful when the suspension state
    // actually changed — pin its absence on the no-op path.
    const { clearSuspensionCache } = require('../../src/middleware/auth');
    expect(clearSuspensionCache).not.toHaveBeenCalled();
  });

  it('should restore pre-suspension profile data on unsuspend', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '42',
      data: () => ({
        isSuspended: true,
        preSuspensionDisplayName: 'Original Name',
        preSuspensionProfilePhotoUrl: 'https://example.com/photo.jpg',
        preSuspensionCoverPhotoUrl: 'https://example.com/cover.jpg',
      }),
    });

    db.collection.mockImplementation(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/42/unsuspend');
    expect(res.status).toBe(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuspended: false,
        displayName: 'Original Name',
        profilePhotoUrl: 'https://example.com/photo.jpg',
        coverPhotoUrl: 'https://example.com/cover.jpg',
      }),
    );
  });

  it('should not restore fields that are null in pre-suspension data', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '42',
      data: () => ({
        isSuspended: true,
        preSuspensionDisplayName: null,
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl: null,
      }),
    });

    db.collection.mockImplementation(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/42/unsuspend');
    expect(res.status).toBe(200);

    const updateCall = mockDocUpdate.mock.calls[0][0];
    expect(updateCall.preSuspensionDisplayName).toBeNull();
    expect(updateCall.preSuspensionProfilePhotoUrl).toBeNull();
    expect(updateCall.preSuspensionCoverPhotoUrl).toBeNull();
  });
});

// --- PATCH /api/user/:uid --- validation branches ---------------------------

describe('PATCH /api/user/:uid --- extended validation', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return 400 when displayName exceeds 20 characters', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ displayName: 'A'.repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/displayName must be 20 characters or fewer/);
  });

  it('should return 400 when description exceeds 200 characters', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ description: 'A'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description must be 200 characters or fewer/);
  });

  it('should return 400 when nationality exceeds 3 characters', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ nationality: 'LONG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nationality must be 3 characters or fewer/);
  });

  it('should return 400 when blockedUserIds is not an array', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ blockedUserIds: 'not-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blockedUserIds must be an array/);
  });

  it('should return 400 when followingIds is not an array', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ followingIds: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/followingIds must be an array/);
  });

  it('should return 400 when followerIds is not an array', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ followerIds: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/followerIds must be an array/);
  });

  it('should accept snake_case input and convert to camelCase', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ display_name: 'Snake Case' });
    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('displayName');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Snake Case' }),
    );
  });

  it('should skip PMs when silent=true query param is set', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .patch('/api/user/user-1')
      .query({ silent: 'true' })
      .send({ displayName: 'Silently Changed' });

    expect(res.status).toBe(200);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });

  it('should send PM when profilePhotoUrl is cleared', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app).patch('/api/user/user-1').send({ profilePhotoUrl: '' });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your profile photo was removed by a moderator.',
    );
  });

  it('should send PM when coverPhotoUrl is set to null', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app).patch('/api/user/user-1').send({ coverPhotoUrl: null });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your cover photo was removed by a moderator.',
    );
  });

  it('should send PM when description is cleared', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app).patch('/api/user/user-1').send({ description: '' });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your profile description was cleared by a moderator.',
    );
  });

  it('should send Super Shy activated PM when isSuperShy is true', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app).patch('/api/user/user-1').send({ isSuperShy: true });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Super Shy has been activated on your account.',
    );
  });

  it('should send Super Shy removed PM when isSuperShy is false', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app).patch('/api/user/user-1').send({ isSuperShy: false });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Super Shy has been removed from your account.',
    );
  });

  it('should send PM when superShyExpiry is updated', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

    const res = await request(app).patch('/api/user/user-1').send({ superShyExpiry: expiry });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your Super Shy expiry date has been updated.',
    );
  });

  it('should accept numeric fields like shyCoins and shyBeans', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ shyCoins: 999, shyBeans: 500 });

    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('shyCoins');
    expect(res.body.updatedFields).toContain('shyBeans');
  });

  it('should accept gcsScore as an allowed field', async () => {
    const res = await request(app).patch('/api/user/user-1').send({ gcsScore: 50 });

    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('gcsScore');
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ gcsScore: 50 }));
  });

  it('should accept luckScore and pityCounter fields', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ luckScore: 75, pityCounter: 3 });

    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('luckScore');
    expect(res.body.updatedFields).toContain('pityCounter');
  });

  it('should accept warningCount and hasActiveWarning fields', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ warningCount: 2, hasActiveWarning: true, warningReason: 'Spam' });

    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('warningCount');
    expect(res.body.updatedFields).toContain('hasActiveWarning');
    expect(res.body.updatedFields).toContain('warningReason');
  });
});

// --- POST /api/user/:uniqueId/notify-changes --------------------------------

describe('POST /api/user/:uniqueId/notify-changes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return 400 when fields is not an array', async () => {
    const res = await request(app)
      .post('/api/user/user-1/notify-changes')
      .send({ fields: 'not-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
  });

  it('should return 400 when fields is an empty array', async () => {
    const res = await request(app).post('/api/user/user-1/notify-changes').send({ fields: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
  });

  it('should return success with notified=false when no notifiable fields', async () => {
    const res = await request(app)
      .post('/api/user/user-1/notify-changes')
      .send({ fields: ['shyCoins', 'luckScore'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notified).toBe(false);
    expect(res.body.reason).toMatch(/no notifiable/i);
  });

  it('should send system PM and return notified=true for notifiable fields', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/user/user-1/notify-changes')
      .send({ fields: ['displayName', 'email', 'shyCoins'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notified).toBe(true);
    expect(res.body.fields).toEqual(['displayName', 'email']);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('display name, email address'),
    );
  });

  it('should send PM with friendly names for photo and cover fields', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/user/user-1/notify-changes')
      .send({ fields: ['profilePhotoUrl', 'coverPhotoUrl', 'description'] });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(true);
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('profile photo, cover photo, profile description'),
    );
  });
});

// --- Suspend --- evictSuspendedUser -----------------------------------------

describe('POST /api/user/:uniqueId/suspend --- room eviction', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should evict user from active rooms and clear their seat', async () => {
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const mockBatchUpdate = jest.fn();
    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-evict',
      data: () => ({ displayName: 'Evicted User', gcsScore: 50 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'rooms') {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: 'room-1',
                  data: () => ({
                    participantIds: ['user-evict', 'other-user'],
                    seats: {
                      0: { index: 0, status: 'OCCUPIED', userId: 'user-evict', isMuted: false },
                      1: { index: 1, status: 'OCCUPIED', userId: 'other-user', isMuted: false },
                    },
                  }),
                },
              ],
            }),
          }),
        };
      }
      if (name === 'deviceBindings') {
        return {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        };
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/user-evict/suspend')
      .send({ reason: 'Bad behaviour', canAppeal: true, endDate: futureDate });

    expect(res.status).toBe(200);
    await flushPromises();

    // Race-safe writes: non-owner room evictions go through batch.update with
    // FieldValue.arrayRemove + dot-path 'seats.X' keys (so concurrent client
    // dot-path writes for OTHER seats don't get clobbered). The user-doc
    // currentRoomId clear still uses batch.set+merge.
    expect(mockBatchUpdate).toHaveBeenCalled();

    const roomUpdateCall = mockBatchUpdate.mock.calls.find(
      (call) => call[1]?.participantIds !== undefined,
    );
    expect(roomUpdateCall).toBeDefined();
    // arrayRemove sentinel from FieldValue mock — proves we're not building a
    // literal filtered array (which would race with concurrent arrayUnion).
    expect(roomUpdateCall[1].participantIds).toBe('arrayRemove(user-evict)');
    // Cleared seat written via dot-path key.
    expect(roomUpdateCall[1]['seats.0']).toEqual({
      userId: null,
      state: 'EMPTY',
      isMuted: false,
    });
    // The other seat must NOT be in the write — server-side preserves it.
    expect(roomUpdateCall[1]['seats.1']).toBeUndefined();
  });
});

// --- Suspend / unsuspend --- suggestion ban-cascade wiring ------------------
//
// Defence-in-depth alongside the unit tests in
// tests/routes/suggestions-integration-a-submission.test.js: those prove the
// cascade utility flags the right docs; these prove the suspend/unsuspend
// routes actually CALL it and surface the result in the response.

describe('POST /api/user/:uniqueId/suspend --- suggestion cascade', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('flags accepted/planned suggestions of the suspended user and reports cascade in response', async () => {
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const flagBatchUpdate = jest.fn();
    const flagBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({
      set: jest.fn(),
      update: flagBatchUpdate,
      commit: flagBatchCommit,
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '5151',
      data: () => ({ displayName: 'Banned User', gcsScore: 50 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'suggestions') {
        return {
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
              empty: false,
              size: 2,
              docs: [
                {
                  id: 'sug-A',
                  ref: { _path: 'suggestions/sug-A', update: jest.fn() },
                  data: () => ({ status: 'accepted', submitterUid: 5151 }),
                },
                {
                  id: 'sug-B',
                  ref: { _path: 'suggestions/sug-B', update: jest.fn() },
                  data: () => ({ status: 'planned', submitterUid: 5151 }),
                },
              ],
            }),
          }),
        };
      }
      // Rooms / deviceBindings / other collections → empty (no other cascade work).
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/5151/suspend')
      .send({ reason: 'Repeated harassment', canAppeal: true, endDate: futureDate });

    expect(res.status).toBe(200);
    expect(res.body.suggestionsCascade).toBeDefined();
    expect(res.body.suggestionsCascade.flaggedCount).toBe(2);
    expect(res.body.suggestionsCascade.partial).toBe(false);
    expect(res.body.suggestionsCascade.error).toBeNull();

    // Batch update payload: confirms route-level wiring actually fanned out.
    expect(flagBatchUpdate).toHaveBeenCalledTimes(2);
    const samplePayload = flagBatchUpdate.mock.calls[0][1];
    expect(samplePayload.flaggedForReview).toBe(true);
    expect(samplePayload.flaggedReason).toBe('submitter_suspended');
    expect(samplePayload.flaggedBy).toBe('admin-1');
  });

  it('returns partial=true in suggestionsCascade when the cascade utility throws', async () => {
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '5252',
      data: () => ({ displayName: 'Banned User', gcsScore: 50 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'suggestions') {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
          }),
        };
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/5252/suspend')
      .send({ reason: 'Spam', canAppeal: false, endDate: futureDate });

    // Suspension itself MUST still succeed even when the cascade fails — admin
    // must always be able to ban. Cascade failure is reported, not blocking.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestionsCascade.partial).toBe(true);
    expect(res.body.suggestionsCascade.error).toBe('Firestore unavailable');
  });

  it('surfaces utility-returned partial=true (batch failed without throw) without entering route catch', async () => {
    // The route's try/catch only fires when the utility ITSELF throws. The
    // commitChunked path catches batch failures internally and returns
    // partial:true normally — that path must still surface in the response.
    //
    // Content-aware batch mock: autoApplyBans (fire-and-forget on the suspend
    // path) ALSO calls db.batch(); a blanket `mockRejectedValueOnce` would
    // consume the rejection on the wrong batch. Reject only when the batch's
    // first update carries the `flaggedForReview` payload signature.
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    db.batch.mockImplementation(() => {
      let isFlagBatch = false;
      return {
        set: jest.fn(),
        update: jest.fn((_ref, payload) => {
          if (payload && payload.flaggedForReview !== undefined) {
            isFlagBatch = true;
          }
        }),
        commit: jest.fn(() => {
          if (isFlagBatch) {
            return Promise.reject(new Error('Firestore batch commit blocked by quota'));
          }
          return Promise.resolve();
        }),
      };
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '5454',
      data: () => ({ displayName: 'Banned User', gcsScore: 50 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'suggestions') {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              empty: false,
              size: 1,
              docs: [
                {
                  id: 'sug-Q',
                  ref: { _path: 'suggestions/sug-Q', update: jest.fn() },
                  data: () => ({ status: 'accepted', submitterUid: 5454 }),
                },
              ],
            }),
          }),
        };
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app)
      .post('/api/user/5454/suspend')
      .send({ reason: 'Spam', canAppeal: false, endDate: futureDate });

    expect(res.status).toBe(200);
    expect(res.body.suggestionsCascade.partial).toBe(true);
    expect(res.body.suggestionsCascade.flaggedCount).toBe(0);
    expect(res.body.suggestionsCascade.failedSuggestionIds).toEqual(['sug-Q']);
    expect(res.body.suggestionsCascade.error).toBe('Firestore batch commit blocked by quota');
  });
});

describe('POST /api/user/:uniqueId/unsuspend --- suggestion cascade', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it("clears submitter_suspended flags from the user's suggestions on unsuspend", async () => {
    const { db } = require('../../src/utils/firebase');

    const clearBatchUpdate = jest.fn();
    const clearBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({
      set: jest.fn(),
      update: clearBatchUpdate,
      commit: clearBatchCommit,
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '5151',
      data: () => ({
        displayName: 'Reformed User',
        isSuspended: true,
        preSuspensionDisplayName: 'Reformed User',
      }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'suggestions') {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              empty: false,
              size: 2,
              docs: [
                {
                  id: 'sug-X',
                  ref: { _path: 'suggestions/sug-X', update: jest.fn() },
                  data: () => ({
                    status: 'accepted',
                    submitterUid: 5151,
                    flaggedForReview: true,
                    flaggedReason: 'submitter_suspended',
                  }),
                },
                {
                  id: 'sug-Y',
                  ref: { _path: 'suggestions/sug-Y', update: jest.fn() },
                  data: () => ({
                    status: 'accepted',
                    submitterUid: 5151,
                    flaggedForReview: true,
                    flaggedReason: 'manual_admin_flag',
                  }),
                },
              ],
            }),
          }),
        };
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/5151/unsuspend');

    expect(res.status).toBe(200);
    expect(res.body.suggestionsCascade).toBeDefined();
    expect(res.body.suggestionsCascade.unflaggedCount).toBe(1);

    // Only sug-X (submitter_suspended) is cleared; sug-Y (manual_admin_flag) is preserved.
    expect(clearBatchUpdate).toHaveBeenCalledTimes(1);
    const clearedPayload = clearBatchUpdate.mock.calls[0][1];
    expect(clearedPayload.flaggedForReview).toBe(false);
    expect(clearedPayload.flaggedReason).toBeNull();
  });

  it('returns partial=true in suggestionsCascade when the unflag utility throws', async () => {
    // Pair with the suspend-route throw test: the unsuspend route's outer
    // catch for unflagUnsuspendedUserSuggestions is otherwise uncovered.
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValue({
      exists: true,
      id: '5353',
      data: () => ({
        displayName: 'Reformed User',
        isSuspended: true,
      }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'suggestions') {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockRejectedValue(new Error('Firestore unavailable on unflag')),
          }),
        };
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    const res = await request(app).post('/api/user/5353/unsuspend');

    // Unsuspension must still succeed — cascade failure is reported, not blocking.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestionsCascade.partial).toBe(true);
    expect(res.body.suggestionsCascade.error).toBe('Firestore unavailable on unflag');
  });
});

// --- Suspend --- suspension-match duration for timed bans -------------------

describe('POST /api/user/:uniqueId/suspend --- timed ban duration', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should set suspension-match duration when endDate is provided', async () => {
    const { db } = require('../../src/utils/firebase');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const mockBatchSet = jest.fn();
    const mockBatchCommit = jest.fn().mockResolvedValue();
    db.batch.mockReturnValue({ set: mockBatchSet, update: jest.fn(), commit: mockBatchCommit });

    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-timed',
      data: () => ({ displayName: 'Timed Ban', gcsScore: 80 }),
    });

    db.collection.mockImplementation((name) => {
      if (name === 'deviceBindings') {
        const chain = {
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'device-X', data: () => ({ lastIp: '192.168.1.1' }) }],
          }),
        };
        return chain;
      }
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    });

    await request(app)
      .post('/api/user/user-timed/suspend')
      .send({ reason: 'Temp ban', canAppeal: true, endDate: futureDate });

    await flushPromises();

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        duration: 'suspension-match',
        expiresAt: expect.any(String),
      }),
    );
  });
});

// --- Suspend cache invalidation (Phase 2H finding #1) ----------------------
describe('POST /api/user/:uniqueId/suspend --- cache invalidation', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });
  it('calls clearSuspensionCache after suspend', async () => {
    const { clearSuspensionCache } = require('../../src/middleware/auth');
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'u',
      data: () => ({ displayName: 'U', gcsScore: 100 }),
    });
    await request(app)
      .post('/api/user/u/suspend')
      .send({ reason: 'T', canAppeal: false, endDate: futureDate });
    await flushPromises();
    expect(clearSuspensionCache).toHaveBeenCalled();
  });
});

// --- GET /api/conversations/:id/messages ------------------------------------
