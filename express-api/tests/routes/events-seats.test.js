/**
 * SHY-0267 phase 4 — the host rotates performers through the seats.
 *
 * j16: "Tariq taps Promote Selma" → she takes a performer seat and her mic
 * unlocks; "Tariq taps Demote Selma" → the seat is empty again.
 *
 * This is the whole reason an event exists. A showcase is one room that several
 * performers pass through, and the seat is what says who is performing right
 * now — which is what the money will follow in phase 5.
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

const P = 'evs267';
let app;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

async function person(key, userType) {
  return mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', userType, displayName: key },
  });
}

/** A LIVE event with `roster` accepted, created entirely through the routes. */
async function liveEvent(hostToken, memberTokens = []) {
  const roster = memberTokens.map((m) => m.uniqueId);
  const created = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ title: 'Showcase', startsAt: inMinutes(5), durationMin: 60, roster });
  const eventId = created.body.event.eventId;
  for (const m of memberTokens) {
    await request(app)
      .post(`/api/events/${eventId}/invite/accept`)
      .set('Authorization', `Bearer ${m.idToken}`);
  }
  await db.doc(`events/${eventId}`).update({ startsAt: inMinutes(-1) });
  const started = await request(app)
    .post(`/api/events/${eventId}/start`)
    .set('Authorization', `Bearer ${hostToken}`);
  return { eventId, roomId: started.body.roomId };
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
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearPrefixed(db, 'users', P);
  await clearPrefixed(db, 'events', P);
  await clearPrefixed(db, 'rooms', P);
});

describe('promoting a performer', () => {
  test('seats the member and records who is performing', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId, roomId } = await liveEvent(tariq.idToken, [selma]);

    const res = await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(200);
    const room = await db.doc(`rooms/${roomId}`).get();
    const seats = room.data().seats || {};
    const seated = Object.values(seats).filter((s) => s && s.userId === `${P}-selma`);
    expect(seated).toHaveLength(1);
    // The event records the CURRENT performer separately from the seat map:
    // phase 5 attributes gifts to it, and reading a seat map to answer "who is
    // performing" means re-deriving the answer on every gift.
    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().currentPerformerId).toBe(`${P}-selma`);
  });

  test('promoting someone NOT on the roster is refused', async () => {
    // Otherwise an event is a way to seat anyone in a room they were never
    // invited to.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    await person('stranger', 'MC_SINGER');
    const { eventId } = await liveEvent(tariq.idToken, [selma]);

    const res = await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-stranger` });

    expect(res.status).toBe(400);
  });

  test('only the HOST may promote — a performer cannot seat themselves', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId } = await liveEvent(tariq.idToken, [selma]);

    const res = await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${selma.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(403);
  });

  test('promoting a second performer replaces the first, leaving ONE seated', async () => {
    // A rotation, not an accumulation. Two "current performers" makes the
    // attribution in phase 5 ambiguous, and the money has to go somewhere.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const theo = await person('theo', 'MC_SINGER');
    theo.uniqueId = `${P}-theo`;
    const { eventId, roomId } = await liveEvent(tariq.idToken, [selma, theo]);

    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-theo` });

    const room = await db.doc(`rooms/${roomId}`).get();
    const occupied = Object.values(room.data().seats || {}).filter((s) => s && s.userId);
    expect(occupied).toHaveLength(1);
    expect(occupied[0].userId).toBe(`${P}-theo`);
    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().currentPerformerId).toBe(`${P}-theo`);
  });

  test('promoting the SAME person twice is idempotent', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId, roomId } = await liveEvent(tariq.idToken, [selma]);

    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });
    const second = await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(second.status).toBe(200);
    const room = await db.doc(`rooms/${roomId}`).get();
    const occupied = Object.values(room.data().seats || {}).filter((s) => s && s.userId);
    expect(occupied).toHaveLength(1);
  });
});

describe('demoting', () => {
  test('empties the seat and clears the current performer', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId, roomId } = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    const res = await request(app)
      .post(`/api/events/${eventId}/demote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(200);
    const room = await db.doc(`rooms/${roomId}`).get();
    const occupied = Object.values(room.data().seats || {}).filter((s) => s && s.userId);
    expect(occupied).toHaveLength(0);
    const event = await db.doc(`events/${eventId}`).get();
    // NULL, not the previous performer: between acts nobody is performing, and
    // phase 5 must not pay the person who just left the stage.
    expect(event.data().currentPerformerId).toBeNull();
  });

  test('demoting an empty seat is a NO-OP, not an error', async () => {
    // The host tapping demote twice, or after the performer already left.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId } = await liveEvent(tariq.idToken, [selma]);

    const res = await request(app)
      .post(`/api/events/${eventId}/demote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(200);
  });

  test('only the HOST may demote', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId } = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    const res = await request(app)
      .post(`/api/events/${eventId}/demote`)
      .set('Authorization', `Bearer ${selma.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(403);
  });
});

describe('seat changes require a live event', () => {
  test('promoting before the event starts is refused', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const created = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Later',
        startsAt: inMinutes(30),
        durationMin: 60,
        roster: [`${P}-selma`],
      });

    const res = await request(app)
      .post(`/api/events/${created.body.event.eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(409);
  });

  test('promoting after the event closes is refused', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    selma.uniqueId = `${P}-selma`;
    const { eventId } = await liveEvent(tariq.idToken, [selma]);
    await db.doc(`events/${eventId}`).update({ state: 'CLOSED' });

    const res = await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: `${P}-selma` });

    expect(res.status).toBe(409);
  });
});
