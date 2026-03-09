const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

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
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
          })),
        })),
      })),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      })),
    })),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  FieldValue: {
    increment: jest.fn(n => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'tx-123',
  now: () => 1709913600000,
  todayStr: () => '2026-03-08',
  yesterdayStr: () => '2026-03-07',
}));

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the in-memory economy config cache between tests
  economyRouter._resetConfigCache();
});

// ─── App setup ───────────────────────────────────────────────────

const economyRouter = require('../../src/routes/economy');
const { requireAdmin } = require('../../src/middleware/auth');

function createApp(uid = 'user-A', isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', economyRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/economy/test-coins', () => {
  test('requires admin access', async () => {
    // Make requireAdmin block the request AND send the 403 response
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp('user-A', false);
    const res = await request(app)
      .post('/api/economy/test-coins')
      .send({ amount: 1000 });

    expect(res.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalled();
  });

  test('allows admin to add test coins', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 500 }),
    });

    const app = createApp('admin-user', true);
    const res = await request(app)
      .post('/api/economy/test-coins')
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.coinsAdded).toBe(1000);
    expect(res.body.newBalance).toBe(1500);
  });

  test('rejects invalid amount', async () => {
    const app = createApp('admin-user', true);

    await request(app)
      .post('/api/economy/test-coins')
      .send({ amount: 0 })
      .expect(400);

    await request(app)
      .post('/api/economy/test-coins')
      .send({ amount: 200000 })
      .expect(400);

    await request(app)
      .post('/api/economy/test-coins')
      .send({ amount: -100 })
      .expect(400);
  });
});

describe('POST /api/economy/daily-reward', () => {
  test('claims daily reward successfully', async () => {
    // First call: economy config check
    // Second call: user doc
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Economy config
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({
            dailyBase: 50,
            milestoneRewards: {},
          }),
        });
      }
      // User doc
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          isSuperShy: false,
          loginStreak: 0,
          lastLoginDate: '',
          lastLoginRewardDate: '',
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/daily-reward')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.coinsAwarded).toBe(50);
    expect(res.body.newStreak).toBe(1);
  });

  test('rejects double-claim', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          exists: true,
          id: 'economy',
          data: () => ({ dailyBase: 50, milestoneRewards: {} }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({
          shyCoins: 100,
          lastLoginRewardDate: '2026-03-08', // already claimed today
        }),
      });
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/economy/daily-reward')
      .send({});

    expect(res.status).toBe(409);
  });
});

describe('GET /api/economy/balance', () => {
  test('returns coin and bean balance', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ shyCoins: 500, shyBeans: 200 }),
    });

    const app = createApp('user-A');
    const res = await request(app)
      .get('/api/economy/balance')
      .expect(200);

    expect(res.body.coins).toBe(500);
    expect(res.body.beans).toBe(200);
  });

  test('returns 404 for non-existent user', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp('user-A');
    await request(app)
      .get('/api/economy/balance')
      .expect(404);
  });
});

describe('GET /api/users/:uid/backpack', () => {
  test('allows owner to read their own backpack', async () => {
    const { db } = require('../../src/utils/firebase');
    db.collection.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({
        docs: [
          { id: 'gift-1', data: () => ({ quantity: 3, lastAcquired: 1700000000000 }) },
        ],
      }),
    });

    const app = createApp('user-A');
    const res = await request(app)
      .get('/api/users/user-A/backpack')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('gift-1');
  });

  test('rejects access to another user backpack for non-admin', async () => {
    const app = createApp('user-A', false);
    const res = await request(app)
      .get('/api/users/user-B/backpack')
      .expect(403);

    expect(res.body.error).toMatch(/Cannot access/);
  });

  test('allows admin to access another user backpack', async () => {
    const { db } = require('../../src/utils/firebase');
    db.collection.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({
        docs: [
          { id: 'gift-rose', data: () => ({ giftId: 'gift-rose', quantity: 5, lastAcquired: 1700000000000 }) },
          { id: 'gift-crown', data: () => ({ giftId: 'gift-crown', quantity: 2, lastAcquired: 1699900000000 }) },
        ],
      }),
    });

    const app = createApp('admin-1', true);
    const res = await request(app)
      .get('/api/users/user-B/backpack')
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].giftId).toBe('gift-rose');
    expect(res.body[1].giftId).toBe('gift-crown');
  });
});
