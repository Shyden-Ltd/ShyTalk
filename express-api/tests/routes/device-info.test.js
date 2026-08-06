/**
 * POST /api/device-info — REAL-services integration test (SHY-0149
 * migration off the old fully-mocked suite; No-Stubs debt, EPIC-0003
 * pattern).
 *
 * Everything here runs against the REAL Firestore + Auth emulator with the
 * REAL authMiddleware in front of the router — storage shapes, binding
 * reconciliation, and ban reporting are proven end-to-end, not against a
 * hand-rolled db chain. The two mock-necessary slices moved to unit files:
 * getIpGeo's third-party HTTP branches + the Firestore-throws 500 posture
 * (tests/unit/device-info.unit.test.js) and the ban engine's pure edges
 * (tests/unit/bans.unit.test.js).
 *
 * IP notes: requests that need an IPv4 client address send it as the
 * rightmost X-Forwarded-For entry under `trust proxy: 1` — exactly how the
 * production edge delivers it (`req.ip`). TEST-NET addresses (RFC 5737)
 * keep the best-effort geo lookup inert (ip-api rejects reserved ranges;
 * the route degrades to null geo either way). Requests with no XFF ride
 * the IPv6-mapped loopback, which short-circuits geo entirely. Sign-in ASN
 * ban matching is geo-derived and therefore pinned at the unit layer + via
 * stored-binding ASNs in the auth-ban-gate suite.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin
 * SDK + Auth emulator target localhost. PER-FILE opt-in only — never
 * prepend NODE_ENV=local to the canonical `npm test`
 * (feedback-express-suite-no-node-env-override).
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const deviceInfoRouter = require('../../src/routes/device-info');

const DEVICE_BINDINGS = 'deviceBindings';
// Every document this file creates is namespaced, so its cleanup can be
// scoped — Jest runs files in parallel workers against ONE emulator project,
// and a collection-wide wipe deletes what another worker just seeded.
const ID_PREFIX = 'dvi-';

const DEVICE_BANS = 'deviceBans';
const NETWORK_BANS = 'networkBans';

const CLIENT_IP = '198.51.100.42'; // TEST-NET-2 — real IPv4 shape, geo-inert
const OTHER_IP = '198.51.100.77';

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // mirrors express-api/src/index.js:33
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', deviceInfoRouter);
  return app;
}

/** POST device-info as `caller`; `ip` rides as the edge-delivered (rightmost) XFF. */
function submit(caller, body, { ip } = {}) {
  const req = request(createApp()).post('/api/device-info').set(caller.headers);
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send(body);
}

const readBinding = async (deviceId) => {
  const snap = await db.doc(`${DEVICE_BINDINGS}/${deviceId}`).get();
  return snap.exists ? snap.data() : null;
};

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearAuthCaches();
  await clearPrefixed(db, DEVICE_BINDINGS, ID_PREFIX);
  await clearPrefixed(db, DEVICE_BANS, ID_PREFIX);
  await clearPrefixed(db, NETWORK_BANS, ID_PREFIX);
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('input validation', () => {
  test('rejects a missing deviceId (400)', async () => {
    const caller = await mintRealUser({ uniqueId: '7001' });
    const res = await submit(caller, { platform: 'android' }).expect(400);
    expect(res.body).toEqual({ error: 'deviceId is required' });
  });

  test('rejects an empty body (400)', async () => {
    const caller = await mintRealUser({ uniqueId: '7002' });
    await submit(caller, {}).expect(400);
  });

  test('rejects a deviceId containing "/" — no Firestore path redirection (SHY-0170)', async () => {
    const caller = await mintRealUser({ uniqueId: '7003' });
    const res = await submit(caller, { deviceId: 'evil/../../users' }).expect(400);
    expect(res.body).toEqual({ error: 'deviceId is invalid' });
  });
});

