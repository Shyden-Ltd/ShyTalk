/**
 * EPIC-0006 — reading notification settings server-side.
 *
 * `PATCH /notifications/settings` already existed; the matching read did not,
 * so `NotificationRepositoryImpl.getPmNotificationsEnabled` went straight to
 * Firestore for `users/{userId}.pmNotificationsEnabled`. The setter was behind
 * the API and the getter was not — the half-migration shape that hid the
 * private-messaging outage in SHY-0458.
 *
 * The read is deliberately about the CALLER and takes no user id. The client
 * method accepts one, and passing it through would have let anybody read
 * anybody's settings. The token already says who is asking.
 *
 * ─── Why there are no doubles here ──────────────────────────────────────────
 *
 * This suite mocked `src/utils/firebase` wholesale and hand-built
 * `req.auth = { uniqueId }`. It tripped the no-new-stubs ratchet (EPIC-0003),
 * and the double was weaker than it looked: supplying `req.auth` by hand skips
 * the middleware that decides who the caller IS, which is the entire subject of
 * the "reads the CALLER, never a user named in the request" test below.
 *
 * It also drove persona 50000010 — a SEEDED account. Against the real emulator
 * that would have written over the persona the device journeys depend on, which
 * is what SHY-0464 exists to stop. The ids here are a per-file range no seed and
 * no other suite uses.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const notificationsRouter = require('../../src/routes/notifications');

const CALLER = 64300001;
const OTHER = 64300002;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', notificationsRouter);
  return app;
}

/** Mints the caller with the given stored settings, and returns their headers. */
async function callerWith(settings) {
  clearAuthCaches();
  const user = await mintRealUser({ uniqueId: CALLER, extraUserData: settings });
  return user.headers;
}

beforeAll(assertEmulatorReachable);

afterAll(async () => {
  await Promise.all([db.doc(`users/${CALLER}`).delete(), db.doc(`users/${OTHER}`).delete()]);
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearAuthCaches();
  await Promise.all([db.doc(`users/${CALLER}`).delete(), db.doc(`users/${OTHER}`).delete()]);
});

describe('GET /api/notifications/settings', () => {
  test('returns the settings stored on the caller', async () => {
    const headers = await callerWith({ pmNotificationsEnabled: false, pmSoundEnabled: true });
    const res = await request(createApp()).get('/api/notifications/settings').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(false);
    expect(res.body.pmSoundEnabled).toBe(true);
  });

  test('defaults to enabled when a setting was never stored', async () => {
    // The client defaulted to `true` when the field was absent. Moving the read
    // server-side must not quietly change what a person experiences.
    const headers = await callerWith({});
    const res = await request(createApp()).get('/api/notifications/settings').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(true);
  });

  test('a caller whose user document is gone is refused, not given defaults', async () => {
    // The mocked version asserted that this case returned 200 with defaults.
    // It cannot: identity resolution reads the user document, so a credential
    // whose record has been deleted never reaches the route — the middleware
    // answers 403 first. The double let a request arrive in a state production
    // does not permit, and the assertion described that fiction.
    //
    // The route still defaults a MISSING FIELD to enabled; that is the test
    // above, and it is the reachable half of the original intent.
    const headers = await callerWith({});
    await db.doc(`users/${CALLER}`).delete();

    const res = await request(createApp()).get('/api/notifications/settings').set(headers);

    expect(res.status).toBe(403);
  });

  test('returns every field the PATCH accepts, so the two cannot drift apart', async () => {
    const headers = await callerWith({});
    const res = await request(createApp()).get('/api/notifications/settings').set(headers);
    for (const key of [
      'pmNotificationsEnabled',
      'pmSoundEnabled',
      'pmShowTimestamps',
      'pmShowDateSeparators',
      'pmNotificationPreview',
    ]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  test('reads the CALLER, never a user named in the request', async () => {
    // The client method takes a userId. If the route honoured one, anybody
    // could read anybody's settings — so it must be ignored entirely.
    //
    // This runs through the real auth middleware deliberately: the identity
    // under test is the one the TOKEN resolves to, and a hand-built req.auth
    // would be asserting the fixture rather than the mechanism.
    await db.doc(`users/${OTHER}`).set({ uniqueId: OTHER, pmNotificationsEnabled: false });
    const headers = await callerWith({ pmNotificationsEnabled: true });

    const res = await request(createApp())
      .get(`/api/notifications/settings?userId=${OTHER}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(true);
  });

  test('coerces stored non-booleans, so a bad write cannot reach the client', async () => {
    const headers = await callerWith({ pmNotificationsEnabled: 'yes' });
    const res = await request(createApp()).get('/api/notifications/settings').set(headers);
    expect(typeof res.body.pmNotificationsEnabled).toBe('boolean');
  });
});

/**
 * EPIC-0006 — the PATCH half, and the round trip.
 *
 * The read test above asserts that GET returns every field PATCH accepts, by
 * reading a shared list. That proves the two lists are the same object; it does
 * not prove a setting can actually be written and read back. A field that can be
 * written but never read — or accepted and silently dropped — is invisible until
 * somebody notices it does nothing, which is the failure the shared list exists
 * to prevent.
 */
describe('PATCH /api/notifications/settings', () => {
  test('every field the GET returns can be written and read back', async () => {
    const headers = await callerWith({});

    // Read what the API says exists, then write the opposite of each.
    const before = await request(createApp()).get('/api/notifications/settings').set(headers);
    const fields = Object.keys(before.body);
    expect(fields.length).toBeGreaterThan(0);

    const flipped = Object.fromEntries(fields.map((k) => [k, !before.body[k]]));
    await request(createApp())
      .patch('/api/notifications/settings')
      .set(headers)
      .send(flipped)
      .expect(200);

    const after = await request(createApp()).get('/api/notifications/settings').set(headers);
    expect(after.body).toEqual(flipped);
  });

  test('a field that is not a setting is ignored, not stored', async () => {
    const headers = await callerWith({});

    await request(createApp())
      .patch('/api/notifications/settings')
      .set(headers)
      .send({ pmSoundEnabled: false, notASetting: true })
      .expect(200);

    const stored = (await db.doc(`users/${CALLER}`).get()).data();
    expect(stored.pmSoundEnabled).toBe(false);
    expect(stored).not.toHaveProperty('notASetting');
  });

  test('a body with no recognised field is refused, not silently accepted', async () => {
    // Answering 200 to a write that changed nothing is how a client comes to
    // believe a setting is saved when it never was.
    const headers = await callerWith({});

    const res = await request(createApp())
      .patch('/api/notifications/settings')
      .set(headers)
      .send({ notASetting: true });

    expect(res.status).toBe(400);
  });

  test('values are coerced to booleans on the way in', async () => {
    const headers = await callerWith({});

    await request(createApp())
      .patch('/api/notifications/settings')
      .set(headers)
      .send({ pmNotificationsEnabled: 'yes' })
      .expect(200);

    const stored = (await db.doc(`users/${CALLER}`).get()).data();
    expect(stored.pmNotificationsEnabled).toBe(true);
  });
});

describe('PATCH /api/notifications/settings — a body that is not a body', () => {
  test('a request with no JSON body is refused, not treated as an empty update', () => {
    // `express.json()` only populates req.body for a JSON content type. A
    // client that sends the wrong one — or nothing — leaves it undefined, and
    // the route must answer 400 rather than fall through to a write with no
    // fields in it.
    return callerWith({}).then((headers) =>
      request(createApp())
        .patch('/api/notifications/settings')
        .set(headers)
        .set('Content-Type', 'text/plain')
        .send('not json')
        .expect(400),
    );
  });
});
