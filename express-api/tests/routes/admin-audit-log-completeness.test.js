/**
 * admin-audit-log-completeness.test.js — SHY-0260
 *
 * The admin audit log silently omitted almost every admin action.
 *
 * Both read paths order by `timestamp`, and Firestore's `orderBy` EXCLUDES
 * documents that lack the ordered field — no error, no warning, the rows are
 * simply not in the result. Nearly every writer records `createdAt` instead
 * (`admin-bans` BAN_DEVICE, `admin-devices` UNBIND_DEVICE, `admin-gifts`
 * CREATE_GIFT, `users` ACCOUNT_DELETION_SCHEDULED); only
 * `suggestions-maintenance` writes `timestamp`. On the local emulator the
 * collection held 200 documents and the product's query returned 2.
 *
 * That is worse than a broken endpoint. A failure is visible; this returns
 * 200 OK with a plausible, materially incomplete answer — so "was this user
 * banned by an admin?" answers "no evidence of that" while the evidence sits
 * in the collection.
 *
 * REAL emulator, no doubles, deliberately: a mocked `db` returns whatever the
 * test tells it to and therefore cannot reproduce orderBy's exclusion, which
 * is the whole bug.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const auditLogRouter = require('../../src/routes/admin-audit-log');

const ADMIN_UID = 50009120;
const PREFIX = 'shy260-';

let app;
let adminToken;

/** Written the way admin-bans.js / admin-devices.js / admin-gifts.js write. */
const withCreatedAt = (id, at) => ({
  ref: db.doc(`adminAuditLog/${PREFIX}createdAt-${id}`),
  data: { adminId: String(ADMIN_UID), action: 'BAN_DEVICE', targetUserId: '1', createdAt: at },
});

/** Written the way suggestions-maintenance.js writes. */
const withTimestamp = (id, at) => ({
  ref: db.doc(`adminAuditLog/${PREFIX}timestamp-${id}`),
  data: {
    adminId: String(ADMIN_UID),
    action: 'SUGGESTIONS_UPKEEP',
    targetUserId: '2',
    timestamp: at,
  },
});

/** An entry whose time is unusable — still evidence, must not vanish. */
const withNeither = (id) => ({
  ref: db.doc(`adminAuditLog/${PREFIX}none-${id}`),
  data: { adminId: String(ADMIN_UID), action: 'LEGACY_ACTION', targetUserId: '3' },
});

async function clearSeeded() {
  const snap = await db.collection('adminAuditLog').get();
  const doomed = snap.docs.filter((d) => d.id.startsWith(PREFIX));
  await Promise.all(doomed.map((d) => d.ref.delete()));
}

beforeAll(async () => {
  await assertEmulatorReachable();
  const admin = await mintRealUser({
    uniqueId: ADMIN_UID,
    cohort: 'adult',
    admin: true,
    extraUserData: { cohort: 'adult', role: 'admin', isAdmin: true },
  });
  adminToken = admin.idToken;

  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', auditLogRouter);
});

afterAll(async () => {
  await clearSeeded();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearAuthCaches();
  await clearSeeded();
});

const asAdmin = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

/**
 * Rows THIS FILE seeded, identified by doc-id prefix.
 *
 * Filtering on action names looked equivalent and was not: Jest runs files in
 * parallel workers against ONE emulator project, and other suites write
 * BAN_DEVICE rows of their own. The counts then depend on what else happens
 * to be running — passing alone, failing in the full suite.
 */
const seededRows = (rows) => rows.filter((r) => String(r.id || '').startsWith(PREFIX));

