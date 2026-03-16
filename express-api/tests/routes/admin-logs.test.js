const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/firebase', () => {
  const mockDocs = [
    {
      id: '1',
      data: () => ({
        level: 'ERROR',
        source: 'express-api',
        message: 'Fail',
        timestamp: '2020-01-01T12:00:00Z',
        userId: 'u1',
        sessionTraceId: 's1',
        context: { route: '/api/users' },
      }),
    },
    {
      id: '2',
      data: () => ({
        level: 'INFO',
        source: 'android',
        message: 'OK',
        timestamp: '2020-01-01T12:01:00Z',
        userId: 'u2',
        sessionTraceId: 's2',
        context: {},
      }),
    },
  ];
  const mockQuery = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: mockDocs, empty: false }),
  };
  return {
    db: { collection: jest.fn(() => mockQuery) },
  };
});

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn((req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin required' });
      return true;
    }
    return false;
  }),
}));

const adminLogsRouter = require('../../src/routes/admin-logs');

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
  app.use('/api', adminLogsRouter);
  return app;
}

describe('GET /api/admin/logs', () => {
  test('returns logs with default filters (200)', async () => {
    const app = createApp(true);

    const res = await request(app).get('/api/admin/logs');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.logs[0]).toMatchObject({
      id: '1',
      level: 'ERROR',
      source: 'express-api',
      message: 'Fail',
    });
    expect(res.body.logs[1]).toMatchObject({
      id: '2',
      level: 'INFO',
      source: 'android',
      message: 'OK',
    });
    expect(res.body).toHaveProperty('nextCursor');
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);

    const res = await request(app).get('/api/admin/logs');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('applies query param filters', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);

    await request(app).get('/api/admin/logs?level=ERROR&source=express-api&userId=u1&limit=10');

    expect(db.collection).toHaveBeenCalledWith('logs');
    expect(mockQuery.where).toHaveBeenCalledWith('level', '==', 'ERROR');
    expect(mockQuery.where).toHaveBeenCalledWith('source', '==', 'express-api');
    expect(mockQuery.where).toHaveBeenCalledWith('userId', '==', 'u1');
    expect(mockQuery.limit).toHaveBeenCalledWith(10);
  });
});

describe('GET /api/admin/logs/trace/:traceId', () => {
  test('returns trace logs for a sessionTraceId (200)', async () => {
    const { db } = require('../../src/utils/firebase');
    const app = createApp(true);

    const res = await request(app).get('/api/admin/logs/trace/s1');

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(res.body.logs[0]).toMatchObject({ id: '1', sessionTraceId: 's1' });
    // Verify the route applied the correct Firestore filter
    const mockQuery = db.collection();
    expect(mockQuery.where).toHaveBeenCalledWith('sessionTraceId', '==', 's1');
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);

    const res = await request(app).get('/api/admin/logs/trace/s1');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });
});
