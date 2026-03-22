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
      get: mockCollectionGet,
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
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
  generateId: () => 'tx-gift-123',
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

const log = require('../../src/utils/log');

// ─── App setup ───────────────────────────────────────────────────

const economyRouter = require('../../src/routes/economy');

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  // Default transaction: succeeds (calls the callback with a mock transaction object)
  mockRunTransaction.mockImplementation(async (cb) => {
    const mockTx = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ quantity: 10 }) }),
      update: jest.fn(),
      delete: jest.fn(),
    };
    return cb(mockTx);
  });
  // Reset economy config cache so each test starts fresh
  economyRouter._resetConfigCache();
  // Reset collection mock to default (empty backpack)
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

// ─── Mock helpers ──────────────────────────────────────────────────────

/**
 * Economy config doc returned by db.doc('config/economy').get()
 */
const ECONOMY_CONFIG_DOC = {
  exists: true,
  id: 'economy',
  data: () => ({
    pullCosts: { 1: 10, 10: 100, 100: 1000 },
    beanConversionRate: 0.6,
    broadcastSendThreshold: 5000,
    broadcastWinThreshold: 5000,
  }),
};

/**
 * A standard gift doc.
 */
function makeGiftDoc(overrides = {}) {
  return {
    exists: true,
    id: 'gift-rose',
    data: () => ({
      name: 'Rose',
      coinValue: 10,
      iconUrl: 'rose.png',
      ...overrides,
    }),
  };
}

/**
 * A standard user doc.
 */
function makeUserDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      shyCoins: 500,
      shyBeans: 0,
      displayName: 'Alice',
      ...overrides,
    }),
  };
}

/**
 * A backpack doc with the given quantity.
 */
function makeBackpackDoc(quantity = 5) {
  return {
    exists: true,
    data: () => ({ quantity, coinValue: 10 }),
  };
}

// ─── POST /api/economy/gift (send from backpack) ──────────────────────

describe('POST /api/economy/gift', () => {
  // ── Validation ────────────────────────────────────────────────────

  test('returns 400 when recipientId is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gift').send({ giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientId/i);
  });

  test('returns 400 when giftId is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gift').send({ recipientId: 'user-B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/giftId/i);
  });

  // ── Preconditions ─────────────────────────────────────────────────

  test('returns 404 when gift not found', async () => {
    // gift not found, backpack present, sender present, recipient present
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // gift
      .mockResolvedValueOnce(makeBackpackDoc(5)) // backpack
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/gift not found/i);
  });

  test('returns 402 when backpack quantity is insufficient', async () => {
    // gift found, backpack has only 1 item, sender found, recipient found
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc()) // gift
      .mockResolvedValueOnce(makeBackpackDoc(1)) // backpack (qty=1)
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 5 }); // need 5, have 1

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient items in backpack/i);
  });

  test('returns 404 when recipient not found', async () => {
    // gift found, backpack ok, sender found, recipient NOT found
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc()) // gift
      .mockResolvedValueOnce(makeBackpackDoc(10)) // backpack
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce({ exists: false }); // recipient not found

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/recipient not found/i);
  });

  // ── Happy path ────────────────────────────────────────────────────

  test('returns 200 and decrements backpack on success', async () => {
    // gift found, backpack has 5, sender found, recipient found
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc()) // gift
      .mockResolvedValueOnce(makeBackpackDoc(5)) // backpack
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })) // recipient
      // config/economy (called by loadEconomyConfig)
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      // giftWall get (updateGiftWall)
      .mockResolvedValueOnce({ exists: false })
      // giftRankings get (updateGiftRankings)
      .mockResolvedValueOnce({ exists: false })
      // writeTransaction calls (set — returns undefined)
      .mockResolvedValue({ exists: false });

    // Transaction succeeds with qty=5
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
    expect(res.body.giftName).toBe('Rose');
    expect(res.body.quantity).toBe(1);
    expect(mockRunTransaction).toHaveBeenCalled();
  });
});

// ─── POST /api/economy/gift-direct (buy + send) ──────────────────────

describe('POST /api/economy/gift-direct', () => {
  // ── Insufficient coins ────────────────────────────────────────────

  test('returns 402 when sender has insufficient coins', async () => {
    // gift costs 100 coins, sender has only 50
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 100 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 50 })) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient coins/i);
  });

  // ── Happy path ────────────────────────────────────────────────────

  test('returns 200 and deducts coins on success', async () => {
    // gift costs 10 coins, sender has 500 coins
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 })) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })) // recipient
      // loadEconomyConfig
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      // updateGiftWall — giftWall doc
      .mockResolvedValueOnce({ exists: false })
      // updateGiftRankings — giftRankings doc
      .mockResolvedValueOnce({ exists: false })
      // writeTransaction calls
      .mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.coinsSpent).toBe(10);
    expect(res.body.giftName).toBe('Rose');
  });
});

// ─── POST /api/economy/gift-batch ────────────────────────────────────

