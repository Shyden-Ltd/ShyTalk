/**
 * SHY-0150 — `banned` custom-claim LIFECYCLE, proven against the REAL Auth +
 * Firestore emulators (EPIC-0003 real-only; livekit-cohort.test.js pattern).
 * No jest.mock anywhere: real `authMiddleware` in the chain, real ID tokens
 * minted via the Auth emulator, claims observed via real `auth.getUser`.
 *
 * The rules half (a `banned` token claim denies direct Firestore writes) is
 * pinned by tests/firestore-rules/banned-claim-rules.test.js. THIS suite pins
 * how the claim gets onto (and off) the user's token:
 *
 *   A. Explicit ban mutations (admin-bans.js routes) call the
 *      `syncBannedClaim` chokepoint: ban → mint `banned: true` (merged, other
 *      claims preserved) + revoke refresh tokens; unban → RECOMPUTE standing,
 *      never blind-clear (another active ban keeps the claim).
 *   B. Suspend/unsuspend auto-applied bans (admin-users.js) sync the claim
 *      through the same chokepoint (fire-and-forget helpers → polled).
 *   C. Lazy middleware sync (middleware/auth.js): when the per-request ban
 *      VERDICT disagrees with the decoded token's `banned` claim, the claim
 *      is synced — banned-direction mints from the verdict (covers unlinked
 *      network bans caught by IP, expiry flips, binding changes with no
 *      route in the loop); unbanned-direction clears ONLY after a full
 *      user-attributable recompute (a linked network ban keeps the claim
 *      even though the API gate passes the caller on a clean IP). Exempt
 *      paths never sync (their verdict is never computed).
 *   D. `mintClaimsMerging` preserves `banned` across unrelated claim mints
 *      (the cohort sign-in mint must not stomp a ban).
 *
 * Adversarial (Security AC): the claim is server-controlled — a non-admin
 * caller cannot reach the ban routes (403, claims untouched), an anonymous
 * caller gets 401. Clients have no claim-writing surface at all; custom
 * claims are Admin-SDK-only by Firebase construction.
 *
 * Anti-blind-clear guards (A6, A9, C4) and the adversarial/no-op pins pass
 * BEFORE the implementation exists by design — they are red only against a
 * wrong implementation (blind clear on unban / sync on exempt paths). Every
 * mint/clear/revoke assertion is RED until syncBannedClaim + hooks land.
 *
 * Revocation is observed via `tokensValidAfterTime`, which has SECOND
 * resolution — tests asserting a bump (or explicitly NO bump) first wait
 * ~1.1s so a same-second mint cannot mask the signal either way.
 *
 * Requires the emulators: `npx firebase emulators:start --project=demo-shytalk
 * --only firestore,auth,database` (or `bash local/start.sh`).
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { auth, db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const adminBansRouter = require('../../src/routes/admin-bans');
const adminUsersRouter = require('../../src/routes/admin-users');
const { mintClaimsMerging } = require('../../src/utils/firebase-claims');
const { syncBannedClaim } = require('../../src/utils/banned-claim');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');

// ── Per-file namespace (shared emulator; see firebase-emulator.js) ─────────
// Doc ids are 'bcl-' prefixed; uniqueIds live in a dedicated 617xxx range;
// linkedUniqueId is always the STRING form (matches what clients send and
// what autoApplyBans stores).
const IDS = {
  admin: 617001,
  nonAdmin: 617002,
  a1: 617010,
  a2: 617011,
  b1: 617012,
  a3: 617027,
  adv: 617026,
  a5: 617013,
  a6: 617014,
  a7: 617015,
  c4: 617016,
  a8: 617017,
  a9: 617018,
  b2: 617019,
  d1: 617020,
  c1: 617021,
  c2: 617022,
  c3: 617023,
  c5: 617024,
  c6: 617025,
  r1: 617030,
  r2a: 617031,
  r2b: 617032,
  r4: 617033,
};
const uidOf = (uniqueId) => `bcl-uid-${uniqueId}`;
const SYSTEM_UID = 'SHYTALK_SYSTEM'; // system-pm.js — for PM-conversation cleanup

function buildApp() {
  const app = express();
  // Mirrors src/index.js:33 — req.ip honours ONE proxy hop, so a test can pin
  // the edge IP deterministically via X-Forwarded-For (the network-ban match).
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  // Minimal protected route for the lazy middleware-sync tests — the sync
  // must ride EVERY gated request, not just ban-related routes.
  app.get('/api/bcl-echo', (req, res) => res.json({ ok: true, uniqueId: req.auth.uniqueId }));
  app.use('/api', adminBansRouter);
  app.use('/api', adminUsersRouter);
  return app;
}

let app;
let admin; // minted admin caller (headers reused across tests)

/** Live custom claims for a uid, {} when none. */
async function liveClaims(uid) {
  const rec = await auth.getUser(uid);
  return rec.customClaims || {};
}

