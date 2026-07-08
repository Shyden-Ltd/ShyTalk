'use strict';

/**
 * SHY-0060 — voice seat-claim / accept-invite age gate, REAL services.
 *
 * Taking a mic seat = active speaking → 16+ (voice moderation is harder than
 * text). The gate fires before the room mutation, so an under-16 caller is
 * blocked regardless of room state. No mocks: real Auth-emulator token, real
 * user doc, real flag doc. Pass-through is asserted via `errorId` so the tests
 * don't depend on a fully-seeded room.
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
const roomMutationsRouter = require('../../src/routes/room-mutations');

const SAFETY_DOC = 'config/safety-test-room';
const dobForAge = (years) => Date.UTC(new Date().getUTCFullYear() - years, 0, 1);
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', roomMutationsRouter);
  return app;
}

const claim = (headers) =>
  request(createApp()).post('/api/rooms/room-1/seats/1/claim').set(headers).send({});
const acceptInvite = (headers) =>
  request(createApp()).post('/api/rooms/room-1/seats/1/accept-invite').set(headers).send({});

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

describe('seat claim — VOICE_ROOM_ACTIVE_SPEAKING (16) age gate', () => {
  test('flag ON: an under-16 caller is blocked (403, VOICE_ROOM_ACTIVE_SPEAKING, 16)', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 64000001,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(15) },
    });

    const res = await claim(user.headers).expect(403);
    expect(res.body.errorId).toBe('AGE_GATE_BLOCKED');
    expect(res.body.ageGate).toMatchObject({
      feature: 'VOICE_ROOM_ACTIVE_SPEAKING',
      verdict: 'BlockedUnderAge',
      threshold: 16,
    });
  });

  test('flag ON: a 16-year-old caller is NOT age-blocked', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 64000002,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(16) },
    });

    const res = await claim(user.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag ON: a verified adult is NOT age-blocked', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 64000003,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(30) },
    });

    const res = await claim(user.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag OFF: an under-16 caller is NOT age-blocked', async () => {
    await setFlag(false);
    const user = await mintRealUser({
      uniqueId: 64000004,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(15) },
    });

    const res = await claim(user.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag ON: an unverified caller is blocked with REVERIFY', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 64000005,
      extraUserData: { ageVerified: false, dateOfBirth: dobForAge(30) },
    });

    const res = await claim(user.headers).expect(403);
    expect(res.body.ageGate).toMatchObject({
      feature: 'VOICE_ROOM_ACTIVE_SPEAKING',
      requiredVerification: 'REVERIFY',
    });
  });
});

describe('accept-invite — VOICE_ROOM_ACTIVE_SPEAKING (16) age gate', () => {
  test('flag ON: an under-16 caller accepting a seat invite is blocked (403, 16)', async () => {
    await setFlag(true);
    const user = await mintRealUser({
      uniqueId: 64000006,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(15) },
    });

    const res = await acceptInvite(user.headers).expect(403);
    expect(res.body.ageGate).toMatchObject({
      feature: 'VOICE_ROOM_ACTIVE_SPEAKING',
      threshold: 16,
    });
  });

  test('flag OFF: an under-16 caller accepting a seat invite is NOT age-blocked', async () => {
    await setFlag(false);
    const user = await mintRealUser({
      uniqueId: 64000007,
      extraUserData: { ageVerified: true, dateOfBirth: dobForAge(15) },
    });

    const res = await acceptInvite(user.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });
});
