/**
 * notification-retention.test.js — SHY-0258
 *
 * The inbox had no lifecycle: every dispatch appended a row, a repeated event
 * produced a repeated notification, and nothing was ever removed. The specs
 * for deduplication, the retention cap and the TTL existed only as `test.todo`
 * markers, so the gap was visible but unguarded.
 *
 * Runs against the REAL Firestore emulator. Retention is a question about what
 * a query returns after documents are deleted, which is exactly the kind of
 * claim an in-process double cannot settle: a fake collection would answer
 * whatever this file taught it to.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const {
  MAX_NOTIFICATIONS_PER_USER,
  NOTIFICATION_TTL_MS,
  DEDUP_WINDOW_MS,
  dedupeKeyFor,
  notificationTime,
  isDuplicateNotification,
  enforceRetention,
} = require('../../src/utils/notification-retention');

// Per-file, per-worker AND per-run so a leaked row can never become a later
// run's verdict.
const RUN = `shy258-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
let uidSeq = 0;
const touchedUids = [];

function nextUid() {
  uidSeq += 1;
  const uid = `${RUN}-u${uidSeq}`;
  touchedUids.push(uid);
  return uid;
}

async function seedNotification(uid, overrides = {}) {
  const base = {
    uid,
    userId: uid,
    recipientUid: uid,
    type: 'roadmap_update',
    title: 't',
    body: 'b',
    relatedId: null,
    isRead: false,
    createdAt: Date.now(),
  };
  const data = { ...base, ...overrides };
  data.dedupeKey = data.dedupeKey ?? dedupeKeyFor(data);
  const ref = await db.collection('notifications').add(data);
  return ref;
}

async function countFor(uid) {
  const snap = await db.collection('notifications').where('uid', '==', uid).get();
  return snap.size;
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

describe('what counts as the same event', () => {
  test('the key distinguishes recipient, type and subject', () => {
    const a = dedupeKeyFor({ uid: 'u1', type: 'roadmap_update', relatedId: 's1' });
    expect(dedupeKeyFor({ uid: 'u2', type: 'roadmap_update', relatedId: 's1' })).not.toBe(a);
    expect(dedupeKeyFor({ uid: 'u1', type: 'suggestion_merged', relatedId: 's1' })).not.toBe(a);
    expect(dedupeKeyFor({ uid: 'u1', type: 'roadmap_update', relatedId: 's2' })).not.toBe(a);
    expect(dedupeKeyFor({ uid: 'u1', type: 'roadmap_update', relatedId: 's1' })).toBe(a);
  });

  test('a missing subject does not collide with the literal string "null"', () => {
    // Both spellings arrive in practice (`relatedId: null` from the dispatcher,
    // absent from older rows), and they mean the same thing.
    expect(dedupeKeyFor({ uid: 'u1', type: 't', relatedId: null })).toBe(
      dedupeKeyFor({ uid: 'u1', type: 't' }),
    );
  });
});

describe('deduplication', () => {
  test('the same event fired twice produces one notification', async () => {
    const uid = nextUid();
    const notif = { uid, type: 'roadmap_update', relatedId: 'sugg-1' };
    const now = Date.now();

    expect(await isDuplicateNotification(db, notif, now)).toBe(false);
    await seedNotification(uid, { type: 'roadmap_update', relatedId: 'sugg-1', createdAt: now });
    expect(await isDuplicateNotification(db, notif, now + 1_000)).toBe(true);
  });

  test('the same event OUTSIDE the window is delivered again', async () => {
    // The window collapses a burst, it does not silence a topic forever.
    const uid = nextUid();
    const notif = { uid, type: 'roadmap_update', relatedId: 'sugg-1' };
    const now = Date.now();
    await seedNotification(uid, { type: 'roadmap_update', relatedId: 'sugg-1', createdAt: now });

    expect(await isDuplicateNotification(db, notif, now + DEDUP_WINDOW_MS + 1)).toBe(false);
  });

  test('two DIFFERENT events in the same instant are both delivered', async () => {
    // "Admin approves then immediately overturns" — same person, same
    // suggestion, one minute apart. Collapsing these would hide the reversal,
    // which is the more important of the two.
    const uid = nextUid();
    const now = Date.now();
    await seedNotification(uid, {
      type: 'suggestion_accepted',
      relatedId: 'sugg-1',
      createdAt: now,
    });

    const reversal = { uid, type: 'suggestion_rejected', relatedId: 'sugg-1' };
    expect(await isDuplicateNotification(db, reversal, now + 1_000)).toBe(false);
  });

  test('updates about two different suggestions are both delivered', async () => {
    const uid = nextUid();
    const now = Date.now();
    await seedNotification(uid, { type: 'roadmap_update', relatedId: 'sugg-1', createdAt: now });

    const other = { uid, type: 'roadmap_update', relatedId: 'sugg-2' };
    expect(await isDuplicateNotification(db, other, now + 1_000)).toBe(false);
  });

  test('one person’s notification never suppresses another’s', async () => {
    // The subscriber fan-out dispatches the SAME event to many people at once.
    // A dedup key that ignored the recipient would deliver to exactly one of
    // them and silently drop the rest.
    const alice = nextUid();
    const bob = nextUid();
    const now = Date.now();
    await seedNotification(alice, { type: 'roadmap_update', relatedId: 'sugg-1', createdAt: now });

    expect(
      await isDuplicateNotification(
        db,
        { uid: bob, type: 'roadmap_update', relatedId: 'sugg-1' },
        now,
      ),
    ).toBe(false);
  });
});

describe('the retention cap', () => {
  test('an inbox at the cap is left alone', async () => {
    const uid = nextUid();
    const now = Date.now();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedNotification(uid, { createdAt: now - i * 1000 })),
    );

    const summary = await enforceRetention(db, uid, now, { max: 5 });
    expect(summary.trimmed).toBe(0);
    expect(await countFor(uid)).toBe(5);
  });

  test('exceeding the cap removes the OLDEST, keeping the newest', async () => {
    const uid = nextUid();
    const now = Date.now();
    // Distinguishable ages so "which survived" is checkable, not just "how many".
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        seedNotification(uid, { createdAt: now - i * 1000, title: `n${i}` }),
      ),
    );

    const summary = await enforceRetention(db, uid, now, { max: 4 });
    expect(summary.trimmed).toBe(2);

    const snap = await db.collection('notifications').where('uid', '==', uid).get();
    const titles = snap.docs.map((d) => d.data().title).sort();
    expect(titles).toEqual(['n0', 'n1', 'n2', 'n3']); // the two oldest (n4, n5) are gone
  });

  test('the production cap is the documented 200', () => {
    // The tests above run at small caps for speed; this pins the real policy so
    // a change to it is a deliberate edit rather than a silent drift.
    expect(MAX_NOTIFICATIONS_PER_USER).toBe(200);
  });
});

describe('the TTL', () => {
  test('notifications older than the TTL are removed', async () => {
    const uid = nextUid();
    const now = Date.now();
    await seedNotification(uid, {
      createdAt: now - (NOTIFICATION_TTL_MS + 60_000),
      title: 'ancient',
    });
    await seedNotification(uid, { createdAt: now - 1000, title: 'recent' });

    const summary = await enforceRetention(db, uid, now);
    expect(summary.expired).toBe(1);

    const snap = await db.collection('notifications').where('uid', '==', uid).get();
    expect(snap.docs.map((d) => d.data().title)).toEqual(['recent']);
  });

  test('a notification just INSIDE the TTL survives', async () => {
    // Boundary in the surviving direction — an off-by-one here silently
    // deletes a day of somebody's inbox.
    const uid = nextUid();
    const now = Date.now();
    await seedNotification(uid, { createdAt: now - (NOTIFICATION_TTL_MS - 60_000) });

    const summary = await enforceRetention(db, uid, now);
    expect(summary.expired).toBe(0);
    expect(await countFor(uid)).toBe(1);
  });

  test('the production TTL is 90 days', () => {
    expect(NOTIFICATION_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  test('a row with NO timestamp is reaped rather than living forever', async () => {
    // `orderBy('createdAt')` would have hidden this row from the reaper
    // entirely (Firestore excludes documents missing the ordered field), making
    // undated legacy rows immortal AND miscounting the cap. Treating a missing
    // timestamp as "oldest" is what makes them reachable.
    const uid = nextUid();
    const now = Date.now();
    const ref = await db.collection('notifications').add({ uid, title: 'undated', isRead: false });
    touchedUids.push(uid);

    const summary = await enforceRetention(db, uid, now);
    expect(summary.expired).toBe(1);
    expect((await ref.get()).exists).toBe(false);
  });

  test('notificationTime treats missing and malformed timestamps as oldest', () => {
    expect(notificationTime({ createdAt: 123 })).toBe(123);
    expect(notificationTime({})).toBe(0);
    expect(notificationTime({ createdAt: 'yesterday' })).toBe(0);
    expect(notificationTime({ createdAt: NaN })).toBe(0);
    expect(notificationTime(null)).toBe(0);
  });
});

describe('retention touches the inbox and nothing else', () => {
  test('reaping a person’s notifications leaves their subscription preferences intact', async () => {
    // The inbox and the preferences that populate it are separate records, and
    // a reaper that confused them would silently unsubscribe people as a side
    // effect of tidying up — a data-loss bug that would look like "I stopped
    // getting emails" months later, with nothing connecting it to retention.
    const uid = nextUid();
    const now = Date.now();
    const subRef = db.collection('subscriptions').doc(uid);
    const prefs = {
      uid,
      roadmapUpdateOptedIn: true,
      channelPreferences: { roadmapUpdate: { email: true, inApp: true } },
    };
    await subRef.set(prefs);
    await seedNotification(uid, { createdAt: now - (NOTIFICATION_TTL_MS + 60_000) });

    const summary = await enforceRetention(db, uid, now);
    expect(summary.expired).toBe(1);

    const after = await subRef.get();
    expect(after.exists).toBe(true);
    expect(after.data()).toEqual(prefs);
    await subRef.delete();
  });
});

describe('retention is housekeeping, never a failure path', () => {
  test('an unknown recipient is a no-op, not an error', async () => {
    const summary = await enforceRetention(db, `${RUN}-nobody`, Date.now());
    expect(summary).toEqual({ expired: 0, trimmed: 0, remaining: 0 });
  });

  test('a missing uid is a no-op', async () => {
    expect(await enforceRetention(db, null, Date.now())).toEqual({
      expired: 0,
      trimmed: 0,
      remaining: 0,
    });
  });

  test('a dedup read failure delivers the notification rather than dropping it', async () => {
    // Fails OPEN by design: a duplicate is visible and self-correcting, a
    // silently withheld notification is neither. Induced with a db whose query
    // rejects — the real failure shape, not a stubbed return value.
    const brokenDb = {
      collection: () => ({
        where: () => ({
          where: () => ({
            limit: () => ({ get: () => Promise.reject(new Error('firestore down')) }),
          }),
        }),
      }),
    };
    await expect(
      isDuplicateNotification(brokenDb, { uid: 'u1', type: 't', relatedId: 'r' }, Date.now()),
    ).resolves.toBe(false);
  });

  test('a retention read failure does not throw at the caller', async () => {
    const brokenDb = {
      collection: () => ({
        where: () => ({
          limit: () => ({ get: () => Promise.reject(new Error('firestore down')) }),
        }),
      }),
    };
    await expect(enforceRetention(brokenDb, 'u1', Date.now())).resolves.toEqual({
      expired: 0,
      trimmed: 0,
      remaining: 0,
    });
  });
});
