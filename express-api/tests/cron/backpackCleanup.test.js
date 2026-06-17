/**
 * backpackCleanup.test.js — EPIC-0003 Phase 3 (SHY-0110).
 *
 * MIGRATED off the firebase + log Jest mocks onto the REAL Firestore
 * emulator. Verifies the cron's REAL outcome — expired backpack items
 * deleted, fresh items retained — instead of the previous 11 hollow
 * `toHaveBeenCalled` mock-call assertions (the old test had zero
 * state-read assertions, so it could not catch the cron deleting the
 * wrong docs). The real `log` runs unmocked (exercised, not asserted).
 *
 * Isolation: backpackCleanup queries the WHOLE `backpack` collection
 * group, so a clean slate (clearCollectionGroup in beforeEach) is
 * required — surgical per-id cleanup cannot isolate a global cron.
 * See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const backpackCleanup = require('../../src/cron/backpackCleanup');
const { assertEmulatorReachable, clearCollectionGroup } = require('../helpers/firebase-emulator');

const GROUP = 'backpack';

async function seedItem(uid, itemId, fields) {
  await db.doc(`users/${uid}/backpack/${itemId}`).set(fields);
}

async function readItem(uid, itemId) {
  const snap = await db.doc(`users/${uid}/backpack/${itemId}`).get();
  return snap.exists ? snap.data() : null;
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollectionGroup(db, GROUP);
});

afterAll(async () => {
  await clearCollectionGroup(db, GROUP);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('backpackCleanup (real Firestore emulator)', () => {
  test('deletes expired items across multiple users, keeps future ones', async () => {
    const now = Date.now();
    await seedItem('u1', 'gift-a', { giftId: 'gift-a', quantity: 1, expiresAt: now - 86400000 });
    await seedItem('u2', 'gift-b', { giftId: 'gift-b', quantity: 2, expiresAt: now - 1000 });
    await seedItem('u3', 'gift-c', { giftId: 'gift-c', quantity: 1, expiresAt: now + 86400000 });

    await backpackCleanup();

    expect(await readItem('u1', 'gift-a')).toBeNull();
    expect(await readItem('u2', 'gift-b')).toBeNull();
    expect(await readItem('u3', 'gift-c')).toMatchObject({
      giftId: 'gift-c',
      expiresAt: now + 86400000,
    });
  });

  test('expiry boundary: an item due exactly now is deleted; a future item is kept', async () => {
    const now = Date.now();
    // The cron reads its own Date.now() AFTER this seed, so the due item
    // (expiresAt === now) always satisfies `<= cron-timestamp`, while the
    // future item (now + 60s) never does within a test run — deterministic.
    await seedItem('u1', 'due-now', { expiresAt: now });
    await seedItem('u1', 'future', { expiresAt: now + 60000 });

    await backpackCleanup();

    expect(await readItem('u1', 'due-now')).toBeNull();
    expect(await readItem('u1', 'future')).not.toBeNull();
  });

  test('collection-group: expired items under different parents are all collected', async () => {
    const now = Date.now();
    await seedItem('alpha', 'x', { expiresAt: now - 5 });
    await seedItem('beta', 'y', { expiresAt: now - 5 });
    await seedItem('gamma', 'z', { expiresAt: now - 5 });

    await backpackCleanup();

    expect((await db.collectionGroup(GROUP).get()).empty).toBe(true);
  });

  test('empty group → no-op (resolves, nothing created or deleted)', async () => {
    // beforeEach already cleared the group.
    await expect(backpackCleanup()).resolves.toBeUndefined();

    expect((await db.collectionGroup(GROUP).get()).empty).toBe(true);
  });

  test('does not match a same-named field outside the backpack subcollection', async () => {
    const now = Date.now();
    // A top-level user doc carrying an `expiresAt` field is NOT in the
    // `backpack` collection group, so the cron must not delete it.
    await db.doc('users/shy0110-decoy').set({ expiresAt: now - 99999, displayName: 'decoy' });
    await seedItem('u1', 'real-expired', { expiresAt: now - 1 });

    await backpackCleanup();

    expect(await readItem('u1', 'real-expired')).toBeNull();
    const decoy = await db.doc('users/shy0110-decoy').get();
    expect(decoy.exists).toBe(true);
    expect(decoy.data()).toMatchObject({ displayName: 'decoy' });

    await db.doc('users/shy0110-decoy').delete();
  });
});
