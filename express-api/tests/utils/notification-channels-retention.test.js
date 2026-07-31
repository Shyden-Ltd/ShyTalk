/**
 * notification-channels-retention.test.js — SHY-0258
 *
 * `notification-retention.test.js` proves the POLICY (what counts as a
 * duplicate, what gets reaped). This file proves the policy is actually
 * APPLIED on the path a notification really travels — `dispatchNotificationInline`,
 * the single writer of the in-app inbox.
 *
 * The distinction matters: a correct policy module that nothing calls is
 * exactly the shape of the SHY-0246 defect in this same file, where the in-app
 * channel was documented, believed to work, and never implemented. Testing the
 * module alone would reproduce that mistake with better test coverage.
 *
 * Real Firestore emulator throughout — the assertions are about what rows
 * survive in the collection, which nothing but the real store can answer.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { dispatchNotificationInline } = require('../../src/utils/notification-channels');

const RUN = `shy258d-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
let uidSeq = 0;
const touchedUids = [];

function nextUid() {
  uidSeq += 1;
  const uid = `${RUN}-u${uidSeq}`;
  touchedUids.push(uid);
  return uid;
}

/** Only the in-app channel — no SMTP, no FCM, no system PM in this suite. */
function inAppOnly(uid, overrides = {}) {
  return {
    uid,
    type: 'roadmap_update',
    title: 'Roadmap Update',
    body: 'something changed',
    relatedId: 'sugg-1',
    channels: { inApp: true, email: false, push: false, systemMessage: false },
    email: null,
    pushToken: null,
    ...overrides,
  };
}

async function rowsFor(uid) {
  const snap = await db.collection('notifications').where('uid', '==', uid).get();
  return snap.docs.map((d) => d.data());
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  await Promise.all(
    touchedUids.map(async (uid) => {
      const snap = await db.collection('notifications').where('uid', '==', uid).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }),
  );
  touchedUids.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('dispatch writes the inbox row', () => {
  test('a first notification is stored and reported sent', async () => {
    const uid = nextUid();
    const result = await dispatchNotificationInline(inAppOnly(uid));

    expect(result.inApp).toBe('sent');
    const rows = await rowsFor(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('roadmap_update');
    expect(rows[0].isRead).toBe(false);
    // Persisted so dedup is an equality query rather than a recomputed scan.
    expect(typeof rows[0].dedupeKey).toBe('string');
    expect(rows[0].dedupeKey.length).toBeGreaterThan(0);
  });
});

describe('the same event fired twice', () => {
  test('produces exactly one stored notification', async () => {
    const uid = nextUid();
    const first = await dispatchNotificationInline(inAppOnly(uid));
    const second = await dispatchNotificationInline(inAppOnly(uid));

    expect(first.inApp).toBe('sent');
    expect(second.inApp).toBe('deduplicated');
    expect(await rowsFor(uid)).toHaveLength(1);
  });

  test('reports the suppression rather than claiming a send', async () => {
    // A deduplicated dispatch that reported 'sent' would make the inbox count
    // and the dispatch log disagree, and the disagreement would be invisible.
    const uid = nextUid();
    await dispatchNotificationInline(inAppOnly(uid));
    const result = await dispatchNotificationInline(inAppOnly(uid));

    expect(result.inApp).toBe('deduplicated');
    expect(result.inApp).not.toBe('sent');
  });
});

describe('genuinely different events are both delivered', () => {
  test('an approval followed by a reversal yields two notifications', async () => {
    const uid = nextUid();
    await dispatchNotificationInline(inAppOnly(uid, { type: 'suggestion_accepted' }));
    await dispatchNotificationInline(inAppOnly(uid, { type: 'suggestion_rejected' }));

    const types = (await rowsFor(uid)).map((r) => r.type).sort();
    expect(types).toEqual(['suggestion_accepted', 'suggestion_rejected']);
  });

  test('updates about two different suggestions are both delivered', async () => {
    const uid = nextUid();
    await dispatchNotificationInline(inAppOnly(uid, { relatedId: 'sugg-1' }));
    await dispatchNotificationInline(inAppOnly(uid, { relatedId: 'sugg-2' }));

    expect(await rowsFor(uid)).toHaveLength(2);
  });

  test('a fan-out of one event to many people delivers to each of them', async () => {
    // The subscriber fan-out dispatches the same event to every subscriber. If
    // dedup keyed on the event alone, exactly one person would be notified and
    // the rest would be silently dropped — a bug that would look like
    // "notifications work" to whoever happened to be first.
    const alice = nextUid();
    const bob = nextUid();
    await dispatchNotificationInline(inAppOnly(alice));
    await dispatchNotificationInline(inAppOnly(bob));

    expect(await rowsFor(alice)).toHaveLength(1);
    expect(await rowsFor(bob)).toHaveLength(1);
  });
});

describe('retention is applied by the dispatch that makes it necessary', () => {
  test('an expired notification is reaped when the next one arrives', async () => {
    // No cron: the reap rides along with the write. Seeded directly at an age
    // beyond the TTL, then a real dispatch is what triggers the cleanup.
    const uid = nextUid();
    const { NOTIFICATION_TTL_MS } = require('../../src/utils/notification-retention');
    await db.collection('notifications').add({
      uid,
      userId: uid,
      recipientUid: uid,
      type: 'ancient_type',
      title: 'ancient',
      isRead: false,
      createdAt: Date.now() - (NOTIFICATION_TTL_MS + 60_000),
    });

    await dispatchNotificationInline(inAppOnly(uid));

    const titles = (await rowsFor(uid)).map((r) => r.title);
    expect(titles).not.toContain('ancient');
    expect(titles).toHaveLength(1);
  });

  test('a delivery still succeeds even though housekeeping ran', async () => {
    // Retention runs AFTER the result is recorded, so a tidy-up problem can
    // never downgrade a notification the user is entitled to.
    const uid = nextUid();
    const result = await dispatchNotificationInline(inAppOnly(uid));
    expect(result.inApp).toBe('sent');
    expect(await rowsFor(uid)).toHaveLength(1);
  });
});

describe('channels that were not requested', () => {
  test('no inbox row is written when the in-app channel is off', async () => {
    const uid = nextUid();
    const result = await dispatchNotificationInline(
      inAppOnly(uid, {
        channels: { inApp: false, email: false, push: false, systemMessage: false },
      }),
    );

    expect(result.inApp).toBeNull();
    expect(await rowsFor(uid)).toHaveLength(0);
  });
});
