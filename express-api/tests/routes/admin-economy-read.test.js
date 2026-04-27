/* eslint-disable no-unused-vars */
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

// ─── Task 4: POST /api/users/:uniqueId/adjust-balance ────────────────

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

// ══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/backpack
// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
// DELETE /api/users/:uniqueId/guarantee-next-pull
// ══════════════════════════════════════════════════════════════════
