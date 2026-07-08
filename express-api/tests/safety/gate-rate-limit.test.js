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

const SAFETY_DOC = 'config/safety-test-ratelimit';
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const adult = (uniqueId) => ({ uniqueId, ageVerified: true, dateOfBirth: dobForAge(30) });
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

async function enumerationAlertsFor(userId) {
  const snap = await db.collection('alerts').where('type', '==', 'AGE_GATE_ENUMERATION').get();
  return snap.docs.map((d) => d.data()).filter((a) => a.context?.userId === userId);
}
const FILE_IDS = [67000001, 67000002, 67000003, 67000004];
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
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearEnumerationAlertsFor(id);
});

describe('checkFeatureAccess — gate-check rate limit (AC86)', () => {
  test('the check just past the budget returns 429 and fires one enumeration alert', async () => {
    await setFlag(true);
    const user = adult(67000001);

    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      const ok = await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
      expect(ok).toBeNull(); // adult → allowed, within budget
    }

    const limited = await checkFeatureAccess(db, 'GACHA_SPEND', user, NOW);
    expect(limited).toEqual({
      status: 429,
      body: {
        error: 'Too many requests, please try again later.',
        errorId: 'AGE_GATE_RATE_LIMITED',
      },
    });
    const alerts = await enumerationAlertsFor(67000001);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].context).toMatchObject({ userId: 67000001, count: MAX_PER_WINDOW + 1 });
  });

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
