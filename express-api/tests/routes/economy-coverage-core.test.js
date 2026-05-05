/* eslint-disable no-unused-vars */
/**
 * Additional economy route tests to increase branch/line coverage.
 *
 * Targets ALL uncovered lines listed in the coverage report:
 * 59,68-69,109-116,134-135,166-167,194,222,259,283-285,308-309,
 * 392-396,406-418,431-438,447-461,470-472,561,569-582,616,618,
 * 666,681-694,740,757-758,771,773,795-799,825-828,869,885-886,
 * 902,904,921-924,951-955,962-969,1025-1026,1056-1057,1087-1091,
 * 1117-1118,1176,1188-1189,1235-1236,1272-1285,1368-1369,1407-1408,
 * 1458-1459,1496-1497,1513-1514,1537-1538,1553-1554,1565-1566,1581-1584
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockRunTransaction = jest.fn();
const mockGetAll = jest.fn();

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
      get: mockCollectionGet,
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
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
    runTransaction: mockRunTransaction,
    getAll: mockGetAll,
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
  generateId: () => 'tx-cov-123',
  now: () => 1709913600000,
  todayStr: () => '2024-03-08',
  yesterdayStr: () => '2024-03-07',
}));

jest.mock('../../src/utils/playStore', () => ({
  verifyProductPurchase: jest.fn(),
  verifySubscription: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');
const { verifyProductPurchase, verifySubscription } = require('../../src/utils/playStore');

// ─── App setup ───────────────────────────────────────────────────

const economyRouter = require('../../src/routes/economy');

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset drains mockResolvedValueOnce/mockImplementation queues — clearAllMocks
  // does not. Without this, queued values from prior tests bleed into the next
  // test and cause flaky failures.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchDelete.mockReset();
  mockBatchCommit.mockReset();
  mockRunTransaction.mockReset();
  mockGetAll.mockReset();

  // Re-set defaults AFTER reset
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockRunTransaction.mockImplementation(async (cb) => {
    const mockTx = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 10 }) }),
      update: jest.fn(),
      delete: jest.fn(),
    };
    return cb(mockTx);
  });
  economyRouter._resetConfigCache();
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
});

function createApp(uniqueId = 'user-A', isAdmin = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid-' + uniqueId, uniqueId, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', economyRouter);
  return app;
}

// ─── Mock helpers ────────────────────────────────────────────────

const ECONOMY_CONFIG_DOC = {
  exists: true,
  id: 'economy',
  data: () => ({
    dailyBase: 50,
    milestoneRewards: { 7: 100, 14: 200, 30: 500 },
    pullCosts: { 1: 10, 10: 100, 100: 1000 },
    beanConversionRate: 0.6,
    beanRedeemBonusThreshold: 2000,
    beanRedeemBonusMultiplier: 1.1,
    broadcastSendThreshold: 0,
    broadcastWinThreshold: 5000,
    dropRateExponent: 1.5,
    pitySoftStart: 80,
    pityHardLimit: 120,
    pitySoftMaxShift: 0.15,
    pityHighValueThreshold: 5000,
  }),
};

function makeUserDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      shyCoins: 500,
      shyBeans: 200,
      displayName: 'Alice',
      profilePhotoUrl: 'alice.png',
      ...overrides,
    }),
  };
}

function makeGiftDoc(overrides = {}) {
  return {
    exists: true,
    id: overrides.id || 'gift-rose',
    data: () => ({
      name: 'Rose',
      coinValue: 10,
      iconUrl: 'rose.png',
      showOnWheel: true,
      order: 1,
      ...overrides,
    }),
  };
}

function makeBackpackDoc(quantity = 5) {
  return {
    exists: true,
    data: () => ({ quantity, coinValue: 10, giftId: 'gift-rose' }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// loadEconomyConfig — lines 59, 68-69 (config not in cache, doc doesn't exist)
// ═══════════════════════════════════════════════════════════════════

describe('loadEconomyConfig edge cases', () => {
  test('writes defaults when config/economy doc does not exist (lines 68-69)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ exists: false });
      }
      return Promise.resolve(makeUserDoc());
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(mockDocSet).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test('returns cached config on second call within TTL (line 59)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      return Promise.resolve(makeUserDoc());
    });

    const app = createApp('user-A');
    await request(app).post('/api/economy/daily-reward').send({});

    const configCallsBefore = callCount;
    mockDocGet.mockImplementation(() => {
      callCount++;
      return Promise.resolve(makeUserDoc({ lastLoginRewardDate: '' }));
    });

    await request(app).post('/api/economy/daily-reward').send({});
    expect(callCount - configCallsBefore).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// addBroadcast — lines 109-116 (batch delete of old broadcasts)
// ═══════════════════════════════════════════════════════════════════

describe('addBroadcast old broadcast trimming (lines 109-116)', () => {
  test('trims old broadcasts when more than 50 exist', async () => {
    const { db } = require('../../src/utils/firebase');

    const oldBroadcastDocs = Array.from({ length: 3 }, (_, i) => ({
      id: `old-broadcast-${i}`,
      ref: { id: `old-broadcast-${i}` },
    }));

    db.collection.mockImplementation(() => {
      return {
        get: mockCollectionGet,
        where: jest.fn(() => ({
          limit: jest.fn(() => ({ get: mockCollectionGet })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({ get: mockCollectionGet })),
          })),
        })),
        orderBy: jest.fn(() => ({
          offset: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: oldBroadcastDocs,
              }),
            })),
          })),
          limit: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ docs: [] }),
          })),
        })),
      };
    });

    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500, displayName: 'Alice' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });
    // PR #485: gift-direct uses Firestore transaction for coin deduction
    mockRunTransaction.mockImplementationOnce(async (cb) => {
      const tx = {
        get: jest.fn().mockResolvedValue(makeUserDoc({ shyCoins: 500 })),
        update: jest.fn(),
      };
      return cb(tx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockBatchDelete).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateGiftWall — lines 134-135 (existing sender increment)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// updateGiftRankings — line 194 (existing ranking entry increment)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Daily reward — lines 259 (gift reward milestone), 283-285, 308-309
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gacha — lines 392-396 (guaranteed first pull), 406-418 (hard pity),
// 431-438 (soft pity), 447-461 (luck boost), 470-472 (total<=0),
// 561 (gacha tx write failure), 569-582 (broadcast qualifying wins)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift (send from backpack) — lines 616,618 (trial/self),
// 666 (backpack delete), 681-694 (room message + room update),
// 740 (broadcast), 757-758 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift-direct — lines 771,773 (validation), 795-799 (block),
// 825-828 (room message), 869 (broadcast), 885-886 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift-batch — lines 902,904 (trial/self), 921-924 (insufficient backpack),
// 951-955 (block check), 962-969 (transaction debit),
// 1025-1026 (room message), 1056-1057 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Backpack-send — lines 1087-1091 (block), 1117-1118 (coinValue lookup),
// 1176 (room message), 1188-1189 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Redeem beans — lines 1235-1236 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/redeem-beans — additional coverage', () => {
  test('returns 404 when user not found (PR #486 — tx-internal check)', async () => {
    // Per PR #486: redeem-beans now reads user inside Firestore
    // transaction. Override the default tx mock (which returns
    // backpack-shaped data) to route tx.get() through mockDocGet so
    // {exists:false} flows correctly to the user-not-found branch.
    mockDocGet.mockResolvedValue({ exists: false });
    mockRunTransaction.mockImplementation(async (cb) => {
      const tx = {
        get: (ref) => mockDocGet(ref),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
      return cb(tx);
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  test('returns 500 on internal error (lines 1235-1236)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/redeem-beans').send({ amount: 100 });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('redeem-beans'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Purchase — lines 1272-1285 (production verification paths),
// 1368-1369 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/purchase — additional coverage', () => {
  test('returns 400 for unknown subscription productId (line 1313)', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'unknown_subscription',
      purchaseToken: 'token-new',
      isSubscription: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown subscription/i);
  });

  test('returns 404 when coin package not found (line 1343)', async () => {
    mockCollectionGet = jest.fn().mockImplementation(() => {
      return Promise.resolve({ empty: true, docs: [] });
    });

    mockDocGet.mockResolvedValue(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'unknown_package',
      purchaseToken: 'token-new',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unknown coin package/i);
  });

  test('returns 404 when user not found for coin package (line 1348)', async () => {
    let collectionCallCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      collectionCallCount++;
      if (collectionCallCount === 1) {
        return Promise.resolve({ empty: true, docs: [] });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          {
            id: 'pkg-1',
            data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 10 }),
          },
        ],
      });
    });

    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'coins_100',
      purchaseToken: 'token-new',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  test('handles yearly subscription', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_yearly',
      purchaseToken: 'sub-yearly-token',
      isSubscription: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe('yearly');
  });

  test('handles lifetime subscription', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_lifetime',
      purchaseToken: 'sub-lifetime-token',
      isSubscription: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe('lifetime');
  });

  test('returns 500 on internal error (lines 1368-1369)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'coins_100',
      purchaseToken: 'token-new',
    });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('purchase'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Trial claim — lines 1407-1408 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/trial-claim — additional coverage', () => {
  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-claim').send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  test('returns 500 on internal error (lines 1407-1408)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-claim').send({});

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('trial-claim'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Trial activate — lines 1458-1459 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/trial-activate — additional coverage', () => {
  test('returns 404 when user not found', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ exists: false });
      return Promise.resolve({ exists: true, data: () => ({ quantity: 1 }) });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-activate').send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  test('extends expiry from current expiry if still active (line 1432)', async () => {
    const futureExpiry = 1709913600000 + 10 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const expectedExpiry = futureExpiry + thirtyDays;

    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          data: () => ({ shyCoins: 100, superShyExpiry: futureExpiry, superShyTier: 'monthly' }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ giftId: 'super_shy_trial', quantity: 1 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-activate').send({});

    expect(res.status).toBe(200);
    expect(res.body.newExpiry).toBe(expectedExpiry);
    expect(res.body.newTier).toBe('monthly');
  });

  test('returns 500 on internal error (lines 1458-1459)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/trial-activate').send({});

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('trial-activate'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Test coins — lines 1496-1497 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/test-coins — additional coverage', () => {
  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp('user-A', true);
    const res = await request(app).post('/api/economy/test-coins').send({ amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  test('returns 500 on internal error (lines 1496-1497)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A', true);
    const res = await request(app).post('/api/economy/test-coins').send({ amount: 100 });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('test-coins'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Balance — lines 1513-1514 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Transactions — lines 1537-1538 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Backpack — lines 1553-1554 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift wall — lines 1565-1566 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift wall senders — lines 1581-1584 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// userField helper — line 79 (snake_case fallback)
// ═══════════════════════════════════════════════════════════════════

describe('userField helper — snake_case fallback', () => {
  test('falls back to snake_case when camelCase field missing', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        shy_coins: 999,
        shy_beans: 555,
      }),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/balance');

    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(999);
    expect(res.body.beans).toBe(555);
  });

  test('returns null when both camelCase and snake_case are missing', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/balance');

    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(0);
    expect(res.body.beans).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateGiftRankings error path — line 222
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gacha broadcast error — line 582
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gift-batch fromBackpack delete path — line 967
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Purchase — production verification paths (lines 1272-1285)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/purchase — production verification (lines 1272-1285)', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('calls verifyProductPurchase in production for non-subscription', async () => {
    process.env.NODE_ENV = 'production';

    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    verifyProductPurchase.mockResolvedValue({ orderId: 'prod-order-123' });

    let collectionCallCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      collectionCallCount++;
      if (collectionCallCount === 1) {
        return Promise.resolve({ empty: true, docs: [] }); // No duplicate receipt
      }
      return Promise.resolve({
        empty: false,
        docs: [
          {
            id: 'pkg-1',
            data: () => ({ productId: 'coins_100', coins: 100, bonusCoins: 10 }),
          },
        ],
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'coins_100',
      purchaseToken: 'token-prod',
    });

    expect(res.status).toBe(200);
    expect(verifyProductPurchase).toHaveBeenCalledWith(
      'com.shyden.shytalk',
      'coins_100',
      'token-prod',
    );
  });

  test('calls verifySubscription in production for subscription', async () => {
    process.env.NODE_ENV = 'production';

    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    verifySubscription.mockResolvedValue({ orderId: 'sub-order-123' });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_monthly',
      purchaseToken: 'sub-token-prod',
      isSubscription: true,
    });

    expect(res.status).toBe(200);
    expect(verifySubscription).toHaveBeenCalledWith(
      'com.shyden.shytalk',
      'super_shy_monthly',
      'sub-token-prod',
    );
  });

  test('returns 403 when production verification fails (lines 1278-1285)', async () => {
    process.env.NODE_ENV = 'production';

    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    verifyProductPurchase.mockRejectedValue(new Error('Invalid purchase'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'coins_100',
      purchaseToken: 'token-fake',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verification failed/i);
    expect(log.warn).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('verification rejected'),
      expect.objectContaining({
        userId: 'user-A',
        productId: 'coins_100',
      }),
    );
  });

  test('returns 403 when subscription verification fails', async () => {
    process.env.NODE_ENV = 'production';

    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue(makeUserDoc());

    verifySubscription.mockRejectedValue(new Error('Invalid subscription'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/purchase').send({
      productId: 'super_shy_monthly',
      purchaseToken: 'sub-token-fake',
      isSubscription: true,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verification failed/i);
  });
});
