/**
 * SHY-0267 phase 3 — starting an event and binding it to a room.
 *
 * j16: "Tariq taps Start event" → the event goes LIVE and a room exists bound to
 * it, with the roster panel showing Selma waiting.
 *
 * The event does not reinvent a room. It BINDS one, so seats, LiveKit and the
 * whole existing room machinery keep working — an event is a room with an owner
 * who can change who sits in it.
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

const P = 'evl267';
let app;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

async function host(key = 'tariq') {
  return mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', userType: 'MC_EVENT_HOST', displayName: key },
  });
}

async function member(key = 'selma') {
  return mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', userType: 'MC_SINGER', displayName: key },
  });
}

/** Schedule through the real route, then move startsAt if the test needs it. */
async function scheduled(hostToken, { startsAt = inMinutes(5), roster = [] } = {}) {
  const res = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ title: 'Showcase', startsAt: inMinutes(5), durationMin: 60, roster });
  if (startsAt !== null) {
    await db.doc(`events/${res.body.event.eventId}`).update({ startsAt });
  }
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
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearPrefixed(db, 'users', P);
  await clearPrefixed(db, 'events', P);
  await clearPrefixed(db, 'rooms', P);
});

describe('starting an event', () => {
  test('goes LIVE and binds a room', async () => {
    const tariq = await host();
    const event = await scheduled(tariq.idToken, { startsAt: inMinutes(-1) });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(200);
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().state).toBe('LIVE');
    expect(stored.data().roomId).toBeTruthy();

    const room = await db.doc(`rooms/${stored.data().roomId}`).get();
    expect(room.exists).toBe(true);
    expect(room.data().eventId).toBe(event.eventId);
    expect(room.data().ownerId).toBe(`${P}-tariq`);
    // `state: ACTIVE`, matching the ChatRoom model the rest of the product
    // reads — an event binds a real room rather than inventing a shape.
    expect(room.data().state).toBe('ACTIVE');
  });

  test('the room carries the event title, so the audience knows what they joined', async () => {
    const tariq = await host();
    const event = await scheduled(tariq.idToken, { startsAt: inMinutes(-1) });
    await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    const stored = await db.doc(`events/${event.eventId}`).get();
    const room = await db.doc(`rooms/${stored.data().roomId}`).get();
    expect(room.data().name).toBe('Showcase');
  });

  test('accepted roster members are seeded as rosterParticipants', async () => {
    // j16 asserts the roster panel lists Selma as "waiting" the moment the room
    // opens. She has not joined yet — the panel is about who is EXPECTED.
    const tariq = await host();
    const selma = await member();
    const event = await scheduled(tariq.idToken, {
      startsAt: inMinutes(-1),
      roster: [`${P}-selma`],
    });
    await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const stored = await db.doc(`events/${event.eventId}`).get();
    const room = await db.doc(`rooms/${stored.data().roomId}`).get();
    expect(room.data().rosterParticipants).toContain(`${P}-selma`);
  });

  test('a member who DECLINED is not seeded into the room', async () => {
    // Holding a place for someone who said no is how a host ends up waiting on
    // a performer who was never coming.
    const tariq = await host();
    const selma = await member();
    const event = await scheduled(tariq.idToken, {
      startsAt: inMinutes(-1),
      roster: [`${P}-selma`],
    });
    await request(app)
      .post(`/api/events/${event.eventId}/invite/decline`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const stored = await db.doc(`events/${event.eventId}`).get();
    const room = await db.doc(`rooms/${stored.data().roomId}`).get();
    expect(room.data().rosterParticipants || []).not.toContain(`${P}-selma`);
  });

  test('a member who never answered does NOT block the start', async () => {
    // A performer who goes quiet must not be able to cancel the show by
    // silence.
    const tariq = await host();
    await member();
    const event = await scheduled(tariq.idToken, {
      startsAt: inMinutes(-1),
      roster: [`${P}-selma`],
    });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(200);
  });
});

describe('starting is gated', () => {
  test('too early is refused, and the error says how long remains', async () => {
    // "Not yet" without a number sends the host back to guess.
    const tariq = await host();
    const event = await scheduled(tariq.idToken, { startsAt: inMinutes(45) });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(409);
    // Plain string checks rather than a regex: `\d+\s*minute` trips
    // sonarjs/slow-regex, and the assertion is "it names a number of minutes",
    // which needs no pattern matching at all.
    const message = String(res.body.error);
    expect(message).toContain('minute');
    expect(message.split(/\s/).some((w) => Number.isInteger(Number(w)) && Number(w) > 0)).toBe(
      true,
    );
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().state).toBe('SCHEDULED');
  });

  test('only the HOST may start their event', async () => {
    const tariq = await host();
    const selma = await member();
    const event = await scheduled(tariq.idToken, {
      startsAt: inMinutes(-1),
      roster: [`${P}-selma`],
    });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(403);
  });

  test('starting twice does not create a SECOND room', async () => {
    // Two rooms for one event splits the audience in half and neither half can
    // see the other. The second call returns the room that already exists.
    const tariq = await host();
    const event = await scheduled(tariq.idToken, { startsAt: inMinutes(-1) });

    const first = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    const second = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(second.status).toBe(200);
    expect(second.body.roomId).toBe(first.body.roomId);
    const rooms = await db.collection('rooms').get();
    expect(rooms.docs.filter((d) => d.data().eventId === event.eventId)).toHaveLength(1);
  });

  test('a CLOSED event cannot be restarted', async () => {
    const tariq = await host();
    const event = await scheduled(tariq.idToken, { startsAt: inMinutes(-1) });
    await db.doc(`events/${event.eventId}`).update({ state: 'CLOSED' });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(409);
  });

  test('an unknown event is 404, not 500', async () => {
    const tariq = await host();
    const res = await request(app)
      .post(`/api/events/${P}-nosuch/start`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    expect(res.status).toBe(404);
  });
});
