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
const mockRunTransaction = jest.fn();

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
    runTransaction: mockRunTransaction,
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

// appleStore likewise — iOS purchase verification needs Apple root certs
// in production; tests stay decoupled from real cert files.
jest.mock('../../src/utils/appleStore', () => ({
  verifyApplePurchase: jest.fn(),
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
  // Default transaction: invokes the callback with a mock tx whose
  // get() resolves the same value mockDocGet would resolve (test
  // tests configure mockDocGet sequence; the tx reuses it). Tests
  // that need a different value inside-tx (e.g., race-coverage tests)
  // override mockRunTransaction explicitly.
  mockRunTransaction.mockImplementation(async (cb) => {
    const tx = {
      get: (ref) => mockDocGet(ref),
      update: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };
    return cb(tx);
  });
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

  // ── All subscription tiers ──

  test.each([
    ['super_shy_monthly', 'monthly', 30],
    ['super_shy_yearly', 'yearly', 365],
    ['super_shy_lifetime', 'lifetime', null],
  ])('subscription %s sets tier=%s with %s day expiry', async (productId, tier, days) => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeConfigDoc());

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/purchase')
      .send({
        productId,
        purchaseToken: `sub-token-${productId}`,
        isSubscription: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe(tier);

    const expectedExpiry = days ? 1709913600000 + days * 86400000 : null;
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuperShy: true,
        superShyTier: tier,
        superShyExpiry: expectedExpiry,
      }),
    );
  });

  test('returns 400 for unknown subscription productId', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeConfigDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_invalid',
      purchaseToken: 'sub-token-invalid',
      isSubscription: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown subscription/i);
  });

  // ── Coin packages of varying sizes ──

  test.each([
    { productId: 'coins_100', coins: 100, bonusCoins: 0, expectedTotal: 100 },
    { productId: 'coins_500', coins: 500, bonusCoins: 50, expectedTotal: 550 },
    { productId: 'coins_1000', coins: 1000, bonusCoins: 150, expectedTotal: 1150 },
    { productId: 'coins_5000', coins: 5000, bonusCoins: 1000, expectedTotal: 6000 },
    { productId: 'coins_10000', coins: 10000, bonusCoins: 3000, expectedTotal: 13000 },
    { productId: 'coins_50000', coins: 50000, bonusCoins: 20000, expectedTotal: 70000 },
  ])(
    'purchases $productId ($coins + $bonusCoins bonus = $expectedTotal)',
    async ({ productId, coins, bonusCoins, expectedTotal }) => {
      let collectionCallCount = 0;
      mockCollectionGet = jest.fn().mockImplementation(() => {
        collectionCallCount++;
        if (collectionCallCount === 1) {
          return Promise.resolve({ empty: true, docs: [] }); // no duplicate
        }
        return Promise.resolve({
          empty: false,
          docs: [{ id: `pkg-${productId}`, data: () => ({ productId, coins, bonusCoins }) }],
        });
      });

      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ shyCoins: 0, shyBeans: 0 }),
      });

      const app = createApp('user-A');
      const res = await request(app)
        .post('/api/economy/purchase')
        .send({ productId, purchaseToken: `token-${productId}` });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.coinsAdded).toBe(expectedTotal);
      expect(res.body.newBalance).toBe(expectedTotal);
    },
  );

  test('returns 404 for unknown coin package productId', async () => {
    let collectionCallCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      collectionCallCount++;
      if (collectionCallCount === 1) {
        return Promise.resolve({ empty: true, docs: [] }); // no duplicate
      }
      return Promise.resolve({ empty: true, docs: [] }); // no package found
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/purchase')
      .send({ productId: 'coins_nonexistent', purchaseToken: 'token-none' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unknown coin package/i);
  });

  test('stores purchase receipt with orderId', async () => {
    let collectionCallCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      collectionCallCount++;
      if (collectionCallCount === 1) {
        return Promise.resolve({ empty: true, docs: [] });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: 'pkg-100', data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 0 }) },
        ],
      });
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 0, shyBeans: 0 }),
    });

    const app = createApp('user-A');
    await request(app)
      .post('/api/economy/purchase')
      .send({ productId: 'coins_100', purchaseToken: 'receipt-token' })
      .expect(200);

    // Verify receipt stored
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-A',
        productId: 'coins_100',
        purchaseToken: 'receipt-token',
        platform: 'google',
        verified: true,
      }),
    );
  });

  // ─── Apple / iOS branch ────────────────────────────────────────

  describe('platform=apple branch', () => {
    const { verifyApplePurchase } = require('../../src/utils/appleStore');
    const { verifyProductPurchase } = require('../../src/utils/playStore');

    test('routes consumable purchase through verifyApplePurchase, NOT playStore', async () => {
      let collectionCallCount = 0;
      mockCollectionGet = jest.fn().mockImplementation(() => {
        collectionCallCount++;
        if (collectionCallCount === 1) return Promise.resolve({ empty: true, docs: [] });
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'pkg-100',
              data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 0 }),
            },
          ],
        });
      });
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({ shyCoins: 0, shyBeans: 0 }) });

      // Force production branch — non-prod skips verification entirely.
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      verifyApplePurchase.mockResolvedValueOnce({
        orderId: '2000000123456789',
        productId: 'coins_100',
        purchaseDate: 1700000000000,
      });

      try {
        const app = createApp('user-A');
        const res = await request(app).post('/api/economy/purchase').send({
          productId: 'coins_100',
          purchaseToken: 'mock-jws-payload',
          platform: 'apple',
        });
        expect(res.status).toBe(200);
        expect(verifyApplePurchase).toHaveBeenCalledWith('coins_100', 'mock-jws-payload', false);
        expect(verifyProductPurchase).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('records platform: apple on the purchaseReceipts doc', async () => {
      let collectionCallCount = 0;
      mockCollectionGet = jest.fn().mockImplementation(() => {
        collectionCallCount++;
        if (collectionCallCount === 1) return Promise.resolve({ empty: true, docs: [] });
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'pkg-100',
              data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 0 }),
            },
          ],
        });
      });
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({ shyCoins: 0, shyBeans: 0 }) });

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      verifyApplePurchase.mockResolvedValueOnce({
        orderId: '2000000abcdef',
        productId: 'coins_100',
        purchaseDate: 1700000000000,
      });

      try {
        const app = createApp('user-A');
        await request(app)
          .post('/api/economy/purchase')
          .send({
            productId: 'coins_100',
            purchaseToken: 'mock-jws',
            platform: 'apple',
          })
          .expect(200);

        // Refund handler reads coinsGranted/bonusCoinsGranted from this
        // receipt at refund time — assert they're persisted so a future
        // economy.js refactor can't silently break the refund path.
        expect(mockDocSet).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'apple',
            orderId: '2000000abcdef',
            coinsGranted: 100,
            bonusCoinsGranted: 0,
            isSubscription: false,
          }),
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('subscription receipt persists tierGranted + daysGranted for refund handler', async () => {
      mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({ shyCoins: 0, shyBeans: 0 }) });

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      verifyApplePurchase.mockResolvedValueOnce({
        orderId: '2000000sub-monthly',
        productId: 'super_shy_monthly',
        purchaseDate: 1700000000000,
      });

      try {
        const app = createApp('user-A');
        await request(app)
          .post('/api/economy/purchase')
          .send({
            productId: 'super_shy_monthly',
            purchaseToken: 'mock-jws-sub',
            platform: 'apple',
            isSubscription: true,
          })
          .expect(200);

        expect(mockDocSet).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'apple',
            orderId: '2000000sub-monthly',
            isSubscription: true,
            tierGranted: 'monthly',
            daysGranted: 30,
          }),
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('returns 403 when verifyApplePurchase rejects (e.g. revoked transaction)', async () => {
      mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      verifyApplePurchase.mockRejectedValueOnce(new Error('Apple transaction revoked'));

      try {
        const app = createApp('user-A');
        const res = await request(app).post('/api/economy/purchase').send({
          productId: 'coins_100',
          purchaseToken: 'mock-jws',
          platform: 'apple',
        });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/verification failed/i);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('routes subscription through verifyApplePurchase with isSubscription=true', async () => {
      mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      verifyApplePurchase.mockResolvedValueOnce({
        orderId: '2000000sub',
        productId: 'super_shy_monthly',
        purchaseDate: 1700000000000,
        expiresDate: 1700000000000 + 30 * 86400000,
      });

      try {
        const app = createApp('user-A');
        await request(app)
          .post('/api/economy/purchase')
          .send({
            productId: 'super_shy_monthly',
            purchaseToken: 'mock-jws-sub',
            platform: 'apple',
            isSubscription: true,
          })
          .expect(200);

        expect(verifyApplePurchase).toHaveBeenCalledWith('super_shy_monthly', 'mock-jws-sub', true);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
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

  // PR #486: redeem-beans now uses Firestore transaction. The route
  // loads economy config FIRST, then enters the transaction which
  // does the user read+update atomically. Test mock order: call 1 =
  // config doc, subsequent calls = user doc (via tx.get).

  test('returns 402 when user has insufficient beans (race-safe via tx)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc()); // config
      // tx.get(userRef) — user has 50 beans, requesting 100
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: 50, shyCoins: 100 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient beans/i);
  });

  test('returns 200 and converts beans to coins (no bonus below threshold)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc()); // config first
      // tx.get(userRef)
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: 500, shyCoins: 100 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 }); // below 2000 threshold

    expect(res.status).toBe(200);
    expect(res.body.coinsReceived).toBe(100); // 1:1 below threshold
    expect(res.body.newCoinBalance).toBe(200); // 100 + 100
    expect(res.body.newBeanBalance).toBe(400); // 500 - 100
  });

  test('returns 200 and applies bonus multiplier above threshold', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc());
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: 5000, shyCoins: 0 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.coinsReceived).toBe(2200);
    expect(res.body.newCoinBalance).toBe(2200);
    expect(res.body.newBeanBalance).toBe(3000);
  });

  test('calls update with correct bean/coin increments inside transaction', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc());
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: 200, shyCoins: 50 }),
      });
    });
    // Capture the tx.update call
    const txUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (cb) => {
      const tx = {
        get: (ref) => mockDocGet(ref),
        update: txUpdate,
        set: jest.fn(),
        delete: jest.fn(),
      };
      return cb(tx);
    });

    const app = createApp('user-A');
    await request(app).post('/api/economy/redeem-beans').send({ amount: 50 }).expect(200);

    expect(txUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shyBeans: 'increment(-50)',
        shyCoins: 'increment(50)',
      }),
    );
  });

  // ── Race condition coverage (PR #486 audit C2) ────────────────────

  test('aborts when concurrent redeem empties balance between outer calc and tx read', async () => {
    // loadEconomyConfig returns normal config; tx.get sees 0 beans
    // (a concurrent redeem has emptied them). Tx must throw, route 402.
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc());
      // Fresh tx read sees 0 beans (concurrent redeem won the race)
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: 0, shyCoins: 100 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient beans/i);
  });

  test('returns 404 when user doc does not exist (tx-internal check)', async () => {
    // The tx.get returns a non-existent doc. Tx throws 'User not found'
    // and the route maps to 404.
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc());
      return Promise.resolve({ exists: false });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  // ── All preset redemption amounts (matching UI buttons) ──

  test.each([
    { amount: 100, beanBalance: 500, expectedCoins: 100 },
    { amount: 500, beanBalance: 1000, expectedCoins: 500 },
    { amount: 1000, beanBalance: 3000, expectedCoins: 1000 },
    { amount: 2000, beanBalance: 5000, expectedCoins: 2200 },
    { amount: 5000, beanBalance: 10000, expectedCoins: 5500 },
  ])(
    'redeems $amount beans → $expectedCoins coins',
    async ({ amount, beanBalance, expectedCoins }) => {
      let callCount = 0;
      mockDocGet.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(makeConfigDoc()); // config first
        return Promise.resolve({
          exists: true,
          data: () => ({ shyBeans: beanBalance, shyCoins: 0 }),
        });
      });

      const app = createApp('user-A');
      const res = await request(app).post('/api/economy/redeem-beans').send({ amount });

      expect(res.status).toBe(200);
      expect(res.body.coinsReceived).toBe(expectedCoins);
      expect(res.body.newBeanBalance).toBe(beanBalance - amount);
      expect(res.body.newCoinBalance).toBe(expectedCoins);
    },
  );

  test('redeems full balance (simulating "Redeem All" button)', async () => {
    const fullBalance = 7500;
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeConfigDoc());
      return Promise.resolve({
        exists: true,
        data: () => ({ shyBeans: fullBalance, shyCoins: 200 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: fullBalance });

    expect(res.status).toBe(200);
    // 7500 >= 2000 threshold → bonus: floor(7500 * 1.1) = 8250
    expect(res.body.coinsReceived).toBe(8250);
    expect(res.body.newBeanBalance).toBe(0);
    expect(res.body.newCoinBalance).toBe(8450); // 200 + 8250
  });
});
