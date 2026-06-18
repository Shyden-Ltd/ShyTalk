/**
 * ageVerificationAuditReconcile.test.js — EPIC-0003 / SHY-0120 slice 4.
 *
 * MIGRATED off the firebase + helpers (`now`) Jest mocks. The prior tests
 * routed `db.collection(name).where(...)` through a hand-rolled query-shape
 * fake and pinned `now()`, so they asserted "the add mock was called with
 * shape X" — they could NOT catch the cron reconciling the WRONG submissions,
 * writing a DUPLICATE remediation row on re-run, or the real Firestore range
 * query excluding docs the mock happily returned. This rewrite seeds real
 * `ageVerificationSubmissions` + `auditLog` docs, runs the real cron against
 * the live Firestore emulator, and reads `auditLog` back to assert the real
 * value-level outcome. The real `log` runs unmocked (exercised, not asserted).
 *
 * REAL-vs-mock corrections surfaced while migrating (documented so the next
 * author doesn't re-introduce the fictions):
 *   1. The cron's main query is `where('decisionAt', '>=', cutoff)` with a
 *      NUMERIC cutoff. Firestore range filters are type-aware — a numeric `>=`
 *      bound matches ONLY number-typed fields. A string- (or out-of-window)
 *      `decisionAt` is excluded by the QUERY and never scanned. The mock test
 *      fed such a doc in and expected `skippedPending`; that path is
 *      unreachable in production (verified against the emulator). `skippedPending`
 *      is exercised here the only real way it can fire — a numeric in-window
 *      doc whose `status === 'pending'`.
 *   2. The per-doc `failed` counter (and the `data()`-throws branch) is a
 *      defensive guard: a real `auditLog.add()` throw needs an un-storable
 *      entry, but every value we can SEED is by definition Firestore-storable,
 *      so the rebuilt entry is storable too — the throw is not cheaply
 *      inducible for real (a genuine Firestore outage mid-loop is operator
 *      escape-hatch territory, never a mock). Loop continuation is proven by a
 *      real multi-doc test instead.
 *
 * Isolation: the cron scans the whole `ageVerificationSubmissions` collection
 * and queries/writes `auditLog`, so both are cleared in beforeEach for a clean
 * slate. See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 1 h ago — comfortably inside the 7-day scan window.
const withinWindow = () => Date.now() - 60 * MIN_MS;
// 8 days ago — outside the 7-day window, so the real range query excludes it.
const beforeWindow = () => Date.now() - 8 * DAY_MS;

const seedSubmission = (id, fields) => db.doc(`ageVerificationSubmissions/${id}`).set(fields);
const seedAudit = (id, fields) => db.doc(`auditLog/${id}`).set(fields);

const remediationFor = async (submissionId) => {
  const snap = await db
    .collection('auditLog')
    .where('details.fromSubmissionId', '==', submissionId)
    .get();
  return snap.docs.map((d) => d.data());
};
const auditCount = async () => (await db.collection('auditLog').get()).size;

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollection(db, 'ageVerificationSubmissions');
  await clearCollection(db, 'auditLog');
});

afterAll(async () => {
  await clearCollection(db, 'ageVerificationSubmissions');
  await clearCollection(db, 'auditLog');
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('ageVerificationAuditReconcile cron (real Firestore emulator)', () => {
  test('an empty submissions collection is a clean no-op (all-zero counts, no audit rows)', async () => {
    const result = await ageVerificationAuditReconcile();

    expect(result).toEqual({
      scanned: 0,
      reconciled: 0,
      skippedPending: 0,
      skippedAlreadyAudited: 0,
      skippedUnknownStatus: 0,
      failed: 0,
    });
    expect(await auditCount()).toBe(0);
  });

  test('back-fills a full remediation row for an in-window approved decision with no audit row', async () => {
    const decisionAt = withinWindow();
    await seedSubmission('sub-approve', {
      userId: '10000050',
      idMethod: 'passport',
      status: 'approved',
      decisionAt,
      decidedBy: 10000001,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(1);

    const rows = await remediationFor('sub-approve');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'age_verification_approved',
      actionType: 'age_verification_approved',
      targetType: 'user',
      targetId: '10000050',
      adminUid: 10000001,
    });
    expect(rows[0].details.fromSubmissionId).toBe('sub-approve');
    expect(rows[0].details.method).toBe('passport');
    expect(rows[0].details.originalDecisionAt).toBe(decisionAt);
    expect(rows[0].details.note).toMatch(/Reconciled by ageVerificationAuditReconcile/);
    expect(typeof rows[0].timestamp).toBe('number');
    expect(typeof rows[0].details.reconciledAt).toBe('number');
  });

  test('maps every submission status to its exact audit action (value matrix)', async () => {
    // One submission per STATUS_ACTION_MAP key, all in-window with no existing
    // audit row → each must be reconciled to its mapped action.
    const cases = [
      ['s-approved', 'approved', 'age_verification_approved'],
      ['s-rejected', 'rejected', 'age_verification_rejected'],
      ['s-dob-modified', 'dob_modified', 'age_verification_dob_modified'],
      ['s-modify-dob', 'modify-dob', 'age_verification_dob_modified'],
      ['s-modifyDob', 'modifyDob', 'age_verification_dob_modified'],
    ];
    for (const [id, status] of cases) {
      await seedSubmission(id, {
        userId: `u-${id}`,
        status,
        decisionAt: withinWindow(),
        decidedBy: 7,
      });
    }

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(cases.length);
    expect(result.reconciled).toBe(cases.length);
    for (const [id, , expectedAction] of cases) {
      const rows = await remediationFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(expectedAction);
      expect(rows[0].actionType).toBe(expectedAction);
    }
  });

  test('a rejected remediation row does NOT leak the approve-only method field', async () => {
    await seedSubmission('sub-reject', {
      userId: '10000051',
      idMethod: 'passport', // present on the submission but must not surface
      status: 'rejected',
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });

    await ageVerificationAuditReconcile();

    const rows = await remediationFor('sub-reject');
    expect(rows[0].action).toBe('age_verification_rejected');
    expect(rows[0].details.method).toBeUndefined();
  });

  test('a dob-modified remediation row carries the DOB-delta caveat in its note', async () => {
    await seedSubmission('sub-dob', {
      userId: '10000052',
      status: 'dob_modified',
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });

    await ageVerificationAuditReconcile();

    const rows = await remediationFor('sub-dob');
    expect(rows[0].action).toBe('age_verification_dob_modified');
    expect(rows[0].details.note).toMatch(/DOB delta not captured/);
  });

  test('falls back to adminUid=0 when decidedBy is absent (legacy submission)', async () => {
    await seedSubmission('sub-no-admin', {
      userId: '10000053',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: withinWindow(),
      // no decidedBy
    });

    await ageVerificationAuditReconcile();

    const rows = await remediationFor('sub-no-admin');
    expect(rows[0].adminUid).toBe(0);
  });

  test('falls back to adminUid=0 when decidedBy is non-numeric', async () => {
    await seedSubmission('sub-str-admin', {
      userId: '10000054',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: withinWindow(),
      decidedBy: 'admin@example.com', // string, not a numeric uid
    });

    await ageVerificationAuditReconcile();

    const rows = await remediationFor('sub-str-admin');
    expect(rows[0].adminUid).toBe(0);
  });

  test('skips a submission already tagged with fromSubmissionId (idempotency marker)', async () => {
    await seedSubmission('sub-tagged', {
      userId: '10000050',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });
    // A prior remediation row already exists for this submission.
    await seedAudit('pre-tagged', {
      action: 'age_verification_approved',
      actionType: 'age_verification_approved',
      targetId: '10000050',
      timestamp: Date.now(),
      details: { fromSubmissionId: 'sub-tagged' },
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedAlreadyAudited).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(await auditCount()).toBe(1); // no duplicate written
  });

  test('is idempotent across two real runs — the second run writes no duplicate', async () => {
    await seedSubmission('sub-twice', {
      userId: '10000055',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });

    const first = await ageVerificationAuditReconcile();
    expect(first.reconciled).toBe(1);
    expect(await auditCount()).toBe(1);

    // Second run finds the tagged row it just wrote → skip, no duplicate.
    const second = await ageVerificationAuditReconcile();
    expect(second.reconciled).toBe(0);
    expect(second.skippedAlreadyAudited).toBe(1);
    expect(await auditCount()).toBe(1);
  });

  test('skips when an untagged original audit row matches actionType+targetId within ±10 min', async () => {
    const decisionAt = withinWindow();
    await seedSubmission('sub-match', {
      userId: '10000056',
      idMethod: 'passport',
      status: 'approved',
      decisionAt,
      decidedBy: 10000001,
    });
    // Original route-written audit row (no fromSubmissionId tag), 5 min before
    // the decision — inside the ±10 min skew window.
    await seedAudit('orig-match', {
      actionType: 'age_verification_approved',
      targetId: '10000056',
      timestamp: decisionAt - 5 * MIN_MS,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedAlreadyAudited).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(await auditCount()).toBe(1);
  });

  test('back-fills when the only candidate audit row is OUTSIDE the ±10 min window', async () => {
    const decisionAt = withinWindow();
    await seedSubmission('sub-far', {
      userId: '10000057',
      idMethod: 'passport',
      status: 'approved',
      decisionAt,
      decidedBy: 10000001,
    });
    // 11 min before the decision — just outside the window → not a match.
    await seedAudit('orig-far', {
      actionType: 'age_verification_approved',
      targetId: '10000057',
      timestamp: decisionAt - 11 * MIN_MS,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.reconciled).toBe(1);
    expect(await auditCount()).toBe(2); // the stale original + the new remediation
  });

  test('back-fills when an in-window audit row belongs to a DIFFERENT user (targetId scoping)', async () => {
    const decisionAt = withinWindow();
    await seedSubmission('sub-other', {
      userId: '10000058',
      idMethod: 'passport',
      status: 'approved',
      decisionAt,
      decidedBy: 10000001,
    });
    // Same action + a perfectly in-window timestamp, but a different targetId.
    await seedAudit('orig-other-user', {
      actionType: 'age_verification_approved',
      targetId: '99999999',
      timestamp: decisionAt,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.reconciled).toBe(1);
    const rows = await remediationFor('sub-other');
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe('10000058');
  });

  test('coerces a REAL Firestore Timestamp on the candidate audit row when matching the window', async () => {
    const decisionAt = withinWindow();
    await seedSubmission('sub-ts', {
      userId: '10000059',
      idMethod: 'passport',
      status: 'approved',
      decisionAt,
      decidedBy: 10000001,
    });
    // Seeding a JS Date makes Firestore store (and read back) a genuine
    // Timestamp object with `.toMillis()` — exercising the real coercion path
    // the mock test faked with a hand-rolled `{ toMillis }`.
    await seedAudit('orig-ts', {
      actionType: 'age_verification_approved',
      targetId: '10000059',
      timestamp: new Date(decisionAt - 5 * MIN_MS),
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedAlreadyAudited).toBe(1);
    expect(result.reconciled).toBe(0);
  });

  test('skips an in-window submission whose status is pending (defensive status check)', async () => {
    await seedSubmission('sub-pending', {
      userId: '10000060',
      status: 'pending',
      decisionAt: withinWindow(), // numeric + in-window → genuinely returned by the query
      decidedBy: 10000001,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.skippedPending).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(await auditCount()).toBe(0);
  });

  test('skips an in-window submission whose status is not in STATUS_ACTION_MAP', async () => {
    await seedSubmission('sub-unknown', {
      userId: '10000061',
      status: 'expired', // not a recognised decision status
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.skippedUnknownStatus).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(await auditCount()).toBe(0);
  });

  test('does not scan a submission decided before the 7-day window (real range-query boundary)', async () => {
    await seedSubmission('sub-old', {
      userId: '10000062',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: beforeWindow(), // 8 days ago → excluded by `decisionAt >= cutoff`
      decidedBy: 10000001,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(await auditCount()).toBe(0);
  });

  test('does not scan a submission whose decisionAt is non-numeric (real type-aware query)', async () => {
    // The numeric `>=` range query excludes a string-typed decisionAt entirely
    // (verified against the emulator). It is never returned, so never scanned —
    // the cron back-fills only the sibling numeric submission.
    await seedSubmission('sub-string-ts', {
      userId: '10000063',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: 'not-a-timestamp',
      decidedBy: 10000001,
    });
    await seedSubmission('sub-numeric-ts', {
      userId: '10000064',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: withinWindow(),
      decidedBy: 10000001,
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(await remediationFor('sub-string-ts')).toHaveLength(0);
    expect(await remediationFor('sub-numeric-ts')).toHaveLength(1);
  });

  test('reconciles every gap across a multi-submission scan (loop continues across docs)', async () => {
    for (const id of ['multi-a', 'multi-b', 'multi-c']) {
      await seedSubmission(id, {
        userId: `u-${id}`,
        idMethod: 'passport',
        status: 'approved',
        decisionAt: withinWindow(),
        decidedBy: 10000001,
      });
    }

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(3);
    expect(result.reconciled).toBe(3);
    expect(result.failed).toBe(0);
    for (const id of ['multi-a', 'multi-b', 'multi-c']) {
      expect(await remediationFor(id)).toHaveLength(1);
    }
  });
});

// ─── toMillis helper — pure function, real inputs, no doubles ──────────
// Kept as direct assertions on the exported helper (no mock collaborator),
// covering the timestamp shapes the cron must coerce in hasExistingAudit /
// buildRemediationEntry.
describe('toMillis', () => {
  const { toMillis } = ageVerificationAuditReconcile;

  test('returns finite numbers unchanged', () => {
    expect(toMillis(1777896000000)).toBe(1777896000000);
    expect(toMillis(0)).toBe(0);
  });

  test('returns null for non-finite numbers', () => {
    expect(toMillis(NaN)).toBeNull();
    expect(toMillis(Infinity)).toBeNull();
  });

  test('calls .toMillis() on Firestore-Timestamp-like objects', () => {
    expect(toMillis({ toMillis: () => 1234567890 })).toBe(1234567890);
  });

  test('returns null when .toMillis() returns a non-finite value', () => {
    expect(toMillis({ toMillis: () => NaN })).toBeNull();
  });

  test('coerces { seconds, nanoseconds } to ms', () => {
    expect(toMillis({ seconds: 1777896, nanoseconds: 500_000_000 })).toBe(1777896 * 1000 + 500);
  });

  test('returns null for unknown shapes', () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis('1777896000000')).toBeNull();
    expect(toMillis({})).toBeNull();
  });
});

// ─── Internal helper exports — pure value assertions ──────────────────
describe('exports', () => {
  test('exposes the scan window + the exact status→action map', () => {
    expect(ageVerificationAuditReconcile.SCAN_WINDOW_MS).toBe(7 * 86_400_000);
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.approved).toBe(
      'age_verification_approved',
    );
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.rejected).toBe(
      'age_verification_rejected',
    );
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP['modify-dob']).toBe(
      'age_verification_dob_modified',
    );
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.dob_modified).toBe(
      'age_verification_dob_modified',
    );
  });

  test('exposes toMillis for callers that need to coerce timestamp shapes', () => {
    expect(typeof ageVerificationAuditReconcile.toMillis).toBe('function');
  });
});
