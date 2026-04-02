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
    req.auth = { uid: 'admin-1', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminEconomyRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/users/:uniqueId/luck', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should accept valid numeric luckScore', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({ luckScore: 50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept valid string numeric luckScore', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({ luckScore: '75' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject NaN luckScore', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({ luckScore: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('luckScore must be a number');
  });

  it('should reject NaN pityCounter', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({ pityCounter: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pityCounter must be a number');
  });

  it('should clamp luckScore between 0 and 100', async () => {
    await request(app).post('/api/users/user-1/luck').send({ luckScore: 200 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(100);
  });

  it('should clamp negative luckScore to 0', async () => {
    await request(app).post('/api/users/user-1/luck').send({ luckScore: -50 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(0);
  });

  it('should clamp negative pityCounter to 0', async () => {
    await request(app).post('/api/users/user-1/luck').send({ pityCounter: -10 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.pityCounter).toBe(0);
  });

  it('should return 400 when no fields provided', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No fields to update');
  });
});

// ─── Task 4: POST /api/users/:uniqueId/adjust-balance ────────────────

describe('POST /api/users/:uniqueId/adjust-balance', () => {
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

// ─── Task 5: GET /api/users/:uniqueId/transactions ────────────────────

describe('GET /api/users/:uniqueId/transactions', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return transaction history', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'tx-1',
          data: () => ({
            type: 'ADMIN_ADJUSTMENT',
            amount: 50,
            currency: 'COINS',
            timestamp: 1700000000000,
          }),
        },
        {
          id: 'tx-2',
          data: () => ({
            type: 'GACHA_PULL',
            amount: -10,
            currency: 'COINS',
            timestamp: 1699900000000,
          }),
        },
      ],
    });

    const res = await request(app).get('/api/users/user-1/transactions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('tx-1');
    expect(res.body[1].id).toBe('tx-2');
  });

  it('should return empty array when no transactions exist', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    const res = await request(app).get('/api/users/user-1/transactions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should filter by transaction type', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'tx-1',
          data: () => ({
            type: 'ADMIN_ADJUSTMENT',
            amount: 50,
            currency: 'COINS',
            timestamp: 1700000000000,
          }),
        },
      ],
    });

    const res = await request(app).get('/api/users/user-1/transactions?type=ADMIN_ADJUSTMENT');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('should respect limit parameter', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'GACHA_PULL', amount: -10, timestamp: 1700000000000 }) },
      ],
    });

    const res = await request(app).get('/api/users/user-1/transactions?limit=1');

    expect(res.status).toBe(200);
  });

  it('should cap limit at 200', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    const res = await request(app).get('/api/users/user-1/transactions?limit=9999');

    expect(res.status).toBe(200);
  });
});

// ─── Task 7: GET /api/users/:uniqueId/backpack (admin) ────────────────
// Note: The backpack GET endpoint lives in economy.js with admin bypass,
// not in admin-economy.js. Tests for it are in economy.test.js.
// The admin-economy.js only has the POST endpoint for setting quantities.

// ══════════════════════════════════════════════════════════════════
// Admin guard: all endpoints return 403 for non-admin users
// ══════════════════════════════════════════════════════════════════

describe('Admin guard: all admin-economy endpoints return 403 for non-admin', () => {
  const economyEndpoints = [
    ['GET', '/api/users/u1/economy'],
    ['POST', '/api/users/u1/adjust-balance'],
    ['POST', '/api/users/u1/backpack'],
    ['GET', '/api/users/u1/luck'],
    ['POST', '/api/users/u1/luck'],
    ['GET', '/api/users/u1/transactions'],
    ['GET', '/api/users/u1/guarantee-next-pull'],
    ['POST', '/api/users/u1/guarantee-next-pull'],
    ['DELETE', '/api/users/u1/guarantee-next-pull'],
  ];

  let app;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    const { requireAdmin } = require('../../src/middleware/auth');
    requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
  });

  test.each(economyEndpoints)('%s %s returns 403', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/economy
// ══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/economy', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should return economy snapshot for existing user', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        shyCoins: 100,
        shyBeans: 50,
        luckScore: 75,
        pityCounter: 3,
        isSuperShy: true,
        superShyExpiry: 1700000000000,
        superShyTier: 'GOLD',
        loginStreak: 7,
        lastLoginDate: '2025-03-01',
        guaranteedNextPullGiftId: 'gift-123',
      }),
    });

    const res = await request(app).get('/api/users/user-1/economy');

    expect(res.status).toBe(200);
    expect(res.body.shyCoins).toBe(100);
    expect(res.body.shyBeans).toBe(50);
    expect(res.body.luckScore).toBe(75);
    expect(res.body.pityCounter).toBe(3);
    expect(res.body.isSuperShy).toBe(true);
    expect(res.body.superShyTier).toBe('GOLD');
    expect(res.body.loginStreak).toBe(7);
    expect(res.body.guaranteedNextPullGiftId).toBe('gift-123');
  });

  it('should fall back to snake_case fields', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        shy_coins: 200,
        shy_beans: 80,
        luck_score: 40,
        pity_counter: 1,
        is_super_shy: false,
        super_shy_expiry: null,
        super_shy_tier: null,
        login_streak: 2,
        last_login_date: '2025-01-15',
        guaranteed_next_pull_gift_id: null,
      }),
    });

    const res = await request(app).get('/api/users/user-1/economy');

    expect(res.status).toBe(200);
    expect(res.body.shyCoins).toBe(200);
    expect(res.body.shyBeans).toBe(80);
    expect(res.body.luckScore).toBe(40);
    expect(res.body.pityCounter).toBe(1);
  });

  it('should return defaults when fields are missing', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    const res = await request(app).get('/api/users/user-1/economy');

    expect(res.status).toBe(200);
    expect(res.body.shyCoins).toBe(0);
    expect(res.body.shyBeans).toBe(0);
    expect(res.body.luckScore).toBe(0);
    expect(res.body.pityCounter).toBe(0);
    expect(res.body.isSuperShy).toBe(false);
    expect(res.body.superShyExpiry).toBeNull();
    expect(res.body.loginStreak).toBe(0);
    expect(res.body.guaranteedNextPullGiftId).toBeNull();
  });

  it('should return 404 for non-existent user', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).get('/api/users/nonexistent/economy');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore down'));

    const res = await request(app).get('/api/users/user-1/economy');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/adjust-balance — additional branches
