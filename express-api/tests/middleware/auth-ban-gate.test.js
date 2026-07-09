/**
 * Per-request ban gate in authMiddleware — REAL-services integration test
 * (SHY-0149, EPIC-0005).
 *
 * Bans used to be checked in exactly ONE place: the app's /api/device-info
 * call at sign-in. The web, direct API calls, modified clients, and
 * already-signed-in sessions were never re-checked — a banned user with a
 * valid token could act freely. This suite pins the authoritative fix: a
 * per-request ban gate inside the shared authMiddleware (mirroring the
 * suspension check), fed the REAL edge IP (`req.ip` under `trust proxy: 1`,
 * index.js:33), never the client-forgeable leftmost `X-Forwarded-For`.
 *
 * Contract pinned (all against the REAL Firestore + Auth emulator — a mocked
 * db cannot prove Filter.or owner resolution, String/Number legacy linkage,
 * or admin-route cache invalidation, which are the point of the control):
 *   Device bans   — linkedUniqueId (String + legacy Number) → 403; a ban on a
 *                   device BOUND to the caller (uniqueId or legacy userId,
 *                   even without linkage) → 403; expired ban → passes.
 *   Network bans  — ip / subnet / asn (ASN from the caller's stored device
 *                   bindings — no per-request geo call) → 403.
 *   XFF           — the matched IP is `req.ip` (rightmost = edge-appended);
 *                   forged leftmost entries change nothing, in the gate AND
 *                   in /api/device-info's stored lastIp + banStatus.
 *   Mid-session   — a ban issued through the REAL admin route bites on the
 *                   caller's very next request (cache invalidated on issue).
 *   Caching       — bounded per-uid cache (5-min TTL family): a direct doc
 *                   delete does NOT lift the ban until clearBanCache().
 *   Exemptions    — the suspension-exempt paths (appeal / delete /
 *                   data-export…) PLUS the ban-delivery channels
 *                   (/device-info, /devices/lock-check) stay reachable, so a
 *                   banned app user still receives the ban screen instead of
 *                   a generic error.
 *   Response      — exactly { error, code, banType, reason, expiresAt };
 *                   no internal fields (linkedUniqueId, createdBy) leak.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin
 * SDK + Auth emulator target localhost. PER-FILE opt-in only — never prepend
 * NODE_ENV=local to the canonical `npm test`
 * (feedback-express-suite-no-node-env-override).
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const authModule = require('../../src/middleware/auth');
const { authMiddleware, authMiddlewareStrict, clearBanCache } = authModule;
const { BINDINGS_SCAN_LIMIT } = require('../../src/utils/bans');
const deviceInfoRouter = require('../../src/routes/device-info');
const suggestionsRouter = require('../../src/routes/suggestions');
const adminBansRouter = require('../../src/routes/admin-bans');

const DEVICE_BANS = 'deviceBans';
const NETWORK_BANS = 'networkBans';
const DEVICE_BINDINGS = 'deviceBindings';
const USERS = 'users';
const SUGGESTIONS = 'suggestions';

/**
 * Probe app replicating the production wiring that matters to the gate:
 * `trust proxy: 1` exactly as express-api/src/index.js:33 (the XFF tests are
 * meaningless without it) + the REAL authMiddleware ahead of the routes.
 */
function createProbeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  // Sensitive probe: any auth-gated mutation stands in for "every sensitive route".
  app.post('/api/probe/sensitive', (req, res) => res.json({ ok: true, via: 'probe' }));
  // Suspension-exempt shapes (mirroring the auth.js exempt list) — a banned
  // user must keep appeal + GDPR access.
  app.post('/api/users/:id/appeal', (req, res) => res.json({ ok: true, via: 'appeal' }));
  app.get('/api/users/:id/data-export', (req, res) => res.json({ ok: true, via: 'export' }));
  return app;
}

function createRouterApp(router) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', router);
  return app;
}

/**
 * The STRICT middleware guards every /api/portal/* route. Its ban block is a
 * near-duplicate of authMiddleware's, so it needs its own real proof — a
 * duplicated security branch that no test executes is unverified.
 */
function createStrictProbeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddlewareStrict);
  app.post('/api/portal/revoke-all-sessions', (req, res) => res.json({ ok: true }));
  app.get('/api/portal/me', (req, res) => res.json({ ok: true, via: 'portal-me' }));
  return app;
}

const EDGE_IP = '203.0.113.77'; // "real" client IP as the edge proxy reports it
const CLEAN_IP = '198.51.100.9'; // unbanned decoy the attacker forges

async function seedDeviceBan(deviceId, data = {}) {
  await db.doc(`${DEVICE_BANS}/${deviceId}`).set({
    deviceId,
    reason: 'abuse',
    duration: 'permanent',
    expiresAt: null,
    linkedUniqueId: null,
    createdAt: new Date().toISOString(),
    createdBy: 'test-admin',
    ...data,
  });
}

async function seedNetworkBan(banId, data = {}) {
  await db.doc(`${NETWORK_BANS}/${banId}`).set({
    type: 'ip',
    value: EDGE_IP,
    reason: 'network abuse',
    duration: 'permanent',
    expiresAt: null,
    linkedUniqueId: null,
    createdAt: new Date().toISOString(),
    createdBy: 'test-admin',
    ...data,
  });
}

/** POST the sensitive probe as `caller`, with an optional forged/edge XFF chain. */
function probeAs(caller, { xff } = {}) {
  const req = request(createProbeApp()).post('/api/probe/sensitive').set(caller.headers);
  if (xff) req.set('X-Forwarded-For', xff);
  return req.send({});
}

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearAuthCaches();
  clearBanCache();
  await clearCollection(db, DEVICE_BANS);
  await clearCollection(db, NETWORK_BANS);
  await clearCollection(db, DEVICE_BINDINGS);
  await clearCollection(db, USERS);
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ─── AC happy path ────────────────────────────────────────────────

