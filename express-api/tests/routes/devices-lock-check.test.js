/**
 * POST /api/devices/lock-check — device-lock (anti-abuse / ban-evasion)
 * decision, REAL-services integration test (SHY-0170, EPIC-0006).
 *
 * The device-lock ("one device ↔ one account") decision used to be made
 * CLIENT-SIDE: the app read `deviceBindings/{deviceId}` directly and itself
 * decided sign-out / block-new-account — a tampered client could skip it. This
 * endpoint moves the decision server-side so the API is the authority.
 *
 * Contract pinned (all against the REAL Firestore + Auth emulator — a mocked
 * db.set() cannot prove the atomic bind-race or that a bound device is NOT
 * rebound, which are the whole point of a security control):
 *   1. Device bound to a DIFFERENT user → { status: 'locked', boundToOther: true },
 *      and the existing binding is NOT overwritten.
 *   2. Unbound device + existing caller → { status: 'allowed' } AND the device is
 *      now atomically bound to the caller's uniqueId.
 *   3. Device already bound to the SAME caller → allowed, boundAt unchanged (no churn).
 *   4. New user (valid token, NO users doc → uniqueId null) on a bound device →
 *      locked (drives the "block new account creation" path).
 *   5. New user on an UNBOUND device → allowed AND the device is left UNBOUND
 *      (a not-yet-registered person must not claim a device).
 *   6. Unauthenticated (no token) → 401.
 *   7. Missing deviceId → 400.
 *   8. Concurrent bind race on one unbound device → exactly ONE binding wins.
 *   9. Legacy `{ userId }`-only binding docs (old client shape) are honoured.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK +
 * Auth emulator target localhost. PER-FILE opt-in only — never prepend
 * NODE_ENV=local to the canonical `npm test` (feedback-express-suite-no-node-env-override).
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const devicesRouter = require('../../src/routes/devices');

const DEVICE_BINDINGS = 'deviceBindings';
const USERS = 'users';

/** App with the REAL auth middleware ahead of the router (no faked req.auth). */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', devicesRouter);
  return app;
}

const bindingRef = (deviceId) => db.doc(`${DEVICE_BINDINGS}/${deviceId}`);
async function seedBinding(deviceId, data) {
  await bindingRef(deviceId).set(data);
}
async function readBinding(deviceId) {
  const snap = await bindingRef(deviceId).get();
  return snap.exists ? snap.data() : null;
}

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearAuthCaches();
  await clearCollection(db, DEVICE_BINDINGS);
  await clearCollection(db, USERS);
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('POST /api/devices/lock-check', () => {
  test('device bound to a DIFFERENT user → locked, and the binding is NOT overwritten', async () => {
    const deviceId = 'dev-locked-1';
    await seedBinding(deviceId, { uniqueId: '1001', boundAt: 111 });
    const caller = await mintRealUser({ uniqueId: '2002' });

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'locked', boundToOther: true });
    // The attacker's sign-in must NOT steal the binding.
    expect((await readBinding(deviceId)).uniqueId).toBe('1001');
  });

  test('unbound device + existing caller → allowed AND atomically bound to the caller', async () => {
    const deviceId = 'dev-fresh-1';
    const caller = await mintRealUser({ uniqueId: '3003' });

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'allowed', boundToOther: false });
    const binding = await readBinding(deviceId);
    expect(binding.uniqueId).toBe('3003');
    expect(binding.boundAt).toBeDefined();
  });

  test('device already bound to the SAME caller → allowed, boundAt unchanged (no churn)', async () => {
    const deviceId = 'dev-same-1';
    await seedBinding(deviceId, { uniqueId: '4004', boundAt: 42 });
    const caller = await mintRealUser({ uniqueId: '4004' });

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'allowed', boundToOther: false });
    expect((await readBinding(deviceId)).boundAt).toBe(42); // not re-stamped
  });

  test('new user (token, no users doc) on a bound device → locked (blocks account creation)', async () => {
    const deviceId = 'dev-newblocked-1';
    await seedBinding(deviceId, { uniqueId: '5005', boundAt: 1 });
    const newcomer = await mintTokenWithoutUserDoc({});

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(newcomer.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'locked', boundToOther: true });
  });

  test('new user on an UNBOUND device → allowed AND the device is left UNBOUND', async () => {
    const deviceId = 'dev-newfree-1';
    const newcomer = await mintTokenWithoutUserDoc({});

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(newcomer.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'allowed', boundToOther: false });
    // A not-yet-registered person must not claim the device.
    expect(await readBinding(deviceId)).toBeNull();
  });

  test('unauthenticated (no token) → 401', async () => {
    await request(createApp())
      .post('/api/devices/lock-check')
      .send({ deviceId: 'dev-noauth' })
      .expect(401);
  });

  test('missing deviceId → 400', async () => {
    const caller = await mintRealUser({ uniqueId: '6006' });
    await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({})
      .expect(400);
  });

  test('concurrent bind race on one unbound device → exactly ONE binding wins', async () => {
    const deviceId = 'dev-race-1';
    const a = await mintRealUser({ uniqueId: '7007' });
    const b = await mintRealUser({ uniqueId: '8008' });
    const app = createApp();

    const [ra, rb] = await Promise.all([
      request(app).post('/api/devices/lock-check').set(a.headers).send({ deviceId }),
      request(app).post('/api/devices/lock-check').set(b.headers).send({ deviceId }),
    ]);

    const statuses = [ra.body.status, rb.body.status].sort();
    expect(statuses).toEqual(['allowed', 'locked']); // exactly one of each
    const boundTo = (await readBinding(deviceId)).uniqueId;
    expect(['7007', '8008']).toContain(boundTo); // one deterministic winner
  });

  test('legacy { userId }-only binding (old client shape) is honoured for the same user', async () => {
    const deviceId = 'dev-legacy-1';
    await seedBinding(deviceId, { userId: '9009', boundAt: 7 }); // no uniqueId field
    const caller = await mintRealUser({ uniqueId: '9009' });

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'allowed', boundToOther: false });
  });
});
