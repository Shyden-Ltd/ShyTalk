/**
 * archiveReports.test.js — EPIC-0003 / SHY-0120 (cron → real Firestore emulator).
 *
 * MIGRATED off the firebase + log Jest mocks. The prior tests faked the query
 * chain + the batch object and asserted "set was called with path
 * reportsArchive/report-1" / introspected the `where` args — i.e. they checked
 * HOW the SDK was called, not that a report actually moved. They could not
 * catch a wrong field spread, a missing injected `id`, a half-committed batch,
 * or the original surviving the delete.
 *
 * This suite drives the REAL cron against the live Firestore emulator: reports
 * are seeded with `db.doc().set()` and the post-run state is read back — the
 * archived doc's exact fields, and the original's deletion, are asserted.
 *
 * Both query clauses are proven by real excluded docs:
 *   - `status == 'resolved'`        → an old `pending` report is left in place.
 *   - `resolvedAt < sixMonthsAgo`   → a recently-resolved report is left in place.
 *
 * NOT covered (escape-hatch, EPIC-0003): the prior "propagates Firestore read /
 * batch-commit errors" tests mocked a rejection. The cron has no catch (errors
 * propagate by construction) and a real emulator read/commit failure is not
 * inducible without a mock — so this is the documented escape-hatch, not a mock.
 *
 * Isolation: clears `reports` + `reportsArchive` in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const archiveReports = require('../../src/cron/archiveReports');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const monthsAgo = (n) => Date.now() - n * MONTH_MS;

const seedReport = (id, fields) => db.doc(`reports/${id}`).set(fields);
const reportExists = async (id) => (await db.doc(`reports/${id}`).get()).exists;
const archived = async (id) => {
  const snap = await db.doc(`reportsArchive/${id}`).get();
  return snap.exists ? snap.data() : null;
};
const count = async (coll) => (await db.collection(coll).get()).size;

// A resolved report old enough (7 months) to be archived.
const resolvedOld = (over = {}) => ({
  reportedUserId: 'user-abc',
  reporterId: 'user-xyz',
  reason: 'spam',
  status: 'resolved',
  resolvedAt: monthsAgo(7),
  ...over,
});

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollection(db, 'reports');
  await clearCollection(db, 'reportsArchive');
});

afterAll(async () => {
  await clearCollection(db, 'reports');
  await clearCollection(db, 'reportsArchive');
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('archiveReports cron (real Firestore emulator)', () => {
  test('archives a resolved report older than 6 months — copies all fields + injected id, then deletes the original', async () => {
    const resolvedAt = monthsAgo(7); // pin once — Date.now() drifts between calls
    await seedReport('report-1', {
      reportedUserId: 'user-bad',
      reporterId: 'user-good',
      reason: 'harassment',
      status: 'resolved',
      resolvedAt,
    });

    await archiveReports();

    const arch = await archived('report-1');
    expect(arch).not.toBeNull();
    expect(arch.id).toBe('report-1'); // injected via { id: d.id, ...d.data() }
    expect(arch.reportedUserId).toBe('user-bad');
    expect(arch.reporterId).toBe('user-good');
    expect(arch.reason).toBe('harassment');
    expect(arch.status).toBe('resolved');
    expect(arch.resolvedAt).toBe(resolvedAt);
    // Original removed from the active collection.
    expect(await reportExists('report-1')).toBe(false);
  });

  test('excludes an old PENDING report (the status == resolved query clause)', async () => {
    await seedReport('pending-old', resolvedOld({ status: 'pending' }));

    await archiveReports();

    expect(await reportExists('pending-old')).toBe(true);
    expect(await archived('pending-old')).toBeNull();
  });

  test('excludes a recently-resolved report (the resolvedAt < sixMonthsAgo clause)', async () => {
    await seedReport('recent', resolvedOld({ resolvedAt: monthsAgo(2) }));

    await archiveReports();

    expect(await reportExists('recent')).toBe(true);
    expect(await archived('recent')).toBeNull();
  });

  test('in a mixed run archives only the eligible report and leaves the pending + recent ones untouched', async () => {
    await seedReport('eligible', resolvedOld());
    await seedReport('pending-old', resolvedOld({ status: 'pending' }));
    await seedReport('recent', resolvedOld({ resolvedAt: monthsAgo(1) }));

    await archiveReports();

    // eligible moved
    expect(await archived('eligible')).not.toBeNull();
    expect(await reportExists('eligible')).toBe(false);
    // the two excluded survive in place, none archived
    expect(await reportExists('pending-old')).toBe(true);
    expect(await reportExists('recent')).toBe(true);
    expect(await archived('pending-old')).toBeNull();
    expect(await archived('recent')).toBeNull();
    expect(await count('reportsArchive')).toBe(1);
  });

  test('does nothing when no report matches (snapshot.empty early return)', async () => {
    await seedReport('recent', resolvedOld({ resolvedAt: monthsAgo(1) }));

    await expect(archiveReports()).resolves.toBeUndefined();

    expect(await count('reportsArchive')).toBe(0);
    expect(await count('reports')).toBe(1); // the recent one untouched
  });

  test('chunks past the 250-per-batch boundary — archives and deletes all 260 eligible reports', async () => {
    const total = 260;
    const batch = db.batch();
    for (let i = 0; i < total; i++) {
      batch.set(db.doc(`reports/bulk-${i}`), resolvedOld());
    }
    await batch.commit();

    await archiveReports();

    // 260 > 250 forces two internal batch commits; the real outcome is that
    // every doc moved — none dropped at the chunk boundary.
    expect(await count('reportsArchive')).toBe(total);
    expect(await count('reports')).toBe(0);
  }, 30000);
});
