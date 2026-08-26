/**
 * SHY-0458 — the conversation READ path, server-side.
 *
 * The client used to read conversations straight from Firestore. That broke
 * private messaging outright: `firestore.rules:355` dereferences
 * `resource.data.participantIds`, so reading a conversation that does not exist
 * YET is a rules evaluation error rather than a miss —
 *
 *   GET /conversations/50000010_50000020 -> 403
 *     "evaluation error at L355:21 for 'get' @ L355, Null value error."
 *
 * — and `getOrCreateConversation` opens with exactly that read, so no
 * conversation could ever be created. These endpoints move the decision to the
 * server, where a missing document is a 404 and creation is a deliberate,
 * authorised act.
 *
 * The gates asserted here are the ones that matter for a minors-facing product:
 * you may only see conversations you are in, cross-cohort pairs cannot be
 * created, and threads frozen at migration stay hidden (UK OSA #17).
 *
 * ─── Why there are no doubles here ──────────────────────────────────────────
 *
 * This suite was first written against a hand-built Firestore double — a
 * `state` object, a `makeQuery()` chain, and `jest.mock` over
 * `src/utils/firebase`, `src/middleware/sameCohort` and `src/middleware/auth`.
 * It tripped the no-new-stubs ratchet (EPIC-0003), and the ratchet was right
 * about more than policy:
 *
 *   - mocking `requireSameCohort` to `(req,res,next)=>next()` meant the
 *     cross-cohort test asserted a 404 that the ROUTE produced while the gate
 *     that exists to produce it was never executed. The safeguarding assertion
 *     was testing the thing it had just switched off.
 *   - the double's `where('participantIds','array-contains', v)` compared
 *     `.map(String)`, so it could not tell a String from a Number — which is
 *     precisely the defect SHY-0130 shipped and SHY-0467 is about.
 *
 * Everything below runs against the real Firestore emulator, real Auth tokens
 * and the real middleware chain.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const conversationsRouter = require('../../src/routes/conversations');

// Per-file uniqueId prefix so parallel suites cannot collide in the shared
// emulator, and well clear of the seeded personas that SHY-0464 protects.
const ALICE = 64200001; // adult, the caller in most tests
const LENA = 64200002; // adult, the other party
const MARCUS = 64200003; // minor, the cross-cohort party

// The route's own id scheme (`conversations.js`): sorted, joined, as strings.
const convIdFor = (a, b) => [String(a), String(b)].sort().join('_');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', conversationsRouter);
  return app;
}

/** Every conversation this file creates, so each test can clean up after itself. */
const OWNED = [convIdFor(ALICE, LENA), convIdFor(ALICE, MARCUS), convIdFor(LENA, MARCUS)];

async function clearConversations() {
  await Promise.all(OWNED.map((id) => db.doc(`conversations/${id}`).delete()));
}

/** Reads the document the ROUTE wrote, not the response it projected. */
const storedConversation = async (id) => (await db.doc(`conversations/${id}`).get()).data();

let alice;

beforeAll(async () => {
  await assertEmulatorReachable();
  // The other parties need real user documents: the route looks them up to
  // decide cohort, and `requireSameCohort` reads them for real here.
  await db.doc(`users/${LENA}`).set({ uniqueId: LENA, cohort: 'adult', displayName: 'Lena' });
  await db.doc(`users/${MARCUS}`).set({ uniqueId: MARCUS, cohort: 'minor', displayName: 'Marcus' });
});

afterAll(async () => {
  await clearConversations();
  await Promise.all([db.doc(`users/${LENA}`).delete(), db.doc(`users/${MARCUS}`).delete()]);
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearAuthCaches();
  await clearConversations();
  alice = await mintRealUser({
    uniqueId: ALICE,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', displayName: 'Alice' },
  });
});

afterEach(clearConversations);

describe('GET /api/conversations', () => {
  test('returns only conversations the caller is in', async () => {
    await db.doc(`conversations/${convIdFor(ALICE, LENA)}`).set({
      participantIds: [String(ALICE), String(LENA)],
      lastMessageAt: 2,
    });
    await db.doc(`conversations/${convIdFor(LENA, MARCUS)}`).set({
      participantIds: [String(LENA), String(MARCUS)],
      lastMessageAt: 3,
    });

    const res = await request(createApp()).get('/api/conversations').set(alice.headers);

    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id);
    expect(ids).toContain(convIdFor(ALICE, LENA));
    expect(ids).not.toContain(convIdFor(LENA, MARCUS));
  });

  test('excludes threads frozen at migration (UK OSA #17)', async () => {
    await db.doc(`conversations/${convIdFor(ALICE, LENA)}`).set({
      participantIds: [String(ALICE), String(LENA)],
      lastMessageAt: 1,
    });
    await db.doc(`conversations/${convIdFor(ALICE, MARCUS)}`).set({
      participantIds: [String(ALICE), String(MARCUS)],
      crossCohortAtMigration: true,
      lastMessageAt: 9,
    });

    const res = await request(createApp()).get('/api/conversations').set(alice.headers);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.id)).not.toContain(convIdFor(ALICE, MARCUS));
  });

  test('an empty list is 200 with [], not an error', async () => {
    // The defect this story fixes made "no conversations yet" indistinguishable
    // from "denied". They must never look the same again.
    const res = await request(createApp()).get('/api/conversations').set(alice.headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/conversations — get or create', () => {
  test('creates the conversation when none exists', async () => {
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: LENA });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(convIdFor(ALICE, LENA));
    expect(await storedConversation(convIdFor(ALICE, LENA))).toBeDefined();
  });

  test('a conversation that does not exist yet is created, never a rules error', async () => {
    // The exact case that returned "Null value error" from firestore.rules.
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: LENA });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  test('returns the existing conversation instead of creating a second', async () => {
    const id = convIdFor(ALICE, LENA);
    await db.doc(`conversations/${id}`).set({
      participantIds: [String(ALICE), String(LENA)],
      createdAt: 111,
    });

    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: LENA });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    // The original document survived rather than being replaced by a new one.
    expect((await storedConversation(id)).createdAt).toBe(111);
  });

  test('refuses a conversation with yourself', async () => {
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: ALICE });
    expect(res.status).toBe(400);
  });

  test('refuses a cross-cohort pair', async () => {
    // The safeguarding gate. An adult must not be able to open a thread with a
    // minor by asking the API politely.
    //
    // The body is asserted too: a bare status check passes when the ROUTE does
    // not exist, because Express answers its own 404 — which is how this test
    // passed before a single line of the endpoint was written.
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: MARCUS });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(await storedConversation(convIdFor(ALICE, MARCUS))).toBeUndefined();
  });

  test('requires otherUserId', async () => {
    const res = await request(createApp()).post('/api/conversations').set(alice.headers).send({});
    expect(res.status).toBe(400);
  });

  test('an unknown user is 404, not a created conversation', async () => {
    // Body asserted for the same reason as above — Express's own 404 for a
    // missing route has no body, so this cannot pass before the route exists.
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: 99999999 });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(await storedConversation(convIdFor(ALICE, 99999999))).toBeUndefined();
  });
});

