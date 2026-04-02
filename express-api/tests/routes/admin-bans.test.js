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
    // Each query (string + numeric variant per collection) returns the same docs,
    // but deduplication by id ensures each ban is only counted once.
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
    // Mock returns ban1+ban2 for all 4 queries; dedup keeps 2 unique docs
    expect(res.body.removed).toBe(2);
    expect(mockRefDelete).toHaveBeenCalled();
  });
});

describe('GET /api/admin/bans/user/:uniqueId', () => {
  test('gets all bans for user (200)', async () => {
    mockWhereGet.mockResolvedValue({
      docs: [{ id: 'ban1', data: () => ({ reason: 'Spam', type: 'ip' }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans/user/456').expect(200);

    expect(res.body).toHaveProperty('deviceBans');
    expect(res.body).toHaveProperty('networkBans');
    // Dual-type query: both string and numeric forms queried
    expect(mockWhere).toHaveBeenCalledWith('linkedUniqueId', '==', '456');
    expect(mockWhere).toHaveBeenCalledWith('linkedUniqueId', '==', 456);
  });

  test('deduplicates bans returned by both string and numeric queries', async () => {
    // Both queries return the same doc — dedup should keep only one copy
    mockWhereGet.mockResolvedValue({
      docs: [{ id: 'dup-ban', data: () => ({ reason: 'Spam', deviceId: 'd1' }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans/user/123').expect(200);

    // 4 queries (2 device, 2 network) all return dup-ban,
    // but dedup keeps 1 in deviceBans and 1 in networkBans
    expect(res.body.deviceBans).toHaveLength(1);
    expect(res.body.networkBans).toHaveLength(1);
    expect(res.body.deviceBans[0].id).toBe('dup-ban');
    expect(res.body.networkBans[0].id).toBe('dup-ban');
  });
});

describe('POST /api/admin/bans/unban-all/:uniqueId — deduplication', () => {
  test('deduplicates docs from string and numeric queries', async () => {
    const mockRefDelete = jest.fn().mockResolvedValue();
    // All 4 queries return the same two docs
    mockWhereGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'ban1', ref: { delete: mockRefDelete }, data: () => ({}) },
        { id: 'ban2', ref: { delete: mockRefDelete }, data: () => ({}) },
      ],
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/bans/unban-all/12345').expect(200);

    expect(res.body.success).toBe(true);
    // 4 queries each return ban1+ban2, but dedup keeps only 2 unique docs
    expect(res.body.removed).toBe(2);
    // Each unique doc deleted exactly once
    expect(mockRefDelete).toHaveBeenCalledTimes(2);
  });

  test('queries both string and numeric forms of uniqueId', async () => {
    mockWhereGet.mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    await request(app).post('/api/admin/bans/unban-all/789').expect(200);

    expect(mockWhere).toHaveBeenCalledWith('linkedUniqueId', '==', '789');
    expect(mockWhere).toHaveBeenCalledWith('linkedUniqueId', '==', 789);
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('Admin auth — all ban routes reject non-admin', () => {
  test('POST /api/admin/bans/device non-admin returns 403', async () => {
    const app = createApp(false);
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev1', reason: 'Test' })
      .expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/admin/bans/network non-admin returns 403', async () => {
    const app = createApp(false);
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '1.2.3.4', reason: 'Test' })
      .expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('DELETE /api/admin/bans/device/:id non-admin returns 403', async () => {
    const app = createApp(false);
    await request(app).delete('/api/admin/bans/device/dev1').expect(403);
  });

  test('DELETE /api/admin/bans/network/:id non-admin returns 403', async () => {
    const app = createApp(false);
    await request(app).delete('/api/admin/bans/network/ban1').expect(403);
  });

  test('POST /api/admin/bans/unban-all/:id non-admin returns 403', async () => {
    const app = createApp(false);
    await request(app).post('/api/admin/bans/unban-all/user1').expect(403);
  });

  test('GET /api/admin/bans/user/:id non-admin returns 403', async () => {
    const app = createApp(false);
    await request(app).get('/api/admin/bans/user/123').expect(403);
  });
});

describe('POST /api/admin/bans/device — additional branches', () => {
  test('permanent ban (no duration): expiresAt is null', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-perm', reason: 'Permanent' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-perm',
        duration: 'permanent',
        expiresAt: null,
      }),
    );
  });

  test('device ban with linkedUniqueId sends system PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-linked', reason: 'Spam', duration: '7d', linkedUniqueId: 'user42' })
      .expect(200);

    expect(sendSystemPm).toHaveBeenCalledWith(
      'user42',
      'A restriction has been placed on your account.',
    );
  });

  test('device ban without linkedUniqueId does not send system PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockClear();
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-no-link', reason: 'Spam', duration: '7d' })
      .expect(200);

    expect(sendSystemPm).not.toHaveBeenCalled();
  });

  test('device ban succeeds even when system PM fails', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-pm-fail', reason: 'Spam', linkedUniqueId: 'user99' })
      .expect(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/admin/bans/network — additional branches', () => {
  test('subnet ban validates CIDR format', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'subnet', value: 'not-a-cidr', reason: 'Test' })
      .expect(400);
    expect(res.body.error).toMatch(/CIDR subnet format/);
  });

  test('valid subnet ban accepted', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'subnet', value: '192.168.0.0/24', reason: 'VPN', duration: '30d' })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  test('ASN validates numeric format', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'asn', value: 'AS12345', reason: 'Test' })
      .expect(400);
    expect(res.body.error).toMatch(/ASN must be numeric/);
  });

  test('valid ASN ban accepted', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'asn', value: '12345', reason: 'Bot network' })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  test('IP format validation rejects malformed IP', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: 'not-an-ip', reason: 'Test' })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid IP address format/);
  });

  test('network ban with linkedUniqueId sends system PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockClear();
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/network')
      .send({
        type: 'ip',
        value: '5.6.7.8',
        reason: 'Abuse',
        duration: '24h',
        linkedUniqueId: 'user55',
      })
      .expect(200);

    expect(sendSystemPm).toHaveBeenCalledWith(
      'user55',
      'A restriction has been placed on your account.',
    );
  });

  test('network ban without linkedUniqueId does not send system PM', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockClear();
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '9.9.9.9', reason: 'Spam' })
      .expect(200);

    expect(sendSystemPm).not.toHaveBeenCalled();
  });

  test('network ban succeeds even when system PM fails', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '8.8.4.4', reason: 'Test', linkedUniqueId: 'user77' })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  test('permanent network ban (no duration): expiresAt is null', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '3.3.3.3', reason: 'Permanent' })
      .expect(200);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 'permanent',
        expiresAt: null,
      }),
    );
  });

  test('missing type field returns 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ value: '1.2.3.4', reason: 'Test' })
      .expect(400);
    expect(res.body.error).toBe('type must be one of: ip, subnet, asn');
  });

  test('value as non-string returns 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: 12345, reason: 'Test' })
      .expect(400);
    expect(res.body.error).toBe('value is required');
  });
});

