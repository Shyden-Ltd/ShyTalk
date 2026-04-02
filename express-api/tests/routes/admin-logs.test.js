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

// ─── Additional branch coverage tests ───────────────────────────

describe('GET /api/admin/logs — limit clamping', () => {
  test('clamps limit below 1 to default (50)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?limit=0');

    expect(mockQuery.limit).toHaveBeenCalledWith(50);
  });

  test('clamps negative limit to default (50)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?limit=-5');

    expect(mockQuery.limit).toHaveBeenCalledWith(50);
  });

  test('clamps limit above MAX_LIMIT to 200', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?limit=999');

    expect(mockQuery.limit).toHaveBeenCalledWith(200);
  });

  test('uses non-numeric limit as default (50)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?limit=abc');

    expect(mockQuery.limit).toHaveBeenCalledWith(50);
  });
});

describe('GET /api/admin/logs — additional Firestore filters', () => {
  test('applies sessionTraceId filter', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?sessionTraceId=sess-123');

    expect(mockQuery.where).toHaveBeenCalledWith('sessionTraceId', '==', 'sess-123');
  });

  test('applies requestTraceId filter', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?requestTraceId=req-456');

    expect(mockQuery.where).toHaveBeenCalledWith('requestTraceId', '==', 'req-456');
  });

  test('applies startTime and endTime filters', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?startTime=1000&endTime=2000');

    expect(mockQuery.where).toHaveBeenCalledWith('timestamp', '>=', 1000);
    expect(mockQuery.where).toHaveBeenCalledWith('timestamp', '<=', 2000);
  });
});

describe('GET /api/admin/logs — cursor pagination', () => {
  test('applies cursor for pagination', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    jest.clearAllMocks();

    const app = createApp(true);
    await request(app).get('/api/admin/logs?cursor=1609459200000');

    expect(mockQuery.startAfter).toHaveBeenCalledWith(1609459200000);
  });

  test('returns nextCursor when docs.length equals limit (more pages available)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    // Return exactly 2 docs with limit=2 — signals more pages
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'a',
          data: () => ({ level: 'INFO', message: 'First', timestamp: 2000 }),
        },
        {
          id: 'b',
          data: () => ({ level: 'INFO', message: 'Second', timestamp: 1000 }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    // nextCursor should be the timestamp of the last doc
    expect(res.body.nextCursor).toBe(1000);
  });

  test('returns null nextCursor when fewer docs than limit', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    // Return only 1 doc, but default limit is 50 — so no next page
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'single',
          data: () => ({ level: 'INFO', message: 'Only one', timestamp: 1000 }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.nextCursor).toBeNull();
  });
});

describe('GET /api/admin/logs — client-side route filter', () => {
  test('filters by context.route', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: '1',
          data: () => ({
            level: 'ERROR',
            message: 'route match',
            timestamp: 1000,
            context: { route: '/api/users' },
          }),
        },
        {
          id: '2',
          data: () => ({
            level: 'INFO',
            message: 'no match',
            timestamp: 2000,
            context: { route: '/api/rooms' },
          }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?route=/api/users');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].id).toBe('1');
  });

  test('filters by top-level route field (no context.route)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: '1',
          data: () => ({
            level: 'INFO',
            message: 'has route at top level',
            timestamp: 1000,
            route: '/api/gifts',
          }),
        },
        {
          id: '2',
          data: () => ({
            level: 'INFO',
            message: 'no route at all',
            timestamp: 2000,
          }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?route=/api/gifts');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].id).toBe('1');
  });
});

describe('GET /api/admin/logs — keyword filter', () => {
  test('filters by keyword in message', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: '1',
          data: () => ({ level: 'ERROR', message: 'Database timeout occurred', timestamp: 1000 }),
        },
        {
          id: '2',
          data: () => ({ level: 'INFO', message: 'Request completed', timestamp: 2000 }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?keyword=timeout');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].id).toBe('1');
  });

  test('filters by keyword in context (case-insensitive)', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: '1',
          data: () => ({
            level: 'INFO',
            message: 'Generic message',
            timestamp: 1000,
            context: { userId: 'TARGETUSER' },
          }),
        },
        {
          id: '2',
          data: () => ({
            level: 'INFO',
            message: 'Other log',
            timestamp: 2000,
            context: { action: 'login' },
          }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?keyword=targetuser');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].id).toBe('1');
  });

  test('keyword filter excludes entries with no message and no context', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: '1',
          data: () => ({ level: 'INFO', timestamp: 1000 }),
        },
      ],
      empty: false,
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs?keyword=anything');

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(0);
  });
});

describe('GET /api/admin/logs — error handling', () => {
  test('returns 500 on Firestore error', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('GET /api/admin/logs/trace/:traceId — error handling', () => {
  test('returns 500 on Firestore error', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection();
    mockQuery.get.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const app = createApp(true);
    const res = await request(app).get('/api/admin/logs/trace/s1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
