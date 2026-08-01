/**
 * SHY-0267 phase 1 — scheduling an event and inviting a roster.
 *
 * j16 has asserted this across 11 scenarios since it was written and NONE of it
 * existed: no events surface in express-api/src or shared/src, and the fields
 * the scenarios name — `teamRoster`, `eventInvites`, `events/{id}/giftLedger` —
 * appeared nowhere outside the corpus. The scenarios were tagged
 * `@unimplemented` yesterday to stop them reading as regressions; a tag is an
 * honest stopgap, not a fix.
 *
 * THE COHORT BOUNDARY IS THE SECURITY PROPERTY HERE. A roster is a standing
 * working relationship between named people, and it is the one place the product
 * could create a cross-cohort one — rooms, discovery and PMs all refuse it. An
 * adult host must not be able to put a minor on their roster, in either
 * direction.
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

const P = 'ev267';
let app;

const inFiveMinutes = () => new Date(Date.now() + 5 * 60_000).toISOString();

async function seedMember({ key, cohort = 'adult', userType = 'MC_SINGER' }) {
  const uniqueId = `${P}-${key}`;
  await db.doc(`users/${uniqueId}`).set({
    uniqueId,
    displayName: key,
    cohort,
    userType,
  });
  return uniqueId;
}

async function host({ cohort = 'adult', userType = 'MC_EVENT_HOST' } = {}) {
  return mintRealUser({
    uniqueId: `${P}-tariq`,
    cohort,
    extraUserData: { cohort, userType, displayName: 'Tariq' },
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

describe('scheduling', () => {
  test('a host schedules an event with a roster', async () => {
    const tariq = await host();
    const selma = await seedMember({ key: 'selma' });

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Saturday Showcase',
        startsAt: inFiveMinutes(),
        durationMin: 60,
        roster: [selma],
      });

    expect(res.status).toBe(201);
    expect(res.body.event.title).toBe('Saturday Showcase');
    expect(res.body.event.hostId).toBe(`${P}-tariq`);
    expect(res.body.event.roster).toEqual([selma]);
    expect(res.body.event.state).toBe('SCHEDULED');
  });

  test('every rostered member gets a PENDING invite naming the host and time', async () => {
    // "You were invited" without who or when is not an invitation — the
    // performer cannot decide whether they are free.
    const tariq = await host();
    const selma = await seedMember({ key: 'selma' });
    const startsAt = inFiveMinutes();

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ title: 'Showcase', startsAt, durationMin: 60, roster: [selma] });

    const invite = await db.doc(`users/${selma}/eventInvites/${res.body.event.eventId}`).get();
    expect(invite.exists).toBe(true);
    expect(invite.data().status).toBe('PENDING');
    expect(invite.data().hostName).toBe('Tariq');
    expect(invite.data().startsAt).toBe(startsAt);
  });

  test('an EMPTY roster is valid — a host may perform solo', async () => {
    const tariq = await host();
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ title: 'Solo', startsAt: inFiveMinutes(), durationMin: 30, roster: [] });
    expect(res.status).toBe(201);
    expect(res.body.event.roster).toEqual([]);
  });
});

describe('the cohort boundary holds on a roster', () => {
  test('an ADULT host cannot roster a MINOR', async () => {
    // A roster is a standing working relationship between named people. Rooms,
    // discovery and PMs all refuse to cross the cohort line; this is the one
    // place that boundary could be created instead.
    const tariq = await host({ cohort: 'adult' });
    const minor = await seedMember({ key: 'minor', cohort: 'minor' });

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ title: 'Showcase', startsAt: inFiveMinutes(), durationMin: 60, roster: [minor] });

    expect(res.status).toBe(403);
    // `users/{id}/eventInvites` is a COLLECTION — an odd segment count, so
    // `.doc()` on it throws rather than returning an empty snapshot.
    const invites = await db.collection(`users/${minor}/eventInvites`).get();
    expect(invites.empty).toBe(true);
  });

  test('a MINOR host cannot roster an ADULT — the guard runs both ways', async () => {
    const minorHost = await host({ cohort: 'minor' });
    const adult = await seedMember({ key: 'adult', cohort: 'adult' });

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${minorHost.idToken}`)
      .send({ title: 'Showcase', startsAt: inFiveMinutes(), durationMin: 60, roster: [adult] });

    expect(res.status).toBe(403);
  });

  test('a refused roster creates NO event at all, not a partial one', async () => {
    // A half-created event with the offending member dropped would be a
    // different event than the host asked for, silently.
    const tariq = await host({ cohort: 'adult' });
    const ok = await seedMember({ key: 'ok', cohort: 'adult' });
    const minor = await seedMember({ key: 'minor2', cohort: 'minor' });

    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ title: 'Mixed', startsAt: inFiveMinutes(), durationMin: 60, roster: [ok, minor] });

    const events = await db.collection('events').get();
    expect(events.docs.filter((d) => d.id.startsWith(P))).toHaveLength(0);
  });
});

describe('authorisation and validation', () => {
  test('a non-host userType is refused', async () => {
    const singer = await host({ userType: 'MC_SINGER' });
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${singer.idToken}`)
      .send({ title: 'Nope', startsAt: inFiveMinutes(), durationMin: 60, roster: [] });
    expect(res.status).toBe(403);
  });

  test('an unauthenticated request is refused', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({ title: 'Nope', startsAt: inFiveMinutes(), durationMin: 60, roster: [] });
    expect(res.status).toBe(401);
  });

  test('a start time in the PAST is refused', async () => {
    // Scheduling backwards is always a mistake, and silently accepting it makes
    // an event that can never start.
    const tariq = await host();
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Yesterday',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        durationMin: 60,
        roster: [],
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/past|future/i);
  });

  test.each([
    ['missing title', { startsAt: null, durationMin: 60 }],
    ['blank title', { title: '   ', durationMin: 60 }],
    ['zero duration', { title: 'X', durationMin: 0 }],
    ['negative duration', { title: 'X', durationMin: -5 }],
  ])('%s is refused', async (_label, patch) => {
    const tariq = await host();
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({ title: 'X', startsAt: inFiveMinutes(), durationMin: 60, roster: [], ...patch });
    expect(res.status).toBe(400);
  });

  test('a roster naming a user who does not exist is refused', async () => {
    // Silently dropping them would give the host an event whose roster is not
    // the one they typed.
    const tariq = await host();
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Ghost',
        startsAt: inFiveMinutes(),
        durationMin: 60,
        roster: [`${P}-nobody`],
      });
    expect(res.status).toBe(400);
  });

  test('a host cannot roster THEMSELVES', async () => {
    const tariq = await host();
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tariq.idToken}`)
      .send({
        title: 'Self',
        startsAt: inFiveMinutes(),
        durationMin: 60,
        roster: [`${P}-tariq`],
      });
    expect(res.status).toBe(400);
  });
});
