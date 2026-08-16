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
    // The route's binding write runs inside a transaction (SHY-0149 C-NEW-2).
    // The fake buffers writes and commits them after the callback, exactly as
    // Firestore does — so a rejecting `mockSet` still fails the transaction
    // (and the route still answers 500), and assertions keep reading
    // `mockSet.mock.calls[0][0]` as the written document.
    runTransaction: async (fn) => {
      const writes = [];
      await fn({
        get: (refOrQuery) => mockDocGet(refOrQuery?._path),
        set: (_ref, data, opts) => writes.push([data, opts]),
      });
      for (const [data, opts] of writes) await mockSet(data, opts);
    },
  },
}));

// Mirrors the REAL module's surface. `debug` was missing, and SHY-0299's
// observability line — `log.debug(...)` on an unresolved geo lookup — was
// therefore `undefined()`, a TypeError caught by the route's handler and
// served as a 500. The route worked; the MIRROR was incomplete
// ([[feedback-harness-mirror-drifts-into-phantom-fields]], in reverse: a
// missing method rather than a phantom one). Keep this in step with
// src/utils/log.js.
jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
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
  rollbackBindingIfOverCap: async () => false,
  clearBanCache: () => {},
  MAX_BOUND_DEVICES: 20,
}));

const express = require('express');
const request = require('supertest');
const deviceInfoRouter = require('../../src/routes/device-info');
const { clearIpGeoCache } = require('../../src/utils/ip-geo');

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
  // SHY-0143 gave getIpGeo a 5-minute cache (ip-api's free tier is ~45 req/min
  // per CALLING ip, shared by every user, and the cold-start path now hits it).
  // Without clearing, one case's stubbed response is served to the next and the
  // fetch-branch assertions below stop exercising the branches they name.
  clearIpGeoCache();
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
      // `status` is part of the real wire shape now: SHY-0143 added it to the
      // request's `fields` mask so the fail-closed guard can actually fire.
      // A fixture without it is a fixture of a response ip-api never sends.
      json: async () => ({
        status: 'success',
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

  test('a non-ok geo response OMITS the geo fields (SHY-0299)', async () => {
    // Was `toMatchObject({ isp: null, asn: null, country: null })`, which
    // pinned the bug as the contract. Under `merge: true` an explicit null
    // OVERWRITES — it is not the same as omitting the key — so a failed
    // lookup replaced a known-good ASN with null, and `bans.js` filters those
    // out, so an ASN-scoped ban stopped matching that device for up to ~5.5
    // minutes ([[feedback-tests-can-pin-the-bug-as-the-contract]]).
    mockFetch.mockResolvedValue({ ok: false });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    const written = mockSet.mock.calls[0][0];
    expect(written).not.toHaveProperty('isp');
    expect(written).not.toHaveProperty('asn');
    expect(written).not.toHaveProperty('country');
    expect(written).not.toHaveProperty('region');
    // The rest of the document is unaffected — this is about which KEYS the
    // existing write carries, not about skipping the write.
    expect(written).toMatchObject({ lastIp: '203.0.113.9' });
  });

  test('a PARTIAL geo payload writes what it has and omits the rest (SHY-0299)', async () => {
    // The important half: a partial result must not erase the fields it does
    // not carry. Previously `country: 'Sweden'` arrived alongside
    // `asn: null`, wiping a known ASN on a lookup that partly SUCCEEDED.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', country: 'Sweden' }),
    });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    const written = mockSet.mock.calls[0][0];
    expect(written).toMatchObject({ country: 'Sweden' });
    expect(written).not.toHaveProperty('isp');
    expect(written).not.toHaveProperty('asn');
    expect(written).not.toHaveProperty('region');
  });

  test('a geo network failure omits the geo fields (no crash) (SHY-0299)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    const written = mockSet.mock.calls[0][0];
    expect(written).not.toHaveProperty('isp');
    expect(written).not.toHaveProperty('asn');
  });

  test('the geo fetch carries an abort timeout so a hung ip-api cannot hang device-info', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('203.0.113.9'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('an abort (timeout fired) omits the geo fields like any failure (SHY-0299)', async () => {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    const written = mockSet.mock.calls[0][0];
    expect(written).not.toHaveProperty('isp');
    expect(written).not.toHaveProperty('asn');
  });

  test('a SUCCESSFUL lookup still writes every geo field (SHY-0299 control)', async () => {
    // Without this, omitting the keys unconditionally would satisfy every
    // assertion above while recording no geo at all — which is the same
    // security hole by another route.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        isp: 'ExampleNet',
        as: 'AS64500 Example',
        country: 'Sweden',
        regionName: 'Stockholm',
      }),
    });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({
      isp: 'ExampleNet',
      asn: 'AS64500',
      country: 'Sweden',
      region: 'Stockholm',
    });
  });

  test('a later SUCCESSFUL lookup writes the NEW asn — last-known, not append-only', async () => {
    // The other direction of the fix. Omitting keys under merge means a field
    // can never be CLEARED, so the risk is a stale value outliving a genuine
    // network change (roaming, VPN on). It must be overwritten by the next
    // success. This case lives here rather than in the route suite because
    // inducing a real ip-api SUCCESS needs a real answer from a third party.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', as: 'AS64999 Someone Else' }),
    });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    expect(mockSet.mock.calls[0][0]).toMatchObject({ asn: 'AS64999' });
  });

  test('an EMPTY-STRING asn is treated as absent, not written as an empty ASN', async () => {
    // `getIpGeo` maps ip-api's `as: ""` (an unrouted address) to null. An
    // empty string reaching the document would be stored, then filtered out
    // by `bans.js`'s `filter(Boolean)` anyway — a value that looks recorded
    // and matches nothing.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', as: '', isp: 'ExampleNet' }),
    });

    await postDeviceInfo({ ip: '203.0.113.9' }).expect(200);
    const written = mockSet.mock.calls[0][0];
    expect(written).not.toHaveProperty('asn');
    expect(written).toMatchObject({ isp: 'ExampleNet' });
  });
});

describe('route error posture', () => {
  test('returns 500 when the Firestore write throws', async () => {
    mockSet.mockRejectedValue(new Error('firestore down'));

    const res = await postDeviceInfo().expect(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
