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
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const devicesRouter = require('../../src/routes/devices');
const deviceInfoRouter = require('../../src/routes/device-info');

// Every document this file creates is namespaced so its cleanup can be scoped:
// Jest runs files in parallel workers against ONE emulator project, and a
// collection-wide wipe deletes what another worker just seeded.
const ID_PREFIX = 'lck-';

const DEVICE_BINDINGS = 'deviceBindings';

/** App with the REAL auth middleware ahead of the router (no faked req.auth). */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', devicesRouter);
  return app;
}

/** App for the sibling /api/device-info route (binding-reconcile proof). */
function createDeviceInfoApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', deviceInfoRouter);
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
  await clearPrefixed(db, DEVICE_BINDINGS, ID_PREFIX);
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('POST /api/devices/lock-check', () => {
  test('device bound to a DIFFERENT user → locked, and the binding is NOT overwritten', async () => {
    const deviceId = 'lck-dev-locked-1';
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
    const deviceId = 'lck-dev-fresh-1';
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
    const deviceId = 'lck-dev-same-1';
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
    const deviceId = 'lck-dev-newblocked-1';
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
    const deviceId = 'lck-dev-newfree-1';
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
      .send({ deviceId: 'lck-dev-noauth' })
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

  test('a deviceId containing "/" is rejected (400) — validation precedes any Firestore access', async () => {
    // The 400 is the guarantee: deviceId validation runs BEFORE the transaction,
    // so a `/`-bearing value can never reach `db.doc(...)` and redirect the path.
    const caller = await mintRealUser({ uniqueId: '6106' });
    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: 'a/b/c' })
      .expect(400);
    expect(res.body.error).toBe('deviceId is invalid');
  });

  test('a whitespace-only deviceId is rejected (400)', async () => {
    const caller = await mintRealUser({ uniqueId: '6206' });
    await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: '   ' })
      .expect(400);
  });

  test('a non-string deviceId is rejected (400) — never stringified into a doc path', async () => {
    const caller = await mintRealUser({ uniqueId: '6306' });
    await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: { evil: true } })
      .expect(400);
  });

  test('a binding doc with BOTH uniqueId AND a disagreeing userId → uniqueId wins (?? precedence pinned)', async () => {
    // Legacy migration edge: if both fields exist, the modern uniqueId is
    // authoritative. Seed uniqueId=owner, userId=someone-else; the owner is allowed.
    const deviceId = 'lck-dev-bothfields-1';
    await seedBinding(deviceId, { uniqueId: '7700', userId: '9999', boundAt: 3 });
    const owner = await mintRealUser({ uniqueId: '7700' });

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(owner.headers)
      .send({ deviceId })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'allowed', boundToOther: false });
  });

  test('concurrent bind race on one unbound device → exactly ONE binding wins', async () => {
    const deviceId = 'lck-dev-race-1';
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
    const deviceId = 'lck-dev-legacy-1';
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

// SHY-0170 reconcile, proven against REAL Firestore merge semantics — a mocked
// .set() can't prove `merge:true` actually leaves the existing uniqueId untouched.
describe('POST /api/device-info — binding reconcile (real emulator)', () => {
  test('does NOT rebind a device already owned by another account, but DOES update telemetry', async () => {
    const deviceId = 'lck-dev-di-reconcile-1';
    await seedBinding(deviceId, { uniqueId: '1111', boundAt: 5, model: 'old-model' });
    const intruder = await mintRealUser({ uniqueId: '2222' });

    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(intruder.headers)
      .send({ deviceId, model: 'new-model' })
      .expect(200);

    const binding = await readBinding(deviceId);
    expect(binding.uniqueId).toBe('1111'); // owner preserved — intruder did NOT steal it
    expect(binding.model).toBe('new-model'); // telemetry still updated (merge)
  });

  test('binds uniqueId on a genuinely NEW device (first-write path preserved)', async () => {
    const deviceId = 'lck-dev-di-fresh-1';
    const caller = await mintRealUser({ uniqueId: '3333' });

    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId, model: 'pixel' })
      .expect(200);

    const binding = await readBinding(deviceId);
    expect(binding.uniqueId).toBe('3333'); // new device → bound to the caller
    expect(binding.boundAt).toBeDefined();
  });
});

