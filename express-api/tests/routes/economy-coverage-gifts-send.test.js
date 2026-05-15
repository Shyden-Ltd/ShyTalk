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
      // PR #492: addBroadcast uses count() aggregate (audit H5)
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
      })),
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
    // PR 9 — existence-hiding: byte-identical to the cross-cohort 404.
    expect(res.body).toEqual({ error: 'Not found' });
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
    // PR #485: gift-direct now wraps coin deduction in a Firestore
    // transaction. Tests must mock mockRunTransaction to return a tx
    // object with sufficient coins.
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
    // PR 9 — existence-hiding: the all-missing-recipients short-circuit
    // returns the same byte-identical body as the cross-cohort gate so
    // an attacker can't distinguish "none exist" from "≥1 cross-cohort".
    expect(res.body).toEqual({ error: 'Not found' });
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
    // PR 9 — existence-hiding: byte-identical to the cross-cohort 404.
    expect(res.body).toEqual({ error: 'Not found' });
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
