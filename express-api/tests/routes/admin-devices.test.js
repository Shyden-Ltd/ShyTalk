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

const adminDevicesRouter = require('../../src/routes/admin-devices');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin1', uniqueId: 'admin1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminDevicesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
  mockWhereGet.mockResolvedValue({ empty: true, docs: [] });
});

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/admin/devices', () => {
  test('returns device list (200)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        {
          id: 'dev-001',
          data: () => ({
            userId: 'u1',
            manufacturer: 'Samsung',
            model: 'Galaxy S21',
            lastIp: '1.2.3.4',
          }),
        },
        {
          id: 'dev-002',
          data: () => ({
            userId: 'u2',
            manufacturer: 'Google',
            model: 'Pixel 7',
            lastIp: '5.6.7.8',
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices').expect(200);

    expect(res.body.devices).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.devices[0].id).toBe('dev-001');
    expect(res.body.devices[1].id).toBe('dev-002');
  });

  test('filters by search query', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        {
          id: 'dev-001',
          data: () => ({
            userId: 'u1',
            manufacturer: 'Samsung',
            model: 'Galaxy S21',
            lastIp: '1.2.3.4',
          }),
        },
        {
          id: 'dev-002',
          data: () => ({
            userId: 'u2',
            manufacturer: 'Google',
            model: 'Pixel 7',
            lastIp: '5.6.7.8',
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices?q=samsung').expect(200);

    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].manufacturer).toBe('Samsung');
    expect(res.body.total).toBe(1);
  });

  test('paginates with limit and offset', async () => {
    const docs = [];
    for (let i = 0; i < 10; i++) {
      docs.push({ id: `dev-${i}`, data: () => ({ userId: `u${i}` }) });
    }
    mockCollectionGet.mockResolvedValue({ docs });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices?limit=3&offset=2').expect(200);

    expect(res.body.devices).toHaveLength(3);
    expect(res.body.devices[0].id).toBe('dev-2');
    expect(res.body.total).toBe(10);
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).get('/api/admin/devices').expect(403);
    expect(res.body.error).toBeDefined();
  });
});

describe('GET /api/admin/devices/:deviceId', () => {
  test('returns single device binding (200)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'dev-001',
      data: () => ({ userId: 'u1', manufacturer: 'Samsung', model: 'Galaxy S21' }),
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices/dev-001').expect(200);

    expect(res.body.id).toBe('dev-001');
    expect(res.body.manufacturer).toBe('Samsung');
    expect(mockDoc).toHaveBeenCalledWith('deviceBindings/dev-001');
  });

  test('returns 404 for non-existent device', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices/nonexistent').expect(404);

    expect(res.body.error).toBe('Device binding not found');
  });
});

describe('GET /api/admin/devices/user/:uniqueId', () => {
  test('returns all devices for a user (200)', async () => {
    mockWhereGet.mockResolvedValue({
      docs: [
        { id: 'dev-001', data: () => ({ userId: 10000001, model: 'Galaxy S21' }) },
        { id: 'dev-002', data: () => ({ userId: 10000001, model: 'Pixel 7' }) },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices/user/10000001').expect(200);

    expect(res.body.devices).toHaveLength(2);
    expect(mockWhere).toHaveBeenCalledWith('uniqueId', '==', 10000001);
  });

  test('returns empty array when user has no devices', async () => {
    mockWhereGet.mockResolvedValue({ docs: [] });

    const app = createApp();
    const res = await request(app).get('/api/admin/devices/user/10000002').expect(200);

    expect(res.body.devices).toHaveLength(0);
  });
});

describe('DELETE /api/admin/devices/:deviceId', () => {
  test('unbinds device (200)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'dev-001',
      data: () => ({ userId: 'u1' }),
    });

    const app = createApp();
    const res = await request(app).delete('/api/admin/devices/dev-001').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('deviceBindings/dev-001');
    expect(mockDelete).toHaveBeenCalled();
    // Audit log should have been written
    expect(mockDoc).toHaveBeenCalledWith('adminAuditLog/mock-id-123');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UNBIND_DEVICE',
        targetDeviceId: 'dev-001',
      }),
    );
  });

  test('returns 404 for non-existent device', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).delete('/api/admin/devices/nonexistent').expect(404);

    expect(res.body.error).toBe('Device binding not found');
  });

  test('rejects non-admin (403)', async () => {
    const app = createApp(false);
    const res = await request(app).delete('/api/admin/devices/dev-001').expect(403);
    expect(res.body.error).toBeDefined();
  });
});
