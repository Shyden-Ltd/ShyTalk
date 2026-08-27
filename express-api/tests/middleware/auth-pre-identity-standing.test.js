/**
 * Pre-identity routes vs the two standing gates — REAL-services integration
 * test (SHY-0461, EPIC-0005).
 *
 * `PRE_IDENTITY_ROUTES` is the list of routes that run BEFORE an identity —
 * and therefore before a standing — can be known. Gating any of them on
 * standing is circular by construction: the caller cannot learn what it is
 * until it has resolved who it is, and it cannot resolve who it is because of
 * what it is.
 *
 * That circularity shipped. A suspended person signing in got
 * `403 Account suspended` from `POST /users/sign-in` — the FIRST call the app
 * makes — so `AuthViewModel` never reached the user document it is allowed to
 * read, never reached `checkAndApplyBan()`, and fell through to
 * `isBackendUnreachable`. The phone showed "cannot connect" to somebody who
 * was suspended and entitled to appeal. A BANNED person hit the identical
 * wall, so the ban screen was unreachable on a cold sign-in too.
 *
 * Contract pinned (against the REAL Firestore + Auth emulator — a mocked db
 * cannot prove the gate ordering or that the route declines to mutate):
 *   The class     — EVERY entry in PRE_IDENTITY_ROUTES answers a suspended
 *                   caller and a banned caller, rather than refusing them.
 *                   Driven off the exported constant, so a route added to the
 *                   list is covered without anybody remembering to add a case.
 *   No widening   — a route OUTSIDE the class still refuses both standings.
 *                   The fix must not become a hole.
 *   No mutation   — sign-in as a suspended or banned caller returns the
 *                   verdict and leaves the user document alone. Exempting the
 *                   route without this reintroduces the Audit M5 (Phase 2A)
 *                   hazard: a refused caller taking a fresh firebaseUid and
 *                   custom claims on the way past.
 *   The verdict   — the response says WHICH standing, so the client can pick
 *                   the suspension screen or the ban screen rather than
 *                   guessing.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin
 * SDK + Auth emulator target localhost. PER-FILE opt-in only — never prepend
 * NODE_ENV=local to the canonical `npm test`.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware, PRE_IDENTITY_ROUTES, clearBanCache } = require('../../src/middleware/auth');
const usersRouter = require('../../src/routes/users');

// Per-file id prefix: Jest runs files in parallel workers against ONE
// emulator project, so a collection-wide wipe deletes what a sibling seeded.
const ID_PREFIX = 'pis-';
const DEVICE_BANS = 'deviceBans';

const SUSPENDED_ID = 50990461;
const BANNED_ID = 50990462;
const CLEAN_ID = 50990463;
const BAN_DEVICE = `${ID_PREFIX}device-0461`;

// A sentinel the sign-in route would overwrite if it ran its mutation.
const SENTINEL_LAST_SEEN = '1999-01-01T00:00:00.000Z';

/**
 * Probe app: the REAL authMiddleware in front of a handler that does nothing
 * but succeed. What is under test is the GATE'S decision, not any route's own
 * validation — a route returning 400 for a missing field would mask whether
 * the gate let it through at all.
 */
function createGateProbeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.all(/.*/, (req, res) => res.json({ ok: true, reached: req.path }));
  return app;
}

/** The REAL users router, for the route-level contract. */
function createUsersApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

async function seedIdentity(identifier, uniqueId) {
  await db.doc(`identityMap/email:${identifier}`).set({ uniqueId, unlinked: false });
}

async function seedUserDoc(uniqueId, extra = {}) {
  await db
    .doc(`users/${uniqueId}`)
    .set({ uniqueId, lastSeenAt: SENTINEL_LAST_SEEN, ...extra }, { merge: true });
}

async function seedDeviceBanFor(uniqueId) {
  await db.doc(`${DEVICE_BANS}/${BAN_DEVICE}`).set({
    deviceId: BAN_DEVICE,
    reason: 'SHY-0461 pre-identity class',
    duration: 'permanent',
    expiresAt: null,
    linkedUniqueId: String(uniqueId),
    createdAt: new Date().toISOString(),
    createdBy: 'test-admin',
  });
}

/** A body that satisfies each pre-identity route's own required fields. */
function bodyFor(route, identifier) {
  if (route.path === '/users/sign-in') return { provider: 'email', identifier };
  if (route.path === '/devices/lock-check') return { deviceId: BAN_DEVICE };
  if (route.path === '/device-info') return { deviceId: BAN_DEVICE };
  if (route.path === '/users') return { provider: 'email', identifier };
  return {};
}

function send(app, route, headers, body) {
  const url = `/api${route.path}`;
  const verb = route.method.toLowerCase();
  const req = request(app)[verb](url).set(headers);
  return verb === 'get' ? req : req.send(body);
}

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearAuthCaches();
  clearBanCache();
  await clearPrefixed(db, DEVICE_BANS, ID_PREFIX);
});

