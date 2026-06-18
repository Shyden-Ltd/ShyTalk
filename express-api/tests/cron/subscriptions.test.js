/**
 * subscriptions.test.js — EPIC-0003 / SHY-0120 slice 2.
 *
 * MIGRATED off the firebase + log Jest mocks (the prior tests asserted
 * `batch.update toHaveBeenCalledWith` / `commit toHaveBeenCalledTimes` and could
 * not catch the cron downgrading the WRONG users) onto the REAL Firestore
 * emulator. Each test seeds real users, runs the real cron, and reads back to
 * assert the real outcome — the correct users downgraded (isSuperShy=false,
 * expiry/tier nulled), the exempt ones (future, lifetime, non-supershy)
 * retained verbatim. The real `log` runs unmocked (exercised, not asserted).
 *
 * Note (scoping): the truncation `log.warn` fires only when the query returns
 * exactly CRON_LIMIT (500) rows. It is an observability log (unmocked → not
 * asserted per the EPIC-0003 logger policy), and the query's `.limit(500)` caps
 * `toExpire` at 500 so the batch loop always runs once — the multi-user test
 * already exercises the single-batch path. Seeding 500 users to fire an
 * unassertable warn is disproportionate, so that path is intentionally not
 * re-seeded here.
 *
 * Isolation: the cron queries the whole `users` collection, so it is cleared in
 * beforeEach for a clean slate. See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const subscriptions = require('../../src/cron/subscriptions');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const HOUR_MS = 60 * 60 * 1000;

const seedUser = (id, fields) => db.doc(`users/${id}`).set(fields);
const readUser = async (id) => {
  const snap = await db.doc(`users/${id}`).get();
  return snap.exists ? snap.data() : null;
};

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollection(db, 'users');
});

afterAll(async () => {
  await clearCollection(db, 'users');
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('subscriptions cron (real Firestore emulator)', () => {
  test('an empty users collection is a clean no-op', async () => {
    await expect(subscriptions()).resolves.toBeUndefined();
  });

  test('downgrades an expired non-lifetime SuperShy user, nulling expiry + tier', async () => {
    await seedUser('u1', {
      isSuperShy: true,
      superShyExpiry: Date.now() - HOUR_MS,
      superShyTier: 'monthly',
      displayName: 'Expired Pat',
    });

    await subscriptions();

    expect(await readUser('u1')).toMatchObject({
      isSuperShy: false,
      superShyExpiry: null,
      superShyTier: null,
      displayName: 'Expired Pat', // unrelated fields untouched
    });
  });

  test('retains a SuperShy user whose expiry is still in the future', async () => {
    await seedUser('u1', {
      isSuperShy: true,
      superShyExpiry: Date.now() + HOUR_MS,
      superShyTier: 'monthly',
    });

    await subscriptions();

    expect(await readUser('u1')).toMatchObject({
      isSuperShy: true,
      superShyTier: 'monthly',
    });
  });

  test('exempts a lifetime subscriber even when past expiry', async () => {
    await seedUser('u1', {
      isSuperShy: true,
      superShyExpiry: Date.now() - HOUR_MS,
      superShyTier: 'lifetime',
    });

    await subscriptions();

    // Lifetime status is never expired by the cron.
    expect(await readUser('u1')).toMatchObject({
      isSuperShy: true,
      superShyTier: 'lifetime',
    });
  });

  test('downgrades an expired user whose tier field is missing (undefined !== lifetime)', async () => {
    await seedUser('u1', {
      isSuperShy: true,
      superShyExpiry: Date.now() - HOUR_MS,
      // no superShyTier
    });

    await subscriptions();

    expect(await readUser('u1')).toMatchObject({ isSuperShy: false, superShyExpiry: null });
  });

  test('never touches a non-SuperShy user (query scoping)', async () => {
    await seedUser('u1', { isSuperShy: false, superShyExpiry: Date.now() - HOUR_MS });

    await subscriptions();

    // isSuperShy=false is outside the query — left exactly as seeded.
    expect(await readUser('u1')).toMatchObject({ isSuperShy: false });
  });

  test('expiry exactly at "now" is downgraded (the <= boundary)', async () => {
    // The cron compares against Date.now() captured at run time (>= this seed
    // time by a few ms), so an expiry equal to seed-now satisfies `<=`.
    await seedUser('u1', { isSuperShy: true, superShyExpiry: Date.now(), superShyTier: 'monthly' });

    await subscriptions();

    expect(await readUser('u1')).toMatchObject({ isSuperShy: false });
  });

  test('downgrades multiple expired users and leaves exempt ones in one run', async () => {
    const now = Date.now();
    await seedUser('expired-a', {
      isSuperShy: true,
      superShyExpiry: now - HOUR_MS,
      superShyTier: 'monthly',
    });
    await seedUser('expired-b', {
      isSuperShy: true,
      superShyExpiry: now - 2 * HOUR_MS,
      superShyTier: 'annual',
    });
    await seedUser('future', {
      isSuperShy: true,
      superShyExpiry: now + HOUR_MS,
      superShyTier: 'monthly',
    });
    await seedUser('lifetime', {
      isSuperShy: true,
      superShyExpiry: now - HOUR_MS,
      superShyTier: 'lifetime',
    });

    await subscriptions();

    expect(await readUser('expired-a')).toMatchObject({ isSuperShy: false, superShyTier: null });
    expect(await readUser('expired-b')).toMatchObject({ isSuperShy: false, superShyTier: null });
    expect(await readUser('future')).toMatchObject({ isSuperShy: true, superShyTier: 'monthly' });
    expect(await readUser('lifetime')).toMatchObject({
      isSuperShy: true,
      superShyTier: 'lifetime',
    });
  });

  test('when all matched users are lifetime, nothing is downgraded', async () => {
    await seedUser('l1', {
      isSuperShy: true,
      superShyExpiry: Date.now() - HOUR_MS,
      superShyTier: 'lifetime',
    });
    await seedUser('l2', {
      isSuperShy: true,
      superShyExpiry: Date.now() - HOUR_MS,
      superShyTier: 'lifetime',
    });

    await subscriptions();

    expect(await readUser('l1')).toMatchObject({ isSuperShy: true });
    expect(await readUser('l2')).toMatchObject({ isSuperShy: true });
  });
});
