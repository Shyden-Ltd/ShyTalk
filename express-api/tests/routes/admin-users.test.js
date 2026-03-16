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