describe('unbanned users are unaffected', () => {
  test('an unbanned user’s sensitive request succeeds exactly as before', async () => {
    const caller = await mintRealUser({ uniqueId: '5001' });
    const res = await probeAs(caller).expect(200);
    expect(res.body).toEqual({ ok: true, via: 'probe' });
  });

  test('a ban on a device bound to a DIFFERENT user does not touch this caller', async () => {
    await db.doc(`${DEVICE_BINDINGS}/dev-other-1`).set({ uniqueId: '5099', boundAt: 1 });
    await seedDeviceBan('dev-other-1', { linkedUniqueId: '5099' });
    const caller = await mintRealUser({ uniqueId: '5002' });
    await probeAs(caller).expect(200);
  });

  test('an EXPIRED device ban no longer blocks', async () => {
    const caller = await mintRealUser({ uniqueId: '5003' });
    await seedDeviceBan('dev-expired-1', {
      linkedUniqueId: '5003',
      duration: '24h',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await probeAs(caller).expect(200);
  });
});

// ─── AC error paths: device bans ─────────────────────────────────

describe('device bans are enforced per-request, from any client', () => {
  test('a device ban LINKED to the caller’s account → 403 with the ban reason', async () => {
    const caller = await mintRealUser({ uniqueId: '5010' });
    await seedDeviceBan('dev-linked-1', { linkedUniqueId: '5010', reason: 'spam ring' });

    const res = await probeAs(caller).expect(403);
    expect(res.body).toEqual({
      error: 'Account banned',
      code: 'banned',
      banType: 'device',
      reason: 'spam ring',
      expiresAt: null,
    });
  });

  test('a device ban linked with a legacy NUMERIC uniqueId still blocks the string-id caller', async () => {
    const caller = await mintRealUser({ uniqueId: '5011' });
    await seedDeviceBan('dev-linked-legacy-1', { linkedUniqueId: 5011 });
    await probeAs(caller).expect(403);
  });

  test('a ban on a device BOUND to the caller (no linkage on the ban) → 403', async () => {
    const caller = await mintRealUser({ uniqueId: '5012' });
    await db.doc(`${DEVICE_BINDINGS}/dev-bound-1`).set({ uniqueId: '5012', boundAt: 1 });
    await seedDeviceBan('dev-bound-1'); // linkedUniqueId: null — hardware-targeted ban
    await probeAs(caller).expect(403);
  });

  test('a ban on a device bound via the legacy userId field (numeric) → 403', async () => {
    const caller = await mintRealUser({ uniqueId: '5013' });
    await db.doc(`${DEVICE_BINDINGS}/dev-legacy-owner-1`).set({ userId: 5013, boundAt: 1 });
    await seedDeviceBan('dev-legacy-owner-1');
    await probeAs(caller).expect(403);
  });

  test('a hardware ban cannot be hidden by flooding the account with decoy device bindings', async () => {
    // C1 (reviewer, 2026-07-09): the gate resolved hardware bans by scanning
    // the caller's deviceBindings with a small .limit(). deviceIds are
    // attacker-chosen strings and Firestore orders by document id, so binding
    // 20+ decoys that sort BEFORE the banned device pushed it out of the
    // window — and /devices/lock-check, which mints those bindings, is itself
    // ban-exempt. The banned device must be found regardless of decoy count.
    const caller = await mintRealUser({ uniqueId: '5015' });
    const bannedDeviceId = 'zzz-banned-device'; // sorts LAST among the decoys
    await db.doc(`${DEVICE_BINDINGS}/${bannedDeviceId}`).set({ uniqueId: '5015', boundAt: 1 });
    await seedDeviceBan(bannedDeviceId, { reason: 'hardware ban' }); // no linkedUniqueId

    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        db
          .doc(`${DEVICE_BINDINGS}/decoy-${String(i).padStart(3, '0')}`)
          .set({ uniqueId: '5015', boundAt: 1 }),
      ),
    );

    const res = await probeAs(caller).expect(403);
    expect(res.body).toMatchObject({ code: 'banned', banType: 'device', reason: 'hardware ban' });
  });

  test('a caller whose bindings exceed the scannable window is refused (fail-closed, never silently unbanned)', async () => {
    // Beyond the write-time cap the gate cannot prove the caller is clean, so
    // it must refuse rather than log a warning and let them through.
    const caller = await mintRealUser({ uniqueId: '5016' });
    await Promise.all(
      Array.from({ length: BINDINGS_SCAN_LIMIT }, (_, i) =>
        db
          .doc(`${DEVICE_BINDINGS}/flood-${String(i).padStart(4, '0')}`)
          .set({ uniqueId: '5016', boundAt: 1 }),
      ),
    );

    const res = await probeAs(caller).expect(401);
    expect(res.body).toEqual({ error: 'Authentication failed' });
  });

  test('the 403 body leaks nothing beyond the contract (no linkedUniqueId / createdBy)', async () => {
    const caller = await mintRealUser({ uniqueId: '5014' });
    await seedDeviceBan('dev-leak-1', { linkedUniqueId: '5014', reason: 'r' });
    const res = await probeAs(caller).expect(403);
    expect(Object.keys(res.body).sort()).toEqual([
      'banType',
      'code',
      'error',
      'expiresAt',
      'reason',
    ]);
  });
});

// ─── AC error paths: network bans on the REAL edge IP ────────────

