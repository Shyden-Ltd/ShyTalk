const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

// Mutable ref so individual tests can override the collection mock
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
      delete: mockDocDelete,
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: mockCollectionGet,
        })),
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: mockCollectionGet,
          })),
        })),
      })),
      orderBy: jest.fn(() => ({
        offset: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
          })),
        })),
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      })),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'tx-purchase-123',
  now: () => 1709913600000,
  todayStr: () => new Date().toISOString().split('T')[0],
  yesterdayStr: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  },
}));

// playStore is imported by economy.js; mock it so it doesn't require real credentials
jest.mock('../../src/utils/playStore', () => ({
  verifyProductPurchase: jest.fn(),
  verifySubscription: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const economyRouter = require('../../src/routes/economy');

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  // Reset economy config cache so each test starts fresh
  economyRouter._resetConfigCache();
  // Reset collection mock to default (empty)
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
});

function createApp(uniqueId = 'user-A') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid-' + uniqueId, uniqueId, token: { admin: false } };
    next();
  });
  app.use('/api', economyRouter);
  return app;
}

// ─── Economy config mock helper ──────────────────────────────────

function makeConfigDoc() {
  return {
    exists: true,
    id: 'economy',
    data: () => ({
      beanConversionRate: 0.6,
      beanRedeemBonusThreshold: 2000,
      beanRedeemBonusMultiplier: 1.1,
      pullCosts: { 1: 10, 10: 100, 100: 1000 },
    }),
  };
}

// ─── Tests: POST /api/economy/purchase ───────────────────────────

describe('POST /api/economy/purchase', () => {
  test('returns 400 when productId is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/purchase')
      .send({ purchaseToken: 'token-abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/productId/i);
  });

  test('returns 400 when purchaseToken is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({ productId: 'coins_100' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/purchaseToken/i);
  });

  test('returns 409 when purchaseToken is duplicate', async () => {
    // Collection query for purchaseReceipts returns an existing doc
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [{ id: 'receipt-existing', data: () => ({ purchaseToken: 'token-dup' }) }],
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/purchase')
      .send({ productId: 'coins_100', purchaseToken: 'token-dup' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already processed/i);
  });

  test('returns 200 and increments coins for coin package', async () => {
    // The purchase handler (non-subscription) does NOT call loadEconomyConfig.
    // db.doc().get() is only called once: for the user lookup (step 5).
    // Collection calls:
    //   1. purchaseReceipts.where(...).limit(1).get() → empty (no duplicate)
    //   2. coinPackages.where(...).limit(1).get() → package found
    let collectionCallCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      collectionCallCount++;
      if (collectionCallCount === 1) {
        // purchaseReceipts check — no duplicate
        return Promise.resolve({ empty: true, docs: [] });
      }
      // coinPackages — return the package
      return Promise.resolve({
        empty: false,
        docs: [
          {
            id: 'pkg-coins-100',
            data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 10 }),
          },
        ],
      });
    });

    // Only one doc.get() call: the user doc
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 500, shyBeans: 0 }),
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/purchase')
      .send({ productId: 'coins_100', purchaseToken: 'token-new' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.coinsAdded).toBe(110); // 100 + 10 bonus
    expect(res.body.newBalance).toBe(610); // 500 + 110
  });

  test('returns 200 and sets isSuperShy for subscription', async () => {
    // purchaseReceipts check — empty (no duplicate)
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    // Config doc for loadEconomyConfig
    mockDocGet.mockResolvedValue(makeConfigDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_monthly',
      purchaseToken: 'sub-token-new',
      isSubscription: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe('monthly');

    // db.doc().update() should have been called with isSuperShy: true
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ isSuperShy: true, superShyTier: 'monthly' }),
    );
  });
});

// ─── Tests: POST /api/economy/trial-claim ────────────────────────