describe('the audit log returns every entry, whichever time field it carries', () => {
  test('entries written with createdAt are NOT omitted from the list', async () => {
    const now = Date.now();
    const seeds = [
      withCreatedAt('a', now - 1000),
      withCreatedAt('b', now - 2000),
      withCreatedAt('c', now - 3000),
      withTimestamp('d', now - 4000),
    ];
    await Promise.all(seeds.map((s) => s.ref.set(s.data)));

    const res = await asAdmin('/api/admin/audit-log');
    expect(res.status).toBe(200);

    const rows = seededRows(res.body.entries || res.body.logs || res.body || []);
    // 3 createdAt + 1 timestamp. Before the fix this returned 1 — the three
    // BAN_DEVICE rows, the ones a compliance reviewer most needs, were the
    // ones dropped.
    expect(rows.length).toBe(4);
    expect(rows.filter((r) => (r.action || r.actionType) === 'BAN_DEVICE').length).toBe(3);
  });

  test('the export contains the createdAt entries too', async () => {
    const now = Date.now();
    await Promise.all(
      [withCreatedAt('x', now - 500), withTimestamp('y', now - 600)].map((s) => s.ref.set(s.data)),
    );

    const res = await asAdmin('/api/admin/audit-log/export');
    expect(res.status).toBe(200);
    const body = res.text || '';
    expect(body).toContain('BAN_DEVICE');
    expect(body).toContain('SUGGESTIONS_UPKEEP');
  });

  test('an entry with NEITHER time field is still returned, never dropped', async () => {
    // An entry with a bad timestamp is still evidence that something
    // happened. Omitting it is the same failure mode in miniature.
    const now = Date.now();
    await Promise.all([withNeither('z'), withTimestamp('w', now)].map((s) => s.ref.set(s.data)));

    // Filtered by action rather than read from page 1: an entry with no
    // usable time correctly sorts LAST, so on a collection with hundreds of
    // rows it legitimately lands on a later page. Paging it off the first
    // page is not the same as dropping it, and the test must tell those two
    // apart or it would demand the wrong fix.
    const res = await asAdmin('/api/admin/audit-log?action=LEGACY_ACTION');
    expect(res.status).toBe(200);
    const rows = seededRows(res.body.entries || res.body.logs || res.body || []);
    expect(rows.map((r) => r.action || r.actionType)).toContain('LEGACY_ACTION');
  });

  test('merged ordering is newest-first ACROSS both field conventions', async () => {
    // Interleaved on purpose: sorting each convention separately and
    // concatenating would pass a naive "is it sorted" check while putting
    // every createdAt row after every timestamp row.
    const now = Date.now();
    await Promise.all(
      [
        withTimestamp('1', now - 1000),
        withCreatedAt('2', now - 2000),
        withTimestamp('3', now - 3000),
        withCreatedAt('4', now - 4000),
      ].map((s) => s.ref.set(s.data)),
    );

    const res = await asAdmin('/api/admin/audit-log');
    const rows = seededRows(res.body.entries || res.body.logs || res.body || []);
    // Assert the SIZE before the order. "Is it sorted?" is trivially true of
    // a one-element array, so without this the test passed while the bug was
    // fully present — three of the four rows were missing.
    expect(rows.length).toBe(4);
    const times = rows.map((r) => r.timestamp ?? r.createdAt ?? 0);
    const descending = [...times].sort((a, b) => b - a);
    expect(times).toEqual(descending);
  });
});

describe('the reads are bounded and the merge is complete above the cap', () => {
  // These drive the helper directly with a SMALL cap. The previous version
  // grepped this route's source for `.limit(`, which a refactor defeated
  // silently: introducing a `col` local made the pattern match nothing, so
  // the check passed while an unbounded read sat right there. Behaviour
  // cannot be refactored out from under an assertion the way a pattern can.
  const { readAuditCollection, auditEntryTime } = auditLogRouter;

  test('a read never returns more than its cap, and says when it truncated', async () => {
    const now = Date.now();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => withTimestamp(`cap${i}`, now - i * 1000)).map((seed) =>
        seed.ref.set(seed.data),
      ),
    );

    const { docs, truncated } = await readAuditCollection('adminAuditLog', 2);
    // Three bounded queries of 2 each, deduped — the point is that it is
    // BOUNDED, not that it returns exactly 2.
    expect(docs.length).toBeLessThanOrEqual(6);
    expect(truncated).toBe(true);
  });

  test('above the cap, the newest createdAt entries are STILL returned', async () => {
    // The mutant this exists to kill: dropping the createdAt-ordered query.
    // Below the cap the unordered pass happens to cover everything, so the
    // omission is invisible; above it, createdAt-written rows disappear
    // again — which is the original bug, at scale.
    const now = Date.now();
    const seeds = [
      ...Array.from({ length: 5 }, (_, i) => withTimestamp(`hi${i}`, now - i)),
      withCreatedAt('newest', now + 5000),
    ];
    await Promise.all(seeds.map((seed) => seed.ref.set(seed.data)));

    const { docs } = await readAuditCollection('adminAuditLog', 1);
    const actions = docs.map((d) => d.data().action);
    expect(actions).toContain('BAN_DEVICE');
  });

  test('auditEntryTime reads either convention and never throws on neither', () => {
    expect(auditEntryTime({ timestamp: 5 })).toBe(5);
    expect(auditEntryTime({ createdAt: 7 })).toBe(7);
    // timestamp wins when both are present, matching the sort's intent.
    expect(auditEntryTime({ timestamp: 5, createdAt: 7 })).toBe(5);
    expect(auditEntryTime({})).toBe(0);
    expect(auditEntryTime(null)).toBe(0);
    // A non-numeric time is not a time — it must not poison the sort.
    expect(auditEntryTime({ timestamp: 'yesterday' })).toBe(0);
  });
});
