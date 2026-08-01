/**
 * SHY-0266 — a gift notifies its recipient.
 *
 * j05 has asserted this since it was written:
 *
 *   Then the tester sees an FCM push notification on Selma's Android device
 *        with body containing "Alice" and "crown"
 *
 * `economy.js` contained NO push dispatch of any kind — not one call to
 * `sendFcmToTokens` in 2000 lines — so the step failed every run and the failure
 * pointed at the device.
 *
 * Gifting is the revenue path. A gift the recipient never notices is a purchase
 * whose entire value to the sender — being seen — evaporates silently.
 *
 * Real Firestore emulator. FCM is captured through the driver's own local-mode
 * buffer (`getFcmCaptures`), which is the product's real dispatch path with its
 * transport stubbed at the edge — not a mock of our own code.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const economyRouter = require('../../src/routes/economy');
const { getFcmCaptures, clearFcmCaptures } = require('../../src/utils/fcm');

const P = 'gn266';
let app;

async function seedGift(giftId = 'crown', coinValue = 500) {
  // `coinValue` is the field the route reads (economy.js), not `price`.
  await db.doc(`gifts/${giftId}`).set({ giftId, name: 'crown', coinValue, isActive: true });
}

async function seedRecipient({ key, tokens = ['tok-1'], blocked = [] }) {
  const uniqueId = `${P}-${key}`;
  await db.doc(`users/${uniqueId}`).set({
    uniqueId,
    displayName: 'Selma',
    cohort: 'adult',
    shyCoins: 0,
    fcmTokens: tokens,
    blockedUserIds: blocked,
  });
  return uniqueId;
}

beforeAll(async () => {
  await assertEmulatorReachable();
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', economyRouter);
  await seedGift();
}, 60000);

afterAll(async () => {
  await clearPrefixed(db, 'users', P);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearFcmCaptures();
  await clearPrefixed(db, 'users', P);
});

/**
 * A sender with coins.
 *
 * Exercised through `/economy/gift-direct` rather than `/economy/gift`.
 * The latter transfers an item out of the sender's BACKPACK, and
 * `tests/cron/backpackCleanup.test.js` legitimately wipes that whole collection
 * group in its beforeEach — the cron it tests is global, so it cannot scope the
 * wipe to a prefix. Seeding a backpack item here would therefore be deleted by a
 * concurrent worker mid-test. The isolation guard caught exactly that.
 *
 * Both routes dispatch the same notification, so the coin path covers it without
 * sharing a collection another suite must clear.
 */
async function sender(coins = 5000) {
  return mintRealUser({
    uniqueId: `${P}-alice`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', shyCoins: coins, displayName: 'Alice' },
  });
}

describe('the recipient is told', () => {
  test('a gift dispatches a GIFT push naming the sender and the gift', async () => {
    const alice = await sender();
    const selma = await seedRecipient({ key: 'selma' });

    const res = await request(app)
      .post('/api/economy/gift-direct')
      .set('Authorization', `Bearer ${alice.idToken}`)
      .send({ recipientId: selma, giftId: 'crown', quantity: 1 });

    expect(res.status).toBe(200);
    const captures = getFcmCaptures();
    const gift = captures.find((c) => c.data.type === 'GIFT');
    expect(gift).toBeTruthy();
    // Both names, because "you received a gift" does not make the gesture land.
    expect(gift.data.senderName).toBe('Alice');
    expect(gift.data.giftName).toBe('crown');
    expect(gift.tokens).toContain('tok-1');
  });

  test('a recipient with no tokens is a no-op, not an error', async () => {
    const alice = await sender();
    const selma = await seedRecipient({ key: 'notokens', tokens: [] });

    const res = await request(app)
      .post('/api/economy/gift-direct')
      .set('Authorization', `Bearer ${alice.idToken}`)
      .send({ recipientId: selma, giftId: 'crown', quantity: 1 });

    expect(res.status).toBe(200);
    expect(getFcmCaptures().filter((c) => c.data.type === 'GIFT')).toHaveLength(0);
  });
});

describe('a notification is not a delivery channel', () => {
  test('a blocked sender does not reach the recipient', async () => {
    // A block that still lets a gift notification through turns gifting into a
    // way to contact someone who has refused contact.
    const alice = await sender();
    const selma = await seedRecipient({ key: 'blocked', blocked: [`${P}-alice`] });

    await request(app)
      .post('/api/economy/gift-direct')
      .set('Authorization', `Bearer ${alice.idToken}`)
      .send({ recipientId: selma, giftId: 'crown', quantity: 1 });

    expect(getFcmCaptures().filter((c) => c.data.type === 'GIFT')).toHaveLength(0);
  });

  test('the payload carries no balances — only who sent what', async () => {
    const alice = await sender();
    const selma = await seedRecipient({ key: 'privacy' });

    await request(app)
      .post('/api/economy/gift-direct')
      .set('Authorization', `Bearer ${alice.idToken}`)
      .send({ recipientId: selma, giftId: 'crown', quantity: 1 });

    const gift = getFcmCaptures().find((c) => c.data.type === 'GIFT');
    const keys = Object.keys(gift.data);
    for (const leaky of ['shyCoins', 'balance', 'balanceAfter', 'beans', 'shyBeans']) {
      expect(keys).not.toContain(leaky);
    }
  });
});

describe('the gift survives the notification failing', () => {
  test('a push failure never costs the gift', async () => {
    // The coins have moved and the transaction is written. A notification is a
    // courtesy; losing a paid-for gift because a courtesy failed would be a far
    // worse bug than a missed banner.
    const fcm = require('../../src/utils/fcm');
    const original = fcm.sendFcmToTokens;
    fcm.sendFcmToTokens = async () => {
      throw new Error('FCM unavailable');
    };
    try {
      const alice = await sender();
      const selma = await seedRecipient({ key: 'pushfail' });

      const res = await request(app)
        .post('/api/economy/gift-direct')
        .set('Authorization', `Bearer ${alice.idToken}`)
        .send({ recipientId: selma, giftId: 'crown', quantity: 1 });

      expect(res.status).toBe(200);
      const recipientDoc = await db.doc(`users/${selma}`).get();
      expect(recipientDoc.exists).toBe(true);
    } finally {
      fcm.sendFcmToTokens = original;
    }
  });
});
