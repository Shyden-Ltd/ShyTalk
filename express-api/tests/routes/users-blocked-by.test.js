/**
 * POST /api/users/blocked-by — REAL-services integration test (SHY-0351).
 *
 * The room-join path asks "of the people already in this room, has any of them
 * blocked me?" Before this endpoint that question was answered CLIENT-side by a
 * `whereIn(documentId(), chunk)` query on `users`, which could never return a
 * block for three independent reasons — see SHY-0351's `## Why`:
 *
 *   1. `/users/{uniqueId}` is cohort-gated, and a filtered query against a
 *      content-gated rule is refused ALL-OR-NOTHING.
 *   2. The client's `catch` turned that refusal into `emptyList()`, i.e. into
 *      the affirmative answer "nobody has blocked you".
 *   3. `filterIsInstance<String>()` DROPPED every block stored numerically,
 *      and the field genuinely holds both shapes (the app writes strings via
 *      arrayUnion; `PATCH /admin/users/:uniqueId` validates only Array.isArray
 *      and writes numbers straight through).
 *
 * So the two type cases below are not paranoia — they are the two shapes two
 * live writers actually produce, with nothing normalising between them.
 *
 * REAL-only per the No-Stubs rule: NO jest.mock anywhere. Real auth middleware
 * verifying a real Firebase ID token from the Auth emulator, real Firestore
 * emulator for every read and write.
 *
 * Isolation: every uniqueId in this file is in the 5135xxxx band, seeded and
 * deleted by id, so it neither wipes local seed data nor collides with another
 * Jest worker (per-FILE prefix convention).
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

// Per-FILE id band — see the isolation note above.
const CALLER = 51350001;
const BLOCKER_NUMERIC = 51350002; // blocked the caller, stored as a NUMBER
const BLOCKER_STRING = 51350003; // blocked the caller, stored as a STRING
const INNOCENT = 51350004; // has not blocked the caller
const OTHER_COHORT = 51350005; // blocked the caller, but is in the other cohort
const BLOCKED_BY_CALLER = 51350006; // the caller blocked THEM, not the reverse
const ABSENT = 51350099; // never created

const SEEDED = [CALLER, BLOCKER_NUMERIC, BLOCKER_STRING, INNOCENT, OTHER_COHORT, BLOCKED_BY_CALLER];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

async function post(app, caller, body) {
  return request(app).post('/api/users/blocked-by').set(caller.headers).send(body);
}

describe('POST /api/users/blocked-by (SHY-0351)', () => {
  let app;
  let caller;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createApp();
  });

  afterAll(async () => {
    process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  beforeEach(async () => {
    clearAuthCaches();
    caller = await mintRealUser({
      uniqueId: CALLER,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', blockedUserIds: [BLOCKED_BY_CALLER] },
    });
    // The two shapes two real writers produce. NUMBER is what an admin edit
    // writes; STRING is what the app's own block button writes.
    await mintRealUser({
      uniqueId: BLOCKER_NUMERIC,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', blockedUserIds: [CALLER] },
    });
    await mintRealUser({
      uniqueId: BLOCKER_STRING,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', blockedUserIds: [String(CALLER)] },
    });
    await mintRealUser({
      uniqueId: INNOCENT,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', blockedUserIds: [] },
    });
    await mintRealUser({
      uniqueId: OTHER_COHORT,
      cohort: 'minor',
      extraUserData: { cohort: 'minor', blockedUserIds: [CALLER] },
    });
    await mintRealUser({
      uniqueId: BLOCKED_BY_CALLER,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', blockedUserIds: [] },
    });
  });

  afterEach(async () => {
    await Promise.all(SEEDED.map((id) => db.doc(`users/${id}`).delete()));
  });

  // ── Happy path ────────────────────────────────────────────────

  it('returns the ids of members who have blocked the caller', async () => {
    const res = await post(app, caller, { userIds: [BLOCKER_STRING, INNOCENT] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String).sort()).toEqual([String(BLOCKER_STRING)]);
  });

  it('recognises a block stored as a NUMBER', async () => {
    const res = await post(app, caller, { userIds: [BLOCKER_NUMERIC] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String)).toEqual([String(BLOCKER_NUMERIC)]);
  });

  it('recognises a block stored as a STRING', async () => {
    const res = await post(app, caller, { userIds: [BLOCKER_STRING] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String)).toEqual([String(BLOCKER_STRING)]);
  });

  it('omits members who have not blocked the caller', async () => {
    const res = await post(app, caller, { userIds: [INNOCENT] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toEqual([]);
  });

  it('does not treat the caller blocking THEM as them blocking the caller', async () => {
    const res = await post(app, caller, { userIds: [BLOCKED_BY_CALLER] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toEqual([]);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('answers for a member in the OTHER cohort instead of failing the whole request', async () => {
    // The defect this replaces: one member failing the cohort gate denied the
    // entire chunk, so a mixed-cohort room answered "nobody blocked you".
    const res = await post(app, caller, { userIds: [OTHER_COHORT, BLOCKER_STRING] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String).sort()).toEqual(
      [String(OTHER_COHORT), String(BLOCKER_STRING)].sort(),
    );
  });

  it('skips a member who does not exist and still answers for the rest', async () => {
    const res = await post(app, caller, { userIds: [ABSENT, BLOCKER_STRING] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String)).toEqual([String(BLOCKER_STRING)]);
  });

  it('answers an empty list with an empty result', async () => {
    const res = await post(app, caller, { userIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toEqual([]);
  });

  it('answers completely for more members than fit in one client-side chunk', async () => {
    // The old client chunked at 30. A room larger than that must still be
    // answered completely, and the blocker is placed PAST the old boundary so a
    // reintroduced 30-cap fails this test.
    const filler = Array.from({ length: 40 }, (_, i) => ABSENT + i + 1);
    const res = await post(app, caller, { userIds: [...filler, BLOCKER_STRING] });
    expect(res.status).toBe(200);
    expect(res.body.blockedBy.map(String)).toEqual([String(BLOCKER_STRING)]);
  });

  // ── Security ──────────────────────────────────────────────────

  it('returns only ids — never block lists or any other member field', async () => {
    const res = await post(app, caller, { userIds: [BLOCKER_STRING, INNOCENT] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['blockedBy']);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('blockedUserIds');
    expect(serialised).not.toContain('firebaseUid');
  });

  it('answers about the CALLER only — a target in the body cannot redirect it', async () => {
    // BLOCKER_STRING has blocked CALLER but not INNOCENT. Asking "who blocked
    // INNOCENT" must not be answerable by anyone but INNOCENT.
    const res = await post(app, caller, {
      userIds: [BLOCKER_STRING],
      targetUserId: INNOCENT,
      uniqueId: INNOCENT,
      give_me: INNOCENT,
    });
    expect(res.status).toBe(200);
    // Still answered for the CALLER, so the block IS reported.
    expect(res.body.blockedBy.map(String)).toEqual([String(BLOCKER_STRING)]);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/users/blocked-by')
      .send({ userIds: [BLOCKER_STRING] });
    expect(res.status).toBe(401);
  });

  it('rejects an id that is not a plain numeric id (path traversal)', async () => {
    const res = await post(app, caller, { userIds: ['../admin/secrets'] });
    expect(res.status).toBe(400);
  });

  // ── Error paths ───────────────────────────────────────────────

  it('rejects a missing userIds field', async () => {
    const res = await post(app, caller, {});
    expect(res.status).toBe(400);
  });

  it('rejects userIds that is not an array', async () => {
    const res = await post(app, caller, { userIds: String(BLOCKER_STRING) });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long id list rather than reading unboundedly', async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => 10000000 + i);
    const res = await post(app, caller, { userIds: tooMany });
    expect(res.status).toBe(400);
  });
});
