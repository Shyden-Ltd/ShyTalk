/**
 * expireTempIds.test.js — EPIC-0003 Phase 3 (SHY-0109).
 *
 * MIGRATED off the firebase Jest mock onto the REAL Firestore emulator.
 * NODE_ENV=local MUST be set before requiring firebase.js (it
 * reads NODE_ENV at module-load to point the Admin SDK at the emulator).
 *
 * This exercises the GENUINE compound query the cron runs —
 * `tempUniqueIdExpiry <= now AND > 0`, limit 500 — plus the real batch
 * update. The old mock stubbed the entire `db`, so the `> 0` lower bound,
 * the `<= now` upper bound, the field-absent case, and batch atomicity
 * were all simulated by jest.fn() and proved nothing.
 *
 * Cleanup is SURGICAL (only the doc ids this suite creates) because the
 * `users` collection is also populated by local/seed.js — we must not
 * wipe local seed data, and surgical cleanup avoids clobbering data a
 * parallel worker might rely on. See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const expireTempIds = require('../../src/cron/expireTempIds');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');

const USERS = 'users';
const created = [];

async function seedUser(id, fields) {
  await db.collection(USERS).doc(id).set(fields);
  created.push(id);
}

async function readUser(id) {
  const snap = await db.collection(USERS).doc(id).get();
  return snap.exists ? snap.data() : null;
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  if (created.length === 0) {
    return;
  }
  const batch = db.batch();
  for (const id of created) {
    batch.delete(db.collection(USERS).doc(id));
  }
  await batch.commit();
  created.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('expireTempIds (real Firestore emulator)', () => {
  test('clears temp IDs whose expiry is in the past', async () => {
    const now = Date.now();
    await seedUser('shy0109-expired-1', {
      displayName: 'A',
      tempUniqueId: 11111111,
      tempUniqueIdExpiry: now - 86400000,
    });
    await seedUser('shy0109-expired-2', {
      displayName: 'B',
      tempUniqueId: 22222222,
      tempUniqueIdExpiry: now - 100,
    });

    await expireTempIds();

    expect(await readUser('shy0109-expired-1')).toMatchObject({
      tempUniqueId: null,
      tempUniqueIdExpiry: null,
    });
    expect(await readUser('shy0109-expired-2')).toMatchObject({
      tempUniqueId: null,
      tempUniqueIdExpiry: null,
    });
  });

  test('leaves a future temp ID untouched (real <= now upper bound)', async () => {
    const future = Date.now() + 86400000;
    await seedUser('shy0109-future', { tempUniqueId: 33333333, tempUniqueIdExpiry: future });

    await expireTempIds();

    expect(await readUser('shy0109-future')).toMatchObject({
      tempUniqueId: 33333333,
      tempUniqueIdExpiry: future,
    });
  });

  test('leaves the 0-sentinel untouched (real > 0 lower bound)', async () => {
    await seedUser('shy0109-sentinel-0', { tempUniqueId: null, tempUniqueIdExpiry: 0 });

    await expireTempIds();

    expect(await readUser('shy0109-sentinel-0')).toMatchObject({ tempUniqueIdExpiry: 0 });
  });

  test('leaves a user with no tempUniqueIdExpiry field untouched', async () => {
    await seedUser('shy0109-no-field', { displayName: 'C' });

    await expireTempIds();

    expect(await readUser('shy0109-no-field')).toEqual({ displayName: 'C' });
  });

  test('mixed batch: clears only the expired, leaves future + 0-sentinel', async () => {
    const now = Date.now();
    await seedUser('shy0109-m-expired', { tempUniqueId: 44444444, tempUniqueIdExpiry: now - 1 });
    await seedUser('shy0109-m-future', {
      tempUniqueId: 55555555,
      tempUniqueIdExpiry: now + 86400000,
    });
    await seedUser('shy0109-m-zero', { tempUniqueIdExpiry: 0 });

    await expireTempIds();

    expect(await readUser('shy0109-m-expired')).toMatchObject({
      tempUniqueId: null,
      tempUniqueIdExpiry: null,
    });
    expect(await readUser('shy0109-m-future')).toMatchObject({ tempUniqueId: 55555555 });
    expect(await readUser('shy0109-m-zero')).toMatchObject({ tempUniqueIdExpiry: 0 });
  });

  test('resolves (no-op) when no docs are expired', async () => {
    await seedUser('shy0109-safe', {
      tempUniqueId: 66666666,
      tempUniqueIdExpiry: Date.now() + 999999,
    });

    await expect(expireTempIds()).resolves.toBeUndefined();

    expect(await readUser('shy0109-safe')).toMatchObject({ tempUniqueId: 66666666 });
  });
});
