/**
 * routes/device-info.js — UNIT tests (SHY-0149).
 *
 * The mock-necessary slices relocated from the old fully-mocked
 * routes/device-info.test.js during its real-emulator migration:
 *
 *  - getIpGeo branches: ip-api.com is a third-party HTTP service — its
 *    failure shapes (non-ok, malformed, network error, HANG) cannot be
 *    induced for real without depending on the live service in CI.
 *  - the geo fetch TIMEOUT contract: a hung ip-api must not hang
 *    /api/device-info (pre-existing defect fixed under SHY-0149 — the
 *    fetch had no AbortSignal, so a stalled upstream stalled sign-in).
 *  - the route's 500 posture when Firestore itself throws.
 *
 * Everything else about this route runs against the REAL emulator in
 * tests/routes/device-info.test.js.
 */

const mockSet = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn().mockResolvedValue({ exists: false });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockDocGet(path), set: mockSet })),
    collection: jest.fn(),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// The ban engine has its own suites (unit + real-emulator); stub it benign.
// `countBoundDevices` returns 0 so the device-binding cap (SHY-0149 C1) never
// trips here — the cap itself is proven against the real emulator in
// tests/routes/devices-lock-check.test.js.
jest.mock('../../src/utils/bans', () => ({
  checkBans: async () => ({ isBanned: false, banType: null, reason: null, expiresAt: null }),
  countBoundDevices: async () => 0,
  MAX_BOUND_DEVICES: 20,
}));

const express = require('express');
const request = require('supertest');
const deviceInfoRouter = require('../../src/routes/device-info');

const originalFetch = global.fetch;
const mockFetch = jest.fn();

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // mirrors express-api/src/index.js
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    req.auth = { uid: 'unit-uid', uniqueId: '9001' };
    next();
  });
  app.use('/api', deviceInfoRouter);
  return app;
}

function postDeviceInfo({ ip, body } = {}) {
  const req = request(createApp()).post('/api/device-info');
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send(body ?? { deviceId: 'dev-unit-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSet.mockReset();
  mockSet.mockResolvedValue();
  mockDocGet.mockReset();
  mockDocGet.mockResolvedValue({ exists: false });
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('getIpGeo branches (third-party HTTP — unit-mocked by necessity)', () => {
  test('non-IPv4 client address short-circuits: no outbound geo call at all', async () => {
    // No X-Forwarded-For → req.ip is the IPv6-mapped loopback.
    await postDeviceInfo().expect(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('a successful geo response maps isp/asn/country/region onto the stored doc', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        isp: 'ExampleNet',
        as: 'AS64500 ExampleNet Ltd',
        country: 'Sweden',
        regionName: 'Stockholm',
      }),
    });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);

    const stored = mockSet.mock.calls[0][0];
    expect(stored).toMatchObject({
      isp: 'ExampleNet',
      asn: 'AS64500',
      country: 'Sweden',
      region: 'Stockholm',
      lastIp: '203.0.113.9',
    });
  });

  test('a non-ok geo response degrades to null geo fields (no crash)', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({ isp: null, asn: null, country: null });
  });

  test('missing fields in the geo payload store as nulls', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ country: 'Sweden' }) });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({
      isp: null,
      asn: null,
      country: 'Sweden',
      region: null,
    });
  });

  test('a geo network failure degrades to null geo fields (no crash)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({ isp: null, asn: null });
  });

  test('the geo fetch carries an abort timeout so a hung ip-api cannot hang device-info', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('203.0.113.9'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('an abort (timeout fired) degrades to null geo fields like any failure', async () => {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({ isp: null, asn: null });
  });
});

describe('route error posture', () => {
  test('returns 500 when the Firestore write throws', async () => {
    mockSet.mockRejectedValue(new Error('firestore down'));

    const res = await postDeviceInfo().expect(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