/**
 * SHY-0149 / reviewer C1: unbounded device binding let an attacker bury a
 * hardware-banned device under decoy bindings until the ban gate's scan
 * window no longer reached it. Binding creation is therefore capped — and the
 * cap must hold on BOTH binding-minting routes, since /devices/lock-check and
 * /api/device-info are each exempt from the ban gate itself.
 */
describe('a device binding cannot be minted without limit (ban-evasion cap)', () => {
  const { MAX_BOUND_DEVICES, countBoundDevices } = require('../../src/utils/bans');

  async function fillBindingsToCap(uniqueId) {
    await Promise.all(
      Array.from({ length: MAX_BOUND_DEVICES }, (_, i) =>
        seedBinding(`lck-cap-${uniqueId}-${String(i).padStart(3, '0')}`, { uniqueId, boundAt: 1 }),
      ),
    );
  }

  test('lock-check refuses to bind device number MAX+1 for the same account', async () => {
    const caller = await mintRealUser({ uniqueId: '6001' });
    await fillBindingsToCap('6001');

    const res = await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: 'lck-one-too-many' })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'device_limit' });
    expect(await readBinding('lck-one-too-many')).toBeNull(); // nothing was written
  });

  test('device-info stores telemetry for device MAX+1 but leaves it UNBOUND', async () => {
    const caller = await mintRealUser({ uniqueId: '6002' });
    await fillBindingsToCap('6002');

    // Refusing outright would blank the ban screen this endpoint feeds, so it
    // succeeds — it just never claims the device for the capped account.
    const res = await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'lck-di-one-too-many', model: 'pixel' })
      .expect(200);
    expect(res.body.success).toBe(true);

    const binding = await readBinding('lck-di-one-too-many');
    expect(binding.model).toBe('pixel'); // telemetry recorded…
    expect(binding.uniqueId).toBeUndefined(); // …but NOT bound to the caller
    expect(binding.boundAt).toBeUndefined();
  });

  test('an unbound over-cap doc cannot be used as a ban-hiding decoy (it has no owner)', async () => {
    const caller = await mintRealUser({ uniqueId: '6006' });
    await fillBindingsToCap('6006');
    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'lck-di-decoy' })
      .expect(200);

    // countBoundDevices only counts docs owned by the caller, so the unbound
    // doc never inflates their binding set.
    expect(await countBoundDevices('6006')).toBe(MAX_BOUND_DEVICES);
  });

  test('re-submitting the SAME over-cap device does not quietly bind it (the cap is not a one-shot check)', async () => {
    // Reviewer R3-C1: the cap only ran on the `!existing.exists` branch. The
    // first call created an unowned doc; the second call took the `else`
    // branch, saw `owner === null`, and bound it — with no cap check, and
    // without clearing the ban cache.
    const caller = await mintRealUser({ uniqueId: '6012' });
    await fillBindingsToCap('6012');

    for (let i = 0; i < 2; i++) {
      await request(createDeviceInfoApp())
        .post('/api/device-info')
        .set(caller.headers)
        .send({ deviceId: 'lck-di-recall' })
        .expect(200);
    }

    expect((await readBinding('lck-di-recall')).uniqueId).toBeUndefined();
    expect(await countBoundDevices('6012')).toBe(MAX_BOUND_DEVICES);
  });

  test('a not-yet-registered caller (no users doc) never binds a device via device-info', async () => {
    // Mirrors lock-check's rule ("a not-yet-registered caller must never bind
    // a device"). Without the guard, device-info stored a literal
    // `uniqueId: null` with a boundAt, and fired clearBanCache(null).
    const newcomer = await mintTokenWithoutUserDoc();

    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(newcomer.headers)
      .send({ deviceId: 'lck-di-newcomer', model: 'pixel' })
      .expect(200);

    const binding = await readBinding('lck-di-newcomer');
    expect(binding.model).toBe('pixel'); // telemetry still recorded
    expect(binding.uniqueId).toBeUndefined(); // …but the device is NOT claimed
    expect(binding.boundAt).toBeUndefined();
  });

  test('a device left unbound while at the cap IS claimed once a slot frees up', async () => {
    // The unowned doc is not poisoned — it is simply unclaimed. Under the cap
    // the very next call binds it normally.
    const caller = await mintRealUser({ uniqueId: '6013' });
    await fillBindingsToCap('6013');
    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'lck-di-later' })
      .expect(200);
    expect((await readBinding('lck-di-later')).uniqueId).toBeUndefined();

    await db.doc(`${DEVICE_BINDINGS}/lck-cap-6013-000`).delete(); // a slot frees up

    await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'lck-di-later' })
      .expect(200);
    expect((await readBinding('lck-di-later')).uniqueId).toBe('6013');
  });

  test('a BANNED caller at the cap still receives banStatus from device-info (ban screen preserved)', async () => {
    const caller = await mintRealUser({ uniqueId: '6007' });
    await fillBindingsToCap('6007');
    await db.doc('deviceBans/lck-di-banned-at-cap').set({
      deviceId: 'lck-di-banned-at-cap',
      reason: 'at-cap ban screen',
      expiresAt: null,
    });

    const res = await request(createDeviceInfoApp())
      .post('/api/device-info')
      .set(caller.headers)
      .send({ deviceId: 'lck-di-banned-at-cap' })
      .expect(200);

    expect(res.body.banStatus).toMatchObject({
      isBanned: true,
      banType: 'device',
      reason: 'at-cap ban screen',
    });
  });

  test('concurrent device-info calls on distinct new devices cannot exceed the cap', async () => {
    const caller = await mintRealUser({ uniqueId: '6008' });
    // One free slot; fire six racers at it.
    await Promise.all(
      Array.from({ length: MAX_BOUND_DEVICES - 1 }, (_, i) =>
        seedBinding(`lck-race-di-${i}`, { uniqueId: '6008', boundAt: 1 }),
      ),
    );

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(createDeviceInfoApp())
          .post('/api/device-info')
          .set(caller.headers)
          .send({ deviceId: `lck-di-racer-${i}` }),
      ),
    );

    expect(await countBoundDevices('6008')).toBeLessThanOrEqual(MAX_BOUND_DEVICES);
  });

  test('a rollback whose target vanished mid-flight is a safe no-op', async () => {
    // Between the over-cap detection and the rollback's own transaction, an
    // admin unbind (or another request) can delete the doc. The ownership
    // guard must make that a no-op rather than a throw (reviewer R5-I5).
    // The account stays over cap (a sibling binding holds the extra slot), so
    // the rollback really does enter its transaction and find nothing.
    const { rollbackBindingIfOverCap } = require('../../src/utils/bans');
    await fillBindingsToCap('6030');
    await seedBinding('lck-extra-slot', { uniqueId: '6030', boundAt: 1 }); // cap + 1

    await expect(rollbackBindingIfOverCap('6030', 'lck-vanished')).resolves.toBe(true);
    expect(await readBinding('lck-vanished')).toBeNull(); // never existed
    // A doc the rollback does not target is never touched.
    expect((await readBinding('lck-extra-slot')).uniqueId).toBe('6030');
  });

  test('a rollback never releases a binding that now belongs to someone else', async () => {
    const { rollbackBindingIfOverCap } = require('../../src/utils/bans');
    await fillBindingsToCap('6031');
    // Over cap for 6031, but the device was re-claimed by a different account.
    await seedBinding('lck-stolen', { uniqueId: '6031', boundAt: 1 });
    await seedBinding('lck-stolen', { uniqueId: '6032', boundAt: 2 });

    await rollbackBindingIfOverCap('6031', 'lck-stolen');

    // The concurrent winner keeps it — the rollback released nothing.
    expect((await readBinding('lck-stolen')).uniqueId).toBe('6032');
  });

  test('concurrent lock-check calls on distinct new devices cannot exceed the cap', async () => {
    const caller = await mintRealUser({ uniqueId: '6009' });
    await Promise.all(
      Array.from({ length: MAX_BOUND_DEVICES - 1 }, (_, i) =>
        seedBinding(`lck-race-lc-${i}`, { uniqueId: '6009', boundAt: 1 }),
      ),
    );

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(createApp())
          .post('/api/devices/lock-check')
          .set(caller.headers)
          .send({ deviceId: `lck-lc-racer-${i}` }),
      ),
    );

    expect(await countBoundDevices('6009')).toBeLessThanOrEqual(MAX_BOUND_DEVICES);
  });

  test('a caller UNDER the cap still binds normally, and re-using an owned device never counts again', async () => {
    const caller = await mintRealUser({ uniqueId: '6003' });
    await Promise.all(
      Array.from({ length: MAX_BOUND_DEVICES - 1 }, (_, i) =>
        seedBinding(`lck-room-6003-${i}`, { uniqueId: '6003', boundAt: 1 }),
      ),
    );

    // The last free slot.
    await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: 'lck-last-slot' })
      .expect(200);
    expect((await readBinding('lck-last-slot')).uniqueId).toBe('6003');

    // At the cap now — but an ALREADY-owned device must keep working forever.
    await request(createApp())
      .post('/api/devices/lock-check')
      .set(caller.headers)
      .send({ deviceId: 'lck-last-slot' })
      .expect(200);
  });

  test('the cap is per-account: another user may still bind their own devices', async () => {
    await fillBindingsToCap('6004');
    const other = await mintRealUser({ uniqueId: '6005' });

    await request(createApp())
      .post('/api/devices/lock-check')
      .set(other.headers)
      .send({ deviceId: 'lck-other-users-phone' })
      .expect(200);
  });

  test('the admin binding route honours the cap too (support tooling cannot flood an account)', async () => {
    await fillBindingsToCap('6010');
    const admin = await mintTokenWithoutUserDoc({ admin: true });
    const app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.use('/api', require('../../src/routes/admin-devices'));

    const res = await request(app)
      .post('/api/admin/devices')
      .set(admin.headers)
      .send({ deviceId: 'admin-one-too-many', uniqueId: 6010 })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'device_limit' });
    expect(await readBinding('admin-one-too-many')).toBeNull();
  });

  test('the admin route cannot REASSIGN a device to an account that is at the cap', async () => {
    // Re-seeding is free only when the owner is unchanged; handing the device
    // to a different account costs THAT account a slot (reviewer R3-I2).
    await seedBinding('lck-someone-elses-phone', { uniqueId: '6098', boundAt: 1 });
    await fillBindingsToCap('6099');
    const admin = await mintTokenWithoutUserDoc({ admin: true });
    const app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.use('/api', require('../../src/routes/admin-devices'));

    const res = await request(app)
      .post('/api/admin/devices')
      .set(admin.headers)
      .send({ deviceId: 'lck-someone-elses-phone', uniqueId: 6099 })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'device_limit' });
    expect((await readBinding('lck-someone-elses-phone')).uniqueId).toBe('6098'); // untouched
  });

  test('an admin re-seed preserves the telemetry a real binding carries', async () => {
    // A binding written by /api/device-info holds ~20 fields; the admin route
    // sends 7. A full replace would silently wipe the rest (reviewer R4-I3).
    await seedBinding('lck-rich-device', {
      uniqueId: '6020',
      boundAt: 1,
      firstSeen: 111,
      osVersion: '15',
      country: 'Sweden',
      asn: 'AS64500',
    });
    const admin = await mintTokenWithoutUserDoc({ admin: true });
    const app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.use('/api', require('../../src/routes/admin-devices'));

    await request(app)
      .post('/api/admin/devices')
      .set(admin.headers)
      .send({ deviceId: 'lck-rich-device', uniqueId: 6020, model: 'corrected' })
      .expect(200);

    const binding = await readBinding('lck-rich-device');
    expect(binding.model).toBe('corrected'); // the admin's correction landed…
    expect(binding).toMatchObject({
      firstSeen: 111, // …and none of the telemetry was lost
      osVersion: '15',
      country: 'Sweden',
      asn: 'AS64500',
    });
  });

  test('concurrent admin binds cannot exceed the cap either', async () => {
    await Promise.all(
      Array.from({ length: MAX_BOUND_DEVICES - 1 }, (_, i) =>
        seedBinding(`lck-race-admin-${i}`, { uniqueId: '6021', boundAt: 1 }),
      ),
    );
    const admin = await mintTokenWithoutUserDoc({ admin: true });
    const app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.use('/api', require('../../src/routes/admin-devices'));

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post('/api/admin/devices')
          .set(admin.headers)
          .send({ deviceId: `lck-admin-racer-${i}`, uniqueId: 6021 }),
      ),
    );

    expect(await countBoundDevices('6021')).toBeLessThanOrEqual(MAX_BOUND_DEVICES);
  });

  test('the admin route may still RE-SEED a binding that already exists at the cap', async () => {
    await fillBindingsToCap('6011');
    const existingId = 'lck-cap-6011-000'; // one of the capped bindings
    const admin = await mintTokenWithoutUserDoc({ admin: true });
    const app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.use('/api', require('../../src/routes/admin-devices'));

    await request(app)
      .post('/api/admin/devices')
      .set(admin.headers)
      .send({ deviceId: existingId, uniqueId: 6011, model: 'reseeded' })
      .expect(200);

    expect((await readBinding(existingId)).model).toBe('reseeded');
  });
});
