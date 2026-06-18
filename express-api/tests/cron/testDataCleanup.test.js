/**
 * testDataCleanup.test.js — EPIC-0003 / SHY-0120 slice 1.
 *
 * MIGRATED off the firebase + log Jest mocks (the prior 18 tests were mostly
 * hollow `db.collection toHaveBeenCalledWith` / `ref.delete toHaveBeenCalled`
 * assertions that could NOT catch the cron deleting the WRONG docs) onto the
 * REAL Firestore emulator. Every test now seeds real state, runs the real cron,
 * and asserts the real outcome by reading back: the correct docs deleted, the
 * siblings/non-test docs retained — value-level, not "the mock was called".
 *
 * The real `log` runs unmocked (exercised, not asserted), proving the logging
 * path does not throw against the real emulator.
 *
 * Isolation: testDataCleanup sweeps 11 top-level collections by `_testRun`
 * prefix + their subcollections + linked bans + the startingScreens config doc
 * + the uniqueId counter, so a clean slate across all of them is required in
 * beforeEach (a leaked `test_`-tagged doc from a prior test would be collected
 * by a later run and skew its assertions). See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const testDataCleanup = require('../../src/cron/testDataCleanup');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');

const HOUR_MS = 60 * 60 * 1000;

// The 11 collections testDataCleanup.js tags + the two ban collections it sweeps.
const TOP_COLLECTIONS = [
  'users',
  'rooms',
  'gifts',
  'conversations',
  'banners',
  'funFacts',
  'reports',
  'suspensionAppeals',
  'alerts',
  'deviceBindings',
  'reportLocks',
  'deviceBans',
  'networkBans',
];

// Every subcollection name the cron deletes (users + conversations) plus the
// phantom `extras` group used by the non-user/non-convo isolation test.
const SUB_GROUPS = [
  'warnings',
  'transactions',
  'backpack',
  'stalkers',
  'giftWall',
  'messages',
  'userSettings',
  'mutes',
  'settings',
  'mod_log',
  'extras',
];

// Per-test slate: the cron sweeps the 13 top-level collections + the
// startingScreens config doc + the uniqueId counter, so those must be clean
// each test (a leaked `test_`-tagged doc would be collected by a later run and
// skew its assertions). Orphaned subcollection docs do NOT need clearing here —
// the cron only reaches a subcollection via a parent doc it finds in the
// `_testRun` query, so an orphan left under a deleted parent is unreachable;
// the heavier collection-group drain runs once in afterAll for tidiness.
async function clearSweptState() {
  for (const c of TOP_COLLECTIONS) {
    await clearCollection(db, c);
  }
  await db.doc('config/startingScreens').delete();
  await db.doc('counters/uniqueId').delete();
}

const seed = (path, data) => db.doc(path).set(data);
const exists = async (path) => (await db.doc(path).get()).exists;
const read = async (path) => {
  const snap = await db.doc(path).get();
  return snap.exists ? snap.data() : null;
};

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearSweptState();
});

afterAll(async () => {
  await clearSweptState();
  // Drain any subcollection docs seeded by the subcollection tests so the group
  // is clean for the next suite.
  for (const g of SUB_GROUPS) {
    await clearCollectionGroup(db, g);
  }
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('testDataCleanup (real Firestore emulator)', () => {
  // --- production guard ---

  test('does nothing in production — a stale test doc survives', async () => {
    await seed('gifts/g1', { _testRun: 'test_run', createdAt: Date.now() - 2 * HOUR_MS });

    process.env.NODE_ENV = 'production';
    try {
      await testDataCleanup();
    } finally {
      process.env.NODE_ENV = 'local';
    }

    // Early-returned before any query — the stale doc is untouched.
    expect(await exists('gifts/g1')).toBe(true);
  });

  // --- collection sweep + value-level deletion ---

  test('sweeps every tagged collection — stale test docs deleted, non-test docs retained', async () => {
    const stale = Date.now() - 2 * HOUR_MS;
    const tagged = [
      'users',
      'rooms',
      'gifts',
      'conversations',
      'banners',
      'funFacts',
      'reports',
      'suspensionAppeals',
      'alerts',
      'deviceBindings',
      'reportLocks',
    ];
    for (const col of tagged) {
      await seed(`${col}/stale`, { _testRun: 'test_run', createdAt: stale });
    }
    // A doc with NO _testRun must never be collected (range query excludes it).
    await seed('gifts/keep-real', { createdAt: stale, name: 'a real gift' });

    await testDataCleanup();

    for (const col of tagged) {
      expect(await exists(`${col}/stale`)).toBe(false);
    }
    expect(await exists('gifts/keep-real')).toBe(true);
  });

  // --- createdAt cutoff boundary ---

  test('createdAt cutoff — just-past-1h deleted, just-under-1h retained', async () => {
    const now = Date.now();
    await seed('gifts/old', { _testRun: 'test_run', createdAt: now - 61 * 60 * 1000 });
    await seed('gifts/recent', { _testRun: 'test_run', createdAt: now - 59 * 60 * 1000 });

    await testDataCleanup();

    expect(await exists('gifts/old')).toBe(false);
    expect(await exists('gifts/recent')).toBe(true);
  });

  test('a doc with no createdAt is treated as stale and deleted', async () => {
    await seed('gifts/no-ts', { _testRun: 'test_run' });

    await testDataCleanup();

    expect(await exists('gifts/no-ts')).toBe(false);
  });

  test('a doc with a non-numeric createdAt is treated as stale and deleted', async () => {
    await seed('gifts/bad-ts', { _testRun: 'test_run', createdAt: 'not-a-number' });

    await testDataCleanup();

    expect(await exists('gifts/bad-ts')).toBe(false);
  });

  // --- _testRun prefix scoping ---

  test('only the test_ prefix range is collected — prod_ tagged + untagged docs survive', async () => {
    const stale = Date.now() - 2 * HOUR_MS;
    await seed('gifts/test-doc', { _testRun: 'test_run', createdAt: stale });
    await seed('gifts/prod-doc', { _testRun: 'prod_run', createdAt: stale }); // < 'test_' — out of range
    await seed('gifts/untagged', { createdAt: stale }); // no _testRun field at all

    await testDataCleanup();

    expect(await exists('gifts/test-doc')).toBe(false);
    expect(await exists('gifts/prod-doc')).toBe(true);
    expect(await exists('gifts/untagged')).toBe(true);
  });

  // --- empty branch ---

  test('an empty target set is a clean no-op (resolves, throws nothing)', async () => {
    await expect(testDataCleanup()).resolves.toBeUndefined();
  });

  // --- user subcollection cleanup ---

  test('deletes a user’s subcollections AND the user doc', async () => {
    await seed('users/u1', { _testRun: 'test_run', createdAt: 0, uniqueId: 100000001 });
    await seed('users/u1/warnings/w1', { reason: 'x' });
    await seed('users/u1/transactions/t1', { amount: 5 });
    await seed('users/u1/backpack/b1', { giftId: 'g' });

    await testDataCleanup();

    expect(await exists('users/u1')).toBe(false);
    expect(await exists('users/u1/warnings/w1')).toBe(false);
    expect(await exists('users/u1/transactions/t1')).toBe(false);
    expect(await exists('users/u1/backpack/b1')).toBe(false);
  });

  // --- conversation subcollection cleanup ---

  test('deletes a conversation’s subcollections AND the conversation doc', async () => {
    await seed('conversations/c1', { _testRun: 'test_run', createdAt: 0 });
    await seed('conversations/c1/messages/m1', { text: 'hi' });
    await seed('conversations/c1/userSettings/us1', { muted: false });
    await seed('conversations/c1/mod_log/ml1', { action: 'warn' });

    await testDataCleanup();

    expect(await exists('conversations/c1')).toBe(false);
    expect(await exists('conversations/c1/messages/m1')).toBe(false);
    expect(await exists('conversations/c1/userSettings/us1')).toBe(false);
    expect(await exists('conversations/c1/mod_log/ml1')).toBe(false);
  });

  // --- non-user / non-conversation collections skip subcollection cleanup ---

  test('a gift’s subcollection is NOT swept (only users/conversations get subcollection cleanup)', async () => {
    await seed('gifts/g1', { _testRun: 'test_run', createdAt: 0 });
    await seed('gifts/g1/extras/x1', { note: 'orphan-by-design' });

    await testDataCleanup();

    // The gift doc itself is deleted, but its subcollection doc is left intact
    // (the cron only recurses into users + conversations subcollections).
    expect(await exists('gifts/g1')).toBe(false);
    expect(await exists('gifts/g1/extras/x1')).toBe(true);
  });

  // --- linked device/network ban cleanup ---

  test('deletes deviceBans/networkBans linked to a deleted user (numeric + string uniqueId variants)', async () => {
    await seed('users/u1', { _testRun: 'test_run', createdAt: 0, uniqueId: 100000099 });
    await seed('deviceBans/db1', { linkedUniqueId: 100000099 }); // numeric variant
    await seed('networkBans/nb1', { linkedUniqueId: '100000099' }); // string variant
    await seed('deviceBans/keep', { linkedUniqueId: 200000000 }); // unrelated — must survive

    await testDataCleanup();

    expect(await exists('users/u1')).toBe(false);
    expect(await exists('deviceBans/db1')).toBe(false);
    expect(await exists('networkBans/nb1')).toBe(false);
    expect(await exists('deviceBans/keep')).toBe(true);
  });

  test('falls back to doc.id as the uniqueId for ban cleanup when the field is missing', async () => {
    // No uniqueId field → cron uses doc.id ('100000077') for linked-ban lookup.
    await seed('users/100000077', { _testRun: 'test_run', createdAt: 0 });
    await seed('deviceBans/db1', { linkedUniqueId: '100000077' });

    await testDataCleanup();

    expect(await exists('users/100000077')).toBe(false);
    expect(await exists('deviceBans/db1')).toBe(false);
  });

  // --- starting-screens config cleanup ---

  test('deletes only pw-/screen-/test- prefixed startingScreens keys, retains the rest', async () => {
    await seed('config/startingScreens', {
      // matches a prefix → deleted
      'pw-screen-1': { url: '/t1' },
      'screen-abc': { url: '/t2' },
      'test-xyz': { url: '/t3' },
      // no matching prefix → retained
      'real-screen': { url: '/real' },
      'password-reset': { url: '/pw-like' },
      testing: { url: '/no-hyphen' },
      screensaver: { url: '/no-hyphen2' },
      'my-test-screen': { url: '/middle-match' },
    });

    await testDataCleanup();

    const after = await read('config/startingScreens');
    expect(Object.keys(after).sort()).toEqual(
      ['my-test-screen', 'password-reset', 'real-screen', 'screensaver', 'testing'].sort(),
    );
    expect(after['pw-screen-1']).toBeUndefined();
    expect(after['screen-abc']).toBeUndefined();
    expect(after['test-xyz']).toBeUndefined();
  });

  test('startingScreens cleanup is a no-op when the config doc is absent', async () => {
    // clearAll already removed config/startingScreens.
    await expect(testDataCleanup()).resolves.toBeUndefined();
    expect(await exists('config/startingScreens')).toBe(false);
  });

  test('startingScreens cleanup leaves the doc untouched when no key matches a test prefix', async () => {
    await seed('config/startingScreens', {
      'real-screen-1': { url: '/r1' },
      'production-screen': { url: '/prod' },
    });

    await testDataCleanup();

    const after = await read('config/startingScreens');
    expect(Object.keys(after).sort()).toEqual(['production-screen', 'real-screen-1']);
  });

  test('startingScreens cleanup error is swallowed (best-effort) — a real invalid field-path update throws and is caught', async () => {
    // `set` stores 'test-bad..key' as a LITERAL field name; the cron's
    // `update({'test-bad..key': FieldValue.delete()})` parses it as a field
    // PATH, where the empty `..` segment is rejected by Firestore → a REAL
    // emulator error. The cron's try/catch must swallow it (best-effort) so the
    // whole cron still resolves and the screen doc survives.
    await seed('config/startingScreens', { 'test-bad..key': { url: '/x' } });

    await expect(testDataCleanup()).resolves.toBeUndefined();
    expect(await exists('config/startingScreens')).toBe(true);
  });

  // --- counter restore ---

  test('restores the uniqueId counter to the max surviving user after deleting test users', async () => {
    await seed('users/tu1', { _testRun: 'test_run', createdAt: 0, uniqueId: 100000099 });
    await seed('users/real1', { uniqueId: 100000050 }); // no _testRun → survives

    await testDataCleanup();

    expect(await exists('users/tu1')).toBe(false);
    expect(await exists('users/real1')).toBe(true);
    expect(await read('counters/uniqueId')).toEqual({ value: 100000050 });
  });

  test('counter falls back to 100000000 when no users survive', async () => {
    await seed('users/tu1', { _testRun: 'test_run', createdAt: 0, uniqueId: 100000099 });

    await testDataCleanup();

    expect(await exists('users/tu1')).toBe(false);
    expect(await read('counters/uniqueId')).toEqual({ value: 100000000 });
  });

  test('does not touch the counter when no users were deleted', async () => {
    // A stale non-user test doc is deleted, but no users → no counter write.
    await seed('gifts/g1', { _testRun: 'test_run', createdAt: 0 });

    await testDataCleanup();

    expect(await exists('gifts/g1')).toBe(false);
    expect(await exists('counters/uniqueId')).toBe(false);
  });
});
