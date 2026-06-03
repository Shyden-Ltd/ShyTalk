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
    expect(res.body.success).toBe(true);
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
    expect(res.body.success).toBe(true);
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
    expect(res.body.success).toBe(true);
    expect(mockSet).toHaveBeenCalled();
  });

  test('rejects empty update (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alert-config').send({ unknownField: 'value' });

    expect(res.status).toBe(400);
  });
});

// ─── Additional branch coverage ─────────────────────────────────

describe('PATCH /api/admin/alert-config — edge cases', () => {
  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app)
      .patch('/api/admin/alert-config')
      .send({ errorSpikeThreshold: 20 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('returns 500 on Firestore error during set', async () => {
    mockSet.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alert-config')
      .send({ errorSpikeThreshold: 20 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('returns merged config after update', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ errorSpikeThreshold: 20, slowEndpointThresholdMs: 3000 }),
    });

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alert-config')
      .send({ errorSpikeThreshold: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.errorSpikeThreshold).toBe(20);
  });

  test('rejects body with only non-allowed keys (400)', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alert-config').send({ foo: 'bar', baz: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid fields to update');
  });

  test('accepts multiple valid config keys', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ errorSpikeThreshold: 15, slowEndpointThresholdMs: 5000 }),
    });

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alert-config')
      .send({ errorSpikeThreshold: 15, slowEndpointThresholdMs: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        errorSpikeThreshold: 15,
        slowEndpointThresholdMs: 5000,
      }),
      { merge: true },
    );
  });
});

describe('GET /api/admin/alerts — edge cases', () => {
  test('returns 500 on Firestore error', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');
    mockQuery.get.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('applies type filter', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?type=error_spike').expect(200);

    expect(mockQuery.where).toHaveBeenCalledWith('type', '==', 'error_spike');
  });

  test('applies severity filter', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?severity=critical').expect(200);

    expect(mockQuery.where).toHaveBeenCalledWith('severity', '==', 'critical');
  });

  test('applies status filter', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?status=unresolved').expect(200);

    expect(mockQuery.where).toHaveBeenCalledWith('status', '==', 'unresolved');
  });

  test('applies all filters together', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app)
      .get('/api/admin/alerts?type=error_spike&severity=critical&status=unresolved')
      .expect(200);

    expect(mockQuery.where).toHaveBeenCalledWith('type', '==', 'error_spike');
    expect(mockQuery.where).toHaveBeenCalledWith('severity', '==', 'critical');
    expect(mockQuery.where).toHaveBeenCalledWith('status', '==', 'unresolved');
  });

  test('clamps limit below 1 to default', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?limit=0').expect(200);

    expect(mockQuery.limit).toHaveBeenCalledWith(50);
  });

  test('clamps limit above MAX_LIMIT to 200', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?limit=999').expect(200);

    expect(mockQuery.limit).toHaveBeenCalledWith(200);
  });

  test('handles non-numeric limit gracefully', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?limit=abc').expect(200);

    // NaN || 50 → 50
    expect(mockQuery.limit).toHaveBeenCalledWith(50);
  });

  test('uses custom valid limit', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');

    const app = createApp(true);
    await request(app).get('/api/admin/alerts?limit=25').expect(200);

    expect(mockQuery.limit).toHaveBeenCalledWith(25);
  });

  test('returns empty alerts array when no alerts exist', async () => {
    const { db } = require('../../src/utils/firebase');
    const mockQuery = db.collection('alerts');
    mockQuery.get.mockResolvedValueOnce({ docs: [] });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts').expect(200);

    expect(res.body.alerts).toHaveLength(0);
  });
});

