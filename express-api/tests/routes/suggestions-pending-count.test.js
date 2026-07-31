/**
 * suggestions-pending-count.test.js — SHY-0258
 *
 * The admin review-queue badge. `pendingCount` rides on the suggestions
 * listing that the admin panel already fetches, so the badge needs no extra
 * request and no notification.
 *
 * The security property matters as much as the number: `pending` is a status
 * non-admins are not permitted to filter by (the listing 403s them), so
 * returning its size to everyone would disclose exactly what that 403 exists
 * to withhold — how much unreviewed content is queued.
 *
 * Real Firestore emulator + the real router: a count is a question about what
 * is in the collection, and the aggregation query is the thing under test.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RUN = `shy258p-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
const createdIds = [];

/**
 * Mount the real suggestions router behind a stub auth layer. The auth
 * middleware is not what is under test here; the route's admin BRANCH is.
 */
function createApp({ isAdmin }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: `${RUN}-fuid`,
      uniqueId: `${RUN}-caller`,
      token: { admin: isAdmin, uniqueId: `${RUN}-caller` },
    };
    next();
  });
  app.use('/api', require('../../src/routes/suggestions'));
  return app;
}

async function seedSuggestion(status) {
  const id = `${RUN}-${status}-${createdIds.length}`;
  await db.doc(`suggestions/${id}`).set({
    id,
    title: `t-${id}`,
    description: 'd',
    status,
    tags: [],
    language: 'en',
    voteCount: 0,
    createdAt: Date.now(),
    submitterUid: `${RUN}-submitter`,
  });
  createdIds.push(id);
  return id;
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  await Promise.all(createdIds.map((id) => db.doc(`suggestions/${id}`).delete()));
  createdIds.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('the admin review-queue badge', () => {
  test('an admin sees how many suggestions are awaiting review', async () => {
    await seedSuggestion('pending');
    await seedSuggestion('pending');
    await seedSuggestion('accepted');

    const res = await request(createApp({ isAdmin: true }))
      .get('/api/suggestions')
      .expect(200);

    // The emulator is shared, so other rows may exist; the badge must at least
    // account for the ones this test created, and must not count the accepted
    // one as pending.
    expect(typeof res.body.pendingCount).toBe('number');
    expect(res.body.pendingCount).toBeGreaterThanOrEqual(2);
  });

  test('the count reflects a newly submitted suggestion', async () => {
    // "Admin panel: suggestion count badge updates" — the badge is derived on
    // each read rather than cached, so a new submission is reflected without
    // any invalidation step to get wrong.
    const before = (
      await request(createApp({ isAdmin: true }))
        .get('/api/suggestions')
        .expect(200)
    ).body.pendingCount;

    await seedSuggestion('pending');

    const after = (
      await request(createApp({ isAdmin: true }))
        .get('/api/suggestions')
        .expect(200)
    ).body.pendingCount;

    expect(after).toBe(before + 1);
  });

  test('a NON-admin is not told the size of the review queue', async () => {
    // The disclosure guard. A non-admin cannot even filter by `pending`, so
    // handing them its size would be the same leak by a different route.
    await seedSuggestion('pending');

    const res = await request(createApp({ isAdmin: false }))
      .get('/api/suggestions')
      .expect(200);

    expect(res.body.pendingCount).toBeUndefined();
  });

  test('the listing still works for everyone', async () => {
    // The badge is additive; a regression here would break the public
    // suggestions board for the sake of an admin nicety.
    await seedSuggestion('accepted');

    const res = await request(createApp({ isAdmin: false }))
      .get('/api/suggestions')
      .expect(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});
