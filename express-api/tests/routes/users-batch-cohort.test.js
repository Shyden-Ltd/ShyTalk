'use strict';

/**
 * SHY-0338 — POST /api/users/batch, REAL services.
 *
 * The follow lists are empty because both clients read their members by
 * querying Firestore directly:
 *
 *   collection("users").whereIn(FieldPath.documentId(), chunk)   // chunks of 30
 *
 * `firestore.rules` gates a `users/{uniqueId}` read on `cohortMatchesCaller()`,
 * and the refusal is ALL-OR-NOTHING: one member of the chunk failing the gate
 * denies the WHOLE query, taking the other 29 readable users with it. Both
 * clients then swallow the `PERMISSION_DENIED` into `emptyList()`. Proved
 * against the live rules engine in
 * `tests/firestore-rules/users-follow-lists-rules.test.js`.
 *
 * This endpoint is the fix. The Admin SDK is not subject to rules, so the
 * cohort decision moves to where it can be made PER USER — drop the people this
 * viewer may not see, return everyone else. The test that matters is
 * "one cross-cohort member does not empty the batch": that is the exact
 * behaviour the client-side query cannot have.
 *
 * No mocks: real Auth-emulator tokens, real user documents.
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

// A namespace of its own so a parallel suite cannot collide on these ids.
const VIEWER_ID = 63380001;
const SAME_COHORT_A = 63380002;
const SAME_COHORT_B = 63380003;
const CROSS_COHORT = 63380004;
const NO_COHORT_FIELD = 63380005;
const BLOCKER = 63380006;
const ABSENT = 63380099;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

/** A user document as the sign-in path writes it. */
function seedUser(uniqueId, { cohort = 'adult', ...extra } = {}) {
  return db.doc(`users/${uniqueId}`).set({
    uniqueId,
    firebaseUid: `fbuid-${uniqueId}`,
    displayName: `User ${uniqueId}`,
    email: `user${uniqueId}@example.test`,
    pinHash: 'should-never-be-returned',
    fcmTokens: ['tok-should-never-be-returned'],
    dateOfBirth: Date.UTC(1990, 0, 1),
    followerIds: [],
    followingIds: [],
    blockedUserIds: [],
    ...(cohort === null ? {} : { cohort }),
    ...extra,
  });
}

let app;
let viewer;

beforeAll(async () => {
  await assertEmulatorReachable();
  app = createApp();
  viewer = await mintRealUser({ uniqueId: VIEWER_ID, cohort: 'adult' });
});

afterAll(() => {
  clearAuthCaches();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await Promise.all([
    seedUser(SAME_COHORT_A),
    seedUser(SAME_COHORT_B),
    seedUser(CROSS_COHORT, { cohort: 'minor' }),
    seedUser(NO_COHORT_FIELD, { cohort: null }),
    seedUser(BLOCKER, { blockedUserIds: [String(VIEWER_ID)] }),
    db.doc(`users/${ABSENT}`).delete(),
  ]);
});

const postBatch = (ids) => request(app).post('/api/users/batch').set(viewer.headers).send({ ids });

describe('POST /api/users/batch — the follow-list read', () => {
  test('returns every same-cohort user in the batch', async () => {
    const res = await postBatch([String(SAME_COHORT_A), String(SAME_COHORT_B)]);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId)).sort()).toEqual(
      [String(SAME_COHORT_A), String(SAME_COHORT_B)].sort(),
    );
  });

  test('ONE cross-cohort member does not empty the batch — it drops that member only', async () => {
    // THE DEFECT'S CURE, in one assertion. The client-side query refuses the
    // whole chunk here and the list renders empty. Filtering per user is the
    // entire reason this endpoint exists.
    const res = await postBatch([
      String(SAME_COHORT_A),
      String(CROSS_COHORT),
      String(SAME_COHORT_B),
    ]);
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => String(u.uniqueId));
    expect(ids).toEqual(expect.arrayContaining([String(SAME_COHORT_A), String(SAME_COHORT_B)]));
    expect(ids).not.toContain(String(CROSS_COHORT));
  });

  test('a user whose document predates the cohort field is dropped, not fatal', async () => {
    // The commonest case in production: `cohort` arrived with UK OSA #17, so
    // older documents have none and read as the 'minor' default. Client-side
    // this is what empties a whole page for an adult viewer.
    const res = await postBatch([String(SAME_COHORT_A), String(NO_COHORT_FIELD)]);
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => String(u.uniqueId));
    expect(ids).toContain(String(SAME_COHORT_A));
    expect(ids).not.toContain(String(NO_COHORT_FIELD));
  });

  test('the caller is returned their own profile even in a mixed batch', async () => {
    const res = await postBatch([String(VIEWER_ID), String(CROSS_COHORT)]);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId))).toEqual([String(VIEWER_ID)]);
  });

  test('sensitive fields are stripped from every entry', async () => {
    const res = await postBatch([String(SAME_COHORT_A), String(SAME_COHORT_B)]);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('pinHash');
      expect(u).not.toHaveProperty('fcmTokens');
      expect(u).not.toHaveProperty('email');
      expect(u).not.toHaveProperty('firebaseUid');
      expect(u).not.toHaveProperty('dateOfBirth');
      expect(u).not.toHaveProperty('cohort');
      expect(u).not.toHaveProperty('cohortOverride');
    }
  });

  test('an id that does not exist is simply absent — no error, no existence signal', async () => {
    const res = await postBatch([String(SAME_COHORT_A), String(ABSENT)]);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId))).toEqual([String(SAME_COHORT_A)]);
  });

  test('a user who has blocked the viewer is not returned', async () => {
    const res = await postBatch([String(SAME_COHORT_A), String(BLOCKER)]);
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => String(u.uniqueId));
    expect(ids).toContain(String(SAME_COHORT_A));
    expect(ids).not.toContain(String(BLOCKER));
  });

  test('duplicate ids yield one entry each', async () => {
    const res = await postBatch([String(SAME_COHORT_A), String(SAME_COHORT_A)]);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId))).toEqual([String(SAME_COHORT_A)]);
  });

  test('an empty id list returns an empty result, not an error', async () => {
    const res = await postBatch([]);
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test('an oversized batch is refused rather than served', async () => {
    // A read amplifier is a denial-of-service surface: every id can cost a
    // document read. The cap is enforced, not silently truncated — truncation
    // would give the caller a partial list they believe is complete.
    const res = await postBatch(Array.from({ length: 201 }, (_, i) => String(63390000 + i)));
    expect(res.status).toBe(400);
  });

  test('a malformed body is refused', async () => {
    const res = await request(app)
      .post('/api/users/batch')
      .set(viewer.headers)
      .send({ ids: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('an unauthenticated caller is refused', async () => {
    const res = await request(app)
      .post('/api/users/batch')
      .send({ ids: [String(SAME_COHORT_A)] });
    expect(res.status).toBe(401);
  });
});
