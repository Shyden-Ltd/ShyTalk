'use strict';

/**
 * SHY-0350 — GET /api/users/search, REAL services.
 *
 * Search used to run a FILTERED `firestore.collection("users")` query straight
 * from the client. `firestore.rules:74` gates a users read on
 * `cohortMatchesCaller()`, a condition on document CONTENT, and Firestore must
 * decide a filtered query's permission from the QUERY ALONE — so it refused the
 * whole thing and the user read `PERMISSION_DENIED: Null value error. for
 * 'list' @ L74` in the search box.
 *
 * This endpoint already existed and did the job properly. These tests pin its
 * contract so the clients can rely on it, and pin the one thing that is NEW:
 * `cohort` is returned rather than stripped.
 *
 * That last part is not decoration. The clients run their own
 * `filterSameCohortAs` over the results; without the field every result reads as
 * the 'minor' default and an adult's search filters itself to nothing —
 * measured on-device, the API returned a match and the screen said "No users
 * found".
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

const SEARCHER = 63500001;
const SAME_COHORT = 63500002;
const CROSS_COHORT = 63500003;
const BLOCKER = 63500004;
const PREFIX = 'Zzsearchable';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

function seedUser(uniqueId, { cohort = 'adult', name, ...extra } = {}) {
  return db.doc(`users/${uniqueId}`).set({
    uniqueId,
    firebaseUid: `fbuid-${uniqueId}`,
    displayName: name || `${PREFIX} ${uniqueId}`,
    email: `u${uniqueId}@example.test`,
    pinHash: 'never-returned',
    fcmTokens: ['never-returned'],
    dateOfBirth: Date.UTC(1990, 0, 1),
    blockedUserIds: [],
    cohort,
    ...extra,
  });
}

let app;
let searcher;

beforeAll(async () => {
  await assertEmulatorReachable();
  app = createApp();
  searcher = await mintRealUser({ uniqueId: SEARCHER, cohort: 'adult' });
});

afterAll(() => {
  clearAuthCaches();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await Promise.all([
    seedUser(SAME_COHORT),
    seedUser(CROSS_COHORT, { cohort: 'minor' }),
    seedUser(BLOCKER, { blockedUserIds: [String(SEARCHER)] }),
  ]);
});

const search = (q) =>
  request(app)
    .get(`/api/users/search?q=${encodeURIComponent(q)}`)
    .set(searcher.headers);

describe('GET /api/users/search', () => {
  test('finds a same-cohort user by displayName prefix', async () => {
    const res = await search(PREFIX);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId))).toContain(String(SAME_COHORT));
  });

  test('returns cohort, and it always equals the searcher’s', async () => {
    // The NEW behaviour, and the reason the client can filter at all. Every
    // user returned is same-cohort by construction, so the value discloses
    // nothing — and this assertion is what keeps that true.
    const res = await search(PREFIX);
    expect(res.body.users.length).toBeGreaterThan(0);
    for (const u of res.body.users) expect(u.cohort).toBe('adult');
  });

  test('never returns a cross-cohort user', async () => {
    const res = await search(PREFIX);
    expect(res.body.users.map((u) => String(u.uniqueId))).not.toContain(String(CROSS_COHORT));
  });

  test('never returns a user who has blocked the searcher', async () => {
    const res = await search(PREFIX);
    expect(res.body.users.map((u) => String(u.uniqueId))).not.toContain(String(BLOCKER));
  });

  test('never returns the searcher themselves', async () => {
    await seedUser(SEARCHER);
    const res = await search(PREFIX);
    expect(res.body.users.map((u) => String(u.uniqueId))).not.toContain(String(SEARCHER));
  });

  test('strips sensitive fields but keeps cohort', async () => {
    const res = await search(PREFIX);
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('pinHash');
      expect(u).not.toHaveProperty('fcmTokens');
      expect(u).not.toHaveProperty('email');
      expect(u).not.toHaveProperty('firebaseUid');
      expect(u).not.toHaveProperty('dateOfBirth');
      expect(u).not.toHaveProperty('cohortOverride');
      expect(u).toHaveProperty('cohort');
    }
  });

  test('an exact uniqueId resolves to that user', async () => {
    const res = await search(String(SAME_COHORT));
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => String(u.uniqueId))).toEqual([String(SAME_COHORT)]);
    expect(res.body.users[0].cohort).toBe('adult');
  });

  test('an unauthenticated caller is refused', async () => {
    const res = await request(app).get(`/api/users/search?q=${PREFIX}`);
    expect(res.status).toBe(401);
  });
});
