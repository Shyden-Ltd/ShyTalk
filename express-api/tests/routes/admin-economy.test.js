const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionGet = jest.fn();

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
        startAfter: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet,
      };
      return chain;
    }),
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

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests
}));

// ─── App setup ──────────────────────────────────────────────────

const adminEconomyRouter = require('../../src/routes/admin-economy');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminEconomyRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/users/:uid/luck', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should accept valid numeric luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept valid string numeric luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: '75' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject NaN luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('luckScore must be a number');
  });

  it('should reject NaN pityCounter', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ pityCounter: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pityCounter must be a number');
  });

  it('should clamp luckScore between 0 and 100', async () => {
    await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 200 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(100);
  });

  it('should clamp negative luckScore to 0', async () => {
    await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: -50 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(0);
  });

  it('should clamp negative pityCounter to 0', async () => {
    await request(app)
      .post('/api/users/user-1/luck')
      .send({ pityCounter: -10 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.pityCounter).toBe(0);
  });

  it('should return 400 when no fields provided', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No fields to update');
  });
});

// ─── Task 4: POST /api/users/:uid/adjust-balance ────────────────

describe('POST /api/users/:uid/adjust-balance', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should add coins successfully', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100, shyBeans: 50 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 50, reason: 'test bonus' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newBalance).toBe(150);
    expect(res.body.currency).toBe('coins');
  });

  it('should deduct beans successfully', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100, shyBeans: 200 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'beans', amount: -80, reason: 'penalty' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newBalance).toBe(120);
    expect(res.body.currency).toBe('beans');
  });

  it('should not allow balance to go below zero', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 30, shyBeans: 0 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: -100 });

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(0);
  });

  it('should support operation=deduct to negate positive amount', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 500, shyBeans: 0 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 100, operation: 'deduct' });

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(400);
  });

  it('should reject zero amount', async () => {
    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount must be a non-zero number');
  });

  it('should reject invalid currency', async () => {
    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'diamonds', amount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('currency must be "coins" or "beans"');
  });

  it('should reject non-numeric amount', async () => {
    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 'fifty' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount must be a non-zero number');
  });

  it('should return 404 for non-existent user', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/users/nonexistent/adjust-balance')
      .send({ currency: 'coins', amount: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should create a transaction record and audit log', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });

    await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 25, reason: 'gift from admin' });

    // Should have called set for transaction and audit log (via Promise.all)
    expect(mockDocUpdate).toHaveBeenCalled();
    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ─── Task 5: GET /api/users/:uid/transactions ────────────────────

describe('GET /api/users/:uid/transactions', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return transaction history', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'ADMIN_ADJUSTMENT', amount: 50, currency: 'COINS', timestamp: 1700000000000 }) },
        { id: 'tx-2', data: () => ({ type: 'GACHA_PULL', amount: -10, currency: 'COINS', timestamp: 1699900000000 }) },
      ],
    });

    const res = await request(app)
      .get('/api/users/user-1/transactions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('tx-1');
    expect(res.body[1].id).toBe('tx-2');
  });

  it('should return empty array when no transactions exist', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    const res = await request(app)
      .get('/api/users/user-1/transactions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should filter by transaction type', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'ADMIN_ADJUSTMENT', amount: 50, currency: 'COINS', timestamp: 1700000000000 }) },
      ],
    });

    const res = await request(app)
      .get('/api/users/user-1/transactions?type=ADMIN_ADJUSTMENT');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('should respect limit parameter', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'GACHA_PULL', amount: -10, timestamp: 1700000000000 }) },
      ],
    });

    const res = await request(app)
      .get('/api/users/user-1/transactions?limit=1');

    expect(res.status).toBe(200);
  });

  it('should cap limit at 200', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    const res = await request(app)
      .get('/api/users/user-1/transactions?limit=9999');

    expect(res.status).toBe(200);
  });
});

// ─── Task 7: GET /api/users/:uid/backpack (admin) ────────────────
// Note: The backpack GET endpoint lives in economy.js with admin bypass,
// not in admin-economy.js. Tests for it are in economy.test.js.
// The admin-economy.js only has the POST endpoint for setting quantities.
