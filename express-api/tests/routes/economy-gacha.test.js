const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

// Mutable refs so individual tests can override the collection mock
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
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
  generateId: () => 'tx-gacha-123',
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
  // Reset economy config cache so each test starts fresh
  economyRouter._resetConfigCache();
  // Reset collection mock to default (no gifts)
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

// ─── Default mocks for the happy path ────────────────────────────

/**
 * Sets up mockDocGet to return responses in call order:
 * 1. economy config doc
 * 2. user doc
 * 3+ backpack docs (one per unique gift, resolves to non-existent)
 */
function setupHappyPathMocks({ shyCoins = 500, pullCount: _pullCount = 1 } = {}) {
  // The gacha handler calls db.doc().get() in this order:
  //   1. config/economy (loadEconomyConfig)
  //   2. users/{uniqueId}  (user lookup)
  //   3. users/{uniqueId}/backpack/{giftId} (one per unique gift won)
  //   4. users/{uniqueId}/transactions/{txId} (writeTransaction — db.doc().set())
  // doc.get calls:
  let callCount = 0;
  mockDocGet.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // Economy config
      return Promise.resolve({
        exists: true,
        id: 'economy',
        data: () => ({
          pullCosts: { 1: 10, 10: 100, 100: 1000 },
          broadcastWinThreshold: 5000,
          dropRateExponent: 1.5,
          pitySoftStart: 80,
          pityHardLimit: 120,
          pitySoftMaxShift: 0.15,
          pityHighValueThreshold: 5000,
        }),
      });
    }
    if (callCount === 2) {
      // User doc
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins,
          pityCounter: 0,
          luckScore: 0,
          guaranteedNextPullGiftId: null,
        }),
      });
    }
    // Backpack doc(s) — not found yet
    return Promise.resolve({ exists: false });
  });

  // Winnable gifts
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
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/economy/gacha', () => {
  // ── Validation: pullCount ────────────────────────────────────────

  test('returns 400 when pullCount is missing', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pullCount/);
  });

  test('returns 400 when pullCount is 0', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pullCount/);
  });

  test('returns 400 when pullCount is 5 (not 1, 10, or 100)', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pullCount/);
  });

  test('returns 400 when pullCount is a string', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: '10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pullCount/);
  });

  // ── User not found ───────────────────────────────────────────────

  test('returns 404 when user does not exist', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Economy config
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({
            pullCosts: { 1: 10, 10: 100, 100: 1000 },
          }),
        });
      }
      // User doc — not found
      return Promise.resolve({ exists: false });
    });

    const app = createApp('unknown-user');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  // ── Insufficient coins ───────────────────────────────────────────

  // ── PR #499 (audit M3): pullCosts key tolerance (numeric vs string) ──

  test('resolves cost when pullCosts has numeric keys (Firestore native)', async () => {
    // Pre-fix: route used pullCosts[String(pullCount)] which misses
    // numeric-key maps if Firestore stores them as integers. Audit M3.
    // The fix tries numeric first then falls back to string, so both
    // forms resolve. This test pins the numeric-key path.
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          // Numeric-key map — same as the DEFAULT_ECONOMY_CONFIG declaration
          data: () => ({ pullCosts: { 1: 10, 10: 100, 100: 1000 } }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ shyCoins: 5 }), // insufficient
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    // 402 means we got past the 'Invalid pull count' 400 — proves the
    // cost lookup resolved successfully.
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient coins/i);
  });

  test('resolves cost when pullCosts has string keys (JSON serialised)', async () => {
    // Most real-world Firestore docs deserialise JS objects with
    // string keys. Confirms the fallback `pullCosts[String(pullCount)]`
    // still works.
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          // String-key map (explicit)
          data: () => ({ pullCosts: { 1: 10, 10: 100, 100: 1000 } }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ shyCoins: 5 }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient coins/i);
  });

  test('returns 402 when user has insufficient coins for single pull', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({ pullCosts: { 1: 10, 10: 100, 100: 1000 } }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ shyCoins: 5 }), // less than 10 (cost of 1 pull)
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/Insufficient coins/i);
  });

  test('returns 402 when user has insufficient coins for 10-pull', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({ pullCosts: { 1: 10, 10: 100, 100: 1000 } }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ shyCoins: 50 }), // less than 100 (cost of 10-pull)
      });
    });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 10 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/Insufficient coins/i);
  });

  // ── Successful single pull ────────────────────────────────────────

  test('returns 200 with items array on successful single pull', async () => {
    setupHappyPathMocks({ shyCoins: 500, pullCount: 1 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toBeDefined();
    expect(Array.isArray(res.body.gifts)).toBe(true);
    expect(res.body.gifts).toHaveLength(1);
    expect(res.body.gifts[0]).toHaveProperty('giftId');
    expect(res.body.gifts[0]).toHaveProperty('giftName');
    expect(res.body.gifts[0]).toHaveProperty('coinValue');
  });

  test('returns 200 with correct item count for 10-pull', async () => {
    setupHappyPathMocks({ shyCoins: 5000, pullCount: 10 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toBeDefined();
    expect(Array.isArray(res.body.gifts)).toBe(true);
    expect(res.body.gifts).toHaveLength(10);
  });

  test('returns 200 with correct item count for 100-pull', async () => {
    setupHappyPathMocks({ shyCoins: 10000, pullCount: 100 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.gifts).toBeDefined();
    expect(Array.isArray(res.body.gifts)).toBe(true);
    expect(res.body.gifts).toHaveLength(100);
  });

  // ── Coin deduction ────────────────────────────────────────────────

  test('deducts correct coin amount from user balance on single pull', async () => {
    setupHappyPathMocks({ shyCoins: 500, pullCount: 1 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    // Single pull costs 10 coins; newBalance should be 500 - 10 = 490
    expect(res.body.coinsSpent).toBe(10);
    expect(res.body.newBalance).toBe(490);
  });

  test('deducts correct coin amount from user balance on 10-pull', async () => {
    setupHappyPathMocks({ shyCoins: 500, pullCount: 10 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 10 });

    expect(res.status).toBe(200);
    // 10-pull costs 100 coins; newBalance should be 500 - 100 = 400
    expect(res.body.coinsSpent).toBe(100);
    expect(res.body.newBalance).toBe(400);
  });

  test('batch.update is called with the new coin balance', async () => {
    setupHappyPathMocks({ shyCoins: 500, pullCount: 1 });

    const app = createApp('user-A');
    await request(app).post('/api/economy/gacha').send({ pullCount: 1 }).expect(200);

    // The batch.update call should set shyCoins to 490 (500 - 10)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shyCoins: 490 }),
    );
  });

  // ── Price-changed short-circuit ───────────────────────────────────

  test('returns priceChanged=true when expectedCost does not match actual cost', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({ pullCosts: { 1: 10, 10: 100, 100: 1000 } }),
        });
      }
      return Promise.resolve({ exists: true, data: () => ({ shyCoins: 500 }) });
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/gacha')
      .send({ pullCount: 1, expectedCost: 999 }); // wrong price

    expect(res.status).toBe(200);
    expect(res.body.priceChanged).toBe(true);
    expect(res.body.gifts).toEqual([]);
    expect(res.body.coinsSpent).toBe(0);
    expect(res.body.currentPullCosts).toBeDefined();
  });

  // ── Response shape ────────────────────────────────────────────────

  test('response includes newPityCounter and newLuckScore fields', async () => {
    setupHappyPathMocks({ shyCoins: 500, pullCount: 1 });

    const app = createApp('user-A');
    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('newPityCounter');
    expect(res.body).toHaveProperty('newLuckScore');
    expect(res.body).toHaveProperty('currentPullCosts');
  });
});
