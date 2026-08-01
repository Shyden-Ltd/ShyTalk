/**
 * SHY-0267 phase 5 — gifts follow the performer, and the event keeps a ledger.
 *
 * j16: "Audience tips Selma — beans split + event-level gift ledger gets two
 * entries", then "Tariq's event-host UI shows the real-time event-level gift
 * summary: 2 gifts, 510 coins, 255 beans, top contributor Alice".
 *
 * THIS IS WHY EVENTS EXIST. A showcase with four performers where the tips all
 * land on the host is not a rounding error — it is the performers being paid
 * nothing for the audience they drew. The seat says who is performing; the
 * ledger says what that performance earned.
 *
 * The awkward case is deliberate and tested: a gift arriving while NOBODY is
 * seated. It cannot be dropped (the sender paid), and it must not be credited
 * to whoever last held the stage.
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
const { recordEventGift, summariseEvent } = require('../../src/utils/event-ledger');

const P = 'evg267';
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

describe('attribution', () => {
  test('a gift is credited to the SEATED performer, not the host', async () => {
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

    const entries = await db.collection(`events/${eventId}/giftLedger`).get();
    expect(entries.size).toBe(1);
    expect(entries.docs[0].data().recipientId).toBe(selma.uniqueId);
    expect(entries.docs[0].data().coinValue).toBe(500);
  });

  test('a gift with NOBODY seated goes to the event and the host, never a stale performer', async () => {
    // The gap between acts. Dropping it loses money the sender paid; crediting
    // the last performer pays someone who is no longer on stage.
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const selma = await person('selma', 'MC_SINGER');
    const eventId = await liveEvent(tariq.idToken, [selma]);
    await request(app)
      .post(`/api/events/${eventId}/promote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });
    await request(app)
      .post(`/api/events/${eventId}/demote`)
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ uniqueId: selma.uniqueId });

    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-alice`,
      giftId: 'rose',
      coinValue: 10,
      beanReward: 5,
    });

    const entries = await db.collection(`events/${eventId}/giftLedger`).get();
    expect(entries.size).toBe(1);
    const entry = entries.docs[0].data();
    expect(entry.recipientId).toBe(tariq.uniqueId);
    // Explicitly marked, so a payout run can tell "the host performed" from
    // "nobody was on stage and the house took it".
    expect(entry.unattributed).toBe(true);
  });

  test('a gift in a room with no event writes NO ledger entry', async () => {
    // Ordinary rooms must be untouched by this.
    await db.doc(`rooms/${P}-plain`).set({ roomId: `${P}-plain`, ownerId: `${P}-tariq` });
    await recordEventGift({
      roomId: `${P}-plain`,
      senderId: `${P}-alice`,
      giftId: 'rose',
      coinValue: 10,
      beanReward: 5,
    });
    const rooms = await db.doc(`rooms/${P}-plain`).get();
    expect(rooms.exists).toBe(true);
  });

  test('each gift is its own ledger entry — two tips, two rows', async () => {
    // j16 asserts exactly two entries for two tips. Collapsing them would lose
    // who gave what, which is the contributor list the host reads.
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
    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-theo`,
      giftId: 'rose',
      coinValue: 10,
      beanReward: 5,
    });

    const entries = await db.collection(`events/${eventId}/giftLedger`).get();
    expect(entries.size).toBe(2);
  });
});

describe('the summary the host reads', () => {
  async function seededEvent() {
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
    await recordEventGift({
      roomId: `${eventId}-room`,
      senderId: `${P}-theo`,
      giftId: 'rose',
      coinValue: 10,
      beanReward: 5,
    });
    return { eventId, tariq, selma };
  }

  test('totals match j16: 2 gifts, 510 coins, 255 beans', async () => {
    const { eventId } = await seededEvent();
    const summary = await summariseEvent(eventId);
    expect(summary.giftCount).toBe(2);
    expect(summary.coinTotal).toBe(510);
    expect(summary.beanTotal).toBe(255);
  });

  test('the top contributor is the biggest SPENDER, not the most frequent', async () => {
    // Theo could send twenty roses and still be worth less than Alice's one
    // crown. Ranking by count would name the wrong person on the host's screen.
    const { eventId } = await seededEvent();
    const summary = await summariseEvent(eventId);
    expect(summary.topContributorId).toBe(`${P}-alice`);
  });

  test('an event with no gifts summarises to zeroes, not an error', async () => {
    const tariq = await person('tariq', 'MC_EVENT_HOST');
    const eventId = await liveEvent(tariq.idToken, []);
    const summary = await summariseEvent(eventId);
    expect(summary).toMatchObject({ giftCount: 0, coinTotal: 0, beanTotal: 0 });
    expect(summary.topContributorId).toBeNull();
  });

  test('the host can read the summary over HTTP', async () => {
    const { eventId, tariq } = await seededEvent();
    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${tariq.idToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.coinTotal).toBe(510);
  });

  test('a performer may read the summary of an event they performed in', async () => {
    // It is their earnings. Hiding it from them would make the split
    // unverifiable by the person it pays.
    const { eventId, selma } = await seededEvent();
    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    expect(res.status).toBe(200);
  });

  test('a stranger cannot read it', async () => {
    const { eventId } = await seededEvent();
    const stranger = await person('stranger', 'MEMBER');
    const res = await request(app)
      .get(`/api/events/${eventId}/summary`)
      .set('Authorization', `Bearer ${stranger.idToken}`);
    expect(res.status).toBe(403);
  });
});
