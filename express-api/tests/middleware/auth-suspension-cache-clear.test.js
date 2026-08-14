'use strict';

/**
 * SHY-0166 — clearSuspensionCache() with no argument must clear the WHOLE cache
 * (mirroring its siblings clearUniqueIdCache / clearAdminClaimCache), REAL
 * services. checkSuspension is internal, so it's exercised through
 * authMiddleware: a suspended user is 403 on a non-exempt route, a
 * not-suspended user is 200. The 5-minute suspension TTL far outlasts these
 * millisecond tests, so only an explicit clear can drop a cached entry.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware, clearSuspensionCache } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');

function createApp() {
  const app = express();
  app.use('/api', authMiddleware);
  app.get('/api/protected', (req, res) => res.json({ ok: true }));
  return app;
}
const hit = (headers) => request(createApp()).get('/api/protected').set(headers);

beforeAll(async () => {
  await assertEmulatorReachable();
});
afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});
beforeEach(() => {
  clearAuthCaches();
});

describe('clearSuspensionCache — no-arg clears the whole suspension cache', () => {
  test('after a no-arg clear, a since-un-suspended user is allowed (stale entry dropped)', async () => {
    const user = await mintRealUser({ uniqueId: 69000001, isSuspended: true });

    const blocked = await hit(user.headers); // suspended → 403, caches isSuspended:true
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ error: 'Account suspended' });
    await db.doc('users/69000001').update({ isSuspended: false });
    await hit(user.headers).expect(403); // STILL 403 — stale cache (well within the 5-min TTL)

    clearSuspensionCache(); // no argument → must empty the whole cache

    const res = await hit(user.headers); // next check re-reads Firestore → not suspended
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('a no-arg clear empties MULTIPLE cached entries at once (not just one)', async () => {
    // Two distinct suspended users cached, then a single no-arg clear must drop
    // BOTH — a "clear only the first/oldest entry" mis-implementation would leave
    // the second cached and fail here.
    const a = await mintRealUser({ uniqueId: 69000004, isSuspended: true });
    const b = await mintRealUser({ uniqueId: 69000005, isSuspended: true });

    await hit(a.headers).expect(403); // caches A suspended
    await hit(b.headers).expect(403); // caches B suspended
    await db.doc('users/69000004').update({ isSuspended: false });
    await db.doc('users/69000005').update({ isSuspended: false });

    clearSuspensionCache(); // no argument → must empty EVERY entry

    await hit(a.headers).expect(200); // A re-reads → not suspended
    await hit(b.headers).expect(200); // B re-reads → not suspended (proves all entries cleared)
  });

  test('a targeted clearSuspensionCache(id) still evicts only that id (unchanged)', async () => {
    const a = await mintRealUser({ uniqueId: 69000002, isSuspended: true });
    const b = await mintRealUser({ uniqueId: 69000003, isSuspended: true });

    await hit(a.headers).expect(403); // caches A suspended
    await hit(b.headers).expect(403); // caches B suspended
    await db.doc('users/69000002').update({ isSuspended: false });
    await db.doc('users/69000003').update({ isSuspended: false });

    clearSuspensionCache(69000002); // evict ONLY A

    await hit(a.headers).expect(200); // A re-reads Firestore → not suspended
    await hit(b.headers).expect(403); // B untouched → still cached suspended
  });

  test('a NaN / 0 / null argument is a targeted no-op — it must NOT wipe the whole cache', async () => {
    // Guards the `=== undefined` hardening: production callers pass Number(id),
    // and a malformed id yields NaN (identity-graph.js:175, reports.js). Under a
    // naive `if (uniqueId)` truthiness guard, NaN/0/null are all falsy → clear-all
    // → the whole cache is wiped. `=== undefined` sends them to the targeted
    // delete (a safe no-op). This test goes RED if the guard is ever reverted to
    // truthiness. See [[feedback-test-must-fail-if-logic-skipped]].
    const a = await mintRealUser({ uniqueId: 69000006, isSuspended: true });
    const b = await mintRealUser({ uniqueId: 69000007, isSuspended: true });

    await hit(a.headers).expect(403); // caches A suspended
    await hit(b.headers).expect(403); // caches B suspended
    await db.doc('users/69000006').update({ isSuspended: false });
    await db.doc('users/69000007').update({ isSuspended: false });

    clearSuspensionCache(Number('not-a-number')); // NaN — mirrors identity-graph.js:175 Number(badId)
    clearSuspensionCache(0);
    clearSuspensionCache(null);

    // A truthiness guard would have cleared-all above → both would re-read → 200.
    await hit(a.headers).expect(403); // A still cached suspended (not wiped)
    await hit(b.headers).expect(403); // B still cached suspended (not wiped)
  });
});
