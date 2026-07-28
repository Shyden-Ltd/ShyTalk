'use strict';

// SHY-0060 — gate-check rate limit wired into checkFeatureAccess (AC86), REAL
// services. Past MAX_PER_WINDOW checks/user the gate returns 429 and fires one
// T&S enumeration alert (real alertManager row). Behind the operator flag.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { checkFeatureAccess } = require('../../src/safety/enforce');
const {
  __resetAgeGatingFlagCache,
  __setSafetyConfigDocForTests,
} = require('../../src/safety/age-gating-flag');
const { __resetGateRateLimit, MAX_PER_WINDOW } = require('../../src/safety/gate-rate-limit');
const { hashUserId, SAFETY_AUDIT_COLLECTION } = require('../../src/safety/safety-audit');
const { waitFor } = require('../_helpers/wait-for');

const SAFETY_DOC = 'config/safety-test-ratelimit';
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const adult = (uniqueId) => ({ uniqueId, ageVerified: true, dateOfBirth: dobForAge(30) });
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

async function enumerationAlertsFor(userId) {
  const snap = await db.collection('alerts').where('type', '==', 'AGE_GATE_ENUMERATION').get();
  return snap.docs.map((d) => d.data()).filter((a) => a.context?.userId === userId);
}
async function auditRowsFor(userId) {
  const snap = await db
    .collection(SAFETY_AUDIT_COLLECTION)
    .where('userIdHash', '==', hashUserId(userId))
    .get();
  return snap.docs.map((d) => d.data());
}
async function clearAuditFor(userId) {
  const snap = await db
    .collection(SAFETY_AUDIT_COLLECTION)
    .where('userIdHash', '==', hashUserId(userId))
    .get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const d of snap.docs) batch.delete(d.ref);
  await batch.commit();
}
// The per-block audit write is fire-and-forget (enforce.js does not await it),
// so a loop's writes land asynchronously — poll until `expected` have settled.
// Generous ceiling (~5s, exits early) so shared-emulator contention under the
// parallel workers can't flake the settle.
async function waitForAuditCount(userId, expected, tries = 200, delayMs = 25) {
  for (let i = 0; i < tries; i += 1) {
    if ((await auditRowsFor(userId)).length >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs)); // sleep-ok: poll interval, returns as soon as the rows land
  }
}
const FILE_IDS = [67000001, 67000002, 67000003, 67000004, 67000005];
async function clearEnumerationAlertsFor(userId) {
  const snap = await db.collection('alerts').where('type', '==', 'AGE_GATE_ENUMERATION').get();
  const mine = snap.docs.filter((d) => d.data().context?.userId === userId);
  if (mine.length === 0) return;
  const batch = db.batch();
  for (const d of mine) batch.delete(d.ref);
  await batch.commit();
}

beforeAll(async () => {
  await assertEmulatorReachable();
  __setSafetyConfigDocForTests(SAFETY_DOC);
});
afterAll(() => {
  __setSafetyConfigDocForTests();
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});
beforeEach(async () => {
  __resetAgeGatingFlagCache();
  __resetGateRateLimit();
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearEnumerationAlertsFor(id);
  for (const id of FILE_IDS) await clearAuditFor(id);
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearEnumerationAlertsFor(id);
  for (const id of FILE_IDS) await clearAuditFor(id);
});

describe('checkFeatureAccess — gate-check rate limit (AC86)', () => {
  test('the check just past the budget returns 429 and fires one enumeration alert', async () => {
    await setFlag(true);
    const user = adult(67000001);

    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      const ok = await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
      expect(ok).toBeNull(); // adult → allowed, within budget
    }

    // safetyAudit records age-VERDICT blocks, not rate-limit breaches (those get
    // the dedicated enumeration alert). This case pins that an ALLOWED user's
    // rate-limited call writes no audit row; the companion test below pins the
    // stronger invariant for a would-be-BLOCKED user (the reorder guard).
    const auditBeforeLimit = await auditRowsFor(67000001);
    const limited = await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
    expect(limited).toEqual({
      status: 429,
      body: {
        error: 'Too many requests, please try again later.',
        errorId: 'AGE_GATE_RATE_LIMITED',
      },
    });
    const auditAfterLimit = await auditRowsFor(67000001);
    expect(auditAfterLimit).toHaveLength(auditBeforeLimit.length);
    const alerts = await enumerationAlertsFor(67000001);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].context).toMatchObject({ userId: 67000001, count: MAX_PER_WINDOW + 1 });
  });

  test('a rate-limited check writes NO audit row even for a user who WOULD be age-blocked', async () => {
    await setFlag(true);
    // Under 18 → GACHA_SPEND (18) blocks on the age verdict. Every within-budget
    // check is allowed by the limiter but age-blocked → a fire-and-forget audit
    // row. The (MAX+1)-th check is RATE-LIMITED, and the limiter must
    // short-circuit BEFORE the verdict/audit — so it adds no row even though
    // this user is blockable. This is the reorder guard the adult case can't be:
    // an adult is Allowed regardless of check order, so only a blockable user
    // exposes a verdict-audit-before-rate-limit reorder.
    const minor = { uniqueId: 67000005, ageVerified: true, dateOfBirth: dobForAge(15) };

    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      const blocked = await checkFeatureAccess(db, 'GACHA_SPEND', minor, NOW);
      expect(blocked.status).toBe(403); // age-blocked, still within the rate budget
    }
    await waitForAuditCount(67000005, MAX_PER_WINDOW); // let the fire-and-forget writes settle
    const before = (await auditRowsFor(67000005)).length;
    expect(before).toBe(MAX_PER_WINDOW); // sanity: every in-budget block audited

    const limited = await checkFeatureAccess(db, 'GACHA_SPEND', minor, NOW);
    expect(limited.status).toBe(429);
    // Asserting ABSENCE: there is no state to wait for, so the window is
    // inverted — wait FOR a new audit row and let the timeout be the pass.
    // A plain wait would resolve at t=0 and prove nothing.
    await expect(
      waitFor(async () => expect((await auditRowsFor(67000005)).length).toBeGreaterThan(before), {
        timeout: 500,
      }),
    ).rejects.toThrow();
    expect(await auditRowsFor(67000005)).toHaveLength(before); // the 429 audited nothing
  }, 20000);

  test('the alert fires exactly once even as further checks stay limited', async () => {
    await setFlag(true);
    const user = adult(67000002);

    for (let i = 0; i < MAX_PER_WINDOW + 3; i += 1) {
      await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
    }

    expect(await enumerationAlertsFor(67000002)).toHaveLength(1);
  });

  test('flag OFF: the rate limit never engages (the gate short-circuits first)', async () => {
    await setFlag(false);
    const user = adult(67000003);

    for (let i = 0; i < MAX_PER_WINDOW + 5; i += 1) {
      const res = await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
      expect(res).toBeNull();
    }
    expect(await enumerationAlertsFor(67000003)).toHaveLength(0);
  });

  test('one user exhausting the budget does not limit another user', async () => {
    await setFlag(true);
    const noisy = adult(67000001);
    const quiet = adult(67000004);

    for (let i = 0; i < MAX_PER_WINDOW + 1; i += 1) {
      await checkFeatureAccess(db, 'GACHA_SPEND', noisy, NOW);
    }

    const quietResult = await checkFeatureAccess(db, 'GACHA_SPEND', quiet, NOW);
    expect(quietResult).toBeNull(); // adult, first check → allowed
  });
});