/**
 * SHY-0468 — the cohort gate on thread CREATION.
 *
 * The gate read `req.auth.cohort`, a field `authMiddleware` does not set (the
 * claim is at `req.auth.token.cohort`). `callerCohort` was always undefined,
 * the `&&` short-circuited, and every caller passed: an adult could open a
 * thread with a minor, and the thread was written.
 *
 * These run on the real middleware chain deliberately. The suite that missed
 * this mocked `requireSameCohort` to a pass-through AND hand-supplied
 * `req.auth.cohort` — it asserted a refusal while switching off the thing that
 * refuses.
 */
describe('POST /api/conversations — the cohort wall holds in both directions', () => {
  test('an adult cannot open a thread with a minor, and nothing is written', async () => {
    const res = await request(createApp())
      .post('/api/conversations')
      .set(alice.headers)
      .send({ otherUserId: MARCUS });

    expect(res.status).toBe(404);
    expect(await storedConversation(convIdFor(ALICE, MARCUS))).toBeUndefined();
  });

  test('a minor cannot open a thread with an adult either', async () => {
    // The wall is not directional. A minor initiating must be refused for the
    // same reason, or the gate is only half present.
    const marcus = await mintRealUser({
      uniqueId: MARCUS,
      cohort: 'minor',
      extraUserData: { cohort: 'minor', displayName: 'Marcus' },
    });

    const res = await request(createApp())
      .post('/api/conversations')
      .set(marcus.headers)
      .send({ otherUserId: LENA });

    expect(res.status).toBe(404);
    expect(await storedConversation(convIdFor(MARCUS, LENA))).toBeUndefined();
  });

  test('a caller with no cohort claim is treated as a minor, not as unrestricted', async () => {
    // Fail CLOSED. An absent claim must restrict the caller, never free them —
    // which is exactly the direction the old code failed in.
    const noClaim = await mintRealUser({
      uniqueId: ALICE,
      extraUserData: { cohort: 'adult', displayName: 'Alice' },
    });

    const res = await request(createApp())
      .post('/api/conversations')
      .set(noClaim.headers)
      .send({ otherUserId: LENA }); // LENA is an adult

    expect(res.status).toBe(404);
    expect(await storedConversation(convIdFor(ALICE, LENA))).toBeUndefined();
  });

  test('a target with no cohort field is treated as a minor', async () => {
    // The second half of the same hole: `other.cohort &&` meant a missing
    // field skipped the comparison entirely.
    const NOFIELD = 64200004;
    await db.doc(`users/${NOFIELD}`).set({ uniqueId: NOFIELD, displayName: 'No cohort' });
    try {
      const res = await request(createApp())
        .post('/api/conversations')
        .set(alice.headers)
        .send({ otherUserId: NOFIELD });

      expect(res.status).toBe(404);
      expect(await storedConversation(convIdFor(ALICE, NOFIELD))).toBeUndefined();
    } finally {
      await db.doc(`users/${NOFIELD}`).delete();
      await db.doc(`conversations/${convIdFor(ALICE, NOFIELD)}`).delete();
    }
  });

  test('an admin cohortOverride on the target is honoured over the raw field', async () => {
    // `effectiveCohort` prefers an audited override; the raw field alone would
    // refuse a pairing staff have deliberately allowed.
    const OVERRIDDEN = 64200005;
    await db
      .doc(`users/${OVERRIDDEN}`)
      .set({ uniqueId: OVERRIDDEN, cohort: 'minor', cohortOverride: 'adult', displayName: 'Ovr' });
    try {
      const res = await request(createApp())
        .post('/api/conversations')
        .set(alice.headers)
        .send({ otherUserId: OVERRIDDEN });

      expect(res.status).toBe(200);
      expect(await storedConversation(convIdFor(ALICE, OVERRIDDEN))).toBeDefined();
    } finally {
      await db.doc(`users/${OVERRIDDEN}`).delete();
      await db.doc(`conversations/${convIdFor(ALICE, OVERRIDDEN)}`).delete();
    }
  });
});