// ══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/adjust-balance — additional branches', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should return 500 when Firestore update fails', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 10 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('should continue when system PM fails (non-blocking)', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });

    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should fall back to shy_coins when shyCoins is missing', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shy_coins: 300 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 50 });

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(350);
  });

  it('should fall back to shy_beans when shyBeans is missing', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shy_beans: 150 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'beans', amount: -50 });

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(100);
  });

  it('should generate default details when no reason is provided', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 25 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should NOT negate amount with operation=deduct when amount is already negative', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 500 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: -100, operation: 'deduct' });

    expect(res.status).toBe(200);
    // amount is already negative, operation=deduct only negates positive amounts
    expect(res.body.newBalance).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/backpack
// ══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/backpack', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should set backpack item with non-zero quantity', async () => {
    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocSet).toHaveBeenCalled();
  });

  it('should delete backpack item when quantity is 0', async () => {
    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocDelete).toHaveBeenCalled();
  });

  it('should reject missing giftId', async () => {
    const res = await request(app).post('/api/users/user-1/backpack').send({ quantity: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('giftId required');
  });

  it('should reject negative quantity', async () => {
    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity must be a non-negative number');
  });

  it('should reject non-numeric quantity', async () => {
    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 'many' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity must be a non-negative number');
  });

  it('should send system PM when not silent', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 3 });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalled();
  });

  it('should skip system PM when silent is true', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 3, silent: true });

    expect(res.status).toBe(200);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });

  it('should use giftName in PM when provided', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', giftName: 'Sparkly Rose', quantity: 2 });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith('user-1', expect.stringContaining('Sparkly Rose'));
  });

  it('should send removal PM when quantity is 0 and not silent', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', giftName: 'Broken Gift', quantity: 0 });

    expect(res.status).toBe(200);
    expect(sendSystemPm).toHaveBeenCalledWith('user-1', expect.stringContaining('removed'));
  });

  it('should handle system PM failure gracefully', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 1 });

    // Should still succeed — PM failure is non-blocking
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app)
      .post('/api/users/user-1/backpack')
      .send({ giftId: 'gift-1', quantity: 5 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/luck
// ══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/luck', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should return luck and pity for existing user', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ luckScore: 55, pityCounter: 8 }),
    });

    const res = await request(app).get('/api/users/user-1/luck');

    expect(res.status).toBe(200);
    expect(res.body.luckScore).toBe(55);
    expect(res.body.pityCounter).toBe(8);
  });

  it('should fall back to snake_case fields', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ luck_score: 30, pity_counter: 2 }),
    });

    const res = await request(app).get('/api/users/user-1/luck');

    expect(res.status).toBe(200);
    expect(res.body.luckScore).toBe(30);
    expect(res.body.pityCounter).toBe(2);
  });

  it('should return defaults when fields are missing', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    const res = await request(app).get('/api/users/user-1/luck');

    expect(res.status).toBe(200);
    expect(res.body.luckScore).toBe(0);
    expect(res.body.pityCounter).toBe(0);
  });

  it('should return 404 for non-existent user', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).get('/api/users/nonexistent/luck');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore down'));

    const res = await request(app).get('/api/users/user-1/luck');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/luck — additional branches
