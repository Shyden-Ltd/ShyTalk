/**
 * firebase-emulator.test.js — EPIC-0003 Phase 3 (SHY-0109).
 *
 * Exercises the shared emulator helper against the REAL Firestore
 * emulator (no jest.mock). Uses a dedicated throwaway collection so it
 * never collides with the cron test's `users` collection (the emulator
 * is shared across Jest workers).
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const {
  assertEmulatorReachable,
  clearCollection,
  firestoreHostPort,
} = require('../helpers/firebase-emulator');

const SPEC_COLLECTION = '_emulator_helper_spec';

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterAll(async () => {
  await clearCollection(db, SPEC_COLLECTION);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearCollection(db, SPEC_COLLECTION);
});

describe('firestoreHostPort', () => {
  test('parses the FIRESTORE_EMULATOR_HOST set by firebase.js under NODE_ENV=local', () => {
    expect(firestoreHostPort()).toEqual({ host: 'localhost', port: 8080 });
  });

  test('falls back to localhost:8080 when the env var is absent', () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      expect(firestoreHostPort()).toEqual({ host: 'localhost', port: 8080 });
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = saved;
    }
  });

  test('parses a non-default host:port', () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9999';
    try {
      expect(firestoreHostPort()).toEqual({ host: '127.0.0.1', port: 9999 });
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = saved;
    }
  });
});

describe('assertEmulatorReachable', () => {
  test('resolves when the emulator is up', async () => {
    await expect(assertEmulatorReachable()).resolves.toBeUndefined();
  });

  test('rejects fast + actionably when nothing is listening (no silent skip)', async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    // Port 1 has no listener → connect refused fast (deterministic).
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:1';
    let captured;
    const startedAt = Date.now();
    try {
      await assertEmulatorReachable({ timeoutMs: 2000 });
    } catch (e) {
      captured = e;
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = saved;
    }
    expect(captured).toBeDefined();
    expect(captured.message).toContain('localhost:1');
    expect(captured.message).toContain('bash local/start.sh');
    // Fast-fail: a refused connection must not approach the timeout.
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe('clearCollection', () => {
  test('deletes every doc and returns the count', async () => {
    await db.collection(SPEC_COLLECTION).doc('a').set({ n: 1 });
    await db.collection(SPEC_COLLECTION).doc('b').set({ n: 2 });
    await db.collection(SPEC_COLLECTION).doc('c').set({ n: 3 });

    const deleted = await clearCollection(db, SPEC_COLLECTION);

    expect(deleted).toBe(3);
    const snap = await db.collection(SPEC_COLLECTION).get();
    expect(snap.empty).toBe(true);
  });

  test('returns 0 on an already-empty collection', async () => {
    expect(await clearCollection(db, SPEC_COLLECTION)).toBe(0);
  });

  test('drains more than one batch (paginates)', async () => {
    // batchSize=2 forces ≥2 passes over 5 docs → proves the pagination loop.
    const writes = [];
    for (let i = 0; i < 5; i++) {
      writes.push(db.collection(SPEC_COLLECTION).doc(`p${i}`).set({ n: i }));
    }
    await Promise.all(writes);

    const deleted = await clearCollection(db, SPEC_COLLECTION, 2);

    expect(deleted).toBe(5);
    expect((await db.collection(SPEC_COLLECTION).get()).empty).toBe(true);
  });
});
