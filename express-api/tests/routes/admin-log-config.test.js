const express = require('express');
const request = require('supertest');

const mockDocData = {
  retentionHours: 72,
  levelPerSource: { 'express-api': 'DEBUG', android: 'WARN' },
  excludedRoutes: ['/api/health'],
  hardCapDaily: 20000,
  batchSettings: { intervalSeconds: 60, wifiOnly: true },
};

const mockSet = jest.fn().mockResolvedValue();
const mockGet = jest.fn().mockResolvedValue({ exists: true, data: () => mockDocData });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockGet,
      set: mockSet,
    })),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn((req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin required' });
      return true;
    }
    return false;
  }),
}));

const logConfigRouter = require('../../src/routes/admin-log-config');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (isAdmin) {
      req.auth = { uid: 'admin1', isAdmin: true, token: { admin: true } };
    } else {
      req.auth = { uid: 'user1', isAdmin: false, token: {} };
    }
    next();
  });
  app.use('/api', logConfigRouter);
  return app;
}

describe('GET /api/log-config (public)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns config from Firestore (200)', async () => {
    const app = createApp(false); // no admin needed
    const res = await request(app).get('/api/log-config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockDocData);
    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('logConfig/settings');
  });

  test('returns DEFAULT_CONFIG when doc does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const app = createApp(false);
    const res = await request(app).get('/api/log-config');

    expect(res.status).toBe(200);
    expect(res.body.retentionHours).toBe(48);
    expect(res.body.hardCapDaily).toBe(15000);
  });

  test('returns DEFAULT_CONFIG on Firestore error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Firestore down'));
    const app = createApp(false);
    const res = await request(app).get('/api/log-config');

    expect(res.status).toBe(200);
    expect(res.body.retentionHours).toBe(48);
  });
});

describe('GET /api/admin/log-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns config for admin (200)', async () => {
    const app = createApp(true);
    const res = await request(app).get('/api/admin/log-config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockDocData);
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/log-config');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });
});

describe('PATCH /api/admin/log-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates settings (200)', async () => {
    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/log-config')
      .send({ retentionHours: 96, hardCapDaily: 5000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('logConfig/settings');
    expect(mockSet).toHaveBeenCalledWith(
      { retentionHours: 96, hardCapDaily: 5000 },
      { merge: true },
    );
  });

  test('rejects empty body (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/log-config').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/i);
  });

  test('rejects body with only unknown fields (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/log-config').send({ foo: 'bar', baz: 123 });

    expect(res.status).toBe(400);
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).patch('/api/admin/log-config').send({ retentionHours: 24 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });
});