describe('POST /api/economy/gift-batch', () => {
  // ── Validation ────────────────────────────────────────────────────

  test('returns 400 when recipientIds is not an array', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: 'user-B', giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientIds/i);
  });

  test('returns 400 when recipientIds is an empty array', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds: [], giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientIds/i);
  });

  test('returns 400 when recipientIds exceeds 50', async () => {
    const recipientIds = Array.from({ length: 51 }, (_, i) => `user-${i}`);
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({ recipientIds, giftId: 'gift-rose' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 50/i);
  });

  // ── Insufficient balance ──────────────────────────────────────────

  test('returns 402 when sender has insufficient coins (direct mode)', async () => {
    // gift costs 100 coins each, 3 recipients → 300 total, sender has only 50
    // The handler returns 402 after loading gift + sender, before fetching recipients
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 100 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 50 })); // sender (50 < 300 → 402)

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['user-B', 'user-C', 'user-D'],
        giftId: 'gift-rose',
        quantity: 1,
        fromBackpack: false,
      });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient coins/i);
  });

  // ── Happy path ────────────────────────────────────────────────────

  test('returns 200 with correct recipientCount on success', async () => {
    // gift costs 10 coins each, 2 recipients → 20 total, sender has 500
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc({ coinValue: 10 })) // gift
      .mockResolvedValueOnce(makeUserDoc({ shyCoins: 500 })) // sender
      // recipient existence checks (2 users via Promise.all)
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' }))
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Carol' }))
      // loadEconomyConfig
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      // per-recipient processing (updateGiftWall, updateGiftRankings, writeTransaction * 2 recipients * 3 calls each)
      .mockResolvedValue({ exists: false });

    // Transaction succeeds — deducts coins
    mockRunTransaction.mockImplementation(async (cb) => {
      const mockTx = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ shyCoins: 500 }),
        }),
        update: jest.fn(),
        delete: jest.fn(),
      };
      return cb(mockTx);
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['user-B', 'user-C'],
        giftId: 'gift-rose',
        quantity: 1,
        fromBackpack: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recipientCount).toBe(2);
    expect(res.body.giftName).toBe('Rose');
  });
});

// ─── POST /api/economy/backpack-send ─────────────────────────────────

describe('POST /api/economy/backpack-send', () => {
  // ── Validation / empty backpack ───────────────────────────────────

  test('returns 400 when backpack is empty', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    // collection().get() returns empty backpack
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/backpack is empty/i);
  });

  // ── Happy path ────────────────────────────────────────────────────

  test('returns 200 and clears entire backpack on success', async () => {
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // sender
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })) // recipient
      // loadEconomyConfig
      .mockResolvedValueOnce(ECONOMY_CONFIG_DOC)
      // updateGiftWall giftWall doc (for gift-rose item)
      .mockResolvedValueOnce({ exists: false })
      // updateGiftRankings giftRankings doc (for gift-rose item)
      .mockResolvedValueOnce({ exists: false })
      // writeTransaction calls
      .mockResolvedValue({ exists: false });

    // Backpack has one item with coinValue denormalized on doc
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'gift-rose',
          data: () => ({ giftId: 'gift-rose', quantity: 3, coinValue: 10 }),
        },
      ],
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalItemsSent).toBe(3);
    // Beans = floor(10 * 0.6 * 3) = 18
    expect(res.body.totalBeanReward).toBe(18);
    // Batch commit called to delete the backpack items
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});

// ─── Gift block audit logging ─────────────────────────────────────────

describe('POST /api/economy/gift — block audit logging', () => {
  test('logs warning when sender has blocked the recipient', async () => {
    // gift found, backpack has items, sender has blocked recipient, recipient found
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc()) // gift
      .mockResolvedValueOnce(makeBackpackDoc(5)) // backpack
      .mockResolvedValueOnce(makeUserDoc({ blockedUserIds: ['user-B'] })) // sender blocks recipient
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob' })); // recipient

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);

    // Verify log.warn was called with 'economy' source and 'Gift blocked' message
    expect(log.warn).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('Gift blocked'),
      expect.objectContaining({
        senderUniqueId: 'user-A',
        recipientUniqueId: 'user-B',
      }),
    );
  });

  test('logs warning when recipient has blocked the sender', async () => {
    // gift found, backpack has items, sender OK, recipient has blocked sender
    mockDocGet
      .mockResolvedValueOnce(makeGiftDoc()) // gift
      .mockResolvedValueOnce(makeBackpackDoc(5)) // backpack
      .mockResolvedValueOnce(makeUserDoc()) // sender (no blocks)
      .mockResolvedValueOnce(makeUserDoc({ displayName: 'Bob', blockedUserIds: ['user-A'] })); // recipient blocks sender

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-rose', quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/blocked users/i);

    expect(log.warn).toHaveBeenCalledWith(
      'economy',
      expect.stringContaining('Gift blocked'),
      expect.objectContaining({
        senderUniqueId: 'user-A',
        recipientUniqueId: 'user-B',
      }),
    );
  });
});
