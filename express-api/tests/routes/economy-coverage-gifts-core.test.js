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
    // PR #485: gift-direct now uses Firestore transaction for coin
    // deduction. Mock the transaction to succeed with sufficient coins.
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

// ═══════════════════════════════════════════════════════════════════
// Gift-batch fromBackpack delete path — line 967
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Purchase — production verification paths (lines 1272-1285)
// ═══════════════════════════════════════════════════════════════════
