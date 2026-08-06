'use strict';

// SHY-0060 — integration test for the central age-gate enforcement helper.
// Touches Firestore (reads the config/safety flag), so it runs against the
// REAL emulator per the no-stubs rule. NODE_ENV must be 'local' before the
// firebase require.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { checkFeatureAccess } = require('../../src/safety/enforce');
const {
  __resetAgeGatingFlagCache,
  __setSafetyConfigDocForTests,
} = require('../../src/safety/age-gating-flag');

// Isolated flag doc — this file toggles the flag, so it must NOT share the
// production `config/safety` doc with age-gating-flag.test.js under parallel
// Jest workers (they share one emulator). Plain kebab id — Firestore reserves
// the `__*__` name pattern, so no leading/trailing double underscores.
const SAFETY_DOC = 'config/safety-test-enforce';
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const verified = (years, extra = {}) => ({
  ageVerified: true,
  dateOfBirth: dobForAge(years),
  ...extra,
});

const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

beforeAll(async () => {
  await assertEmulatorReachable();
  __setSafetyConfigDocForTests(SAFETY_DOC);
});
afterAll(() => {
  __setSafetyConfigDocForTests();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});
beforeEach(async () => {
  __resetAgeGatingFlagCache();
  await db.doc(SAFETY_DOC).delete();
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
});

describe('checkFeatureAccess — flag OFF means NO enforcement', () => {
  test('an under-age user is allowed through when the flag is absent (default OFF)', async () => {
    // config/safety deleted in beforeEach → default OFF.
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', verified(12), NOW);
    expect(block).toBeNull();
  });

  test('an under-age user is allowed through when the flag is explicitly false', async () => {
    await setFlag(false);
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', verified(12), NOW);
    expect(block).toBeNull();
  });
});

describe('checkFeatureAccess — flag ON, allowed verdicts pass', () => {
  test('a verified adult is allowed through', async () => {
    await setFlag(true);
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', verified(30), NOW);
    expect(block).toBeNull();
  });
});

describe('checkFeatureAccess — flag ON, blocked verdicts return a 403', () => {
  test('a plain under-age block returns a structured 403 (no user-facing code copy)', async () => {
    await setFlag(true);
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', verified(14), NOW);
    expect(block).toEqual({
      status: 403,
      body: {
        error: 'This feature is not available for your account.',
        errorId: 'AGE_GATE_BLOCKED',
        ageGate: {
          feature: 'DIRECT_MESSAGE_WITH_STRANGER',
          verdict: 'BlockedUnderAge',
          threshold: 18,
          requiredVerification: 'NONE',
        },
      },
    });
  });

  test('an unverified user is blocked with a REVERIFY requirement', async () => {
    await setFlag(true);
    const user = { ageVerified: false, dateOfBirth: dobForAge(40) };
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', user, NOW);
    expect(block.status).toBe(403);
    expect(block.body.ageGate.requiredVerification).toBe('REVERIFY');
    expect(block.body.ageGate.verdict).toBe('BlockedUnderAge');
  });

  test('a region block reports the elevated threshold and null verification', async () => {
    await setFlag(true);
    const block = await checkFeatureAccess(db, 'SIGNUP', verified(15, { nationality: 'DE' }), NOW);
    expect(block.status).toBe(403);
    expect(block.body.ageGate).toEqual({
      feature: 'SIGNUP',
      verdict: 'BlockedRegion',
      threshold: 16,
      requiredVerification: null,
    });
  });

  test('a gacha-spend block for a 17-year-old', async () => {
    await setFlag(true);
    const block = await checkFeatureAccess(db, 'GACHA_SPEND', verified(17), NOW);
    expect(block.status).toBe(403);
    expect(block.body.ageGate.threshold).toBe(18);
    expect(block.body.ageGate.feature).toBe('GACHA_SPEND');
  });
});

describe('checkFeatureAccess — lazy userData loader (zero cost when flag OFF)', () => {
  test('the loader is NOT invoked when the flag is OFF (no extra user-doc read)', async () => {
    // Flag deleted in beforeEach → OFF. An endpoint that only loads the user
    // doc for the gate can pass a loader; it must not fire when gating is off.
    let calls = 0;
    const loadUser = async () => {
      calls += 1;
      return verified(12);
    };
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', loadUser, NOW);
    expect(block).toBeNull();
    expect(calls).toBe(0);
  });

  test('the loader IS invoked and its result evaluated when the flag is ON', async () => {
    await setFlag(true);
    let calls = 0;
    const loadUser = async () => {
      calls += 1;
      return verified(14);
    };
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', loadUser, NOW);
    expect(calls).toBe(1);
    expect(block.status).toBe(403);
    expect(block.body.ageGate.verdict).toBe('BlockedUnderAge');
  });

  test('a loader returning an allowed user yields null (no block)', async () => {
    await setFlag(true);
    const loadUser = async () => verified(30);
    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', loadUser, NOW);
    expect(block).toBeNull();
  });
});