afterAll(async () => {
  await clearPrefixed(db, DEVICE_BANS, ID_PREFIX);
  // A suspended user left behind is met by the next suite — or the next
  // device journey — as an account nobody suspended, and the product gets
  // the blame. Delete them rather than merely un-suspending them.
  await Promise.all(
    [SUSPENDED_ID, BANNED_ID, CLEAN_ID].map((id) => db.doc(`users/${id}`).delete()),
  );
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ─── The class: every pre-identity route answers a refused caller ──────────

const VERDICT_CHANNELS = PRE_IDENTITY_ROUTES.filter((r) => r.standingExempt);
const ACTING_PRE_IDENTITY = PRE_IDENTITY_ROUTES.filter((r) => !r.standingExempt);

// Both halves of the table must be non-empty, or a `filter` that silently
// matched nothing would turn either describe-block below into zero cases —
// a green run proving the opposite of what it claims.
test('the pre-identity table splits into both kinds', () => {
  expect(VERDICT_CHANNELS.length).toBeGreaterThan(0);
  expect(ACTING_PRE_IDENTITY.length).toBeGreaterThan(0);
});

describe('standing-verdict channels are reachable while suspended', () => {
  test.each(VERDICT_CHANNELS.map((r) => [`${r.method} ${r.path}`, r]))(
    '%s does not refuse a suspended caller',
    async (_label, route) => {
      const identifier = `pis-susp-${SUSPENDED_ID}@shytalk.test`;
      const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });
      await seedIdentity(identifier, SUSPENDED_ID);

      const res = await send(createGateProbeApp(), route, user.headers, bodyFor(route, identifier));

      // The gate's refusal is the thing under test. Any other status means the
      // request got PAST the gate, which is the whole point.
      expect(res.body?.error).not.toBe('Account suspended');
      expect(res.status).not.toBe(403);
    },
  );
});

describe('standing-verdict channels are reachable while banned', () => {
  test.each(VERDICT_CHANNELS.map((r) => [`${r.method} ${r.path}`, r]))(
    '%s does not refuse a banned caller',
    async (_label, route) => {
      const identifier = `pis-ban-${BANNED_ID}@shytalk.test`;
      const user = await mintRealUser({ uniqueId: BANNED_ID });
      await seedIdentity(identifier, BANNED_ID);
      await seedDeviceBanFor(BANNED_ID);
      clearBanCache();

      const res = await send(createGateProbeApp(), route, user.headers, bodyFor(route, identifier));

      expect(res.body?.error).not.toBe('Account banned');
      expect(res.status).not.toBe(403);
    },
  );
});

// ─── No widening: the gate still works everywhere else ────────────────────

describe('the exemption does not widen past the class', () => {
  test('a route outside PRE_IDENTITY_ROUTES still refuses a suspended caller', async () => {
    const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });

    const res = await request(createGateProbeApp())
      .post('/api/probe/sensitive')
      .set(user.headers)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Account suspended' });
  });

  test('a route outside PRE_IDENTITY_ROUTES still refuses a banned caller', async () => {
    const user = await mintRealUser({ uniqueId: BANNED_ID });
    await seedDeviceBanFor(BANNED_ID);
    clearBanCache();

    const res = await request(createGateProbeApp())
      .post('/api/probe/sensitive')
      .set(user.headers)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('banned');
  });

  test.each(ACTING_PRE_IDENTITY.map((r) => [`${r.method} ${r.path}`, r]))(
    '%s is pre-identity but ACTS, so a suspended caller is still refused',
    async (_label, route) => {
      const identifier = `pis-act-susp-${SUSPENDED_ID}@shytalk.test`;
      const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });
      await seedIdentity(identifier, SUSPENDED_ID);

      const res = await send(createGateProbeApp(), route, user.headers, bodyFor(route, identifier));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Account suspended' });
    },
  );

  test.each(ACTING_PRE_IDENTITY.map((r) => [`${r.method} ${r.path}`, r]))(
    '%s is pre-identity but ACTS, so a banned caller is still refused',
    async (_label, route) => {
      // The one that matters: `POST /users` creates an account. A banned
      // caller reaching it is ban evasion, and being pre-identity is no
      // defence — the gate matches this caller by device and IP precisely
      // because there is no identity yet.
      const identifier = `pis-act-ban-${BANNED_ID}@shytalk.test`;
      const user = await mintRealUser({ uniqueId: BANNED_ID });
      await seedIdentity(identifier, BANNED_ID);
      await seedDeviceBanFor(BANNED_ID);
      clearBanCache();

      const res = await send(createGateProbeApp(), route, user.headers, bodyFor(route, identifier));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('banned');
    },
  );

  test('GET /users is NOT pre-identity and stays refused while suspended', async () => {
    // `PRE_IDENTITY_ROUTES` matches on METHOD and EXACT path on purpose:
    // `POST /users` creates an account, `GET /users` is a listing.
    const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });

    const res = await request(createGateProbeApp()).get('/api/users').set(user.headers);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Account suspended' });
  });
});

