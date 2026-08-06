'use strict';

// SHY-0060 — the tamper orchestrator, REAL services: checkAgeClaimTamper reads
// the real flag doc, derives the server age from the DOB, and on tamper fires a
// REAL alertManager alert (written to the `alerts` collection) + returns a 403.
// No mocks — the alert is asserted by reading the row it writes.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { checkAgeClaimTamper } = require('../../src/safety/tamper-check');
const {
  __resetAgeGatingFlagCache,
  __setSafetyConfigDocForTests,
} = require('../../src/safety/age-gating-flag');

const SAFETY_DOC = 'config/safety-test-tamper';
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

// The alert write is awaited inside checkAgeClaimTamper, so a single read (no
// poll) is deterministic. `alerts` is shared: filter to this test's id.
async function tamperAlertsFor(userId) {
  const snap = await db.collection('alerts').where('type', '==', 'AGE_CLAIM_TAMPER').get();
  return snap.docs.map((d) => d.data()).filter((a) => a.context?.userId === userId);
}
const FILE_IDS = [66000001, 66000002, 66000003, 66000004, 66000005, 66000006, 66000007];
async function clearTamperAlertsFor(userId) {
  const snap = await db.collection('alerts').where('type', '==', 'AGE_CLAIM_TAMPER').get();
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
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearTamperAlertsFor(id);
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearTamperAlertsFor(id);
});

describe('checkAgeClaimTamper — flag ON, a material lie', () => {
  test('the BDD143 case (claimed 19, record 15) 403s and fires a critical alert', async () => {
    await setFlag(true);
    const userData = { uniqueId: 66000001, ageVerified: true, dateOfBirth: dobForAge(15) };

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 19,
      userDataOrLoader: userData,
      nowMs: NOW,
    });

    expect(block).toEqual({
      status: 403,
      body: { error: 'Age verification failed.', errorId: 'AGE_CLAIM_TAMPER' },
    });
    const alerts = await tamperAlertsFor(66000001);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].context).toMatchObject({ userId: 66000001, claimedAge: 19, serverAge: 15 });
  });

  test('the lazy-loader form is supported (tamper 403 + alert)', async () => {
    await setFlag(true);
    const load = async () => ({
      uniqueId: 66000002,
      ageVerified: true,
      dateOfBirth: dobForAge(14),
    });

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 20,
      userDataOrLoader: load,
      nowMs: NOW,
    });

    expect(block.status).toBe(403);
    const alerts = await tamperAlertsFor(66000002);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].context).toMatchObject({ claimedAge: 20, serverAge: 14 });
  });
});

describe('checkAgeClaimTamper — no block, no alert', () => {
  test('a claim within tolerance neither blocks nor alerts', async () => {
    await setFlag(true);
    const userData = { uniqueId: 66000003, ageVerified: true, dateOfBirth: dobForAge(15) };

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 16,
      userDataOrLoader: userData,
      nowMs: NOW,
    });

    expect(block).toBeNull();
    expect(await tamperAlertsFor(66000003)).toHaveLength(0);
  });

  test('an exact-match claim neither blocks nor alerts', async () => {
    await setFlag(true);
    const userData = { uniqueId: 66000004, ageVerified: true, dateOfBirth: dobForAge(15) };

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 15,
      userDataOrLoader: userData,
      nowMs: NOW,
    });

    expect(block).toBeNull();
    expect(await tamperAlertsFor(66000004)).toHaveLength(0);
  });

  test('no claimedAge means nothing to check', async () => {
    await setFlag(true);
    const userData = { uniqueId: 66000005, ageVerified: true, dateOfBirth: dobForAge(15) };

    const block = await checkAgeClaimTamper(db, { userDataOrLoader: userData, nowMs: NOW });

    expect(block).toBeNull();
    expect(await tamperAlertsFor(66000005)).toHaveLength(0);
  });

  test('flag OFF: even a gross lie is neither blocked nor alerted', async () => {
    await setFlag(false);
    const userData = { uniqueId: 66000006, ageVerified: true, dateOfBirth: dobForAge(15) };

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 40,
      userDataOrLoader: userData,
      nowMs: NOW,
    });

    expect(block).toBeNull();
    expect(await tamperAlertsFor(66000006)).toHaveLength(0);
  });

  test('no DOB on record: nothing to compare, no block', async () => {
    await setFlag(true);
    const userData = { uniqueId: 66000007, ageVerified: true };

    const block = await checkAgeClaimTamper(db, {
      claimedAge: 19,
      userDataOrLoader: userData,
      nowMs: NOW,
    });

    expect(block).toBeNull();
    expect(await tamperAlertsFor(66000007)).toHaveLength(0);
  });
});