/** tokensValidAfterTime as epoch ms (0 when absent). */
async function tokensValidAfter(uid) {
  const rec = await auth.getUser(uid);
  return rec.tokensValidAfterTime ? Date.parse(rec.tokensValidAfterTime) : 0;
}

/**
 * Poll live claims until `predicate` holds or `ms` elapses; returns the last
 * observed claims either way so the caller's assert reports the real value.
 * Needed ONLY for the fire-and-forget suspend/unsuspend helpers.
 */
async function pollClaims(uid, predicate, ms = 4000) {
  const start = Date.now();
  for (;;) {
    const claims = await liveClaims(uid);
    if (predicate(claims) || Date.now() - start > ms) return claims;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Real wall-clock wait — tokensValidAfterTime has second resolution. */
const settleClock = () => new Promise((r) => setTimeout(r, 1100));

/** Seed a ban/binding doc directly (standing changes no route saw). */
const seed = (path, data) => db.doc(path).set(data);

beforeAll(async () => {
  await assertEmulatorReachable();
  app = buildApp();
  admin = await mintRealUser({
    uniqueId: IDS.admin,
    uid: uidOf(IDS.admin),
    cohort: 'adult',
    admin: true,
  });
});

beforeEach(() => {
  // The middleware + bans caches are process-wide; a verdict cached by one
  // test must never decide another's.
  clearAuthCaches();
});

afterAll(async () => {
  clearAuthCaches();
  // Per-file namespace sweep — prefixed doc ids first.
  await clearPrefixed(db, 'deviceBans', 'bcl-');
  await clearPrefixed(db, 'deviceBindings', 'bcl-');
  await clearPrefixed(db, 'networkBans', 'bcl-');
  // Route-generated networkBans ids are random — sweep by our linked ids.
  const linked = Object.values(IDS).map(String);
  for (let i = 0; i < linked.length; i += 10) {
    const chunk = linked.slice(i, i + 10);
    for (const col of ['networkBans', 'deviceBans']) {
      const snap = await db.collection(col).where('linkedUniqueId', 'in', chunk).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  // Audit rows written by our admin caller.
  const audit = await db.collection('adminAuditLog').where('adminId', '==', uidOf(IDS.admin)).get();
  await Promise.all(audit.docs.map((d) => d.ref.delete()));
  // users docs (recursive: suspend writes a warnings subdoc) + system PMs.
  for (const uniqueId of Object.values(IDS)) {
    await db.recursiveDelete(db.doc(`users/${uniqueId}`));
    const convId = [String(uniqueId), SYSTEM_UID].sort((a, b) => a.localeCompare(b)).join('_');
    await db.recursiveDelete(db.doc(`conversations/${convId}`));
    await auth.deleteUser(uidOf(uniqueId)).catch(() => {});
  }
  await auth.deleteUser('bcl-uid-nodoc-r5').catch(() => {}); // R1-5's doc-less user
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════════════
// A — explicit ban mutations mint / recompute the claim (+ revocation)
// ═══════════════════════════════════════════════════════════════════════════

describe('explicit ban routes → syncBannedClaim chokepoint', () => {
  test('ban device (linked) mints banned:true, PRESERVES other claims, and revokes refresh tokens', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a1, uid: uidOf(IDS.a1), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult' });
    await settleClock(); // second-resolution guard for the revocation assert
    const before = await tokensValidAfter(target.uid);

    await request(app)
      .post('/api/admin/bans/device')
      .set(admin.headers)
      .send({ deviceId: 'bcl-dev-a1', reason: 'bcl-test', linkedUniqueId: String(IDS.a1) })
      .expect(200);

    const claims = await liveClaims(target.uid);
    expect(claims.banned).toBe(true);
    expect(claims.cohort).toBe('adult'); // merge, not replace
    expect(await tokensValidAfter(target.uid)).toBeGreaterThan(before);
  });

  test('ban device with NO linkedUniqueId still mints for the device’s BOUND owner', async () => {
    const owner = await mintRealUser({ uniqueId: IDS.a2, uid: uidOf(IDS.a2), cohort: 'adult' });
    await seed('deviceBindings/bcl-dev-a2', { uniqueId: String(IDS.a2), boundAt: 1 });

    await request(app)
      .post('/api/admin/bans/device')
      .set(admin.headers)
      .send({ deviceId: 'bcl-dev-a2', reason: 'bcl-test' })
      .expect(200);

    expect((await liveClaims(owner.uid)).banned).toBe(true);
  });

  test('ban network (linked) mints banned:true', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a3, uid: uidOf(IDS.a3), cohort: 'adult' });

    await request(app)
      .post('/api/admin/bans/network')
      .set(admin.headers)
      .send({
        type: 'ip',
        value: '203.0.113.5',
        reason: 'bcl-test',
        linkedUniqueId: String(IDS.a3),
      })
      .expect(200);

    expect((await liveClaims(target.uid)).banned).toBe(true);
  });

  test('ban network with NO linkedUniqueId mints for NOBODY (structural limit → lazy path)', async () => {
    const bystander = await mintRealUser({
      uniqueId: IDS.nonAdmin,
      uid: uidOf(IDS.nonAdmin),
      cohort: 'adult',
    });

    await request(app)
      .post('/api/admin/bans/network')
      .set(admin.headers)
      .send({ type: 'ip', value: '203.0.113.99', reason: 'bcl-test' })
      .expect(200);

    expect((await liveClaims(bystander.uid)).banned).toBeUndefined();
  });

  test('unban device RECOMPUTES to banned:false when it was the last ban', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a5, uid: uidOf(IDS.a5), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('deviceBans/bcl-dev-a5', {
      deviceId: 'bcl-dev-a5',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a5),
      expiresAt: null,
      createdAt: 1,
    });

    await request(app).delete('/api/admin/bans/device/bcl-dev-a5').set(admin.headers).expect(200);

    expect((await liveClaims(target.uid)).banned).toBe(false);
  });

  test('unban device KEEPS banned:true while a linked network ban is still active (no blind clear)', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a6, uid: uidOf(IDS.a6), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('deviceBans/bcl-dev-a6', {
      deviceId: 'bcl-dev-a6',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a6),
      expiresAt: null,
      createdAt: 1,
    });
    await seed('networkBans/bcl-net-a6', {
      type: 'ip',
      value: '198.51.100.14',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a6),
      expiresAt: null,
      createdAt: 1,
    });

    await request(app).delete('/api/admin/bans/device/bcl-dev-a6').set(admin.headers).expect(200);

    expect((await liveClaims(target.uid)).banned).toBe(true);
  });

  test('unban network RECOMPUTES to banned:false when it was the last ban', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a7, uid: uidOf(IDS.a7), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('networkBans/bcl-net-a7', {
      type: 'ip',
      value: '198.51.100.15',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a7),
      expiresAt: null,
      createdAt: 1,
    });

    await request(app).delete('/api/admin/bans/network/bcl-net-a7').set(admin.headers).expect(200);

    expect((await liveClaims(target.uid)).banned).toBe(false);
  });

  test('unban-all RECOMPUTES to banned:false (device + network linked bans lifted)', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a8, uid: uidOf(IDS.a8), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('deviceBans/bcl-dev-a8', {
      deviceId: 'bcl-dev-a8',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a8),
      expiresAt: null,
      createdAt: 1,
    });
    await seed('networkBans/bcl-net-a8', {
      type: 'ip',
      value: '198.51.100.16',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a8),
      expiresAt: null,
      createdAt: 1,
    });

    const res = await request(app)
      .post(`/api/admin/bans/unban-all/${IDS.a8}`)
      .set(admin.headers)
      .expect(200);

    expect(res.body.removed).toBe(2);
    expect((await liveClaims(target.uid)).banned).toBe(false);
  });

  test('unban-all KEEPS banned:true when an UNLINKED hardware ban on a bound device survives it', async () => {
    const target = await mintRealUser({ uniqueId: IDS.a9, uid: uidOf(IDS.a9), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('deviceBindings/bcl-dev-a9', { uniqueId: String(IDS.a9), boundAt: 1 });
    // Unlinked hardware ban — unban-all's linkedUniqueId queries can't see it.
    await seed('deviceBans/bcl-dev-a9', {
      deviceId: 'bcl-dev-a9',
      reason: 'bcl-test',
      expiresAt: null,
      createdAt: 1,
    });
    // Plus one linked ban so unban-all has something to remove.
    await seed('deviceBans/bcl-dev-a9b', {
      deviceId: 'bcl-dev-a9b',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.a9),
      expiresAt: null,
      createdAt: 1,
    });

    const res = await request(app)
      .post(`/api/admin/bans/unban-all/${IDS.a9}`)
      .set(admin.headers)
      .expect(200);

    expect(res.body.removed).toBe(1); // only the linked one
    expect((await liveClaims(target.uid)).banned).toBe(true); // hardware ban still stands
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security AC — the claim surface is admin-gated (server-controlled)
// ═══════════════════════════════════════════════════════════════════════════

describe('claim mutation surface is server-controlled', () => {
  test('a NON-admin caller gets 403 from the ban route and the target’s claims are untouched', async () => {
    const target = await mintRealUser({ uniqueId: IDS.adv, uid: uidOf(IDS.adv), cohort: 'adult' });
    const caller = await mintRealUser({
      uniqueId: IDS.nonAdmin,
      uid: uidOf(IDS.nonAdmin),
      cohort: 'adult',
    });

    await request(app)
      .post('/api/admin/bans/device')
      .set(caller.headers)
      .send({ deviceId: 'bcl-dev-x', reason: 'bcl-test', linkedUniqueId: String(IDS.adv) })
      .expect(403);

    expect((await liveClaims(target.uid)).banned).toBeUndefined();
  });

  test('an anonymous caller gets 401 before reaching the ban route', async () => {
    await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'bcl-dev-x', reason: 'bcl-test' })
      .expect(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — suspend / unsuspend auto-applied bans ride the same chokepoint
// ═══════════════════════════════════════════════════════════════════════════

describe('suspend / unsuspend auto-ban claim sync (fire-and-forget → polled)', () => {
  test('suspend auto-bans the bound device + last IP and mints banned:true', async () => {
    const target = await mintRealUser({ uniqueId: IDS.b1, uid: uidOf(IDS.b1), cohort: 'adult' });
    await seed('deviceBindings/bcl-dev-b1', {
      uniqueId: String(IDS.b1),
      lastIp: '203.0.113.12',
      boundAt: 1,
    });

    await request(app)
      .post(`/api/user/${IDS.b1}/suspend`)
      .set(admin.headers)
      .send({ reason: 'bcl-test', canAppeal: false })
      .expect(200);

    const claims = await pollClaims(target.uid, (c) => c.banned === true);
    expect(claims.banned).toBe(true);

    // The auto-ban docs themselves (value-level: the standing the claim reflects).
    const deviceBan = await db.doc('deviceBans/bcl-dev-b1').get();
    expect(deviceBan.exists).toBe(true);
    expect(deviceBan.data().autoApplied).toBe(true);
    expect(deviceBan.data().linkedUniqueId).toBe(String(IDS.b1));
    const netSnap = await db
      .collection('networkBans')
      .where('linkedUniqueId', '==', String(IDS.b1))
      .get();
    expect(netSnap.docs.map((d) => d.data().value)).toContain('203.0.113.12');
  });

  test('unsuspend lifts the auto-bans and recomputes to banned:false', async () => {
    await mintRealUser({ uniqueId: IDS.b2, uid: uidOf(IDS.b2), cohort: 'adult' });
    const target = { uid: uidOf(IDS.b2) };
    await seed('deviceBindings/bcl-dev-b2', {
      uniqueId: String(IDS.b2),
      lastIp: '203.0.113.19',
      boundAt: 1,
    });
    await request(app)
      .post(`/api/user/${IDS.b2}/suspend`)
      .set(admin.headers)
      .send({ reason: 'bcl-test', canAppeal: false })
      .expect(200);
    await pollClaims(target.uid, (c) => c.banned === true);

    await request(app).post(`/api/user/${IDS.b2}/unsuspend`).set(admin.headers).expect(200);

    const claims = await pollClaims(target.uid, (c) => c.banned === false);
    expect(claims.banned).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — lazy middleware sync (verdict ≠ token claim)
// ═══════════════════════════════════════════════════════════════════════════

describe('authMiddleware lazy claim sync', () => {
  test('banned-direction: an active ban the routes never saw is minted on the next request (+ revocation)', async () => {
    // Standing changed with NO route in the loop (models an expiry flip /
    // binding change): ban doc seeded directly. Token carries NO banned claim.
    const target = await mintRealUser({ uniqueId: IDS.c1, uid: uidOf(IDS.c1), cohort: 'adult' });
    await seed('deviceBans/bcl-dev-c1', {
      deviceId: 'bcl-dev-c1',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.c1),
      expiresAt: null,
      createdAt: 1,
    });
    await settleClock();
    const before = await tokensValidAfter(target.uid);

    const res = await request(app).get('/api/bcl-echo').set(target.headers).expect(403);

    expect(res.body.code).toBe('banned'); // the SHY-0149 gate still answers
    expect((await liveClaims(target.uid)).banned).toBe(true); // lazy mint
    expect(await tokensValidAfter(target.uid)).toBeGreaterThan(before); // revoked
  });

  test('unbanned-direction: a stale banned:true token is recomputed to banned:false — request passes, NO revocation', async () => {
    // Live claims + token both say banned, but no ban stands (models a lazy
    // expiry / unlinked unban the routes could not attribute).
    const target = await mintRealUser({
      uniqueId: IDS.c2,
      uid: uidOf(IDS.c2),
      cohort: 'adult',
      extraClaims: { banned: true },
    });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await settleClock();
    const before = await tokensValidAfter(target.uid);

    const res = await request(app).get('/api/bcl-echo').set(target.headers).expect(200);

    expect(res.body.ok).toBe(true);
    expect((await liveClaims(target.uid)).banned).toBe(false); // recomputed clear
    expect(await tokensValidAfter(target.uid)).toBe(before); // clearing never signs the user out
  });

  test('banned-direction: an UNLINKED network ban caught by the caller’s IP is minted from the verdict', async () => {
    // The recompute cannot attribute an unlinked network ban to a user — the
    // VERDICT (live IP match) is the only evidence, and it must be enough to
    // mint. This closes the story's structural-limit path.
    const target = await mintRealUser({ uniqueId: IDS.c3, uid: uidOf(IDS.c3), cohort: 'adult' });
    await seed('networkBans/bcl-net-c3', {
      type: 'ip',
      value: '203.0.113.77',
      reason: 'bcl-test',
      expiresAt: null,
      createdAt: 1,
    });

    const res = await request(app)
      .get('/api/bcl-echo')
      .set(target.headers)
      .set('X-Forwarded-For', '203.0.113.77')
      .expect(403);

    expect(res.body.code).toBe('banned');
    expect((await liveClaims(target.uid)).banned).toBe(true);
  });

  test('clear-authority is the RECOMPUTE: a linked network ban keeps the claim even when the API gate passes', async () => {
    // Linked network ban on an IP the caller is NOT using: the per-request
    // gate passes them (no IP/device match), but the admin explicitly linked
    // a standing ban to this account — the lazy path must NOT clear it.
    const target = await mintRealUser({
      uniqueId: IDS.c4,
      uid: uidOf(IDS.c4),
      cohort: 'adult',
      extraClaims: { banned: true },
    });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });
    await seed('networkBans/bcl-net-c4', {
      type: 'ip',
      value: '198.51.100.9',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.c4),
      expiresAt: null,
      createdAt: 1,
    });

    await request(app).get('/api/bcl-echo').set(target.headers).expect(200);

    expect((await liveClaims(target.uid)).banned).toBe(true); // kept
  });

  test('no repeated revocation: a second request on the same stale token does not re-revoke', async () => {
    const target = await mintRealUser({ uniqueId: IDS.c5, uid: uidOf(IDS.c5), cohort: 'adult' });
    await seed('deviceBans/bcl-dev-c5', {
      deviceId: 'bcl-dev-c5',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.c5),
      expiresAt: null,
      createdAt: 1,
    });
    await request(app).get('/api/bcl-echo').set(target.headers).expect(403); // first sync mints + revokes
    await settleClock();
    const afterFirst = await tokensValidAfter(target.uid);

    await request(app).get('/api/bcl-echo').set(target.headers).expect(403);

    expect(await tokensValidAfter(target.uid)).toBe(afterFirst); // no second revocation
  });

  test('exempt paths never sync: the verdict is not computed, so no mint happens there', async () => {
    // /portal/sign-out is ban-exempt (signing out must always work). The gate
    // is skipped there BY DESIGN — and so is the lazy sync, since the verdict
    // that would drive it is never computed on an exempt path.
    const target = await mintRealUser({ uniqueId: IDS.c6, uid: uidOf(IDS.c6), cohort: 'adult' });
    await seed('deviceBans/bcl-dev-c6', {
      deviceId: 'bcl-dev-c6',
      reason: 'bcl-test',
      linkedUniqueId: String(IDS.c6),
      expiresAt: null,
      createdAt: 1,
    });

    // 404 = passed the middleware (no portal router mounted here), not 403.
    await request(app).get('/api/portal/sign-out').set(target.headers).expect(404);

    expect((await liveClaims(target.uid)).banned).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D — the merge dependency the whole design leans on
// ═══════════════════════════════════════════════════════════════════════════

describe('mintClaimsMerging preserves banned across unrelated mints', () => {
  test('a cohort re-mint (sign-in path) does not stomp banned:true', async () => {
    const target = await mintRealUser({ uniqueId: IDS.d1, uid: uidOf(IDS.d1), cohort: 'adult' });
    await auth.setCustomUserClaims(target.uid, { cohort: 'adult', banned: true });

    await mintClaimsMerging(target.uid, { cohort: 'minor' });

    const claims = await liveClaims(target.uid);
    expect(claims.cohort).toBe('minor');
    expect(claims.banned).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E — reviewer R1 gap-closures (util-level contracts, still real-only)
// ═══════════════════════════════════════════════════════════════════════════

describe('syncBannedClaim util contracts (reviewer R1)', () => {
  test('R1-1: the dedupe guard itself short-circuits a repeat call — distinct from idempotency', async () => {
    // Removing the dedup block must turn THIS red: the second call's return
    // is `reason: 'dedup'`, which only the guard produces (the idempotent
    // no-change path returns `{synced: true, changed: false}` instead).
    await mintRealUser({ uniqueId: IDS.r1, uid: uidOf(IDS.r1), cohort: 'adult' });

    const first = await syncBannedClaim(String(IDS.r1), { dedupe: true });
    expect(first).toMatchObject({ synced: true, changed: false, banned: false });

    const second = await syncBannedClaim(String(IDS.r1), { dedupe: true });
    expect(second).toEqual({ synced: false, reason: 'dedup' });

    // Route callers bypass the guard — a fresh mutation must always sync.
    const routeStyle = await syncBannedClaim(String(IDS.r1));
    expect(routeStyle).toMatchObject({ synced: true });
  });

  test('R1-2: ONE device-ban mutation syncs BOTH the linked account AND a different bound owner', async () => {
    const linked = await mintRealUser({ uniqueId: IDS.r2a, uid: uidOf(IDS.r2a), cohort: 'adult' });
    const owner = await mintRealUser({ uniqueId: IDS.r2b, uid: uidOf(IDS.r2b), cohort: 'adult' });
    await seed('deviceBindings/bcl-dev-r2', { uniqueId: String(IDS.r2b), boundAt: 1 });

    await request(app)
      .post('/api/admin/bans/device')
      .set(admin.headers)
      .send({ deviceId: 'bcl-dev-r2', reason: 'bcl-test', linkedUniqueId: String(IDS.r2a) })
      .expect(200);

    expect((await liveClaims(linked.uid)).banned).toBe(true);
    expect((await liveClaims(owner.uid)).banned).toBe(true);
  });

  test('R1-4: an ASN network ban matching a STORED binding ASN is attributable — recompute mints', async () => {
    const target = await mintRealUser({ uniqueId: IDS.r4, uid: uidOf(IDS.r4), cohort: 'adult' });
    // Binding stores the ip-api 'AS64500' shape; the admin route validates
    // digits-only — normalizeAsn bridges them (the SHY-0149 defect class).
    await seed('deviceBindings/bcl-dev-r4', {
      uniqueId: String(IDS.r4),
      asn: 'AS64500',
      boundAt: 1,
    });
    await seed('networkBans/bcl-net-r4', {
      type: 'asn',
      value: '64500',
      reason: 'bcl-test',
      expiresAt: null,
      createdAt: 1,
    });

    const result = await syncBannedClaim(String(IDS.r4));

    expect(result).toMatchObject({ synced: true, banned: true });
    expect((await liveClaims(target.uid)).banned).toBe(true);
  });

  test('R1-5: a network-banned caller with NO users doc (uniqueId null) is denied without a mint or a crash', async () => {
    const target = await mintTokenWithoutUserDoc({ cohort: 'adult', uid: 'bcl-uid-nodoc-r5' });
    await seed('networkBans/bcl-net-r5', {
      type: 'ip',
      value: '203.0.113.55',
      reason: 'bcl-test',
      expiresAt: null,
      createdAt: 1,
    });

    const res = await request(app)
      .get('/api/bcl-echo')
      .set(target.headers)
      .set('X-Forwarded-For', '203.0.113.55')
      .expect(403);

    expect(res.body.code).toBe('banned'); // the gate still denies
    // No uniqueId → nothing to mint; the sync short-circuits cleanly.
    expect((await liveClaims(target.uid)).banned).toBeUndefined();
  });

  test('R1-6: the dedup map is BOUNDED — the oldest key is evicted past MAX size and re-syncs', async () => {
    // Fill the map one past its 500-entry bound with distinct ids. The ids
    // resolve no users doc, so each call marks the dedup map then returns
    // `no-uid` — cheap, real, and enough to drive the eviction branch.
    for (let i = 0; i <= 500; i++) {
      await syncBannedClaim(`bcl-evict-${i}`, { dedupe: true });
    }
    // Oldest key evicted → a repeat is NOT deduped (re-processed to no-uid).
    expect(await syncBannedClaim('bcl-evict-0', { dedupe: true })).toEqual({
      synced: false,
      reason: 'no-uid',
    });
    // A recent key is still within the map → deduped.
    expect(await syncBannedClaim('bcl-evict-500', { dedupe: true })).toEqual({
      synced: false,
      reason: 'dedup',
    });
  }, 120000);
});
