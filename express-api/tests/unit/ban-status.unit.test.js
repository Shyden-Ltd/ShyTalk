/**
 * `GET /api/ban-status` — the geo→ASN wiring.
 *
 * SHY-0143 R7/C-1. The route resolves the caller's ASN and passes it to
 * `checkBans`, and that is the ONLY reason `getIpGeo` is on this path: an
 * ASN-scoped network ban has to reach a signed-out cold start, which is the
 * whole point of the endpoint.
 *
 * It was also the one thing untested. Replacing
 *
 *   checkBans(deviceId, req.ip, geo.asn || null)
 * with
 *   checkBans(deviceId, req.ip, null)
 *
 * left the entire Express suite green — the integration suite's client IP is
 * a TEST-NET address that can never yield an ASN, and nothing else imports
 * this route. That is the same shape as the earlier finding on this story
 * ("a guard registered in a bootstrap file nothing exercises is a guard
 * nobody is checking"), one layer down.
 *
 * `fetch` is stubbed here by necessity — ip-api.com is a third party, and its
 * failure branches cannot be induced for real. This mirrors the
 * `getIpGeo branches (third-party HTTP — unit-mocked by necessity)` block in
 * `tests/unit/device-info.unit.test.js`; the Firestore side is the REAL
 * emulator, as everywhere else.
 *
 * NODE_ENV='local' is set BEFORE requiring firebase so the Admin SDK targets
 * the emulator. PER-FILE opt-in only.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const banStatusRouter = require('../../src/routes/ban-status');
const { clearBanCache } = require('../../src/utils/bans');
const { clearIpGeoCache } = require('../../src/utils/ip-geo');

const NETWORK_BANS = 'networkBans';
const DEVICE_BANS = 'deviceBans';
const ID_PREFIX = 'bsu-';

// A routable-looking IPv4 so `getIpGeo`'s format guard passes and the stubbed
// fetch is actually reached. Distinct per test so the geo cache cannot serve
// one case's answer to another.
const ipFor = (n) => `203.0.113.${n}`;

const originalFetch = global.fetch;

function stubGeo(response) {
  global.fetch = jest.fn(async () => response);
}

const okJson = (body) => ({ ok: true, json: async () => body });

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', banStatusRouter);
  return app;
}

const check = (deviceId, ip) =>
  request(createApp()).get('/api/ban-status').query({ deviceId }).set('X-Forwarded-For', ip).send();

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearBanCache();
  // Without this, case 1's ASN is served to the geo-failure case and the
  // negative assertion passes for the wrong reason.
  clearIpGeoCache();
  await clearPrefixed(db, NETWORK_BANS, ID_PREFIX);
  await clearPrefixed(db, DEVICE_BANS, ID_PREFIX);
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('an ASN-scoped ban reaches a caller with no session', () => {
  test('a banned ASN blocks, resolved from the geo lookup', async () => {
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}asn`).set({
      type: 'asn',
      value: '64500',
      reason: 'Hosting provider used for evasion',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    stubGeo(okJson({ status: 'success', as: 'AS64500 Example Networks' }));

    const res = await check(`${ID_PREFIX}dev-a`, ipFor(10));

    expect(res.status).toBe(200);
    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('network_asn');
    expect(res.body.banStatus.reason).toBe('Hosting provider used for evasion');
  });

  test('the AS-prefixed spelling of the same ASN also blocks', async () => {
    // `normalizeAsn` exists because operators write both `64500` and
    // `AS64500`. SHY-0149 fixed that, and nothing on this route pinned it.
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}asn2`).set({
      type: 'asn',
      value: 'AS64500',
      reason: 'Same ban, other spelling',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    stubGeo(okJson({ status: 'success', as: 'AS64500 Example Networks' }));

    const res = await check(`${ID_PREFIX}dev-b`, ipFor(11));

    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('network_asn');
  });

  test('a DIFFERENT ASN is unaffected by that ban', async () => {
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}asn3`).set({
      type: 'asn',
      value: '64500',
      reason: 'x',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    stubGeo(okJson({ status: 'success', as: 'AS64999 Someone Else' }));

    const res = await check(`${ID_PREFIX}dev-c`, ipFor(12));

    expect(res.body.banStatus.isBanned).toBe(false);
  });
});

describe('when the ASN cannot be resolved', () => {
  test('the ASN ban does NOT match — fail-open, deliberately', async () => {
    // Asserted so the posture is a decision on the record rather than an
    // accident. It is also exactly the degradation the geo cache's negative
    // TTL exists to bound: while ip-api is unreachable, ASN-scoped bans stop
    // matching for everyone, so the outbound rate during failure has to stay
    // below the shared quota or the outage sustains itself.
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}asn4`).set({
      type: 'asn',
      value: '64500',
      reason: 'x',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    stubGeo({ ok: false, json: async () => ({}) });

    const res = await check(`${ID_PREFIX}dev-d`, ipFor(13));

    expect(res.status).toBe(200);
    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('an IP ban still blocks when the geo lookup fails', async () => {
    // The other half: losing the ASN must not lose the ban types that need
    // no geo at all, or one third-party outage disables network banning
    // entirely rather than just its ASN tier.
    await db
      .collection(NETWORK_BANS)
      .doc(`${ID_PREFIX}ip`)
      .set({
        type: 'ip',
        value: ipFor(14),
        reason: 'Known VPN exit',
        expiresAt: null,
        createdAt: new Date().toISOString(),
      });
    stubGeo({ ok: false, json: async () => ({}) });

    const res = await check(`${ID_PREFIX}dev-e`, ipFor(14));

    expect(res.body.banStatus.isBanned).toBe(true);
    expect(res.body.banStatus.banType).toBe('network_ip');
  });
});
