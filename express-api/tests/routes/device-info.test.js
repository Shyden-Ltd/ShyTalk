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

// Chain supports `.where(filter).limit(N).get()` for the active-bans
// query that replaced the expireBans cron. Returns the same
// `mockCollectionGet` regardless of filter/limit, so existing tests
// that read network bans still work.
const mockWhere = jest.fn(() => ({
  get: mockCollectionGet,
  limit: mockLimit,
}));

const mockCollection = jest.fn(() => ({
  get: mockCollectionGet,
  limit: mockLimit,
  where: mockWhere,
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
          expiresAt: new Date(Date.now() + 86400000).toISOString(), // future
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
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
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
          expiresAt: new Date(Date.now() - 86400000).toISOString(), // past
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
            expiresAt: new Date(Date.now() - 86400000).toISOString(),
          }),
        },
      ],
    });

    const app = createApp();

    const res = await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('uses Firestore .where() filter to fetch only active network bans', async () => {
    // Confirms the query layer filters out expired bans before they
    // reach checkBans's per-doc safety check. This is the change that
    // eliminates the need for the expireBans cron — Firestore returns
    // only currently-active bans (expiresAt == null OR > now), so reads
    // are bounded by the active-ban count, not total stored count.
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, size: 0, docs: [] });

    const app = createApp();

    await request(app).post('/api/device-info').send(validBody).expect(200);

    expect(mockWhere).toHaveBeenCalled();
  });

  test('matches permanent network ban (expiresAt === null) under the where-filter', async () => {
    // Permanent bans (no expiresAt) must still be returned by the OR
    // filter. A naive `where('expiresAt', '>', now)` would silently
    // drop them; the OR branch for `== null` keeps them visible.
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({
      empty: false,
      size: 1,
      docs: [
        {
          data: () => ({
            type: 'ip',
            value: '203.0.113.50',
            reason: 'Permanent IP ban',
            expiresAt: null,
          }),
        },
      ],
    });

    const app = createApp();

    const res = await request(app)
      .post('/api/device-info')
      .set('x-forwarded-for', '203.0.113.50')
      .send(validBody)
      .expect(200);

    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('network_ip');
    expect(res.body.banStatus.expiresAt).toBeNull();
  });

  test('logs truncation warning when networkBans hits the 500 limit', async () => {
    // The query is capped at 500 to bound per-request reads on the
    // Spark tier. If a deployment ever has >500 simultaneously-active
    // network bans, this log tells ops the bound was hit so they can
    // consider a different query strategy.
    const log = require('../../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    try {
      mockDocGet.mockResolvedValue({ exists: false });
      // 500 non-matching docs — exercises the truncation branch without
      // short-circuiting on a match.
      const docs = Array.from({ length: 500 }, (_, i) => ({
        data: () => ({
          type: 'ip',
          value: `10.${Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}`,
          reason: 'bulk',
          expiresAt: null,
        }),
      }));
      mockCollectionGet.mockResolvedValue({ empty: false, size: 500, docs });

      const app = createApp();

      await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.99')
        .send(validBody)
        .expect(200);

      expect(warnSpy).toHaveBeenCalledWith(
        'device-info',
        expect.stringContaining('truncat'),
        expect.objectContaining({ limit: 500 }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not log truncation warning when networkBans size < 500', async () => {
    // Regression guard: a contributor flipping `===` to `>=` or
    // changing the constant could fire the warning on every healthy
    // request. Pin the silent-success path.
    const log = require('../../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    try {
      mockDocGet.mockResolvedValue({ exists: false });
      mockCollectionGet.mockResolvedValue({
        empty: false,
        size: 3,
        docs: [
          { data: () => ({ type: 'ip', value: '10.0.0.1', reason: 'x', expiresAt: null }) },
          { data: () => ({ type: 'ip', value: '10.0.0.2', reason: 'y', expiresAt: null }) },
          { data: () => ({ type: 'ip', value: '10.0.0.3', reason: 'z', expiresAt: null }) },
        ],
      });

      const app = createApp();

      await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.99')
        .send(validBody)
        .expect(200);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
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

  // ─── Additional branch coverage tests ───────────────────────────

  describe('IP extraction', () => {
    test('falls back to req.ip when no x-forwarded-for header', async () => {
      const app = createApp();

      const res = await request(app).post('/api/device-info').send(validBody).expect(200);

      expect(res.body.success).toBe(true);
      // Without x-forwarded-for, req.ip is used (typically ::ffff:127.0.0.1 in supertest).
      // Since that's IPv6, getIpGeo returns {} without calling fetch, but the route still succeeds.
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'abc-xyz' }), {
        merge: true,
      });
    });
  });

  describe('empty/null body edge cases', () => {
    test('rejects empty body (400)', async () => {
      const app = createApp();

      const res = await request(app).post('/api/device-info').send({}).expect(400);

      expect(res.body.error).toBe('deviceId is required');
    });

    test('stores null for all optional fields when not provided', async () => {
      const app = createApp();

      await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send({ deviceId: 'minimal-device' })
        .expect(200);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'minimal-device',
          manufacturer: null,
          model: null,
          osVersion: null,
          screenResolution: null,
          screenDensity: null,
          totalRamMb: null,
          appVersion: null,
          buildNumber: null,
          locale: null,
          networkType: null,
          carrierName: null,
          firebaseInstallationId: null,
        }),
        { merge: true },
      );
    });
  });

  describe('getIpGeo branches', () => {
    test('returns empty geo for non-IPv4 address', async () => {
      global.fetch = jest.fn();

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '2001:db8::1')
        .send(validBody)
        .expect(200);

      // fetch should NOT be called for non-IPv4
      expect(global.fetch).not.toHaveBeenCalled();
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

    test('returns empty geo when ip-api returns non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.success).toBe(true);
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

    test('handles missing fields in geo response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.success).toBe(true);
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
  });

  describe('network ban types', () => {
    test('detects subnet network ban', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'subnet',
              value: '203.0.113.0/24',
              reason: 'Banned subnet',
              expiresAt: null, // permanent ban
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.50')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(true);
      expect(res.body.banStatus.banType).toBe('network_subnet');
      expect(res.body.banStatus.reason).toBe('Banned subnet');
      expect(res.body.banStatus.expiresAt).toBeNull();
    });

    test('detects ASN network ban', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'asn',
              value: 'AS2856',
              reason: 'Banned ASN',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(true);
      expect(res.body.banStatus.banType).toBe('network_asn');
      expect(res.body.banStatus.reason).toBe('Banned ASN');
    });

    test('ignores network ban with unknown type', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'unknown_type',
              value: 'something',
              reason: 'Should not match',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(false);
    });
  });

  describe('permanent bans (no expiresAt)', () => {
    test('permanent device ban (no expiresAt) is active', async () => {
      let docGetCallCount = 0;
      mockDocGet.mockImplementation(() => {
        docGetCallCount++;
        if (docGetCallCount === 1) {
          return Promise.resolve({ exists: false });
        }
        return Promise.resolve({
          exists: true,
          data: () => ({
            reason: 'Permanent ban',
            // no expiresAt — should be treated as active
          }),
        });
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(true);
      expect(res.body.banStatus.banType).toBe('device');
      expect(res.body.banStatus.reason).toBe('Permanent ban');
      expect(res.body.banStatus.expiresAt).toBeNull();
    });
  });

  describe('isIpInSubnet edge cases', () => {
    test('subnet check with /0 prefix (matches all IPs)', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'subnet',
              value: '0.0.0.0/0',
              reason: 'Global ban',
              expiresAt: null,
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.50')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(true);
      expect(res.body.banStatus.banType).toBe('network_subnet');
    });

    test('subnet check with invalid CIDR falls back safely', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'subnet',
              value: 'not-a-cidr',
              reason: 'Bad CIDR',
              expiresAt: null,
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.50')
        .send(validBody)
        .expect(200);

      // isIpInSubnet should catch the error and return false
      expect(res.body.banStatus.isBanned).toBe(false);
    });
  });

  describe('checkBans error handling', () => {
    test('returns noBan when checkBans throws', async () => {
      // First call (deviceBindings) succeeds
      // Second call (deviceBans) throws
      let docGetCallCount = 0;
      mockDocGet.mockImplementation(() => {
        docGetCallCount++;
        if (docGetCallCount === 1) {
          return Promise.resolve({ exists: false });
        }
        throw new Error('Firestore connection lost');
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      // Should gracefully return noBan
      expect(res.body.banStatus.isBanned).toBe(false);
      expect(res.body.banStatus.banType).toBeNull();
    });
  });

  describe('main route error handling', () => {
    test('returns 500 when Firestore set throws', async () => {
      mockSet.mockRejectedValueOnce(new Error('Write failed'));

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(500);

      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('non-matching network bans', () => {
    test('IP ban does not match different IP', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'ip',
              value: '10.0.0.1',
              reason: 'Wrong IP',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.50')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(false);
    });

    test('subnet ban does not match IP outside range', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'subnet',
              value: '10.0.0.0/8',
              reason: 'Internal subnet ban',
              expiresAt: null,
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.50')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(false);
    });

    test('ASN ban does not match different ASN', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockCollectionGet.mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              type: 'asn',
              value: 'AS99999',
              reason: 'Different ASN',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            }),
          },
        ],
      });

      const app = createApp();

      const res = await request(app)
        .post('/api/device-info')
        .set('x-forwarded-for', '203.0.113.1')
        .send(validBody)
        .expect(200);

      expect(res.body.banStatus.isBanned).toBe(false);
    });
  });
});