describe('GET /api/admin/bans — permanent bans (no expiresAt)', () => {
  test('includes bans with null expiresAt (permanent)', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        {
          id: 'perm1',
          data: () => ({ deviceId: 'perm-device', reason: 'Permanent', expiresAt: null }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans').expect(200);
    expect(res.body.deviceBans).toHaveLength(1);
    expect(res.body.deviceBans[0].id).toBe('perm1');
  });

  test('includes bans with undefined expiresAt', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [{ id: 'perm2', data: () => ({ deviceId: 'perm-device-2', reason: 'No expiry' }) }],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/bans').expect(200);
    expect(res.body.deviceBans).toHaveLength(1);
  });
});

describe('POST /api/admin/bans/unban-all — system PM', () => {
  test('sends system PM after unbanning', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockClear();
    mockWhereGet.mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    await request(app).post('/api/admin/bans/unban-all/user999').expect(200);

    expect(sendSystemPm).toHaveBeenCalledWith(
      'user999',
      'A restriction on your account has been lifted.',
    );
  });

  test('succeeds even when system PM fails', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');
    sendSystemPm.mockRejectedValueOnce(new Error('PM send failed'));
    mockWhereGet.mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app).post('/api/admin/bans/unban-all/user888').expect(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Error handling — 500 responses', () => {
  test('GET /api/admin/bans returns 500 on Firestore error', async () => {
    mockCollectionGet.mockRejectedValueOnce(new Error('Firestore error'));
    const app = createApp();
    const res = await request(app).get('/api/admin/bans').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('POST /api/admin/bans/device returns 500 on Firestore error', async () => {
    mockSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-err', reason: 'Test' })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('POST /api/admin/bans/network returns 500 on Firestore error', async () => {
    mockSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '1.2.3.4', reason: 'Test' })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('DELETE /api/admin/bans/device/:id returns 500 on Firestore error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Firestore delete error'));
    const app = createApp();
    const res = await request(app).delete('/api/admin/bans/device/dev-err').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('DELETE /api/admin/bans/network/:id returns 500 on Firestore error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Firestore delete error'));
    const app = createApp();
    const res = await request(app).delete('/api/admin/bans/network/ban-err').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('POST /api/admin/bans/unban-all returns 500 on Firestore error', async () => {
    mockWhereGet.mockRejectedValueOnce(new Error('Firestore query error'));
    const app = createApp();
    const res = await request(app).post('/api/admin/bans/unban-all/user-err').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('GET /api/admin/bans/user/:id returns 500 on Firestore error', async () => {
    mockWhereGet.mockRejectedValueOnce(new Error('Firestore query error'));
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/user/user-err').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('parseExpiry helper', () => {
  test('duration "24h" sets expiry ~24 hours from now', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-24h', reason: 'Test', duration: '24h' })
      .expect(200);

    const setCall = mockSet.mock.calls.find((c) => c.length > 0 && c[0]?.deviceId === 'dev-24h');
    expect(setCall).toBeDefined();
    // expiresAt should be an ISO string ~24h from now
    expect(setCall[0].expiresAt).toBeTruthy();
    const expiry = new Date(setCall[0].expiresAt).getTime();
    const now = Date.now();
    expect(expiry).toBeGreaterThan(now);
    expect(expiry).toBeLessThan(now + 25 * 3600000);
  });

  test('duration "30d" sets expiry ~30 days from now', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-30d', reason: 'Test', duration: '30d' })
      .expect(200);

    const setCall = mockSet.mock.calls.find((c) => c.length > 0 && c[0]?.deviceId === 'dev-30d');
    expect(setCall).toBeDefined();
    expect(setCall[0].expiresAt).toBeTruthy();
  });

  test('invalid duration format: expiresAt is null', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-invalid', reason: 'Test', duration: 'bad' })
      .expect(200);

    const setCall = mockSet.mock.calls.find(
      (c) => c.length > 0 && c[0]?.deviceId === 'dev-invalid',
    );
    expect(setCall).toBeDefined();
    expect(setCall[0].expiresAt).toBeNull();
  });
});
