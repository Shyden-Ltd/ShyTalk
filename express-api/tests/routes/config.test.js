const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      get: mockCollectionGet,
      where: jest.fn(() => ({
        get: mockCollectionGet,
        orderBy: jest.fn(() => ({
          get: mockCollectionGet,
        })),
      })),
      orderBy: jest.fn((..._args) => {
        // Support chaining: orderBy().limit() for broadcasts
        return {
          get: mockCollectionGet,
          limit: jest.fn(() => ({
            get: mockCollectionGet,
          })),
        };
      }),
    })),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // default: allow admin
}));

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const configRouter = require('../../src/routes/config');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'user-A', token: { admin: true } };
    next();
  });
  // Mount at /api — same as production index.js
  app.use('/api', configRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/config/:key', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'app',
      data: () => ({ minVersionCode: 1, latestVersionCode: 2 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/app');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.minVersionCode).toBe(1);
  });

  test('returns defaults for app config when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/config/app').expect(200);

    expect(res.body.minVersionCode).toBe(1);
    expect(res.body.latestVersionCode).toBe(1);
  });

  test('returns defaults and seeds economy config when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/config/economy').expect(200);

    expect(res.body.beanConversionRate).toBe(0.6);
    expect(res.body.dailyBase).toBe(50);
    // Should have seeded the doc
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('returns 404 for unknown config key when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    await request(app).get('/api/config/unknown').expect(404);
  });

  test('strips Firestore doc id from response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'app',
      data: () => ({ minVersionCode: 5 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/app').expect(200);

    expect(res.body.id).toBeUndefined();
    expect(res.body.minVersionCode).toBe(5);
  });
});

describe('PUT /api/config/:key', () => {
  test('returns 403 for non-admin', async () => {
    const { requireAdmin } = require('../../src/middleware/auth');
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const app = createApp();
    const res = await request(app).put('/api/config/app').send({ minVersionCode: 2 });
    expect(res.status).toBe(403);
  });

  test('route is reachable (no double /api prefix)', async () => {
    const app = createApp();
    const res = await request(app).put('/api/config/app').send({ minVersionCode: 2 });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects unknown config keys', async () => {
    const app = createApp();
    const res = await request(app).put('/api/config/unknown').send({ foo: 'bar' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown config key/);
  });

  test('filters to only allowed fields for app config', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/config/app')
      .send({ minVersionCode: 2, hackerField: 'pwned' });

    expect(res.status).toBe(200);
    // Only allowed fields should be written
    const setCall = mockDocSet.mock.calls[0];
    expect(setCall[0]).toHaveProperty('minVersionCode', 2);
    expect(setCall[0]).not.toHaveProperty('hackerField');
  });

  test('returns 400 when no valid fields provided', async () => {
    const app = createApp();
    const res = await request(app).put('/api/config/app').send({ hackerField: 'pwned' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/);
  });
});

describe('GET /api/gifts', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [{ id: 'gift-1', data: () => ({ name: 'Rose', order: 1 }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/gifts');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Rose');
  });
});

describe('GET /api/gifts/all', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        { id: 'gift-1', data: () => ({ name: 'Rose', order: 1 }) },
        { id: 'gift-2', data: () => ({ name: 'Crown', order: 2 }) },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/gifts/all');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /api/coin-packages', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [{ id: 'pkg-1', data: () => ({ coins: 100, price: 0.99 }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/coin-packages');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/broadcasts', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [{ id: 'bc-1', data: () => ({ text: 'Hello', timestamp: 123 }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/broadcasts');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/gift-rankings/:giftId', () => {
  test('route is reachable (no double /api prefix)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        rankings: [{ userId: 'u1', count: 10 }],
        totalSent: 10,
        lastUpdated: 123,
      }),
    });

    const app = createApp();
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.rankings).toHaveLength(1);
    expect(res.body.totalSent).toBe(10);
  });

  test('returns empty rankings when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/gift-rankings/gift-1').expect(200);

    expect(res.body.rankings).toEqual([]);
    expect(res.body.totalSent).toBe(0);
    expect(res.body.lastUpdated).toBeNull();
  });
});

describe('PUT /api/config/economy', () => {
  test('returns 403 for non-admin', async () => {
    const { requireAdmin } = require('../../src/middleware/auth');
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });
    const app = createApp();
    const res = await request(app).put('/api/config/economy').send({ dailyBase: 100 });
    expect(res.status).toBe(403);
  });

  test('route is reachable (no double /api prefix)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ dailyBase: 50 }),
    });

    const app = createApp();
    const res = await request(app).put('/api/config/economy').send({ dailyBase: 100 });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.dailyBase).toBe(100);
  });

  test('rejects body with no valid economy fields', async () => {
    const app = createApp();
    const res = await request(app).put('/api/config/economy').send({ invalidField: 'foo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No valid economy config fields');
  });

  test('filters out invalid fields and merges valid ones', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ dailyBase: 50, beanConversionRate: 0.6 }),
    });

    const app = createApp();
    const res = await request(app)
      .put('/api/config/economy')
      .send({ dailyBase: 75, hackerField: 'malicious', beanConversionRate: 0.8 });

    expect(res.status).toBe(200);
    expect(res.body.dailyBase).toBe(75);
    expect(res.body.beanConversionRate).toBe(0.8);
    expect(res.body.hackerField).toBeUndefined();
  });

  test('accepts wheelInnerThreshold, maxRoomDurationMinutes, superShyRoomDurationMinutes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    const app = createApp();
    const res = await request(app).put('/api/config/economy').send({
      wheelInnerThreshold: 0.3,
      maxRoomDurationMinutes: 120,
      superShyRoomDurationMinutes: 30,
    });

    expect(res.status).toBe(200);
    expect(res.body.wheelInnerThreshold).toBe(0.3);
    expect(res.body.maxRoomDurationMinutes).toBe(120);
    expect(res.body.superShyRoomDurationMinutes).toBe(30);
  });
});