describe('POST /api/economy/trial-claim', () => {
  test('returns 409 when trial already claimed', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 100, hasClaimedSuperShyTrial: true }),
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-claim').send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already claimed/i);
  });

  test('returns 200 and adds trial item to backpack', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 100, hasClaimedSuperShyTrial: false }),
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-claim').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Should update hasClaimedSuperShyTrial
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ hasClaimedSuperShyTrial: true }),
    );

    // Should write trial item to backpack
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        giftId: 'super_shy_trial',
        quantity: 1,
        giftName: 'Super Shy Trial',
      }),
    );
  });
});

// ─── Tests: POST /api/economy/trial-activate ─────────────────────

describe('POST /api/economy/trial-activate', () => {
  test('returns 402 when no trial item in backpack', async () => {
    // trial-activate calls Promise.all([userSnap, bpSnap])
    // Both use db.doc().get(); first returns user, second returns missing bp item
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // userSnap
        return Promise.resolve({
          exists: true,
          data: () => ({ shyCoins: 100, superShyExpiry: 0 }),
        });
      }
      // bpSnap — not found
      return Promise.resolve({ exists: false });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-activate').send({});

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/no trial item/i);
  });

  test('returns 200 and sets isSuperShy with expiry', async () => {
    const fixedNow = 1709913600000; // matches helpers mock: now() = 1709913600000
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const expectedExpiry = fixedNow + thirtyDays;

    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // userSnap
        return Promise.resolve({
          exists: true,
          data: () => ({ shyCoins: 100, superShyExpiry: 0, superShyTier: null }),
        });
      }
      // bpSnap — trial item present
      return Promise.resolve({
        exists: true,
        data: () => ({ giftId: 'super_shy_trial', quantity: 1 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-activate').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newTier).toBe('trial');
    expect(res.body.newExpiry).toBe(expectedExpiry);

    // Should update isSuperShy
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ isSuperShy: true, superShyTier: 'trial' }),
    );

    // Should delete the backpack item
    expect(mockDocDelete).toHaveBeenCalled();
  });
});

// ─── Tests: POST /api/economy/redeem-beans ────────────────────────

describe('POST /api/economy/redeem-beans', () => {
  test('returns 400 when amount is 0', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  test('returns 400 when amount is negative', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  test('returns 400 when amount is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  test('returns 402 when user has insufficient beans', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyBeans: 50, shyCoins: 100 }),
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 }); // user only has 50

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient beans/i);
  });

  test('returns 200 and converts beans to coins (no bonus below threshold)', async () => {
    // loadEconomyConfig calls db.doc().get() first (config), then user
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // User doc (redeem-beans reads user before config)
        return Promise.resolve({
          exists: true,
          data: () => ({ shyBeans: 500, shyCoins: 100 }),
        });
      }
      // Economy config (loadEconomyConfig)
      return Promise.resolve(makeConfigDoc());
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 }); // below beanRedeemBonusThreshold of 2000

    expect(res.status).toBe(200);
    expect(res.body.coinsReceived).toBe(100); // 1:1 below threshold
    expect(res.body.newCoinBalance).toBe(200); // 100 + 100
    expect(res.body.newBeanBalance).toBe(400); // 500 - 100
  });

  test('returns 200 and applies bonus multiplier above threshold', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // User doc
        return Promise.resolve({
          exists: true,
          data: () => ({ shyBeans: 5000, shyCoins: 0 }),
        });
      }
      // Economy config
      return Promise.resolve(makeConfigDoc());
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 2000 }); // at beanRedeemBonusThreshold (2000)

    expect(res.status).toBe(200);
    // 2000 * 1.1 = 2200 (floored)
    expect(res.body.coinsReceived).toBe(2200);
    expect(res.body.newCoinBalance).toBe(2200); // 0 + 2200
    expect(res.body.newBeanBalance).toBe(3000); // 5000 - 2000
  });

  test('calls db.doc().update() with correct bean/coin increments', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          data: () => ({ shyBeans: 200, shyCoins: 50 }),
        });
      }
      return Promise.resolve(makeConfigDoc());
    });

    const app = createApp('user-A');
    await request(app).post('/api/economy/redeem-beans').send({ amount: 50 }).expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        shyBeans: 'increment(-50)',
        shyCoins: 'increment(50)',
      }),
    );
  });
});
