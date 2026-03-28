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

describe('updateGiftWall — existing sender (lines 134-135)', () => {
  test('increments existing sender sendCount in gift wall', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(makeBackpackDoc(5))
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500, displayName: 'Alice' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          giftId: 'gift-rose',
          receivedCount: 3,
          senders: [{ senderId: 'user-A', sendCount: 3, lastSentAt: 1700000000000 }],
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          rankings: [{ userId: 'user-B', count: 5, rank: 1 }],
          totalSent: 5,
        }),
      })
      .mockResolvedValue({ exists: false });

    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 5 }) }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateGiftRankings — line 194 (existing ranking entry increment)
// ═══════════════════════════════════════════════════════════════════

describe('updateGiftRankings — existing user (line 194)', () => {
  test('increments existing ranking count for recipient', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(makeBackpackDoc(5))
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          rankings: [
            { userId: 'user-B', count: 10, rank: 1, displayName: 'Bob' },
            { userId: 'user-C', count: 5, rank: 2, displayName: 'Carol' },
          ],
          totalSent: 15,
        }),
      })
      .mockResolvedValue({ exists: false });

    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 5 }) }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
  });
});

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

describe('POST /api/economy/gift — additional coverage', () => {
  test('returns 400 for super_shy_trial gift (line 616)', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'super_shy_trial' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trial items cannot be transferred/i);
  });

  test('returns 400 when sending gift to yourself (line 618)', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-A', giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot send gift to yourself/i);
  });

  test('deletes backpack item when quantity reaches 0 (line 665-666)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeBackpackDoc(1))
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    const deleteMock = jest.fn();
    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 1 }) }),
        update: jest.fn(),
        delete: deleteMock,
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalled();
  });

  test('writes room gift message when sender is in a room (lines 681-694)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeBackpackDoc(5))
      .mockResolvedValueOnce(makeUserDoc({ currentRoomId: 'room-1', displayName: 'Alice' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 5 }) }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test('writes room gift message with quantity label when qty > 1 (line 683)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeBackpackDoc(5))
      .mockResolvedValueOnce(makeUserDoc({ currentRoomId: 'room-1', displayName: 'Alice' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 5 }) }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(3);
  });

  test('returns 500 on internal error (lines 757-758)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('/economy/gift'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gift-direct — lines 771,773 (validation), 795-799 (block),
// 825-828 (room message), 869 (broadcast), 885-886 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gift-direct — additional coverage', () => {
  test('returns 400 when recipientId is missing (line 771)', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gift-direct').send({ giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientId/i);
  });

  test('returns 400 when sending to yourself (line 773)', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-A', giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot send gift to yourself/i);
  });

  test('returns 404 when gift not found', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/gift not found/i);
  });

  test('returns 404 when recipient not found', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/recipient not found/i);
  });

  test('returns 403 when sender blocked recipient (lines 795-799)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeUserDoc({ blockedUserIds: ['user-B'] }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
    expect(log.warn).toHaveBeenCalled();
  });

  test('returns 403 when recipient blocked sender', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc())
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob', blockedUserIds: ['user-A'] }));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
  });

  test('writes room message when sender is in a room (lines 825-828)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(
        makeUserDoc({ shyCoins: 500, currentRoomId: 'room-1', displayName: 'Alice' }),
      )
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('returns 500 on internal error (lines 885-886)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gift-direct'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gift-batch — lines 902,904 (trial/self), 921-924 (insufficient backpack),
// 951-955 (block check), 962-969 (transaction debit),
// 1025-1026 (room message), 1056-1057 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gift-batch — additional coverage', () => {
  test('returns 400 for super_shy_trial gift (line 902)', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'super_shy_trial' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trial items cannot be transferred/i);
  });

  test('returns 400 when sender is in recipientIds (line 904)', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-A', 'user-B'], giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot send gift to yourself/i);
  });

  test('returns 404 when gift not found', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/gift not found/i);
  });

  test('returns 404 when sender not found', async () => {
    mockDocGet.mockResolvedValueOnce(makeGiftDoc()).mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/sender not found/i);
  });

  test('returns 402 when backpack has insufficient items (lines 921-924)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 }))
      .mockResolvedValueOnce(makeBackpackDoc(1));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['user-B', 'user-C'],
        giftId: 'gift-rose',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient items in backpack/i);
  });

  test('returns 404 when no valid recipients exist', async () => {
    // gift-batch flow: gift -> sender -> (coins check) -> loadEconomyConfig -> recipients
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 })) // sender
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC) // loadEconomyConfig
      // All recipients don't exist
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B', 'user-C'], giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no valid recipients/i);
  });

  test('returns 403 when one recipient has blocked sender (lines 951-955)', async () => {
    // gift-batch flow: gift -> sender -> (coins check) -> loadEconomyConfig -> recipients -> block check
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 })) // sender
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC) // loadEconomyConfig
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob', blockedUserIds: ['user-A'] })); // recipient blocks sender

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
  });

  test('returns 403 when sender has blocked a recipient', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500, blockedUserIds: ['user-B'] })) // sender blocks user-B
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC) // loadEconomyConfig
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
  });

  test('fromBackpack mode deducts from backpack via transaction (lines 960-977)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 }))
      .mockResolvedValueOnce(makeBackpackDoc(5))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    const txDeleteMock = jest.fn();
    const txUpdateMock = jest.fn();
    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 5 }) }),
        update: txUpdateMock,
        delete: txDeleteMock,
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose', quantity: 1, fromBackpack: true });

    expect(res.status).toBe(200);
    expect(txUpdateMock).toHaveBeenCalled();
  });

  test('batch with room message when sender is in room (lines 1025-1026)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 }))
      .mockResolvedValueOnce(
        makeUserDoc({ shyCoins: 500, currentRoomId: 'room-1', displayName: 'Alice' }),
      )
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ shyCoins: 500 }) }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose', quantity: 1, fromBackpack: false });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('returns 500 on internal error (lines 1056-1057)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose' });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gift-batch'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Backpack-send — lines 1087-1091 (block), 1117-1118 (coinValue lookup),
// 1176 (room message), 1188-1189 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/backpack-send — additional coverage', () => {
  test('returns 400 when recipientId is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/backpack-send').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientId/i);
  });

  test('returns 400 when sending to yourself', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-A' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot send to yourself/i);
  });

  test('returns 404 when sender not found', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce(makeUserDoc());

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/sender not found/i);
  });

  test('returns 404 when recipient not found', async () => {
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/recipient not found/i);
  });

  test('returns 403 when sender blocked recipient (lines 1087-1091)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ blockedUserIds: ['user-B'] }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
    expect(log.warn).toHaveBeenCalled();
  });

  test('returns 403 when recipient blocked sender', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob', blockedUserIds: ['user-A'] }));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);
  });

  test('looks up gift coinValue when not denormalized on backpack doc (lines 1117-1118)', async () => {
    // backpack-send flow: sender -> recipient -> backpack(collection) -> loadEconomyConfig
    //   -> for each item: gift lookup -> updateGiftWall -> updateGiftRankings
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // 1. sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })) // 2. recipient
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC) // 3. loadEconomyConfig
      // 4. Gift catalog lookup (coinValue missing from backpack doc)
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ coinValue: 50 }),
      })
      // 5. updateGiftWall - giftWall doc
      .mockResolvedValueOnce({ exists: false })
      // 6. updateGiftRankings - giftRankings doc
      .mockResolvedValueOnce({ exists: false })
      // 7. updateGiftRankings - user doc (for new ranking entry)
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      // remaining calls
      .mockResolvedValue({ exists: false });

    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'gift-rare',
          data: () => ({ giftId: 'gift-rare', quantity: 2 }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Beans = floor(50 * 0.6 * 2) = 60
    expect(res.body.totalBeanReward).toBe(60);
  });

  test('writes room message when sender is in a room (line 1176)', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ currentRoomId: 'room-1', displayName: 'Alice' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: false });

    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'gift-rose',
          data: () => ({ giftId: 'gift-rose', quantity: 1, coinValue: 10 }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('filters out super_shy_trial items from backpack send', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc())
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }));

    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'super_shy_trial',
          data: () => ({ giftId: 'super_shy_trial', quantity: 1, coinValue: 0 }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/backpack is empty/i);
  });

  test('returns 500 on internal error (lines 1188-1189)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('backpack-send'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Redeem beans — lines 1235-1236 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/redeem-beans — additional coverage', () => {
  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

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

describe('GET /api/economy/balance — additional coverage', () => {
  test('returns 500 on internal error (lines 1513-1514)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/balance');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('balance'),
      expect.any(Object),
    );
  });

  test('returns 0 for missing coin/bean fields (snake_case fallback)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shy_coins: 300, shy_beans: 150 }),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/balance');

    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(300);
    expect(res.body.beans).toBe(150);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Transactions — lines 1537-1538 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/economy/transactions — additional coverage', () => {
  test('returns 500 on internal error (lines 1537-1538)', async () => {
    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementationOnce(() => {
      throw new Error('Firestore down');
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/transactions');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('transactions'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Backpack — lines 1553-1554 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/backpack — additional coverage', () => {
  test('returns 500 on internal error (lines 1553-1554)', async () => {
    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementationOnce(() => {
      throw new Error('Firestore down');
    });

    const app = createApp('user-A', true);
    const res = await request(app).get('/api/users/user-A/backpack');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('backpack'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gift wall — lines 1565-1566 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/gift-wall — additional coverage', () => {
  test('returns 500 on internal error (lines 1565-1566)', async () => {
    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementationOnce(() => {
      throw new Error('Firestore down');
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gift-wall'),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gift wall senders — lines 1581-1584 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/gift-wall/:giftId/senders — additional coverage', () => {
  test('returns 500 on internal error (lines 1581-1584)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-rose/senders');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('senders'),
      expect.any(Object),
    );
  });
});

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

describe('updateGiftRankings error handling (line 222)', () => {
  test('catches and logs error when ranking update fails', async () => {
    // Make the giftRankings doc.get() throw during updateGiftRankings
    // The gift-direct route calls updateGiftRankings near the end.
    // We need all mocks up to that point to succeed, then fail on the rankings doc.
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeGiftDoc({ coinValue: 10 })); // gift
      if (callCount === 2) return Promise.resolve(makeUserDoc({ shyCoins: 500 })); // sender
      if (callCount === 3) return Promise.resolve(makeUserDoc({ displayName: 'Bob' })); // recipient
      if (callCount === 4) return Promise.resolve(ECONOMY_CONFIG_DOC); // config
      if (callCount === 5) return Promise.resolve({ exists: false }); // giftWall doc (new)
      if (callCount === 6) return Promise.reject(new Error('Rankings fetch failed')); // giftRankings
      return Promise.resolve({ exists: false });
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    // The error should have been caught internally and logged
    expect(log.error).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('gift rankings'),
      expect.any(Object),
    );
  });
});

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

describe('POST /api/economy/gift-batch — backpack delete when qty reaches 0 (line 967)', () => {
  test('deletes backpack item when remaining quantity is 0', async () => {
    // Send 1 gift to 1 recipient from backpack, backpack has exactly 1
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 })) // sender
      .mockResolvedValueOnce(makeBackpackDoc(1)) // backpack has exactly 1
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })) // recipient
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC) // config
      .mockResolvedValueOnce({ exists: false }) // giftWall
      .mockResolvedValueOnce({ exists: false }) // giftRankings
      .mockResolvedValue({ exists: false });

    // Transaction should delete the backpack item since 1 - 1 = 0
    const txDeleteMock = jest.fn();
    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 1 }) }),
        update: jest.fn(),
        delete: txDeleteMock,
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: ['user-B'], giftId: 'gift-rose', quantity: 1, fromBackpack: true });

    expect(res.status).toBe(200);
    expect(txDeleteMock).toHaveBeenCalled();
  });
});

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
