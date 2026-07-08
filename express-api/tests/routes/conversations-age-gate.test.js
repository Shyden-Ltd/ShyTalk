'use strict';

/**
 * SHY-0060 — POST /api/conversations/:id/messages DM age gate, REAL services.
 *
 * A 1:1 DM with a mutually-followed user is 13+ (bidirectional consent); with
 * anyone else it is 18+ (the stranger predator-vector). Mutual-follow is read
 * from the SENDER doc alone (followingIds ∩ followerIds). Group conversations
 * are out of scope. No mocks: real Auth-emulator token, real conversation +
 * user docs, real flag doc.
 *
 * Age-gate outcomes are asserted via `errorId`, so these tests don't depend on
 * the downstream cross-cohort gate or message write succeeding — a non-age
 * response simply carries no AGE_GATE_BLOCKED errorId.
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
const conversationsRouter = require('../../src/routes/conversations');

const SAFETY_DOC = 'config/safety-test-conversations';
const RECIPIENT = 63000099;
const dobForAge = (years) => Date.UTC(new Date().getUTCFullYear() - years, 0, 1);
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', conversationsRouter);
  return app;
}

async function seedConversation(convId, senderId, { isGroup = false } = {}) {
  // Production shape: participantIds are STRINGS (firestore.rules requires
  // `string(callerUniqueId()) in participantIds`; the app + the existing
  // routes in this file store/compare them as strings). followingIds stay
  // NUMBERS (how the follow route writes them) — the gate must bridge both.
  await db.doc(`conversations/${convId}`).set({
    participantIds: [String(senderId), String(RECIPIENT)],
    isGroup,
  });
}

function sendMessage(convId, headers) {
  return request(createApp())
    .post(`/api/conversations/${convId}/messages`)
    .set(headers)
    .send({ text: 'hi', type: 'TEXT' });
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

describe('DM age gate — stranger (18+)', () => {
  test('flag ON: an under-18 sender DMing a non-followed user is blocked (403, STRANGER, 18)', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000010,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(15),
        followingIds: [],
        followerIds: [],
      },
    });
    await seedConversation('dm-stranger-1', 63000010);

    const res = await sendMessage('dm-stranger-1', sender.headers).expect(403);

    expect(res.body.errorId).toBe('AGE_GATE_BLOCKED');
    expect(res.body.ageGate).toMatchObject({
      feature: 'DIRECT_MESSAGE_WITH_STRANGER',
      verdict: 'BlockedUnderAge',
      threshold: 18,
    });
  });

  test('flag ON: a verified adult DMing a stranger is NOT age-blocked', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000011,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(30),
        followingIds: [],
        followerIds: [],
      },
    });
    await seedConversation('dm-stranger-2', 63000011);

    const res = await sendMessage('dm-stranger-2', sender.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag ON: an unverified sender DMing a stranger is blocked with REVERIFY', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000012,
      extraUserData: { ageVerified: false, dateOfBirth: dobForAge(30) },
    });
    await seedConversation('dm-stranger-3', 63000012);

    const res = await sendMessage('dm-stranger-3', sender.headers).expect(403);
    expect(res.body.ageGate).toMatchObject({
      feature: 'DIRECT_MESSAGE_WITH_STRANGER',
      requiredVerification: 'REVERIFY',
    });
  });
});

describe('DM age gate — mutually-followed (13+)', () => {
  test('flag ON: a 14-year-old DMing a mutually-followed user is allowed (13+ tier)', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000020,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(14),
        followingIds: [RECIPIENT],
        followerIds: [RECIPIENT],
      },
    });
    await seedConversation('dm-followed-1', 63000020);

    const res = await sendMessage('dm-followed-1', sender.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag ON: a 12-year-old is blocked even from a followed DM (13 floor, FOLLOWED)', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000021,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(12),
        followingIds: [RECIPIENT],
        followerIds: [RECIPIENT],
      },
    });
    await seedConversation('dm-followed-2', 63000021);

    const res = await sendMessage('dm-followed-2', sender.headers).expect(403);
    expect(res.body.ageGate).toMatchObject({
      feature: 'DIRECT_MESSAGE_WITH_FOLLOWED_USER',
      threshold: 13,
    });
  });

  test('flag ON: a one-directional follow (not mutual) is still a STRANGER DM', async () => {
    // Sender follows the recipient but the recipient does NOT follow back.
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000022,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(15),
        followingIds: [RECIPIENT],
        followerIds: [], // recipient does not follow back → not mutual
      },
    });
    await seedConversation('dm-followed-3', 63000022);

    const res = await sendMessage('dm-followed-3', sender.headers).expect(403);
    expect(res.body.ageGate.feature).toBe('DIRECT_MESSAGE_WITH_STRANGER');
  });
});

describe('DM age gate — exemptions', () => {
  test('flag OFF: an under-18 stranger DM is NOT age-blocked', async () => {
    await setFlag(false);
    const sender = await mintRealUser({
      uniqueId: 63000030,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(15),
        followingIds: [],
        followerIds: [],
      },
    });
    await seedConversation('dm-off-1', 63000030);

    const res = await sendMessage('dm-off-1', sender.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });

  test('flag ON: a GROUP conversation is exempt (under-18 not blocked)', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000031,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(15),
        followingIds: [],
        followerIds: [],
      },
    });
    await seedConversation('dm-group-1', 63000031, { isGroup: true });

    const res = await sendMessage('dm-group-1', sender.headers);
    expect(res.body.errorId).not.toBe('AGE_GATE_BLOCKED');
  });
});

// Legacy conversations may store participantIds as NUMBERS. The gate's id
// coercion must fire for those too — proving the fix isn't merely swapped from
// "only Numbers work" to "only Strings work".
describe('POST messages — DM gate is robust to Number-typed participantIds (legacy)', () => {
  test('flag ON: a 15-year-old messaging a stranger in a Number-id conversation is blocked', async () => {
    await setFlag(true);
    const sender = await mintRealUser({
      uniqueId: 63000040,
      extraUserData: {
        ageVerified: true,
        dateOfBirth: dobForAge(15),
        followingIds: [],
        followerIds: [],
      },
    });
    await db.doc('conversations/dm-numeric-1').set({
      participantIds: [63000040, RECIPIENT], // Numbers, not Strings
      isGroup: false,
    });

    const res = await sendMessage('dm-numeric-1', sender.headers).expect(403);
    expect(res.body.errorId).toBe('AGE_GATE_BLOCKED');
    expect(res.body.ageGate).toMatchObject({
      feature: 'DIRECT_MESSAGE_WITH_STRANGER',
      threshold: 18,
    });
  });
});
