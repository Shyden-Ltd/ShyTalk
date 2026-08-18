'use strict';

/**
 * SHY-0338 — GET /api/users/:uniqueId/stalkers, REAL services.
 *
 * Stalkers is the deadest of the three lists, and for reasons the other two do
 * not share. `getStalkers()` runs an ORDERED query over `users/{id}/stalkers`,
 * and that rule's second clause reads `resource.data` — so this one IS the
 * classic "rules are not filters" refusal, denied outright whatever it
 * contains. On top of that a stalker document carries no `cohort` field at all,
 * so `cohortMatchesCaller()` compares an adult caller's 'adult' claim against
 * the 'minor' default and never matches — the list stays dead even for a
 * single-document read. Both proved in
 * `tests/firestore-rules/users-follow-lists-rules.test.js`.
 *
 * So stalkers cannot be fixed by fixing the batch read. It needs its own
 * server-side route, and this one returns the visitor entries AND their
 * profiles together — one request instead of two, which matters on the slow
 * mobile connections this product targets.
 *
 * It is also a safety surface: a user who cannot see who is watching them
 * cannot act on it. The ordering and completeness assertions below are not
 * cosmetic.
 *
 * No mocks: real Auth-emulator tokens, real Firestore documents.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const usersRouter = require('../../src/routes/users');

const OWNER_ID = 63381001;
const OTHER_ID = 63381002;
const VISITOR_RECENT = 63381003;
const VISITOR_OLDER = 63381004;
const VISITOR_CROSS_COHORT = 63381005;
const VISITOR_DELETED = 63381006;
const MINOR_OWNER_ID = 63381007;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

function seedUser(uniqueId, { cohort = 'adult' } = {}) {
  return db.doc(`users/${uniqueId}`).set({
    uniqueId,
    firebaseUid: `fbuid-${uniqueId}`,
    displayName: `User ${uniqueId}`,
    email: `user${uniqueId}@example.test`,
    pinHash: 'never-returned',
    fcmTokens: ['never-returned'],
    cohort,
  });
}

function seedVisit(ownerId, visitorId, lastVisitedAt) {
  return db.doc(`users/${ownerId}/stalkers/${visitorId}`).set({
    visitorId: String(visitorId),
    visitCount: 3,
    firstVisitedAt: lastVisitedAt - 86400000,
    lastVisitedAt,
  });
}

let app;
let owner;
let other;
let minorOwner;

beforeAll(async () => {
  await assertEmulatorReachable();
  app = createApp();
  owner = await mintRealUser({ uniqueId: OWNER_ID, cohort: 'adult' });
  other = await mintRealUser({ uniqueId: OTHER_ID, cohort: 'adult' });
  minorOwner = await mintRealUser({ uniqueId: MINOR_OWNER_ID, cohort: 'minor' });
});

afterAll(() => {
  clearAuthCaches();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  const snap = await db.collection(`users/${OWNER_ID}/stalkers`).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  await Promise.all([
    seedUser(VISITOR_RECENT),
    seedUser(VISITOR_OLDER),
    seedUser(VISITOR_CROSS_COHORT, { cohort: 'minor' }),
    db.doc(`users/${VISITOR_DELETED}`).delete(),
  ]);
  await Promise.all([
    seedVisit(OWNER_ID, VISITOR_OLDER, 1_700_000_000_000),
    seedVisit(OWNER_ID, VISITOR_RECENT, 1_700_000_900_000),
  ]);
});

const getStalkers = (id, persona) =>
  request(app).get(`/api/users/${id}/stalkers`).set(persona.headers);

describe('GET /api/users/:uniqueId/stalkers', () => {
  test('the owner receives their visitors, most recent first', async () => {
    const res = await getStalkers(OWNER_ID, owner);
    expect(res.status).toBe(200);
    expect(res.body.stalkers.map((s) => String(s.visitorId))).toEqual([
      String(VISITOR_RECENT),
      String(VISITOR_OLDER),
    ]);
  });

  test('each visitor arrives with their profile, in the same response', async () => {
    // One request, not two. The client used to fetch the visit records and then
    // batch-fetch the profiles separately — two round trips, and the second was
    // the one that failed.
    const res = await getStalkers(OWNER_ID, owner);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.users.map((u) => [String(u.uniqueId), u]));
    expect(byId[String(VISITOR_RECENT)].displayName).toBe(`User ${VISITOR_RECENT}`);
    expect(byId[String(VISITOR_OLDER)].displayName).toBe(`User ${VISITOR_OLDER}`);
  });

  test('the visit metadata survives — count and both timestamps', async () => {
    const res = await getStalkers(OWNER_ID, owner);
    const recent = res.body.stalkers.find((s) => String(s.visitorId) === String(VISITOR_RECENT));
    expect(recent.visitCount).toBe(3);
    expect(recent.lastVisitedAt).toBe(1_700_000_900_000);
    expect(recent.firstVisitedAt).toBe(1_700_000_900_000 - 86400000);
  });

  test('a cross-cohort visitor is dropped, and does not take the list with them', async () => {
    // The per-user filter again. A minor viewing an adult's profile must not
    // appear in that adult's stalker list — but their presence must not empty
    // it either, which is what the client-side query did.
    await seedVisit(OWNER_ID, VISITOR_CROSS_COHORT, 1_700_000_950_000);
    const res = await getStalkers(OWNER_ID, owner);
    expect(res.status).toBe(200);
    const ids = res.body.stalkers.map((s) => String(s.visitorId));
    expect(ids).not.toContain(String(VISITOR_CROSS_COHORT));
    expect(ids).toEqual([String(VISITOR_RECENT), String(VISITOR_OLDER)]);
  });

  test('a visitor whose account is gone is dropped rather than returned hollow', async () => {
    // A visit record outlives the user document after a deletion sweep. Showing
    // a nameless row would be a worse answer than showing none.
    //
    // The owner here is a MINOR on purpose. A missing document has no `cohort`,
    // so it resolves to the 'minor' default — which means an ADULT owner drops
    // it via the COHORT guard and this test would pass with the exists guard
    // deleted. It did: mutation M7 (`if (!userSnap.exists)` → `if (false)`)
    // survived against the adult owner. A minor owner makes the default cohort
    // MATCH, so only the exists guard can drop the row.
    const stale = await db.collection(`users/${MINOR_OWNER_ID}/stalkers`).get();
    await Promise.all(stale.docs.map((d) => d.ref.delete()));
    await seedVisit(MINOR_OWNER_ID, VISITOR_DELETED, 1_700_000_960_000);

    const res = await getStalkers(MINOR_OWNER_ID, minorOwner);
    expect(res.status).toBe(200);
    expect(res.body.stalkers.map((s) => String(s.visitorId))).not.toContain(
      String(VISITOR_DELETED),
    );
    // And nothing hollow leaked into the profile list either.
    expect(res.body.users).toEqual([]);
  });

  test('sensitive fields are stripped from the visitor profiles', async () => {
    const res = await getStalkers(OWNER_ID, owner);
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('pinHash');
      expect(u).not.toHaveProperty('fcmTokens');
      expect(u).not.toHaveProperty('email');
      expect(u).not.toHaveProperty('firebaseUid');
      expect(u).not.toHaveProperty('cohortOverride');
    }
  });

  test("cohort IS returned, and always equals the owner's", async () => {
    // Same reasoning as POST /users/batch — the client's defence-in-depth
    // filter needs it, and every visitor returned is same-cohort as the owner,
    // so the value discloses nothing. This assertion is what keeps that true.
    const res = await getStalkers(OWNER_ID, owner);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
    for (const u of res.body.users) {
      expect(u.cohort).toBe('adult');
    }
  });

  test('nobody else can read your stalkers', async () => {
    // Who is watching you is yours alone. This is the security assertion the
    // whole route hangs on.
    const res = await getStalkers(OWNER_ID, other);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('stalkers');
  });

  test('an unauthenticated caller is refused', async () => {
    const res = await request(app).get(`/api/users/${OWNER_ID}/stalkers`);
    expect(res.status).toBe(401);
  });

  test('an owner with no visitors gets an empty list, not an error', async () => {
    const snap = await db.collection(`users/${OWNER_ID}/stalkers`).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    const res = await getStalkers(OWNER_ID, owner);
    expect(res.status).toBe(200);
    expect(res.body.stalkers).toEqual([]);
    expect(res.body.users).toEqual([]);
  });
});
