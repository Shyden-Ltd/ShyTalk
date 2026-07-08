'use strict';

// SHY-0060 — integration test for the cached age-gating flag READER.
// Runs against the REAL Firebase Emulator (no mocks — the reader touches
// Firestore, so per the no-stubs rule it is proven against the real stack).
//
// NODE_ENV must be 'local' BEFORE requiring src/utils/firebase, because
// firebase.js points the Admin SDK at the emulator at module-load time.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const {
  isAgeGatingEnabled,
  __resetAgeGatingFlagCache,
} = require('../../src/safety/age-gating-flag');

const SAFETY_DOC = 'config/safety';

beforeAll(() => assertEmulatorReachable());
afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// Surgical isolation: `config` is a SHARED collection (app/economy/moderation
// live alongside), so we delete only our own doc — never wipe the collection.
beforeEach(async () => {
  __resetAgeGatingFlagCache();
  await db.doc(SAFETY_DOC).delete();
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
});

describe('isAgeGatingEnabled — reads the real config/safety doc', () => {
  test('returns true when ageGatingEnabled is the boolean true', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: true });
    expect(await isAgeGatingEnabled(db)).toBe(true);
  });

  test('returns false when ageGatingEnabled is the boolean false', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: false });
    expect(await isAgeGatingEnabled(db)).toBe(false);
  });

  test('defaults to false (OFF) when the config/safety doc does not exist', async () => {
    // beforeEach already deleted it — assert the fail-safe default.
    expect(await isAgeGatingEnabled(db)).toBe(false);
  });

  test('defaults to false when the doc exists but omits the flag field', async () => {
    await db.doc(SAFETY_DOC).set({ someOtherSetting: 'x' });
    expect(await isAgeGatingEnabled(db)).toBe(false);
  });

  test('a non-boolean stored value ("true" string) does NOT enable gating', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: 'true' });
    expect(await isAgeGatingEnabled(db)).toBe(false);
  });
});

describe('isAgeGatingEnabled — 60s cache', () => {
  test('a mid-TTL operator flip is NOT observed until the window expires', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: true });
    const t0 = Date.now();
    expect(await isAgeGatingEnabled(db, t0)).toBe(true); // reads + caches ON

    // Operator flips it OFF mid-window.
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: false });
    expect(await isAgeGatingEnabled(db, t0 + 30_000)).toBe(true); // stale ON within TTL
  });

  test('the flip IS observed once the TTL window has elapsed', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: true });
    const t0 = Date.now();
    expect(await isAgeGatingEnabled(db, t0)).toBe(true); // caches ON

    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: false });
    expect(await isAgeGatingEnabled(db, t0 + 61_000)).toBe(false); // refetch → OFF
  });

  test('a cold read (cache just reset) reflects the current stored value', async () => {
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: true });
    expect(await isAgeGatingEnabled(db)).toBe(true);

    __resetAgeGatingFlagCache();
    await db.doc(SAFETY_DOC).set({ ageGatingEnabled: false });
    expect(await isAgeGatingEnabled(db)).toBe(false); // no stale cache → fresh read
  });
});