// ─── The route-level contract: a verdict, and no mutation ─────────────────

describe('POST /users/sign-in answers a refused caller without mutating', () => {
  test('a suspended caller is told they are suspended', async () => {
    const identifier = `pis-susp-route-${SUSPENDED_ID}@shytalk.test`;
    const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });
    await seedUserDoc(SUSPENDED_ID, { isSuspended: true, firebaseUid: user.uid });
    await seedIdentity(identifier, SUSPENDED_ID);

    const res = await request(createUsersApp())
      .post('/api/users/sign-in')
      .set(user.headers)
      .send({ provider: 'email', identifier });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: true, suspended: true, uniqueId: SUSPENDED_ID });
  });

  test('a suspended sign-in leaves the user document untouched', async () => {
    const identifier = `pis-susp-nomut-${SUSPENDED_ID}@shytalk.test`;
    const user = await mintRealUser({ uniqueId: SUSPENDED_ID, isSuspended: true });
    // `firebaseUid` must stay TRUE here. `resolveUniqueId` finds the caller by
    // `users where firebaseUid == uid`, so a decoy value would make the
    // middleware resolve nobody, skip both standing checks, and let the
    // request through — the test would then go green while proving nothing.
    await seedUserDoc(SUSPENDED_ID, { isSuspended: true, firebaseUid: user.uid });
    await seedIdentity(identifier, SUSPENDED_ID);

    await request(createUsersApp())
      .post('/api/users/sign-in')
      .set(user.headers)
      .send({ provider: 'email', identifier });

    // `lastSeenAt` is the whole signal: the route writes it and `firebaseUid`
    // in ONE `update()`, so an untouched sentinel proves neither was written.
    // Asserting on `firebaseUid` alone could not — a refreshed UID is equal to
    // the one already stored.
    const after = (await db.doc(`users/${SUSPENDED_ID}`).get()).data();
    expect(after.lastSeenAt).toBe(SENTINEL_LAST_SEEN);
  });

  test('a banned caller is told they are banned', async () => {
    const identifier = `pis-ban-route-${BANNED_ID}@shytalk.test`;
    const user = await mintRealUser({ uniqueId: BANNED_ID });
    await seedUserDoc(BANNED_ID, { firebaseUid: user.uid });
    await seedIdentity(identifier, BANNED_ID);
    await seedDeviceBanFor(BANNED_ID);
    clearBanCache();

    const res = await request(createUsersApp())
      .post('/api/users/sign-in')
      .set(user.headers)
      .send({ provider: 'email', identifier });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.banned).toBe(true);
    expect(res.body.reason).toBe('SHY-0461 pre-identity class');
  });

  test('a banned sign-in leaves the user document untouched', async () => {
    const identifier = `pis-ban-nomut-${BANNED_ID}@shytalk.test`;
    const user = await mintRealUser({ uniqueId: BANNED_ID });
    // True `firebaseUid` for the same reason as the suspended case above: a
    // decoy breaks `resolveUniqueId` and silently disarms the gate.
    await seedUserDoc(BANNED_ID, { firebaseUid: user.uid });
    await seedIdentity(identifier, BANNED_ID);
    await seedDeviceBanFor(BANNED_ID);
    clearBanCache();

    await request(createUsersApp())
      .post('/api/users/sign-in')
      .set(user.headers)
      .send({ provider: 'email', identifier });

    const after = (await db.doc(`users/${BANNED_ID}`).get()).data();
    expect(after.lastSeenAt).toBe(SENTINEL_LAST_SEEN);
  });

  test('a caller in good standing still signs in and IS updated', async () => {
    // The mutation must still happen for everybody else — a fix that stops
    // sign-in working is not a fix.
    const identifier = `pis-clean-${CLEAN_ID}@shytalk.test`;
    const user = await mintRealUser({ uniqueId: CLEAN_ID });
    await seedUserDoc(CLEAN_ID, { firebaseUid: user.uid });
    await seedIdentity(identifier, CLEAN_ID);

    const res = await request(createUsersApp())
      .post('/api/users/sign-in')
      .set(user.headers)
      .send({ provider: 'email', identifier });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.suspended).toBeUndefined();
    expect(res.body.banned).toBeUndefined();

    const after = (await db.doc(`users/${CLEAN_ID}`).get()).data();
    expect(after.firebaseUid).toBe(user.uid);
    // The mirror of the two assertions above: here the sentinel MUST be gone,
    // which is what makes an untouched sentinel meaningful evidence there.
    expect(after.lastSeenAt).not.toBe(SENTINEL_LAST_SEEN);
  });
});
