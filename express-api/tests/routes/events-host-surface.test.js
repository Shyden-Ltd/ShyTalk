/**
 * SHY-0267 phase 7 — the reads and the roster write the UI needs.
 *
 * The event API could create, start, seat and close an event, but nothing could
 * ASK it anything: a host home screen has no way to list its events, and a
 * performer has no way to find out they were invited. Six phases of write path
 * with no read path is a feature nobody can use.
 *
 * j16 also asserts the cross-cohort boundary on the roster itself: an adult host
 * must not be able to put a minor on his team. That is the same 404-not-403 rule
 * the rest of the product uses, because a 403 confirms the minor exists.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const eventsRouter = require('../../src/routes/events');

const P = 'evh267';
let app;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

async function person(key, userType, cohort = 'adult') {
  const minted = await mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort,
    extraUserData: { cohort, userType, displayName: key },
  });
  minted.uniqueId = `${P}-${key}`;
  return minted;
}

async function schedule(hostToken, { title = 'Showcase', roster = [], startsAt = inMinutes(5) }) {
  const res = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ title, startsAt, durationMin: 60, roster });
  return res.body.event;
}

beforeAll(async () => {
  await assertEmulatorReachable();
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', eventsRouter);
}, 60000);

afterAll(async () => {
  await clearPrefixed(db, 'users', P);
  await clearPrefixed(db, 'events', P);
  await clearPrefixed(db, 'rooms', P);
  await clearPrefixed(db, 'segregationEvents', P);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearPrefixed(db, 'users', P);
  await clearPrefixed(db, 'events', P);
  await clearPrefixed(db, 'rooms', P);
});

describe('the host home screen', () => {
  test('lists the events I host', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    await schedule(tariq.idToken, { title: 'Saturday Showcase' });

    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hosting.map((e) => e.title)).toContain('Saturday Showcase');
  });

  test("does NOT list somebody else's events", async () => {
    // A host home showing another host's events would let anyone start a show
    // they have nothing to do with.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const rival = await person('rival', 'MC_EVENT_HOST');
    await schedule(rival.idToken, { title: "Rival's night" });

    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.body.hosting.map((e) => e.title)).not.toContain("Rival's night");
  });

  test('lists events I am ROSTERED in, separately from ones I host', async () => {
    // Selma needs to find the show she is performing in. Merging the two lists
    // would put a Start-event button in front of someone who cannot start it.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    await schedule(tariq.idToken, { title: 'Saturday Showcase', roster: [selma.uniqueId] });

    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.body.hosting).toEqual([]);
    expect(res.body.performing.map((e) => e.title)).toContain('Saturday Showcase');
  });

  test('a CLOSED event does not clutter the list', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const event = await schedule(tariq.idToken, { title: 'Last week' });
    await db.doc(`events/${event.eventId}`).update({ state: 'CLOSED' });

    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.body.hosting.map((e) => e.title)).not.toContain('Last week');
  });

  test('someone with no events gets empty lists, not an error', async () => {
    const nobody = await person('nobody', 'MEMBER');
    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${nobody.idToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hosting: [], performing: [] });
  });
});

describe('the invite banner', () => {
  test('a rostered member can see the invite waiting for them', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const event = await schedule(tariq.idToken, {
      title: 'Saturday Showcase',
      roster: [selma.uniqueId],
    });

    const res = await request(app)
      .get('/api/events/invites')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(1);
    expect(res.body.invites[0]).toMatchObject({ eventId: event.eventId, status: 'PENDING' });
  });

  test('the invite carries the event TITLE and the host NAME', async () => {
    // The banner says "You are scheduled in Tariq's event". Without these the
    // client would have to fetch the event separately just to render one line.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    await schedule(tariq.idToken, { title: 'Saturday Showcase', roster: [selma.uniqueId] });

    const res = await request(app)
      .get('/api/events/invites')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.body.invites[0]).toMatchObject({
      title: 'Saturday Showcase',
      hostName: 'tariq',
    });
  });

  test('an ANSWERED invite drops out of the banner', async () => {
    // The banner is a call to action. One that has been answered is clutter, and
    // a second Accept would be a confusing no-op.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const event = await schedule(tariq.idToken, {
      title: 'Saturday Showcase',
      roster: [selma.uniqueId],
    });
    await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    const res = await request(app)
      .get('/api/events/invites')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.body.invites).toEqual([]);
  });

  test('an invite to a CLOSED event is not shown', async () => {
    // Nobody can act on it, and offering the choice implies they still can.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const event = await schedule(tariq.idToken, {
      title: 'Saturday Showcase',
      roster: [selma.uniqueId],
    });
    await db.doc(`events/${event.eventId}`).update({ state: 'CLOSED' });

    const res = await request(app)
      .get('/api/events/invites')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.body.invites).toEqual([]);
  });

  test('once the event is LIVE the invite carries the ROOM to join', async () => {
    // j16: "Selma taps the event-room link from the invite banner". Without the
    // roomId the banner has nothing to link to.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const event = await schedule(tariq.idToken, {
      title: 'Saturday Showcase',
      roster: [selma.uniqueId],
    });
    await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    await db.doc(`events/${event.eventId}`).update({ startsAt: inMinutes(-1) });
    await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const res = await request(app)
      .get('/api/events/mine')
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.body.performing[0].roomId).toBe(`${event.eventId}-room`);
  });
});

describe('the event room is a REAL room', () => {
  test('it carries the fields the app’s ChatRoom model reads', async () => {
    // An event room that the rest of the product cannot parse is a room nobody
    // can join. `hostIds` is what grants host powers in the room UI, and it was
    // missing — the host could not moderate his own event.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const event = await schedule(tariq.idToken, { title: 'Saturday Showcase' });
    await db.doc(`events/${event.eventId}`).update({ startsAt: inMinutes(-1) });
    await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const room = await db.doc(`rooms/${event.eventId}-room`).get();
    expect(room.data()).toMatchObject({
      ownerId: `${P}-tariq`,
      state: 'ACTIVE',
      name: 'Saturday Showcase',
      eventId: event.eventId,
    });
    expect(room.data().hostIds).toContain(`${P}-tariq`);
    expect(Array.isArray(room.data().participantIds)).toBe(true);
  });
});

describe('adding to the team roster', () => {
  test('a host can add a same-cohort MC', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');

    const res = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });

    expect(res.status).toBe(200);
    const host = await db.doc(`users/${P}-tariq`).get();
    expect(host.data().teamRoster).toContain(selma.uniqueId);
  });

  test('adding twice does not duplicate the entry', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    for (let i = 0; i < 2; i += 1) {
      await request(app)
        .post('/api/events/roster/add')
        .set('Authorization', `Bearer ${tariq.idToken}`)
        .send({ uniqueId: selma.uniqueId });
    }
    const host = await db.doc(`users/${P}-tariq`).get();
    expect(host.data().teamRoster.filter((id) => id === selma.uniqueId)).toHaveLength(1);
  });

  test('an ADULT host cannot add a MINOR — 404, never 403', async () => {
    // j16's cross-cohort scenario. 403 would confirm the minor exists, which is
    // the leak the whole segregation design exists to prevent, so the answer is
    // byte-identical to "no such user".
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const marcus = await person('marcus', 'MC_SINGER', 'minor');

    const res = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: marcus.uniqueId });

    expect(res.status).toBe(404);
    const host = await db.doc(`users/${P}-tariq`).get();
    expect(host.data().teamRoster || []).not.toContain(marcus.uniqueId);
  });

  test('the refusal is INDISTINGUISHABLE from a genuinely missing user', async () => {
    // Same status AND same body. A different error string is the same leak by
    // another route.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    await person('marcus', 'MC_SINGER', 'minor');

    const blocked = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-marcus` });
    const absent = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-nobody-at-all` });

    expect(blocked.status).toBe(absent.status);
    expect(blocked.body).toEqual(absent.body);
  });

  test('the cross-cohort block is AUDITED', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    await person('marcus', 'MC_SINGER', 'minor');
    await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-marcus` });

    const audit = await db
      .collection('segregationEvents')
      .where('sourceUniqueId', '==', `${P}-tariq`)
      .get();
    const blocked = audit.docs.map((d) => d.data()).filter((e) => e.action === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
  });

  test('a blank target is rejected before anything is written', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const res = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: '   ' });
    expect(res.status).toBe(400);
  });

  test('a host cannot add THEMSELVES — the roster is other people', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const res = await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: tariq.uniqueId });
    expect(res.status).toBe(400);
  });

  test('a host can remove someone again', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    await request(app)
      .post('/api/events/roster/add')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });

    const res = await request(app)
      .post('/api/events/roster/remove')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });

    expect(res.status).toBe(200);
    const host = await db.doc(`users/${P}-tariq`).get();
    expect(host.data().teamRoster || []).not.toContain(selma.uniqueId);
  });
});