describe('storage', () => {
  test('stores the submitted device info with the REAL edge IP and binding timestamps', async () => {
    const caller = await mintRealUser({ uniqueId: '7010' });

    const res = await submit(
      caller,
      {
        deviceId: 'dvi-dev-store-1',
        manufacturer: 'Samsung',
        model: 'SM-S911B',
        osVersion: '15',
        locale: 'en-GB',
        appVersion: '1.2.3',
      },
      { ip: CLIENT_IP },
    ).expect(200);
    expect(res.body.success).toBe(true);

    const binding = await readBinding('dvi-dev-store-1');
    expect(binding).toMatchObject({
      deviceId: 'dvi-dev-store-1',
      manufacturer: 'Samsung',
      model: 'SM-S911B',
      osVersion: '15',
      locale: 'en-GB',
      appVersion: '1.2.3',
      lastIp: CLIENT_IP,
      uniqueId: '7010',
    });
    expect(binding.firstSeen).toBeDefined();
    expect(binding.boundAt).toBeDefined();
    expect(binding.lastSeenAt).toBeDefined();
  });

  test('stores null for optional fields that are not provided', async () => {
    const caller = await mintRealUser({ uniqueId: '7011' });
    await submit(caller, { deviceId: 'dvi-dev-nulls-1' }).expect(200);

    const binding = await readBinding('dvi-dev-nulls-1');
    expect(binding).toMatchObject({
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
    });
  });

  test('sets firstSeen/boundAt only on the FIRST submission; later ones update lastSeenAt', async () => {
    const caller = await mintRealUser({ uniqueId: '7012' });

    await submit(caller, { deviceId: 'dvi-dev-again-1' }).expect(200);
    const first = await readBinding('dvi-dev-again-1');

    await new Promise((r) => setTimeout(r, 5));
    await submit(caller, { deviceId: 'dvi-dev-again-1', model: 'iPhone16,2' }).expect(200);
    const second = await readBinding('dvi-dev-again-1');

    expect(second.firstSeen).toBe(first.firstSeen);
    expect(second.boundAt).toBe(first.boundAt);
    expect(second.model).toBe('iPhone16,2');
    expect(second.lastSeenAt >= first.lastSeenAt).toBe(true);
  });

  test('a forged leftmost X-Forwarded-For is ignored — the stored lastIp is the edge-delivered entry', async () => {
    const caller = await mintRealUser({ uniqueId: '7013' });

    await submit(
      caller,
      { deviceId: 'dvi-dev-forge-1' },
      { ip: `${OTHER_IP}, ${CLIENT_IP}` },
    ).expect(200);
    expect((await readBinding('dvi-dev-forge-1')).lastIp).toBe(CLIENT_IP);
  });
});

describe('binding reconciliation (SHY-0170)', () => {
  test('does NOT rebind a device already owned by a DIFFERENT user', async () => {
    await db.doc(`${DEVICE_BINDINGS}/dvi-dev-foreign-1`).set({ uniqueId: '7098', boundAt: 42 });
    const caller = await mintRealUser({ uniqueId: '7020' });

    await submit(caller, { deviceId: 'dvi-dev-foreign-1' }).expect(200);
    expect((await readBinding('dvi-dev-foreign-1')).uniqueId).toBe('7098');
  });

  test('re-affirms the binding when the device is already the CALLER’s', async () => {
    await db.doc(`${DEVICE_BINDINGS}/dvi-dev-mine-1`).set({ uniqueId: '7021', boundAt: 42 });
    const caller = await mintRealUser({ uniqueId: '7021' });

    await submit(caller, { deviceId: 'dvi-dev-mine-1', manufacturer: 'Google' }).expect(200);
    const binding = await readBinding('dvi-dev-mine-1');
    expect(binding.uniqueId).toBe('7021');
    expect(binding.manufacturer).toBe('Google');
  });
});