describe('POST /api/admin/alerts — all branches', () => {
  test('creates a new alert (200)', async () => {
    const app = createApp(true);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', severity: 'critical', message: '10 errors in 5 min' });

    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^alert_/);
    expect(res.body.type).toBe('error_spike');
    expect(res.body.severity).toBe('critical');
    expect(res.body.message).toBe('10 errors in 5 min');
    expect(res.body.status).toBe('new');
    expect(res.body.createdAt).toBeDefined();
    expect(mockSet).toHaveBeenCalled();
  });

  test('uses default severity and status when not provided', async () => {
    const app = createApp(true);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', message: 'Something happened' });

    expect(res.status).toBe(200);
    expect(res.body.severity).toBe('medium');
    expect(res.body.status).toBe('new');
  });

  test('accepts custom status', async () => {
    const app = createApp(true);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', message: 'Alert', status: 'acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });

  test('returns 400 when type is missing', async () => {
    const app = createApp(true);
    const res = await request(app).post('/api/admin/alerts').send({ message: 'No type' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('type and message are required');
  });

  test('returns 400 when message is missing', async () => {
    const app = createApp(true);
    const res = await request(app).post('/api/admin/alerts').send({ type: 'error_spike' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('type and message are required');
  });

  test('returns 400 when both type and message are missing', async () => {
    const app = createApp(true);
    const res = await request(app).post('/api/admin/alerts').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('type and message are required');
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', message: 'Test' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('rejects status not in the allowlist (400)', async () => {
    // Guard against attackers (or careless admin tooling) persisting
    // arbitrary status strings via POST. The allowlist mirrors what GET
    // filtering / PATCH transitions already accept: new, unresolved,
    // acknowledged, resolved. Anything outside is a 400.
    const app = createApp(true);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', message: 'rogue', status: 'pwned' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/i);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('accepts each allowlisted status value (200)', async () => {
    for (const status of ['new', 'unresolved', 'acknowledged', 'resolved']) {
      const app = createApp(true);
      const res = await request(app)
        .post('/api/admin/alerts')
        .send({ type: 'error_spike', message: `alert with ${status}`, status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  test('returns 500 on Firestore error', async () => {
    mockSet.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app)
      .post('/api/admin/alerts')
      .send({ type: 'error_spike', message: 'Test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('GET /api/admin/alerts/:alertId — all branches', () => {
  test('returns single alert (200)', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'alert-123',
      data: () => ({ type: 'error_spike', severity: 'critical', message: 'Test alert' }),
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts/alert-123');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('alert-123');
    expect(res.body.type).toBe('error_spike');
  });

  test('returns 404 for non-existent alert', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Alert not found');
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/alerts/alert-123');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('returns 500 on Firestore error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alerts/alert-123');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('PATCH /api/admin/alerts/:alertId — edge cases', () => {
  test('returns 400 when status is missing', async () => {
    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alerts/alert1').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  test('returns 404 for non-existent alert', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alerts/nonexistent')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Alert not found');
  });

  test('returns 500 on Firestore error during update', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'unresolved' }),
    });
    mockUpdate.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app)
      .patch('/api/admin/alerts/alert1')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('uses uid when uniqueId is not available', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'unresolved' }),
    });

    // Create app with auth that has uid but no uniqueId
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'admin-uid', token: { admin: true } };
      next();
    });
    app.use('/api', adminAlertsRouter);

    const res = await request(app)
      .patch('/api/admin/alerts/alert1')
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.acknowledgedBy).toBe('admin-uid');
  });

  test('resolved status sets resolvedBy and resolvedAt as ISO string', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'acknowledged' }),
    });

    const app = createApp(true);
    const res = await request(app).patch('/api/admin/alerts/alert1').send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.resolvedBy).toBe('admin1');
    expect(res.body.resolvedAt).toBeDefined();
    // resolvedAt should be an ISO date string
    expect(new Date(res.body.resolvedAt).toISOString()).toBe(res.body.resolvedAt);
  });
});

describe('GET /api/admin/alert-config — edge cases', () => {
  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/alert-config');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/i);
  });

  test('returns defaults when config doc does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alert-config');

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    // Should return all default keys
    expect(res.body.config.errorSpikeThreshold).toBe(10);
    expect(res.body.config.slowEndpointThresholdMs).toBe(3000);
    expect(res.body.config.cronFailureAlert).toBe(true);
  });

  test('merges stored config with defaults', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ errorSpikeThreshold: 25 }),
    });

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alert-config');

    expect(res.status).toBe(200);
    expect(res.body.config.errorSpikeThreshold).toBe(25);
    // Other defaults should still be present
    expect(res.body.config.slowEndpointThresholdMs).toBe(3000);
  });

  test('returns 500 on Firestore error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp(true);
    const res = await request(app).get('/api/admin/alert-config');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
