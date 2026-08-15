/**
 * GET /api/ban-status — REAL-services integration test.
 *
 * SHY-0143 C1. The cold-start ban gate has to work with NO Firebase session:
 * a banned user who is signed out must still be shown the ban screen rather
 * than the login screen, and a banned network must stop a device on which
 * nobody has ever signed in. `/api/device-info` cannot answer that — it is
 * auth-gated, so the client throws before it sends and the repository's
 * catch reports "not banned". This endpoint is the unauthenticated,
 * READ-ONLY answer to the same question.
 *
 * It deliberately does no writes. `/api/device-info` upserts a device
 * binding and runs a cap transaction, which is why it must stay authed and
 * why calling it on every cold start (and every Android rotation) was the
 * wrong shape regardless of the auth problem.
 *
 * Everything runs against the REAL Firestore emulator with the REAL router.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin
 * SDK targets localhost. PER-FILE opt-in only — never prepend NODE_ENV=local
 * to the canonical `npm test`.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const banStatusRouter = require('../../src/routes/ban-status');
const { clearBanCache } = require('../../src/utils/bans');

const DEVICE_BANS = 'deviceBans';
const NETWORK_BANS = 'networkBans';
// Namespaced so cleanup is scoped — Jest runs files in parallel workers
// against ONE emulator project.
const ID_PREFIX = 'bst-';

const CLIENT_IP = '198.51.100.51'; // TEST-NET-2 — real IPv4 shape, geo-inert

/**
 * Mounts the router with NO auth middleware in front, which is the whole
 * point: production reaches this route through `index.js`'s auth-skip list,
 * so the test must exercise the same unauthenticated path.
 */
function createApp() {
  const app = express();
  app.set('trust proxy', 1); // mirrors express-api/src/index.js
  app.use(express.json());
  app.use('/api', banStatusRouter);
  return app;
}

function check(deviceId, { ip } = {}) {
  const req = request(createApp())
    .get('/api/ban-status')
    .query(deviceId === undefined ? {} : { deviceId });
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send();
}

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearBanCache();
  await clearPrefixed(db, DEVICE_BANS, ID_PREFIX);
  await clearPrefixed(db, NETWORK_BANS, ID_PREFIX);
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('no authentication required', () => {
  test('answers with no Authorization header at all', async () => {
    const res = await check(`${ID_PREFIX}unbanned-1`, { ip: CLIENT_IP });

    // The assertion that matters is 200, not the verdict: a 401 here is the
    // C1 defect, and it is what the client silently turned into "not banned".
    expect(res.status).toBe(200);
    expect(res.body.banStatus).toEqual(expect.objectContaining({ isBanned: false }));
  });

  test('an unknown device on a clean network is not banned', async () => {
    const res = await check(`${ID_PREFIX}never-seen`, { ip: CLIENT_IP });

    expect(res.status).toBe(200);
    expect(res.body.banStatus.isBanned).toBe(false);
  });
});

describe('device bans, with nobody signed in', () => {
  test('a banned deviceId is reported as a DEVICE ban', async () => {
    const deviceId = `${ID_PREFIX}banned-device`;
    await db.doc(`${DEVICE_BANS}/${deviceId}`).set({
      reason: 'Evading a prior suspension',
      expiresAt: null,
      bannedAt: new Date().toISOString(),
    });

    const res = await check(deviceId, { ip: CLIENT_IP });

    expect(res.status).toBe(200);
    expect(res.body.banStatus).toEqual(
      expect.objectContaining({ isBanned: true, banType: 'device' }),
    );
  });

  test('the reason and expiry reach the client, not just the fact of a ban', async () => {
    // BanScreen renders (banType, reason, expiresAt). A user banned by a rule
    // they did not cause has no idea whether it lasts an hour or forever, or
    // how to appeal, if the detail is dropped in transit.
    const deviceId = `${ID_PREFIX}detailed`;
    const expiresAt = '2099-09-01T00:00:00.000Z';
    await db.doc(`${DEVICE_BANS}/${deviceId}`).set({
      reason: 'Evading a prior suspension',
      expiresAt,
      bannedAt: new Date().toISOString(),
    });

    const res = await check(deviceId, { ip: CLIENT_IP });

    expect(res.body.banStatus.reason).toBe('Evading a prior suspension');
    expect(res.body.banStatus.expiresAt).toBe(expiresAt);
  });

  test('an EXPIRED device ban does not block', async () => {
    const deviceId = `${ID_PREFIX}expired`;
    await db.doc(`${DEVICE_BANS}/${deviceId}`).set({
      reason: 'Old news',
      expiresAt: '2000-01-01T00:00:00.000Z',
      bannedAt: '1999-01-01T00:00:00.000Z',
    });

    const res = await check(deviceId, { ip: CLIENT_IP });

    expect(res.body.banStatus.isBanned).toBe(false);
  });
});

describe('network bans, with nobody signed in', () => {
  test('a banned IP is reported as a NETWORK ban', async () => {
    // The scenario the story names: a blocked VPN or subnet must stop a
    // device on which nobody has ever signed in.
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}ip`).set({
      type: 'ip',
      value: CLIENT_IP,
      reason: 'Known VPN exit',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });

    const res = await check(`${ID_PREFIX}clean-device`, { ip: CLIENT_IP });

    expect(res.status).toBe(200);
    expect(res.body.banStatus.isBanned).toBe(true);
    // `checkBans` reports the network ban's SUBTYPE (`network_ip`,
    // `network_subnet`, `network_asn`), not a bare "network". Asserted as it
    // actually is rather than as one might assume: the client's
    // `BanStatus.toBanState()` treats only `"device"` as a device ban and maps
    // everything else — including a subtype it has never seen — to a network
    // ban, which is the fail-closed rule that lets the server add a category
    // without the client turning it into a silent bypass.
    expect(res.body.banStatus.banType).toBe('network_ip');
    expect(res.body.banStatus.banType).not.toBe('device');
    expect(res.body.banStatus.reason).toBe('Known VPN exit');
  });

  test('a different IP is unaffected by that ban', async () => {
    await db.collection(NETWORK_BANS).doc(`${ID_PREFIX}ip2`).set({
      type: 'ip',
      value: CLIENT_IP,
      reason: 'Known VPN exit',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });

    const res = await check(`${ID_PREFIX}clean-device`, { ip: '198.51.100.99' });

    expect(res.body.banStatus.isBanned).toBe(false);
  });
});

describe('input handling', () => {
  test('a missing deviceId is rejected rather than treated as unbanned', async () => {
    // Silently answering "not banned" is the failure mode this whole endpoint
    // exists to remove; a malformed request must be visibly wrong.
    const res = await check(undefined, { ip: CLIENT_IP });

    expect(res.status).toBe(400);
  });

  test('a malformed deviceId is rejected', async () => {
    const res = await check('../../etc/passwd', { ip: CLIENT_IP });

    expect(res.status).toBe(400);
  });

  test('the route performs no writes', async () => {
    // `/api/device-info` upserts a deviceBindings doc and runs a cap
    // transaction. This one must be a pure read: it is unauthenticated and
    // called on every cold start, so any write is both a quota cost and an
    // abuse surface.
    const deviceId = `${ID_PREFIX}no-write`;

    await check(deviceId, { ip: CLIENT_IP });

    const binding = await db.doc(`deviceBindings/${deviceId}`).get();
    expect(binding.exists).toBe(false);
  });
});