describe('network bans match the real edge IP — ip, subnet, asn', () => {
  test('a banned exact IP → 403 with banType network_ip', async () => {
    const caller = await mintRealUser({ uniqueId: '5020' });
    await seedNetworkBan('nb-ip-1', { type: 'ip', value: EDGE_IP });

    const res = await probeAs(caller, { xff: EDGE_IP }).expect(403);
    expect(res.body).toMatchObject({ code: 'banned', banType: 'network_ip' });
  });

  test('a banned subnet catches an IP inside it → 403 with banType network_subnet', async () => {
    const caller = await mintRealUser({ uniqueId: '5021' });
    await seedNetworkBan('nb-subnet-1', { type: 'subnet', value: '203.0.113.0/24' });
    const res = await probeAs(caller, { xff: EDGE_IP }).expect(403);
    expect(res.body).toMatchObject({ code: 'banned', banType: 'network_subnet' });
  });

  test('a banned ASN matches via the caller’s STORED device-binding ASN (no live geo lookup)', async () => {
    const caller = await mintRealUser({ uniqueId: '5022' });
    await db
      .doc(`${DEVICE_BINDINGS}/dev-asn-1`)
      .set({ uniqueId: '5022', boundAt: 1, asn: 'AS64500' });
    await seedNetworkBan('nb-asn-1', { type: 'asn', value: 'AS64500' });

    const res = await probeAs(caller).expect(403);
    expect(res.body).toMatchObject({ code: 'banned', banType: 'network_asn' });
  });

  test('an ASN ban stored numerically (the admin-route format) still matches the AS-prefixed binding ASN', async () => {
    const caller = await mintRealUser({ uniqueId: '5024' });
    await db
      .doc(`${DEVICE_BINDINGS}/dev-asn-2`)
      .set({ uniqueId: '5024', boundAt: 1, asn: 'AS64500' });
    // Pre-existing defect: the admin route validates ASN ban values as
    // digits-only ('64500') while geo enrichment stores 'AS64500' — strict
    // equality meant an admin-issued ASN ban could never match.
    await seedNetworkBan('nb-asn-numeric-1', { type: 'asn', value: '64500' });

    const res = await probeAs(caller).expect(403);
    expect(res.body).toMatchObject({ code: 'banned', banType: 'network_asn' });
  });

  test('an EXPIRED network ban no longer blocks', async () => {
    const caller = await mintRealUser({ uniqueId: '5023' });
    await seedNetworkBan('nb-expired-1', {
      value: EDGE_IP,
      duration: '24h',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await probeAs(caller, { xff: EDGE_IP }).expect(200);
  });
});

// ─── AC edge case: forged X-Forwarded-For never changes the matched IP ──

describe('X-Forwarded-For forgery does not evade network bans', () => {
  test('forging a clean leftmost XFF in front of the real banned IP still → 403', async () => {
    const caller = await mintRealUser({ uniqueId: '5030' });
    await seedNetworkBan('nb-xff-1', { value: EDGE_IP });
    // The edge proxy APPENDS the real client IP — client-forged values sit to
    // the LEFT. Under trust proxy: 1, req.ip must be the rightmost entry.
    await probeAs(caller, { xff: `${CLEAN_IP}, ${EDGE_IP}` }).expect(403);
  });

  test('a banned IP appearing ONLY in the forged (leftmost) position does NOT trigger the ban', async () => {
    const caller = await mintRealUser({ uniqueId: '5031' });
    await seedNetworkBan('nb-xff-2', { value: EDGE_IP });
    // Attacker "confesses" someone else's banned IP on the left; their real
    // (edge-appended, rightmost) IP is clean → they are not the banned party.
    await probeAs(caller, { xff: `${EDGE_IP}, ${CLEAN_IP}` }).expect(200);
  });

  test('/api/device-info stores the real edge IP and matches bans against it, not the forged leftmost', async () => {
    const caller = await mintRealUser({ uniqueId: '5032' });
    await seedNetworkBan('nb-xff-3', { value: EDGE_IP });

    const res = await request(createRouterApp(deviceInfoRouter))
      .post('/api/device-info')
      .set(caller.headers)
      .set('X-Forwarded-For', `${CLEAN_IP}, ${EDGE_IP}`)
      .send({ deviceId: 'dev-xff-3' })
      .expect(200);

    // Sign-in ban report reflects the REAL IP…
    expect(res.body.banStatus).toMatchObject({ isBanned: true, banType: 'network_ip' });
    // …and the stored telemetry records the real IP, not the decoy.
    const binding = (await db.doc(`${DEVICE_BINDINGS}/dev-xff-3`).get()).data();
    expect(binding.lastIp).toBe(EDGE_IP);
  });
});

// ─── AC error path: mid-session enforcement ──────────────────────

describe('a ban issued mid-session bites on the very next request', () => {
  test('device ban issued through the REAL admin route → caller’s next request is 403', async () => {
    const caller = await mintRealUser({ uniqueId: '5040' });
    await db.doc(`${DEVICE_BINDINGS}/dev-mid-1`).set({ uniqueId: '5040', boundAt: 1 });

    await probeAs(caller).expect(200); // signed in, acting freely (and now cached as unbanned)

    const admin = await mintTokenWithoutUserDoc({ admin: true });
    await request(createRouterApp(adminBansRouter))
      .post('/api/admin/bans/device')
      .set(admin.headers)
      .send({ deviceId: 'dev-mid-1', reason: 'mid-session ban', linkedUniqueId: '5040' })
      .expect(200);

    // No cache clearing by the test: the admin route itself must invalidate.
    await probeAs(caller).expect(403);
  });
});

// ─── The strict middleware carries the same authority ────────────

describe('authMiddlewareStrict enforces the same ban gate (portal routes)', () => {
  test('a banned portal user is refused with the same 403 contract', async () => {
    const caller = await mintRealUser({ uniqueId: '5080' });
    await seedDeviceBan('dev-strict-1', { linkedUniqueId: '5080', reason: 'portal ban' });

    const res = await request(createStrictProbeApp())
      .post('/api/portal/revoke-all-sessions')
      .set(caller.headers)
      .send({})
      .expect(403);
    expect(res.body).toEqual({
      error: 'Account banned',
      code: 'banned',
      banType: 'device',
      reason: 'portal ban',
      expiresAt: null,
    });
  });

  test('a banned portal user may still reach /portal/me (the strict exempt path)', async () => {
    const caller = await mintRealUser({ uniqueId: '5081' });
    await seedDeviceBan('dev-strict-2', { linkedUniqueId: '5081' });

    const res = await request(createStrictProbeApp())
      .get('/api/portal/me')
      .set(caller.headers)
      .expect(200);
    expect(res.body).toEqual({ ok: true, via: 'portal-me' });
  });

  test('an unbanned portal user passes through untouched', async () => {
    const caller = await mintRealUser({ uniqueId: '5082' });
    await request(createStrictProbeApp())
      .post('/api/portal/revoke-all-sessions')
      .set(caller.headers)
      .send({})
      .expect(200);
  });
});

// ─── Every ban mutation path invalidates the gate's caches ───────

describe('each admin ban mutation reaches the gate on the next request', () => {
  /** Sign in, cache a verdict, run the admin mutation, then re-probe. */
  async function adminPost(admin, path, body) {
    return request(createRouterApp(adminBansRouter))
      .post(path)
      .set(admin.headers)
      .send(body)
      .expect(200);
  }

  test('issuing a NETWORK ban blocks the caller on their next request', async () => {
    const caller = await mintRealUser({ uniqueId: '5090' });
    await probeAs(caller, { xff: EDGE_IP }).expect(200); // caches "clean" + the ban list

    const admin = await mintTokenWithoutUserDoc({ admin: true });
    await adminPost(admin, '/api/admin/bans/network', {
      type: 'ip',
      value: EDGE_IP,
      reason: 'net mid-session',
    });

    await probeAs(caller, { xff: EDGE_IP }).expect(403);
  });

  test('UNBANNING a device lifts the block on the next request', async () => {
    const caller = await mintRealUser({ uniqueId: '5091' });
    await seedDeviceBan('dev-unban-1', { linkedUniqueId: '5091' });
    await probeAs(caller).expect(403); // caches "banned"

    const admin = await mintTokenWithoutUserDoc({ admin: true });
    await request(createRouterApp(adminBansRouter))
      .delete('/api/admin/bans/device/dev-unban-1')
      .set(admin.headers)
      .expect(200);

    await probeAs(caller).expect(200);
  });

  test('UNBANNING a network lifts the block on the next request', async () => {
    const caller = await mintRealUser({ uniqueId: '5092' });
    await seedNetworkBan('nb-unban-1', { value: EDGE_IP });
    await probeAs(caller, { xff: EDGE_IP }).expect(403);

    const admin = await mintTokenWithoutUserDoc({ admin: true });
    await request(createRouterApp(adminBansRouter))
      .delete('/api/admin/bans/network/nb-unban-1')
      .set(admin.headers)
      .expect(200);

    await probeAs(caller, { xff: EDGE_IP }).expect(200);
  });

  test('UNBAN-ALL for a user lifts both their device and network bans at once', async () => {
    const caller = await mintRealUser({ uniqueId: '5093' });
    await seedDeviceBan('dev-unban-all-1', { linkedUniqueId: '5093' });
    await seedNetworkBan('nb-unban-all-1', { value: EDGE_IP, linkedUniqueId: '5093' });
    await probeAs(caller, { xff: EDGE_IP }).expect(403);

    const admin = await mintTokenWithoutUserDoc({ admin: true });
    await adminPost(admin, '/api/admin/bans/unban-all/5093', {});

    await probeAs(caller, { xff: EDGE_IP }).expect(200);
  });
});

// ─── AC performance: bounded, cached lookup ──────────────────────

describe('ban status is cached (bounded lookup), with an explicit clear', () => {
  test('a direct doc delete does not lift the ban until clearBanCache()', async () => {
    const caller = await mintRealUser({ uniqueId: '5050' });
    await seedDeviceBan('dev-cache-1', { linkedUniqueId: '5050' });

    await probeAs(caller).expect(403); // cached as banned
    await db.doc(`${DEVICE_BANS}/dev-cache-1`).delete(); // bypasses the admin route on purpose

    await probeAs(caller).expect(403); // still served from cache — bounded lookups

    expect(typeof authModule.clearBanCache).toBe('function');
    authModule.clearBanCache('5050');
    await probeAs(caller).expect(200);
  });
});

// ─── AC edge case: exemptions — banned users keep their rights ───

describe('exempt paths stay reachable while banned', () => {
  test('a banned user can still reach appeal and data-export paths', async () => {
    const caller = await mintRealUser({ uniqueId: '5060' });
    await seedDeviceBan('dev-exempt-1', { linkedUniqueId: '5060' });

    await probeAs(caller).expect(403); // sanity: the ban is live on sensitive routes

    const app = createProbeApp();
    await request(app).post('/api/users/5060/appeal').set(caller.headers).send({}).expect(200);
    await request(app).get('/api/users/5060/data-export').set(caller.headers).expect(200);
  });

  test('a banned user still receives the ban verdict from /api/device-info (the ban-screen channel)', async () => {
    const caller = await mintRealUser({ uniqueId: '5061' });
    await seedDeviceBan('dev-channel-1', { linkedUniqueId: '5061', reason: 'channel test' });

    const res = await request(createRouterApp(deviceInfoRouter))
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'dev-channel-1' })
      .expect(200);
    expect(res.body.banStatus).toMatchObject({ isBanned: true, reason: 'channel test' });
  });
});

// ─── Real production route inherits the gate ─────────────────────

describe('real sensitive routes inherit the gate with zero per-route changes', () => {
  test('banned → POST /api/suggestions is 403; unbanned → the same body succeeds', async () => {
    const app = createRouterApp(suggestionsRouter);
    const body = { title: 'Ban gate probe', description: 'Server-side enforcement check' };

    const banned = await mintRealUser({ uniqueId: '5070' });
    await seedDeviceBan('dev-sugg-1', { linkedUniqueId: '5070' });
    const resBanned = await request(app)
      .post('/api/suggestions')
      .set(banned.headers)
      .send(body)
      .expect(403);
    expect(resBanned.body.code).toBe('banned');

    clearBanCache();
    const clean = await mintRealUser({ uniqueId: '5071' });
    const resClean = await request(app).post('/api/suggestions').set(clean.headers).send(body);
    expect(resClean.status).toBe(201);
    await clearCollection(db, SUGGESTIONS);
  });
});
