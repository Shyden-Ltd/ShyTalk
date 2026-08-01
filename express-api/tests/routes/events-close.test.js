/**
 * SHY-0267 phase 6 — closing the event.
 *
 * j16: "Tariq taps End event" → the event and its room both go CLOSED, the host
 * sees totals with a per-MC breakdown, and each performer sees THEIR OWN
 * earnings (Selma: 255 beans).
 *
 * The per-performer breakdown is the point. A single event total tells the host
 * what the night made and tells each performer nothing about what they earned —
 * which is the same silence this whole story exists to end.
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
const { recordEventGift } = require('../../src/utils/event-ledger');

const P = 'evc267';
let app;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

async function person(key, userType) {
  const minted = await mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', userType, displayName: key },
  });
  minted.uniqueId = `${P}-${key}`;
  return minted;
}

async function liveEvent(hostToken, members = []) {
  const created = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({
      title: 'Showcase',
      startsAt: inMinutes(5),
      durationMin: 60,
      roster: members.map((m) => m.uniqueId),
    });
  const eventId = created.body.event.eventId;
  for (const m of members) {
    await request(app)
      .post(`/api/events/${eventId}/invite/accept`)
      .set('Authorization', `Bearer ${m.idToken}`);
  }
  await db.doc(`events/${eventId}`).update({ startsAt: inMinutes(-1) });
  await request(app)
    .post(`/api/events/${eventId}/start`)
    .set('Authorization', `Bearer ${hostToken}`);
  return eventId;
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

describe('closing', () => {
  test('closes the event AND its room', async () => {
    // A room left open after its event ends is a room nobody owns: the host has
    // gone and the audience is still sitting in it.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const eventId = await liveEvent(tariq.idToken, []);

    const res = await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(res.status).toBe(200);
    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().state).toBe('CLOSED');
    const room = await db.doc(`rooms/${eventId}-room`).get();
    expect(room.data().state).toBe('CLOSED');
  });

  test('clears the performer seat — nobody is on stage after the show', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });

    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().currentPerformerId).toBeNull();
  });

  test('only the HOST may close', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma]);

    const res = await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(403);
    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().state).toBe('LIVE');
  });

  test('closing twice is idempotent', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const eventId = await liveEvent(tariq.idToken, []);
    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    const second = await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    expect(second.status).toBe(200);
  });

  test('the closing summary is FROZEN onto the event', async () => {
    // The ledger could be re-read, but a summary that recomputes can change
    // after the fact — and a performer who was told they earned 255 must still
    // see 255 tomorrow.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });
    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-alice`,
      giftId: 'crown',
      coinValue: 500,
      beanReward: 250,
    });

    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const event = await db.doc(`events/${eventId}`).get();
    expect(event.data().finalSummary.coinTotal).toBe(500);
    expect(event.data().closedAt).toBeTruthy();
  });
});

describe('the per-performer breakdown', () => {
  async function eventWithTwoPerformers() {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const theo = await person('theo', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma, theo]);

    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });
    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-alice`,
      giftId: 'crown',
      coinValue: 500,
      beanReward: 250,
    });

    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: theo.uniqueId });
    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-alice`,
      giftId: 'rose',
      coinValue: 10,
      beanReward: 5,
    });

    return { eventId, tariq, selma, theo };
  }

  test('each performer’s earnings are attributed to THEM, not pooled', async () => {
    // The whole point. One total tells the host what the night made and tells
    // each performer nothing about what they earned.
    const { eventId, tariq } = await eventWithTwoPerformers();
    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const byPerformer = Object.fromEntries(
      res.body.summary.perPerformer.map((p) => [p.uniqueId, p]),
    );
    expect(byPerformer[`${P}-selma`].beanTotal).toBe(250);
    expect(byPerformer[`${P}-theo`].beanTotal).toBe(5);
  });

  test('a performer sees their own line', async () => {
    const { eventId, tariq, selma } = await eventWithTwoPerformers();
    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(200);
    const mine = res.body.summary.perPerformer.find((p) => p.uniqueId === `${P}-selma`);
    expect(mine.beanTotal).toBe(250);
  });

  test('a performer who earned nothing still appears, at zero', async () => {
    // Absent and zero are different facts. Someone who performed to a quiet room
    // should see that they earned nothing, not wonder whether the page broke.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });
    await request(app)
      .post(`/api/events/${eventId}/close`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    const mine = res.body.summary.perPerformer.find((p) => p.uniqueId === `${P}-selma`);
    expect(mine).toBeTruthy();
    expect(mine.beanTotal).toBe(0);
  });
});
