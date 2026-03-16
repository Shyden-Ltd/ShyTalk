const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

const mockWhereChain = {
  where: jest.fn(() => mockWhereChain),
  limit: jest.fn(() => mockWhereChain),
  get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => mockWhereChain),
    })),
  },
  FieldValue: {
    delete: jest.fn(() => '__DELETE__'),
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

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests by default
}));

// ─── App setup ───────────────────────────────────────────────────

const adminTempIdRouter = require('../../src/routes/admin-temp-id');
const { sendSystemPm } = require('../../src/utils/system-pm');
const { requireAdmin } = require('../../src/middleware/auth');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin1', uniqueId: 'admin1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminTempIdRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockReturnValue(false);
  mockDocGet.mockResolvedValue({ exists: false });
  mockWhereChain.get.mockResolvedValue({ empty: true, docs: [] });
  mockWhereChain.limit.mockReturnValue(mockWhereChain);
  mockWhereChain.where.mockReturnValue(mockWhereChain);
});

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/admin/users/check-id/:id', () => {
  test('returns available: true for unused ID', async () => {
    // Both real and temp queries return empty
    mockWhereChain.get
      .mockResolvedValueOnce({ empty: true, docs: [] }) // real uniqueId
      .mockResolvedValueOnce({ empty: true, docs: [] }); // tempUniqueId

    const app = createApp();
    const res = await request(app).get('/api/admin/users/check-id/12345678').expect(200);

    expect(res.body.available).toBe(true);
  });

  test('returns conflict for real uniqueId match', async () => {
    mockWhereChain.get.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345678 }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/users/check-id/12345678').expect(200);

    expect(res.body.available).toBe(false);
    expect(res.body.conflictType).toBe('real');
    expect(res.body.conflictUser).toBe(12345678);
  });

  test('returns conflict for active temp ID match', async () => {
    const futureExpiry = Date.now() + 86400000; // tomorrow
    mockWhereChain.get
      .mockResolvedValueOnce({ empty: true, docs: [] }) // real uniqueId — no match
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            data: () => ({
              uniqueId: 99999999,
              tempUniqueId: 12345678,
              tempUniqueIdExpiry: futureExpiry,
            }),
          },
        ],
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/users/check-id/12345678').expect(200);

    expect(res.body.available).toBe(false);
    expect(res.body.conflictType).toBe('temp');
    expect(res.body.conflictUser).toBe(99999999);
  });

  test('returns available for expired temp ID', async () => {
    const pastExpiry = Date.now() - 86400000; // yesterday
    mockWhereChain.get
      .mockResolvedValueOnce({ empty: true, docs: [] }) // real uniqueId — no match
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            data: () => ({
              uniqueId: 99999999,
              tempUniqueId: 12345678,
              tempUniqueIdExpiry: pastExpiry,
            }),
          },
        ],
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/users/check-id/12345678').expect(200);

    expect(res.body.available).toBe(true);
  });

  test('returns 400 for ID below 10000000', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/users/check-id/999').expect(400);

    expect(res.body.error).toBe('Invalid ID');
  });

  test('rejects non-admin (403)', async () => {
    requireAdmin.mockReturnValue(true);
    requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).get('/api/admin/users/check-id/12345678').expect(403);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/admin/users/:uniqueId/temp-id', () => {
  test('sets temp ID successfully', async () => {
    const futureExpiry = Date.now() + 86400000;

    // check-id availability: both empty
    mockWhereChain.get
      .mockResolvedValueOnce({ empty: true, docs: [] }) // real uniqueId
      .mockResolvedValueOnce({ empty: true, docs: [] }); // tempUniqueId

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/users/user123/temp-id')
      .send({ tempUniqueId: 12345678, expiryDate: futureExpiry })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tempUniqueId: 12345678,
        tempUniqueIdExpiry: futureExpiry,
      }),
    );
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user123',
      expect.stringContaining('Your display ID has been temporarily changed to 12345678.'),
    );
  });

  test('blocks when ID conflicts', async () => {
    const futureExpiry = Date.now() + 86400000;

    // real uniqueId conflict
    mockWhereChain.get.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345678 }) }],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/users/user123/temp-id')
      .send({ tempUniqueId: 12345678, expiryDate: futureExpiry })
      .expect(409);

    expect(res.body.error).toMatch(/in use/i);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('returns 400 for invalid ID', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/users/user123/temp-id')
      .send({ tempUniqueId: 999, expiryDate: Date.now() + 86400000 })
      .expect(400);

    expect(res.body.error).toBe('Invalid ID');
  });

  test('returns 400 for missing expiryDate', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/users/user123/temp-id')
      .send({ tempUniqueId: 12345678 })
      .expect(400);

    expect(res.body.error).toMatch(/expiry/i);
  });
});

describe('DELETE /api/admin/users/:uniqueId/temp-id', () => {
  test('clears temp ID successfully', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/admin/users/user123/temp-id').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tempUniqueId: '__DELETE__',
        tempUniqueIdExpiry: '__DELETE__',
      }),
    );
    expect(sendSystemPm).toHaveBeenCalledWith(
      'user123',
      'Your display ID has been restored to your original ID.',
    );
  });

  test('rejects non-admin (403)', async () => {
    requireAdmin.mockReturnValue(true);
    requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).delete('/api/admin/users/user123/temp-id').expect(403);
    expect(res.body.error).toBeDefined();
  });
});