describe('sign-in ban report (banStatus)', () => {
  test('reports isBanned=false when nothing matches', async () => {
    const caller = await mintRealUser({ uniqueId: '7030' });
    const res = await submit(caller, { deviceId: 'dvi-dev-clean-1' }, { ip: CLIENT_IP }).expect(
      200,
    );
    expect(res.body.banStatus).toEqual({
      isBanned: false,
      banType: null,
      reason: null,
      expiresAt: null,
    });
  });

  test('reports an active device ban on the SUBMITTED deviceId', async () => {
    await db.doc(`${DEVICE_BANS}/dvi-dev-banned-1`).set({
      deviceId: 'dvi-dev-banned-1',
      reason: 'abuse',
      expiresAt: null,
    });
    const caller = await mintRealUser({ uniqueId: '7031' });

    const res = await submit(caller, { deviceId: 'dvi-dev-banned-1' }).expect(200);
    expect(res.body.banStatus).toEqual({
      isBanned: true,
      banType: 'device',
      reason: 'abuse',
      expiresAt: null,
    });
  });

  test('an EXPIRED device ban does not report banned', async () => {
    await db.doc(`${DEVICE_BANS}/dvi-dev-expired-1`).set({
      deviceId: 'dvi-dev-expired-1',
      reason: 'old',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const caller = await mintRealUser({ uniqueId: '7032' });

    const res = await submit(caller, { deviceId: 'dvi-dev-expired-1' }).expect(200);
    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('reports a PERMANENT network IP ban (expiresAt null) matched on the real edge IP', async () => {
    await db.doc(`${NETWORK_BANS}/dvi-nb-perm-1`).set({
      type: 'ip',
      value: CLIENT_IP,
      reason: 'network abuse',
      expiresAt: null,
    });
    const caller = await mintRealUser({ uniqueId: '7033' });

    const res = await submit(caller, { deviceId: 'dvi-dev-net-1' }, { ip: CLIENT_IP }).expect(200);
    expect(res.body.banStatus).toMatchObject({ isBanned: true, banType: 'network_ip' });
  });

  test('an EXPIRED network ban is excluded by the active-bans query', async () => {
    await db.doc(`${NETWORK_BANS}/dvi-nb-old-1`).set({
      type: 'ip',
      value: CLIENT_IP,
      reason: 'old',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const caller = await mintRealUser({ uniqueId: '7034' });

    const res = await submit(caller, { deviceId: 'dvi-dev-net-2' }, { ip: CLIENT_IP }).expect(200);
    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('reports a subnet ban catching the edge IP', async () => {
    await db.doc(`${NETWORK_BANS}/dvi-nb-subnet-1`).set({
      type: 'subnet',
      value: '198.51.100.0/24',
      reason: 'subnet abuse',
      expiresAt: null,
    });
    const caller = await mintRealUser({ uniqueId: '7035' });

    const res = await submit(caller, { deviceId: 'dvi-dev-net-3' }, { ip: CLIENT_IP }).expect(200);
    expect(res.body.banStatus).toMatchObject({ isBanned: true, banType: 'network_subnet' });
  });

  test('an unknown network-ban type is ignored (no crash, not banned)', async () => {
    await db.doc(`${NETWORK_BANS}/dvi-nb-weird-1`).set({
      type: 'carrier-pigeon',
      value: CLIENT_IP,
      reason: 'nonsense',
      expiresAt: null,
    });
    const caller = await mintRealUser({ uniqueId: '7036' });

    const res = await submit(caller, { deviceId: 'dvi-dev-net-4' }, { ip: CLIENT_IP }).expect(200);
    expect(res.body.banStatus.isBanned).toBe(false);
  });

  test('a forged leftmost XFF cannot dodge a network ban at sign-in', async () => {
    await db.doc(`${NETWORK_BANS}/dvi-nb-forge-1`).set({
      type: 'ip',
      value: CLIENT_IP,
      reason: 'network abuse',
      expiresAt: null,
    });
    const caller = await mintRealUser({ uniqueId: '7037' });

    const res = await submit(
      caller,
      { deviceId: 'dvi-dev-net-5' },
      { ip: `${OTHER_IP}, ${CLIENT_IP}` }, // clean decoy left, real IP right
    ).expect(200);
    expect(res.body.banStatus).toMatchObject({ isBanned: true, banType: 'network_ip' });
  });
});
