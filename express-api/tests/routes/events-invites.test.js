/**
 * SHY-0267 phase 2 — a performer answers their invite.
 *
 * j16: "Selma on Android taps Accept on the event invite" → the invite becomes
 * ACCEPTED, and separately "Selma declines the event invite — Tariq sees the
 * decline". Neither existed.
 *
 * The interesting cases are not accept and decline. They are:
 *   - a DOUBLE accept, which must not put someone on a roster twice
 *   - answering an invite for an event that has already CLOSED
 *   - answering someone ELSE's invite
 * Each of those is a way the roster silently stops matching reality, and a
 * roster that lies is worse than no roster: the host builds a show around it.
 *
 * Real Firestore emulator throughout.
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

const P = 'evi267';
let app;

const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();

/** A scheduled event with `member` invited, created through the real route. */
async function scheduledEvent(hostToken, memberId, overrides = {}) {
  const res = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ title: 'Showcase', startsAt: soon(), durationMin: 60, roster: [memberId] });
  if (overrides.state) {
    await db.doc(`events/${res.body.event.eventId}`).update({ state: overrides.state });
  }
  return res.body.event;
}

async function member(key = 'selma', cohort = 'adult') {
  return mintRealUser({
    uniqueId: `${P}-${key}`,
    cohort,
    extraUserData: { cohort, userType: 'MC_SINGER', displayName: key },
  });
}

async function host() {
  return mintRealUser({
    uniqueId: `${P}-tariq`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', userType: 'MC_EVENT_HOST', displayName: 'Tariq' },
  });
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
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearPrefixed(db, 'users', P);
  await clearPrefixed(db, 'events', P);
});

describe('answering an invite', () => {
  test('accepting marks it ACCEPTED and adds the member to accepted', async () => {
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, selma.uid ? `${P}-selma` : `${P}-selma`);

    const res = await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(200);
    const invite = await db.doc(`users/${P}-selma/eventInvites/${event.eventId}`).get();
    expect(invite.data().status).toBe('ACCEPTED');
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().accepted).toContain(`${P}-selma`);
  });

  test('declining marks it DECLINED and the host can see it', async () => {
    // j16: "Selma declines the event invite — Tariq sees the decline". A decline
    // the host cannot see is the same as no answer, and they will hold a seat
    // for someone who is not coming.
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    const res = await request(app)
      .post(`/api/events/${event.eventId}/invite/decline`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(200);
    const invite = await db.doc(`users/${P}-selma/eventInvites/${event.eventId}`).get();
    expect(invite.data().status).toBe('DECLINED');
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().declined).toContain(`${P}-selma`);
    expect(stored.data().accepted || []).not.toContain(`${P}-selma`);
  });

  test('a decline after an accept moves the member across, not into both', async () => {
    // Someone who accepts and then finds they cannot make it. Leaving them on
    // BOTH lists gives the host a roster where the counts do not add up.
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    await request(app)
      .post(`/api/events/${event.eventId}/invite/decline`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().declined).toContain(`${P}-selma`);
    expect(stored.data().accepted || []).not.toContain(`${P}-selma`);
  });
});

describe('idempotency', () => {
  test('a DOUBLE accept does not roster the member twice', async () => {
    // A double tap on a slow connection. A duplicate would inflate every count
    // the host reads and could seat one person twice.
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    const first = await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    const second = await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(first.status).toBe(200);
    // Idempotent, not an error: the client cannot tell its first request landed.
    expect(second.status).toBe(200);
    const stored = await db.doc(`events/${event.eventId}`).get();
    const accepted = stored.data().accepted || [];
    expect(accepted.filter((id) => id === `${P}-selma`)).toHaveLength(1);
  });

  test('a double decline is likewise idempotent', async () => {
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    await request(app)
      .post(`/api/events/${event.eventId}/invite/decline`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    const second = await request(app)
      .post(`/api/events/${event.eventId}/invite/decline`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(second.status).toBe(200);
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect((stored.data().declined || []).filter((id) => id === `${P}-selma`)).toHaveLength(1);
  });
});

describe('answers that must be refused', () => {
  test('accepting an invite to a CLOSED event is refused, not silently accepted', async () => {
    // Silently accepting would put someone on the roster of a show that already
    // happened, and the host would see a performer appear after the fact.
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`, { state: 'CLOSED' });

    const res = await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(409);
    const invite = await db.doc(`users/${P}-selma/eventInvites/${event.eventId}`).get();
    expect(invite.data().status).toBe('PENDING');
  });

  test('accepting an invite that is not yours is refused', async () => {
    const tariq = await host();
    await member('selma');
    const theo = await member('theo');
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    const res = await request(app)
      .post(`/api/events/${event.eventId}/invite/accept`)
      .set('Authorization', `Bearer ${theo.idToken}`);

    expect(res.status).toBe(404);
    const stored = await db.doc(`events/${event.eventId}`).get();
    expect(stored.data().accepted || []).not.toContain(`${P}-theo`);
  });

  test('an unknown event id is a 404, not a 500', async () => {
    const selma = await member();
    const res = await request(app)
      .post(`/api/events/${P}-nosuchevent/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);
    expect(res.status).toBe(404);
  });

  test('an unauthenticated answer is refused', async () => {
    const tariq = await host();
    await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);
    const res = await request(app).post(`/api/events/${event.eventId}/invite/accept`);
    expect(res.status).toBe(401);
  });
});

describe('the host can read the answers', () => {
  test('the host sees each member’s state: pending, accepted, declined', async () => {
    // The roster panel in j16 shows exactly this. Without it the host is
    // guessing who turned up.
    const tariq = await host();
    const selma = await member('selma');
    await member('theo');

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Showcase',
        startsAt: soon(),
        durationMin: 60,
        roster: [`${P}-selma`, `${P}-theo`],
      });
    const eventId = res.body.event.eventId;

    await request(app)
      .post(`/api/events/${eventId}/invite/accept`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    const view = await request(app)
      .get(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${tariq.idToken}`);

    expect(view.status).toBe(200);
    const byId = Object.fromEntries(
      view.body.event.rosterStates.map((r) => [r.uniqueId, r.status]),
    );
    expect(byId[`${P}-selma`]).toBe('ACCEPTED');
    expect(byId[`${P}-theo`]).toBe('PENDING');
  });

  test('a stranger cannot read someone else’s event', async () => {
    const tariq = await host();
    await member('selma');
    const stranger = await member('stranger');
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    const res = await request(app)
      .get(`/api/events/${event.eventId}`)
      .set('Authorization', `Bearer ${stranger.idToken}`);

    expect(res.status).toBe(403);
  });

  test('a ROSTERED member may read the event they are invited to', async () => {
    // They need the start time and who else is on it to decide.
    const tariq = await host();
    const selma = await member();
    const event = await scheduledEvent(tariq.idToken, `${P}-selma`);

    const res = await request(app)
      .get(`/api/events/${event.eventId}`)
      .set('Authorization', `Bearer ${selma.idToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe('Showcase');
  });
});