// ══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/luck — additional branches', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should accept both luckScore and pityCounter together', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 50, pityCounter: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(50);
    expect(updateCall?.pityCounter).toBe(10);
  });

  it('should return 500 when Firestore update fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app).post('/api/users/user-1/luck').send({ luckScore: 50 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('should skip null luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: null, pityCounter: 5 });

    expect(res.status).toBe(200);
    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBeUndefined();
    expect(updateCall?.pityCounter).toBe(5);
  });

  it('should skip undefined pityCounter', async () => {
    const res = await request(app).post('/api/users/user-1/luck').send({ luckScore: 60 });

    expect(res.status).toBe(200);
    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(60);
    expect(updateCall?.pityCounter).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/transactions — additional branches
// ══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/transactions — additional branches', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should return 500 when Firestore fails', async () => {
    mockCollectionGet.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app).get('/api/users/user-1/transactions');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('should default to limit 50 when limit is NaN', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    const res = await request(app).get('/api/users/user-1/transactions?limit=abc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should sort transactions by timestamp descending', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        { id: 'tx-old', data: () => ({ type: 'A', timestamp: 100 }) },
        { id: 'tx-new', data: () => ({ type: 'A', timestamp: 300 }) },
        { id: 'tx-mid', data: () => ({ type: 'A', timestamp: 200 }) },
      ],
    });

    const res = await request(app).get('/api/users/user-1/transactions');

    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('tx-new');
    expect(res.body[1].id).toBe('tx-mid');
    expect(res.body[2].id).toBe('tx-old');
  });
});

// ══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/guarantee-next-pull
// ══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/guarantee-next-pull', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should return active guarantee with gift details', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          guaranteedNextPullGiftId: 'gift-1',
          guaranteedNextPullSetAt: 1700000000000,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'gift-1',
        data: () => ({ name: 'Golden Rose', coinValue: 500, iconUrl: 'https://cdn/icon.png' }),
      });

    const res = await request(app).get('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.guaranteedGiftId).toBe('gift-1');
    expect(res.body.giftName).toBe('Golden Rose');
    expect(res.body.coinValue).toBe(500);
    expect(res.body.gift).toBeDefined();
    expect(res.body.gift.name).toBe('Golden Rose');
  });

  it('should return inactive when no guarantee is set', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    const res = await request(app).get('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(res.body.guaranteedGiftId).toBeNull();
    expect(res.body.gift).toBeNull();
  });

  it('should handle guarantee with non-existent gift', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ guaranteedNextPullGiftId: 'deleted-gift' }),
      })
      .mockResolvedValueOnce({ exists: false });

    const res = await request(app).get('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.gift).toBeNull();
  });

  it('should fall back to snake_case guaranteed_next_pull_gift_id', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ guaranteed_next_pull_gift_id: 'gift-2' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'gift-2',
        data: () => ({ name: 'Silver Star', coin_value: 200, icon_url: 'https://cdn/star.png' }),
      });

    const res = await request(app).get('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.guaranteedGiftId).toBe('gift-2');
    expect(res.body.gift.coinValue).toBe(200);
    expect(res.body.gift.iconUrl).toBe('https://cdn/star.png');
  });

  it('should return 404 for non-existent user', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).get('/api/users/nonexistent/guarantee-next-pull');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app).get('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/guarantee-next-pull
// ══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/guarantee-next-pull', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should set guarantee successfully when gift exists', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ name: 'Diamond Crown', coinValue: 1000 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/guarantee-next-pull')
      .send({ giftId: 'gift-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.giftName).toBe('Diamond Crown');
    expect(res.body.coinValue).toBe(1000);
    expect(mockDocUpdate).toHaveBeenCalled();
    expect(mockDocSet).toHaveBeenCalled();
  });

  it('should fall back to gift.giftName and coin_value', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ giftName: 'Rare Gem', coin_value: 300 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/guarantee-next-pull')
      .send({ giftId: 'gift-2' });

    expect(res.status).toBe(200);
    expect(res.body.giftName).toBe('Rare Gem');
    expect(res.body.coinValue).toBe(300);
  });

  it('should fall back to giftId when gift has no name', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    const res = await request(app)
      .post('/api/users/user-1/guarantee-next-pull')
      .send({ giftId: 'gift-3' });

    expect(res.status).toBe(200);
    expect(res.body.giftName).toBe('gift-3');
    expect(res.body.coinValue).toBe(0);
  });

  it('should return 400 when giftId is missing', async () => {
    const res = await request(app).post('/api/users/user-1/guarantee-next-pull').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('giftId required');
  });

  it('should return 404 when gift does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/users/user-1/guarantee-next-pull')
      .send({ giftId: 'nonexistent-gift' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Gift not found');
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app)
      .post('/api/users/user-1/guarantee-next-pull')
      .send({ giftId: 'gift-1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════
// DELETE /api/users/:uniqueId/guarantee-next-pull
// ══════════════════════════════════════════════════════════════════

describe('DELETE /api/users/:uniqueId/guarantee-next-pull', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('should revoke guarantee successfully', async () => {
    const res = await request(app).delete('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalled();
    expect(mockDocSet).toHaveBeenCalled();
  });

  it('should return 500 when Firestore fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app).delete('/api/users/user-1/guarantee-next-pull');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
