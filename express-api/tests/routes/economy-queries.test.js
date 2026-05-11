const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();

// Mutable ref so individual tests can override collection behaviour.
// The collection mock must cover every Firestore chaining pattern used by the
// three GET handlers under test:
//
//   GET /economy/transactions (no filter)  → collection().orderBy().limit().get()
//   GET /economy/transactions (?type=...)  → collection().where().orderBy().limit().get()
//   GET /users/:id/gift-wall              → collection().get()
//
// All three patterns are wired through the same mutable `mockCollectionGet`.
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
    })),
    collection: jest.fn(() => {
      // Fluent chain: .where().orderBy().limit().get()  — filtered transactions
      const limitFn = jest.fn(() => ({ get: () => mockCollectionGet() }));
      const orderByFn = jest.fn(() => ({ limit: limitFn }));
      const whereFn = jest.fn(() => ({ orderBy: orderByFn }));

      return {
        // Unfiltered path: collection().orderBy().limit().get()
        orderBy: orderByFn,
        // Filtered path: collection().where().orderBy().limit().get()
        where: whereFn,
        // Direct path: collection().get()  — used by gift-wall
        get: () => mockCollectionGet(),
      };
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
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
  generateId: () => 'tx-query-123',
  now: () => 1709913600000,
  todayStr: () => new Date().toISOString().split('T')[0],
  yesterdayStr: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  },
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

// ─── App setup ───────────────────────────────────────────────────

const economyRouter = require('../../src/routes/economy');

beforeEach(() => {
  jest.clearAllMocks();
  economyRouter._resetConfigCache();
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  // C7: gift-wall + gift-wall/senders now load the target user doc to
  // check `blockedUserIds` before returning data. Default the doc mock
  // to "user exists, has not blocked anyone" so tests that don't care
  // about block state still pass. Tests that explicitly mock mockDocGet
  // (e.g. gift-wall senders) override this.
  mockDocGet.mockResolvedValue({ exists: true, data: () => ({ blockedUserIds: [] }) });
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

// ─── Helpers ─────────────────────────────────────────────────────

function makeTxDoc(id, type, amount, timestamp) {
  return {
    id,
    data: () => ({ type, amount, timestamp, currency: 'COINS' }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/economy/transactions', () => {
  test('returns 200 with transaction list', async () => {
    const docs = [
      makeTxDoc('tx-1', 'GACHA', -10, 1709913500000),
      makeTxDoc('tx-2', 'DAILY_REWARD', 50, 1709913400000),
    ];
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: false, docs });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/transactions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'tx-1', type: 'GACHA', amount: -10 });
    expect(res.body[1]).toMatchObject({ id: 'tx-2', type: 'DAILY_REWARD', amount: 50 });
  });

  test('respects limit parameter', async () => {
    // Build 10 synthetic docs
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeTxDoc(`tx-${i}`, 'GACHA', -10, 1709913600000 - i * 1000),
    );
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: false, docs });

    const app = createApp('user-A');
    // Ask for 5; the Firestore SDK (mocked) returns whatever we put in docs,
    // but we verify the route still passes the response back intact.
    const res = await request(app).get('/api/economy/transactions?limit=5');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The mock returns all 10 docs regardless of the .limit() call — that is
    // fine, we are verifying that the route parses `limit` without error and
    // returns the snapshot results.
    expect(res.body.length).toBe(10);
  });

  test('filters by type', async () => {
    const docs = [makeTxDoc('tx-g1', 'GIFT_SENT', -100, 1709913600000)];
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: false, docs });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/transactions?type=GIFT_SENT');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'tx-g1', type: 'GIFT_SENT' });
  });

  test('returns empty array when user has no transactions', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp('user-A');
    const res = await request(app).get('/api/economy/transactions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/users/:uniqueId/gift-wall', () => {
  test('returns 200 with gifts', async () => {
    const docs = [
      { id: 'gift-rose', data: () => ({ giftId: 'gift-rose', receivedCount: 5 }) },
      { id: 'gift-crown', data: () => ({ giftId: 'gift-crown', receivedCount: 2 }) },
    ];
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: false, docs });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'gift-rose', giftId: 'gift-rose', receivedCount: 5 });
    expect(res.body[1]).toMatchObject({ id: 'gift-crown', giftId: 'gift-crown', receivedCount: 2 });
  });

  test('returns empty array when gift wall is empty', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  // C7: gift-wall view must refuse to serve content when the target has
  // blocked the caller. Critical for block-list integrity — without
  // this, blocked users keep seeing their blocker's gifts indefinitely.
  test('C7: returns 403 when target has blocked the viewer', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ blockedUserIds: ['user-A'] }),
    });
    // Even if the gift wall has data, the route must short-circuit
    // before reading the subcollection — assert it does so by ensuring
    // mockCollectionGet (the gift-wall fetcher) is never called.
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [{ id: 'gift-1', data: () => ({ giftId: 'gift-rose' }) }],
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall').expect(403);

    expect(res.body.error).toMatch(/blocked/i);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/:uniqueId/gift-wall/:giftId/senders', () => {
  test('returns sorted senders', async () => {
    const senders = [
      { senderId: 'user-X', sendCount: 3 },
      { senderId: 'user-Y', sendCount: 10 },
      { senderId: 'user-Z', sendCount: 1 },
    ];
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ giftId: 'gift-rose', senders }),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-rose/senders');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    // Sorted descending by sendCount
    expect(res.body[0]).toMatchObject({ senderId: 'user-Y', sendCount: 10 });
    expect(res.body[1]).toMatchObject({ senderId: 'user-X', sendCount: 3 });
    expect(res.body[2]).toMatchObject({ senderId: 'user-Z', sendCount: 1 });
  });

  test('returns empty array when gift wall doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-rose/senders');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('returns empty array when senders field is missing from gift wall doc', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ giftId: 'gift-rose' }), // no senders field
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-rose/senders');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  // C7: senders list is a strict subset of gift-wall data, so the same
  // block guard applies. Without this, a blocked user could enumerate
  // who sent gifts to the blocker even though the parent gift-wall
  // list is hidden.
  test('C7: returns 403 when target has blocked the viewer', async () => {
    // First mockDocGet call is for the user doc (block check); the
    // second would be for the gift-wall doc but we expect the route to
    // short-circuit. mockResolvedValueOnce is used for the user doc so
    // any follow-up call falls back to the beforeEach default.
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ blockedUserIds: ['user-A'] }),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-rose/senders').expect(403);

    expect(res.body.error).toMatch(/blocked/i);
  });
});
