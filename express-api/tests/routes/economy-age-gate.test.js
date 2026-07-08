'use strict';

/**
 * SHY-0060 — POST /api/economy/gacha + /gift age gate, REAL-services test.
 *
 * No mocks: the REAL auth middleware verifies a REAL Auth-emulator ID token,
 * the spender's REAL users doc carries the age fields, and the operator flag is
 * a REAL config doc. The age gate sits BEFORE the coins check, so an under-age
 * caller with the flag ON gets 403; the same caller with the flag OFF (and no
 * coins) falls through to 402 — a clean "passed the gate" signal that needs no
 * gift/economy-config seeding.
 *
 * NODE_ENV='local' before the firebase require (Admin SDK + Auth emulator →
 * localhost). Flag lives on an isolated doc so this file doesn't race the other
 * flag-toggling suites on the single production config/safety under 2 workers.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const {
  __resetAgeGatingFlagCache,
  __setSafetyConfigDocForTests,
} = require('../../src/safety/age-gating-flag');
const economyRouter = require('../../src/routes/economy');

const SAFETY_DOC = 'config/safety-test-economy';
// Age is computed at the endpoint with the real Date.now(), so seed DOBs
// relative to today. Jan-1 birthdays are safely past for any month.
const dobForAge = (years) => Date.UTC(new Date().getUTCFullYear() - years, 0, 1);
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', economyRouter);
  return app;
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
  clearAuthCaches();
  await db.doc(SAFETY_DOC).delete();
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
});

describe('POST /api/economy/gacha — GACHA_SPEND (18) age gate', () => {
  test('flag OFF: an under-18 verified spender is NOT age-blocked (falls through to the coins check)', async () => {
    await setFlag(false);
    const user = await mintRealUser({
      uniqueId: 62000001,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(15) }, // no coins
    });

    const res = await request(createApp())
      .post('/api/economy/gacha')
      .set(user.headers)
      .send({ pullCount: 1 });

    // Past the age gate → stopped by coins, not age.
    expect(res.status).toBe(402);
    expect(res.body.errorId).toBeUndefined();
  });

  test('flag ON: an under-18 verified spender is blocked (403 AGE_GATE_BLOCKED)', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 62000002,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(17) },
    });

    const res = await request(createApp())
      .post('/api/economy/gacha')
      .set(user.headers)
      .send({ pullCount: 1 })
      .expect(403);

    expect(res.body.errorId).toBe('AGE_GATE_BLOCKED');
    expect(res.body.ageGate).toMatchObject({
      feature: 'GACHA_SPEND',
      verdict: 'BlockedUnderAge',
      threshold: 18,
      requiredVerification: 'NONE',
    });
  });

  test('flag ON: a verified adult passes the age gate (falls through to the coins check)', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 62000003,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(30) },
    });

    const res = await request(createApp())
      .post('/api/economy/gacha')
      .set(user.headers)
      .send({ pullCount: 1 });

    expect(res.status).toBe(402); // adult clears the gate → insufficient coins
  });

  test('flag ON: an unverified spender is blocked with REVERIFY', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 62000004,
      extraUserData: { ageVerified: false, dateOfBirth: dobForAge(30) },
    });

    const res = await request(createApp())
      .post('/api/economy/gacha')
      .set(user.headers)
      .send({ pullCount: 1 })
      .expect(403);

    expect(res.body.ageGate.requiredVerification).toBe('REVERIFY');
  });
});
