const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockSet = jest.fn().mockResolvedValue();
const mockDelete = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn().mockResolvedValue({ exists: false });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
const mockWhereGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockSet,
  delete: mockDelete,
}));

const mockWhere = jest.fn(() => ({
  get: mockWhereGet,
}));

const mockCollection = jest.fn(() => ({
  get: mockCollectionGet,
  where: (...args) => {
    mockWhere(...args);
    return { get: mockWhereGet };
  },
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-id-123'),
  now: jest.fn(() => 1709856000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

// ─── App setup ───────────────────────────────────────────────────

const adminBansRouter = require('../../src/routes/admin-bans');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin1', uniqueId: 'admin1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminBansRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
  mockWhereGet.mockResolvedValue({ empty: true, docs: [] });
});

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/admin/bans', () => {
  test('lists all active bans (200)', async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();

    mockCollectionGet.mockResolvedValue({
      docs: [
        { id: 'dev1', data: () => ({ deviceId: 'dev1', reason: 'spam', expiresAt: futureExpiry }) },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans').expect(200);

    expect(res.body.deviceBans).toHaveLength(1);
    expect(res.body.deviceBans[0].id).toBe('dev1');
    expect(res.body).toHaveProperty('networkBans');
  });

  test('filters out expired bans', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValue({
      docs: [
        { id: 'dev1', data: () => ({ deviceId: 'dev1', reason: 'old', expiresAt: pastExpiry }) },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans').expect(200);

    expect(res.body.deviceBans).toHaveLength(0);
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/bans').expect(403);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/admin/bans/device', () => {
  test('bans a device (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'abc-123', reason: 'Cheating', duration: '7d' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('deviceBans/abc-123');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'abc-123',
        reason: 'Cheating',
        duration: '7d',
      }),
    );
  });

  test('validates required fields — missing deviceId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ reason: 'Spam' })
      .expect(400);

    expect(res.body.error).toBe('deviceId is required');
  });

  test('validates required fields — missing reason', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'abc-123' })
      .expect(400);

    expect(res.body.error).toBe('reason is required');
  });
});

describe('POST /api/admin/bans/network', () => {
  test('bans a network (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '1.2.3.4', reason: 'Spam', duration: '24h' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('networkBans/mock-id-123');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ip',
        value: '1.2.3.4',
        reason: 'Spam',
        duration: '24h',
      }),
    );
  });

  test('validates type field', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'invalid', value: '1.2.3.4', reason: 'Spam' })
      .expect(400);

    expect(res.body.error).toBe('type must be one of: ip, subnet, asn');
  });

  test('validates required value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', reason: 'Spam' })
      .expect(400);

    expect(res.body.error).toBe('value is required');
  });

  test('validates required reason', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '1.2.3.4' })
      .expect(400);

    expect(res.body.error).toBe('reason is required');
  });
});

describe('DELETE /api/admin/bans/device/:deviceId', () => {
  test('unbans a device (200)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/admin/bans/device/abc-123').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('deviceBans/abc-123');
    expect(mockDelete).toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/bans/network/:banId', () => {
  test('unbans a network (200)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/admin/bans/network/ban-xyz').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('networkBans/ban-xyz');
    expect(mockDelete).toHaveBeenCalled();
  });
});

describe('POST /api/admin/bans/unban-all/:uniqueId', () => {
  test('removes all bans for user (200)', async () => {
    const mockRefDelete = jest.fn().mockResolvedValue();
    mockWhereGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'ban1', ref: { delete: mockRefDelete }, data: () => ({}) },
        { id: 'ban2', ref: { delete: mockRefDelete }, data: () => ({}) },
      ],
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/bans/unban-all/user456').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.removed).toBe(4); // 2 from deviceBans + 2 from networkBans (same mock)
    expect(mockRefDelete).toHaveBeenCalled();
  });
});

describe('GET /api/admin/bans/user/:uniqueId', () => {
  test('gets all bans for user (200)', async () => {
    mockWhereGet.mockResolvedValue({
      docs: [{ id: 'ban1', data: () => ({ reason: 'Spam', type: 'ip' }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans/user/user456').expect(200);

    expect(res.body).toHaveProperty('deviceBans');
    expect(res.body).toHaveProperty('networkBans');
    expect(mockWhere).toHaveBeenCalledWith('linkedUniqueId', '==', 'user456');
  });
});
