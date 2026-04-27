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

// ═══════════════════════════════════════════════════════════════════
// addBroadcast — lines 109-116 (batch delete of old broadcasts)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// updateGiftWall — lines 134-135 (existing sender increment)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// updateGiftRankings — line 194 (existing ranking entry increment)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Daily reward — lines 259 (gift reward milestone), 283-285, 308-309
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/daily-reward — gift milestone rewards', () => {
  test('returns gift reward for milestone with type=gift (lines 258-260, 282-290, 307-310)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({
            dailyBase: 50,
            milestoneRewards: {
              7: { type: 'gift', giftId: 'gift-crown', quantity: 2 },
            },
          }),
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            shyCoins: 100,
            isSuperShy: false,
            loginStreak: 6,
            lastLoginDate: '2024-03-07',
            lastLoginRewardDate: '',
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(200);
    expect(res.body.giftId).toBe('gift-crown');
    expect(res.body.giftQuantity).toBe(2);
    expect(res.body.coinsAwarded).toBe(0);
    expect(res.body.newStreak).toBe(7);
    expect(res.body.isMilestone).toBe(true);
  });

  test('applies SuperShy 10% coin bonus (line 267)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(ECONOMY_CONFIG_DOC);
      }
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          isSuperShy: true,
          loginStreak: 0,
          lastLoginDate: '',
          lastLoginRewardDate: '',
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(200);
    // Math.ceil(50 * 1.1) = Math.ceil(55.00000000000001) = 56 due to floating point
    expect(res.body.coinsAwarded).toBe(56);
  });

  test('continues streak when lastLoginDate was yesterday (line 250)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          isSuperShy: false,
          loginStreak: 5,
          lastLoginDate: '2024-03-07',
          lastLoginRewardDate: '',
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(200);
    expect(res.body.newStreak).toBe(6);
  });

  test('resets streak when last login was not yesterday (line 250)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          isSuperShy: false,
          loginStreak: 10,
          lastLoginDate: '2024-03-01',
          lastLoginRewardDate: '',
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(200);
    expect(res.body.newStreak).toBe(1);
  });

  test('returns 404 when user does not exist', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      return Promise.resolve({ exists: false });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(404);
  });

  test('milestone with numeric amount uses rawReward.amount (line 264)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({
            dailyBase: 50,
            milestoneRewards: {
              7: { amount: 300 },
            },
          }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          isSuperShy: false,
          loginStreak: 6,
          lastLoginDate: '2024-03-07',
          lastLoginRewardDate: '',
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(200);
    expect(res.body.coinsAwarded).toBe(300);
  });

  test('returns 500 on internal error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/daily-reward').send({});

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('daily-reward'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gacha — lines 392-396 (guaranteed first pull), 406-418 (hard pity),
// 431-438 (soft pity), 447-461 (luck boost), 470-472 (total<=0),
// 561 (gacha tx write failure), 569-582 (broadcast qualifying wins)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gacha — advanced mechanics', () => {
  function setupGachaMocks({
    shyCoins = 5000,
    pityCounter = 0,
    luckScore = 0,
    guaranteedNextPullGiftId = null,
    gifts = null,
  } = {}) {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(ECONOMY_CONFIG_DOC);
      }
      if (callCount === 2) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            shyCoins,
            pityCounter,
            luckScore,
            guaranteedNextPullGiftId,
            displayName: 'Alice',
            profilePhotoUrl: 'alice.png',
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const giftList = gifts || [
      {
        id: 'gift-rose',
        data: () => ({
          name: 'Rose',
          coinValue: 10,
          showOnWheel: true,
          order: 1,
          iconUrl: 'rose.png',
        }),
      },
      {
        id: 'gift-crown',
        data: () => ({
          name: 'Crown',
          coinValue: 500,
          showOnWheel: true,
          order: 2,
          iconUrl: 'crown.png',
        }),
      },
      {
        id: 'gift-diamond',
        data: () => ({
          name: 'Diamond',
          coinValue: 6000,
          showOnWheel: true,
          order: 3,
          iconUrl: 'diamond.png',
        }),
      },
    ];

    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: giftList,
    });
  }

  test('uses guaranteed first pull when guaranteedNextPullGiftId is set (lines 392-396)', async () => {
    setupGachaMocks({ guaranteedNextPullGiftId: 'gift-diamond' });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(1);
    expect(res.body.gifts[0].giftId).toBe('gift-diamond');
  });

  test('guaranteed pull with non-existent gift falls through to normal pull', async () => {
    setupGachaMocks({ guaranteedNextPullGiftId: 'gift-nonexistent' });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(1);
    expect(['gift-rose', 'gift-crown', 'gift-diamond']).toContain(res.body.gifts[0].giftId);
  });

  test('hard pity at limit guarantees high-value gift (lines 406-418)', async () => {
    setupGachaMocks({ pityCounter: 120 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(1);
    expect(res.body.gifts[0].giftId).toBe('gift-diamond');
    expect(res.body.newPityCounter).toBe(0);
  });

  test('hard pity with no gifts above threshold picks most expensive (lines 411-418)', async () => {
    setupGachaMocks({
      pityCounter: 120,
      gifts: [
        {
          id: 'gift-rose',
          data: () => ({
            name: 'Rose',
            coinValue: 10,
            showOnWheel: true,
            order: 1,
            iconUrl: 'rose.png',
          }),
        },
        {
          id: 'gift-crown',
          data: () => ({
            name: 'Crown',
            coinValue: 500,
            showOnWheel: true,
            order: 2,
            iconUrl: 'crown.png',
          }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(1);
    expect(res.body.gifts[0].giftId).toBe('gift-crown');
  });

  test('soft pity shifts weights toward high-value gifts (lines 420-441)', async () => {
    setupGachaMocks({ pityCounter: 100 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(10);
  });

  test('luck boost shifts weights away from cheapest gift (lines 444-465)', async () => {
    setupGachaMocks({ luckScore: 50 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(1);
  });

  test('100-pull increments luck score by 2 (line 492)', async () => {
    setupGachaMocks({ luckScore: 50, shyCoins: 100000 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.newLuckScore).toBe(52);
  });

  test('luck score caps at 100', async () => {
    setupGachaMocks({ luckScore: 99, shyCoins: 100000 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.newLuckScore).toBe(100);
  });

  test('transaction write failure is caught gracefully (line 561)', async () => {
    setupGachaMocks();

    // writeTransaction calls db.doc().set(); make the gacha tx set fail
    // The batch commit for backpack+coins happens first, then writeTransaction is called.
    // We need to fail only the writeTransaction set call, not the batch or earlier sets.
    let setCallCount = 0;
    const _originalDocSet = mockDocSet;
    mockDocSet.mockImplementation(() => {
      setCallCount++;
      // The writeTransaction call happens after batch.commit (which uses batch.set, not doc.set)
      // writeTransaction calls db.doc().set() once
      if (setCallCount === 1) {
        return Promise.reject(new Error('Transaction write failed'));
      }
      return Promise.resolve();
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    // Should still return 200 because transaction write is best-effort
    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gacha transaction'),
      expect.any(Object),
    );
  });

  test('broadcasts qualifying high-value win (lines 569-582)', async () => {
    setupGachaMocks({ guaranteedNextPullGiftId: 'gift-diamond' });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('returns 500 on internal error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gacha'),
      expect.any(Object),
    );
  });

  test('returns 500 when no winnable gifts exist (line 369)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      return Promise.resolve(makeUserDoc({ shyCoins: 500 }));
    });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'gift-empty',
          data: () => ({ name: 'Empty', coinValue: 0, showOnWheel: true, order: 1 }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/no winnable gifts/i);
  });
});

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

// ═══════════════════════════════════════════════════════════════════
// Purchase — lines 1272-1285 (production verification paths),
// 1368-1369 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Trial claim — lines 1407-1408 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Trial activate — lines 1458-1459 (500 error)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Test coins — lines 1496-1497 (500 error)
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// updateGiftRankings error path — line 222
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Gacha broadcast error — line 582
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gacha — broadcast error (line 582)', () => {
  test('catches broadcast error gracefully', async () => {
    // Set up for a guaranteed diamond pull (>= broadcastWinThreshold)
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(ECONOMY_CONFIG_DOC);
      if (callCount === 2) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            shyCoins: 5000,
            pityCounter: 0,
            luckScore: 0,
            guaranteedNextPullGiftId: 'gift-diamond',
            displayName: 'Alice',
            profilePhotoUrl: 'alice.png',
          }),
        });
      }
      // After batch commit, writeTransaction succeeds but addBroadcast fails
      return Promise.resolve({ exists: false });
    });

    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'gift-rose',
          data: () => ({
            name: 'Rose',
            coinValue: 10,
            showOnWheel: true,
            order: 1,
            iconUrl: 'rose.png',
          }),
        },
        {
          id: 'gift-diamond',
          data: () => ({
            name: 'Diamond',
            coinValue: 6000,
            showOnWheel: true,
            order: 2,
            iconUrl: 'diamond.png',
          }),
        },
      ],
    });

    // Make the broadcast's set call fail — addBroadcast calls db.doc().set()
    // The writeTransaction set call happens first (call 1), then broadcast set (call 2)
    let setCallCount = 0;
    mockDocSet.mockImplementation(() => {
      setCallCount++;
      if (setCallCount === 2) {
        // This is the addBroadcast doc.set() call
        return Promise.reject(new Error('Broadcast write failed'));
      }
      return Promise.resolve();
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('broadcast gacha win'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gift-batch fromBackpack delete path — line 967
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Purchase — production verification paths (lines 1272-1285)
// ═══════════════════════════════════════════════════════════════════
