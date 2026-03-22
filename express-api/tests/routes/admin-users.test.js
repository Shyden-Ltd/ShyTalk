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

describe('GET /api/search/uniqueId/:id', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should find user by tempUniqueId when uniqueId not found', async () => {
    const { db } = require('../../src/utils/firebase');

    // First collection call (uniqueId search) - empty
    // Second collection call (tempUniqueId fallback) - found
    let callCount = 0;
    db.collection.mockImplementation(() => {
      callCount++;
      const getResult =
        callCount === 1
          ? { empty: true, docs: [] }
          : {
              empty: false,
              docs: [
                {
                  id: 'user-abc',
                  data: () => ({
                    uniqueId: 99999999,
                    tempUniqueId: 12345678,
                    gcsScore: 100,
                  }),
                },
              ],
            };
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue(getResult),
      };
      return chain;
    });

    const res = await request(app).get('/api/search/uniqueId/12345678').expect(200);

    expect(res.body.id).toBe('user-abc');
    expect(res.body.uniqueId).toBe(99999999);
    expect(res.body.tempUniqueId).toBe(12345678);
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
