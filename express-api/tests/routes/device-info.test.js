const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockSet = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn().mockResolvedValue({ exists: false });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockSet,
}));

const mockLimit = jest.fn(() => ({
  get: mockCollectionGet,
}));

const mockCollection = jest.fn(() => ({
  get: mockCollectionGet,
  limit: mockLimit,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
  },
}));

// ─── Fetch mock ──────────────────────────────────────────────────

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();

  // Default: device binding doesn't exist yet
  mockDocGet.mockResolvedValue({ exists: false });
  // Default: no network bans
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

  // Default: successful geo response
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        isp: 'BT',
        as: 'AS2856 British Telecommunications PLC',
        country: 'United Kingdom',
        regionName: 'England',
      }),
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ─── App setup ───────────────────────────────────────────────────

const deviceInfoRouter = require('../../src/routes/device-info');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'user123', uniqueId: 'user123' };
    next();
  });
  app.use('/api', deviceInfoRouter);
  return app;
}

const validBody = {
  deviceId: 'abc-xyz',
  manufacturer: 'Samsung',
  model: 'Galaxy S24',
  osVersion: 'Android 14',
  screenResolution: '1080x2340',
  screenDensity: 2.75,
  totalRamMb: 8192,
  appVersion: '0.53',
  buildNumber: 54,
  locale: 'en-GB',
  networkType: 'wifi',
  carrierName: 'EE',
  firebaseInstallationId: 'fid-abc',
};

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/device-info', () => {
  test('accepts valid device info and stores it (200)', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/device-info')
      .set('x-forwarded-for', '203.0.113.1')
      .send(validBody)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.banStatus).toBeDefined();
    expect(res.body.banStatus.isBanned).toBe(false);

    // Should have written to Firestore
    expect(mockDoc).toHaveBeenCalledWith('deviceBindings/abc-xyz');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'abc-xyz',
        uniqueId: 'user123',
        manufacturer: 'Samsung',
        model: 'Galaxy S24',
        isp: 'BT',
        asn: 'AS2856',
        country: 'United Kingdom',
        region: 'England',
      }),
      { merge: true },
    );
  });

  test('rejects missing deviceId (400)', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/device-info')
      .send({ manufacturer: 'Samsung' })
      .expect(400);

    expect(res.body.error).toBe('deviceId is required');
  });

  test('returns banStatus.isBanned = false when no bans', async () => {
    // Device ban doc doesn't exist
    mockDocGet.mockResolvedValue({ exists: false });
    // No network bans
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();

    const res = await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(res.body.banStatus.isBanned).toBe(false);
    expect(res.body.banStatus.banType).toBeNull();
  });

  test('returns banStatus with device ban', async () => {
    // First call: deviceBindings/{deviceId} — doesn't exist
    // Second call: deviceBans/{deviceId} — exists with ban
    let docGetCallCount = 0;
    mockDocGet.mockImplementation(() => {
      docGetCallCount++;
      if (docGetCallCount === 1) {
        // deviceBindings check (existing doc check)
        return Promise.resolve({ exists: false });
      }
      // deviceBans check
      return Promise.resolve({
        exists: true,
        data: () => ({
          reason: 'Cheating',
          expiresAt: Date.now() + 86400000, // future
        }),
      });
    });

    const app = createApp();

    const res = await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('device');
    expect(res.body.banStatus.reason).toBe('Cheating');
  });

  test('returns banStatus with network ban (IP match)', async () => {
    // deviceBindings — doesn't exist, deviceBans — doesn't exist
    mockDocGet.mockResolvedValue({ exists: false });

    // Network bans — one IP ban matching the forwarded IP
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({
            type: 'ip',
            value: '203.0.113.50',
            reason: 'Spam IP',
            expiresAt: Date.now() + 86400000,
          }),
        },
      ],
    });

    const app = createApp();

    const res = await request(app)
      .post('/api/device-info')
      .set('x-forwarded-for', '203.0.113.50, 10.0.0.1')
      .send(validBody)
      .expect(200);

    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('network_ip');
    expect(res.body.banStatus.reason).toBe('Spam IP');
  });

  test('skips expired bans', async () => {
    // Device ban exists but expired
    let docGetCallCount = 0;
    mockDocGet.mockImplementation(() => {
      docGetCallCount++;
      if (docGetCallCount === 1) {
        return Promise.resolve({ exists: false });
      }
      // deviceBans — expired
      return Promise.resolve({
        exists: true,
        data: () => ({
          reason: 'Old ban',
          expiresAt: Date.now() - 86400000, // past
        }),
      });
    });

    // Network bans — also expired
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({
            type: 'ip',
            value: '127.0.0.1',
            reason: 'Old IP ban',
            expiresAt: Date.now() - 86400000,
          }),
        },
      ],
    });

    const app = createApp();

    const res = await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('handles IP geolocation failure gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const app = createApp();

    const res = await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(res.body.success).toBe(true);
    // Geo fields should be null
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isp: null,
        asn: null,
        country: null,
        region: null,
      }),
      { merge: true },
    );
  });

  test('sets firstSeen only on new bindings', async () => {
    // First request: doc doesn't exist — should include firstSeen
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();

    await request(app).post('/api/device-info').send(validBody).expect(200);

    const firstCallDoc = mockSet.mock.calls[0][0];
    expect(firstCallDoc).toHaveProperty('firstSeen');
    expect(firstCallDoc).toHaveProperty('boundAt');

    // Reset mocks
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ isp: 'BT', as: 'AS2856 BT', country: 'UK', regionName: 'England' }),
    });

    // Second request: doc exists — should NOT include firstSeen
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

    await request(app).post('/api/device-info').send(validBody).expect(200);

    const secondCallDoc = mockSet.mock.calls[0][0];
    expect(secondCallDoc).not.toHaveProperty('firstSeen');
    expect(secondCallDoc).not.toHaveProperty('boundAt');
  });
});
