const express = require('express');
const request = require('supertest');

const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn();
const mockAlertDocs = [
  {
    id: 'alert1',
    data: () => ({
      type: 'error_spike',
      severity: 'critical',
      title: 'Error spike',
      message: '10 errors in 5 min',
      status: 'unresolved',
      createdAt: '2020-01-01T12:00:00Z',
    }),
  },
  {
    id: 'alert2',
    data: () => ({
      type: 'slow_endpoint',
      severity: 'warning',
      title: 'Slow endpoint',
      message: 'Response took 5000ms',
      status: 'acknowledged',
      createdAt: '2020-01-01T12:01:00Z',
    }),
  },
];

jest.mock('../../src/utils/firebase', () => {
  const mockQuery = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: mockAlertDocs }),
  };

  return {
    db: {
      collection: jest.fn((name) => {
        if (name === 'alertConfig') {
          return {
            doc: jest.fn(() => ({
              get: mockGet,
              set: mockSet,
            })),
          };
        }
        // alerts collection
        return {
          ...mockQuery,
          doc: jest.fn(() => ({
            get: mockGet,
            update: mockUpdate,
            set: mockSet,
          })),
          orderBy: mockQuery.orderBy,
          where: mockQuery.where,
          limit: mockQuery.limit,
          get: mockQuery.get,
        };
      }),
    },
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

const adminAlertsRouter = require('../../src/routes/admin-alerts');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (isAdmin) {
      req.auth = { uid: 'admin1', uniqueId: 'admin1', isAdmin: true, token: { admin: true } };
    } else {
      req.auth = { uid: 'user1', uniqueId: 'user1', isAdmin: false, token: {} };
    }
    next();
  });
  app.use('/api', adminAlertsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({
    exists: true,
    data: () => ({ errorSpikeThreshold: 10 }),
  });
});

describe('GET /api/admin/alerts', () => {
  test('returns alerts (200)', async () => {
    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.alerts[0]).toMatchObject({
      id: 'alert1',
      type: 'error_spike',
      severity: 'critical',
    });
    expect(res.body.alerts[1]).toMatchObject({
      id: 'alert2',
      type: 'slow_endpoint',
    });
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/alerts');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });
});

describe('PATCH /api/admin/alerts/:alertId', () => {
  test('acknowledges alert (200)', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'unresolved' }),
    });

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alerts/alert1')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('acknowledged');
    expect(res.body.acknowledgedBy).toBe('admin1');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'acknowledged',
        acknowledgedBy: 'admin1',
      }),
    );
  });

  test('resolves alert (200)', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'acknowledged' }),
    });

    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alerts/alert1').send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolvedBy).toBe('admin1');
    expect(res.body.resolvedAt).toBeDefined();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolvedBy: 'admin1',
      }),
    );
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app)
      .patch('/api/admin/alerts/alert1')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('rejects invalid status (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alerts/alert1').send({ status: 'invalid' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/alert-config', () => {
  test('returns config (200)', async () => {
    const app = createApp(true);
    const res = await request(app).get('/api/admin/alert-config');

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.errorSpikeThreshold).toBe(10);
  });
});

describe('PATCH /api/admin/alert-config', () => {
  test('updates config (200)', async () => {
    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alert-config')
      .send({ errorSpikeThreshold: 20 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockSet).toHaveBeenCalled();
  });

  test('rejects empty update (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alert-config').send({ unknownField: 'value' });

    expect(res.status).toBe(400);
  });
});
