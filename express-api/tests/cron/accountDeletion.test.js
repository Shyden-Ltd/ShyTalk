/**
 * accountDeletion.test.js — EPIC-0003 / SHY-0120 (cron → real local stack).
 *
 * MIGRATED off the firebase + auth + email + r2 + log Jest mocks (the prior 49
 * tests faked every collaborator and asserted call SHAPES — "deleteUser was
 * called", "putObject was called", "_path === 'reportsArchive/x'"). For a
 * GDPR hard-delete cron that erases a user across ~19 collections + Firebase
 * Auth + R2 + email, only the real round-trip is trustworthy: that the data is
 * actually GONE / anonymised in the live datastore, that the credential is
 * actually removed from Auth, that the final email actually lands.
 *
 * This suite drives the REAL cron against the full local stack (NODE_ENV=local):
 *   - Firestore emulator (every collection + collectionGroup cascade)
 *   - Firebase Auth emulator (auth.createUser → run → getUser throws user-not-found)
 *   - real MinIO (objects PUT under the user's R2 prefixes, gone after the run)
 *   - real Mailpit (the deletion-complete email is read back from the HTTP API)
 * Seeded with the exact field TYPES the cron queries on (numeric uniqueId for
 * array-contains / collectionGroup; string uniqueId for reports/receipts/etc).
 *
 * NOT covered (escape-hatch, EPIC-0003 — un-inducible against a healthy stack
 * without a mock):
 *   - the fresh-read cancellation guards in accountDeletion() (`!exists` /
 *     `!deletionExecuteAt` on re-read) — they fire only on a real concurrent
 *     mutation between the query and the per-user re-read; no in-process hook.
 *   - the per-step try/catch logging branches (email-send fail, R2 list fail,
 *     user-doc delete fail, Auth delete fail, each Step-6b substep fail) — they
 *     need a real failure injected mid-operation; the happy + selective paths
 *     ARE exercised, and loop-robustness is proven by the multi-user limit test.
 *
 * Isolation: clears every touched collection + collection-group, the user R2
 * prefixes, Mailpit, and all Auth-emulator accounts in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const crypto = require('node:crypto');
const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db, auth } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const { now } = require('../../src/utils/helpers');
const accountDeletion = require('../../src/cron/accountDeletion');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');

const UID = '1001'; // user document id (string)
const N = 1001; // numeric form used by array-contains / collectionGroup queries
const EMAIL = 'deluser@example.com';

const TOP_LEVEL = [
  'users',
  'conversations',
  'rooms',
  'giftRankings',
  'reports',
  'reportsArchive',
  'suspensionAppeals',
  'suggestions',
  'subscriptions',
  'notifications',
  'biometricKeys',
  'otpCodes',
  'emailMetrics',
  'purchaseReceipts',
  'identityMap',
  'deviceBindings',
  'deviceBans',
  'adminAuditLog',
  'config',
  'decoys',
];
const GROUPS = [
  'messages',
  'userSettings',
  'mutes',
  'seatRequests',
  'votes',
  'comments',
  'backpack',
  'giftWall',
  'transactions',
  'warnings',
  'stalkers',
];
const R2_PREFIXES = ['profiles/', 'covers/', 'messages/', 'groups/', 'evidence/'];

const docData = async (path) => (await db.doc(path).get()).data();
const docExists = async (path) => (await db.doc(path).get()).exists;
const r2Exists = async (key) => (await r2.listObjects(key)).includes(key);
const putObj = (key) => r2.putObject(key, Buffer.from('x'), 'image/jpeg');

const MAILPIT = 'http://localhost:8025/api/v1';
const clearMailpit = () => fetch(`${MAILPIT}/messages`, { method: 'DELETE' });
const mailpitMessages = async () =>
  (await (await fetch(`${MAILPIT}/messages`)).json()).messages || [];
const clearAuthUsers = () =>
  fetch('http://localhost:9099/emulator/v1/projects/demo-shytalk/accounts', { method: 'DELETE' });

async function clearR2() {
  for (const prefix of R2_PREFIXES) {
    const keys = await r2.listObjects(prefix);
    if (keys.length > 0) await r2.deleteObjects(keys);
  }
}

/** Seed users/UID and return its DocumentSnapshot (what hardDeleteAccount takes). */
async function seedUserDoc(fields = {}) {
  const data = { email: EMAIL, firebaseUid: 'fb-1001', ...fields };
  // The Admin SDK rejects `undefined` field values — an explicit `undefined`
  // override (e.g. { email: undefined }) means "seed the user without this field".
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  await db.doc(`users/${UID}`).set(data);
  return db.doc(`users/${UID}`).get();
}

beforeAll(async () => {
  await assertEmulatorReachable();
  try {
    await r2.s3.send(new CreateBucketCommand({ Bucket: r2.bucketName }));
  } catch (err) {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
      throw err;
    }
  }
});

beforeEach(async () => {
  for (const col of TOP_LEVEL) await clearCollection(db, col);
  for (const grp of GROUPS) await clearCollectionGroup(db, grp);
  await clearR2();
  await clearMailpit();
  await clearAuthUsers();
});

afterAll(async () => {
  for (const col of TOP_LEVEL) await clearCollection(db, col);
  for (const grp of GROUPS) await clearCollectionGroup(db, grp);
  await clearR2();
  await clearMailpit();
  await clearAuthUsers();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('accountDeletion main cron (real Firestore emulator)', () => {
  test('hard-deletes a user whose deletionExecuteAt is in the past, and writes an audit log', async () => {
    await db.doc(`users/${UID}`).set({
      email: EMAIL,
      firebaseUid: 'fb-1001',
      deletionExecuteAt: now() - 1000,
      deletionReason: 'user_request',
    });

    await accountDeletion();

    expect(await docExists(`users/${UID}`)).toBe(false);
    const audit = (await db.collection('adminAuditLog').get()).docs;
    expect(audit).toHaveLength(1);
    expect(audit[0].data().action).toBe('account_deleted');
  }, 30000);

  test('leaves not-yet-due (future) and deletionExecuteAt:0 users untouched (both query clauses)', async () => {
    await db.doc('users/future').set({ deletionExecuteAt: now() + 60 * 60 * 1000 });
    await db.doc('users/zero').set({ deletionExecuteAt: 0 });

    await accountDeletion();

    expect(await docExists('users/future')).toBe(true); // > now → not yet due
    expect(await docExists('users/zero')).toBe(true); // not > 0 → excluded
    expect((await db.collection('adminAuditLog').get()).size).toBe(0);
  }, 30000);

  test('caps processing at 10 accounts per run, leaving the overflow for the next tick', async () => {
    for (let i = 0; i < 11; i++) {
      await db
        .doc(`users/${2000 + i}`)
        .set({ deletionExecuteAt: now() - 1000, firebaseUid: `fb-${i}` });
    }

    await accountDeletion();

    expect((await db.collection('users').get()).size).toBe(1); // 10 deleted, 1 backlog
  }, 60000);

  test('no-ops when there are no pending deletions', async () => {
    await expect(accountDeletion()).resolves.toBeUndefined();
    expect((await db.collection('adminAuditLog').get()).size).toBe(0);
  }, 30000);

  test('schedules an inactive account for deletion when inactivity deletion is enabled', async () => {
    await db.doc('config/app').set({
      inactiveAccountDeleteMonths: 6,
      accountDeletionGracePeriodDays: 30,
    });
    const ts = now();
    await db.doc('users/inactive').set({
      lastActiveAt: ts - 7 * 30 * 86400000, // older than the 6-month cutoff
      deletionScheduledAt: null,
      isSuspended: false,
    });

    await accountDeletion();

    const u = await docData('users/inactive');
    expect(u.deletionReason).toBe('inactivity');
    expect(typeof u.deletionScheduledAt).toBe('number');
    expect(u.deletionExecuteAt).toBe(u.deletionScheduledAt + 30 * 86400000);
  }, 30000);

  test('does not schedule inactive accounts when the threshold is 0 (disabled)', async () => {
    await db.doc('config/app').set({ inactiveAccountDeleteMonths: 0 });
    await db.doc('users/inactive').set({
      lastActiveAt: now() - 7 * 30 * 86400000,
      deletionScheduledAt: null,
      isSuspended: false,
    });

    await accountDeletion();

    const u = await docData('users/inactive');
    expect(u.deletionScheduledAt).toBeNull();
    expect(u.deletionExecuteAt).toBeUndefined();
  }, 30000);

  test('skips suspended users when scheduling inactive accounts', async () => {
    await db.doc('config/app').set({ inactiveAccountDeleteMonths: 6 });
    await db.doc('users/suspended').set({
      lastActiveAt: now() - 7 * 30 * 86400000,
      deletionScheduledAt: null,
      isSuspended: true,
    });

    await accountDeletion();

    const u = await docData('users/suspended');
    expect(u.deletionScheduledAt).toBeNull(); // suspended → not scheduled
  }, 30000);
});

describe('hardDeleteAccount — per-step real erasure', () => {
  const { hardDeleteAccount } = accountDeletion;

  test('Step 1: sends the deletion-complete email to the user (real Mailpit)', async () => {
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    const msgs = await mailpitMessages();
    const mine = msgs.filter((m) => (m.To || []).some((t) => t.Address === EMAIL));
    expect(mine).toHaveLength(1);
    expect(mine[0].Subject).toBe('Your ShyTalk account has been deleted');
  }, 30000);

  test('Step 1: sends no email when the user has no email address', async () => {
    const userDoc = await seedUserDoc({ email: undefined });

    await hardDeleteAccount(userDoc);

    expect(await mailpitMessages()).toHaveLength(0);
  }, 30000);

  test('Step 2: deletes R2 objects under all five user prefixes', async () => {
    const keys = [
      `profiles/${UID}/a.jpg`,
      `covers/${UID}/b.jpg`,
      `messages/${UID}/c.jpg`,
      `groups/${UID}/d.jpg`,
      `evidence/${UID}/e.jpg`,
    ];
    for (const k of keys) await putObj(k);
    const foreign = 'profiles/9999/keep.jpg';
    await putObj(foreign);
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    for (const k of keys) expect(await r2Exists(k)).toBe(false);
    expect(await r2Exists(foreign)).toBe(true); // other users' media untouched
  }, 30000);

  test('Step 3: deletes a 1-on-1 conversation and all its subcollections', async () => {
    await db.doc('conversations/c1').set({ participantIds: [N, 2002] });
    await db.doc('conversations/c1/messages/m1').set({ text: 'hi' });
    await db.doc('conversations/c1/userSettings/s1').set({ userId: UID });
    await db.doc(`conversations/c1/mutes/${UID}`).set({ muted: true });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('conversations/c1')).toBe(false);
    expect(await docExists('conversations/c1/messages/m1')).toBe(false);
    expect(await docExists('conversations/c1/userSettings/s1')).toBe(false);
    expect(await docExists(`conversations/c1/mutes/${UID}`)).toBe(false);
  }, 30000);

  test('Step 3: removes the user from a group conversation and deletes only their subcollection rows', async () => {
    await db.doc('conversations/g1').set({ participantIds: [N, 2002, 3003] });
    await db.doc('conversations/g1/userSettings/mine').set({ userId: UID });
    await db.doc('conversations/g1/userSettings/theirs').set({ userId: '2002' });
    await db.doc(`conversations/g1/mutes/${UID}`).set({ muted: true });
    await db.doc('conversations/g1/mutes/2002').set({ muted: true });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('conversations/g1')).toBe(true); // group kept
    expect((await docData('conversations/g1')).participantIds).toEqual([2002, 3003]);
    expect(await docExists('conversations/g1/userSettings/mine')).toBe(false);
    expect(await docExists(`conversations/g1/mutes/${UID}`)).toBe(false);
    expect(await docExists('conversations/g1/userSettings/theirs')).toBe(true);
    expect(await docExists('conversations/g1/mutes/2002')).toBe(true);
  }, 30000);

  test('Step 4: deletes an owned room (with subcollections) and removes the user from a non-owned room', async () => {
    await db.doc('rooms/owned').set({ participantIds: [N], ownerId: N });
    await db.doc('rooms/owned/messages/m1').set({ text: 'x' });
    await db.doc('rooms/owned/seatRequests/sr1').set({ uid: N });
    await db.doc('rooms/other').set({ participantIds: [N, 2002], ownerId: 2002 });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('rooms/owned')).toBe(false);
    expect(await docExists('rooms/owned/messages/m1')).toBe(false);
    expect(await docExists('rooms/owned/seatRequests/sr1')).toBe(false);
    expect(await docExists('rooms/other')).toBe(true);
    expect((await docData('rooms/other')).participantIds).toEqual([2002]);
  }, 30000);

  test('Step 5: removes the user from other users’ followerIds and followingIds arrays', async () => {
    await db.doc('users/follower').set({ followerIds: [N, 7] });
    await db.doc('users/following').set({ followingIds: [9, N] });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect((await docData('users/follower')).followerIds).toEqual([7]);
    expect((await docData('users/following')).followingIds).toEqual([9]);
  }, 30000);

  test('Step 5b: deletes the user’s giftRankings entries', async () => {
    await db.doc('giftRankings/gr1').set({ userId: UID });
    await db.doc('giftRankings/gr2').set({ userId: '9999' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('giftRankings/gr1')).toBe(false);
    expect(await docExists('giftRankings/gr2')).toBe(true);
  }, 30000);

  test('Step 6: deletes reports/reportsArchive/suspensionAppeals by reportedUserId, reporterId (+ appeals userId)', async () => {
    await db.doc('reports/r1').set({ reportedUserId: UID });
    await db.doc('reports/r2').set({ reporterId: UID });
    await db.doc('reportsArchive/a1').set({ reportedUserId: UID });
    await db.doc('suspensionAppeals/ap1').set({ userId: UID });
    await db.doc('reports/foreign').set({ reportedUserId: '9999' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('reports/r1')).toBe(false);
    expect(await docExists('reports/r2')).toBe(false);
    expect(await docExists('reportsArchive/a1')).toBe(false);
    expect(await docExists('suspensionAppeals/ap1')).toBe(false);
    expect(await docExists('reports/foreign')).toBe(true);
  }, 30000);

  test('Step 6b: anonymises the user’s own suggestions (submitterUid → 0, submitterDeleted flag)', async () => {
    await db.doc('suggestions/s1').set({ submitterUid: N, title: 'idea', voteCount: 0 });
    await db.doc('suggestions/foreign').set({ submitterUid: 9999, title: 'other' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    const s1 = await docData('suggestions/s1');
    expect(s1.submitterUid).toBe(0);
    expect(s1.submitterDeleted).toBe(true);
    expect(typeof s1.submitterDeletedAt).toBe('number');
    expect(s1.title).toBe('idea'); // community content preserved
    expect((await docData('suggestions/foreign')).submitterUid).toBe(9999);
  }, 30000);

  test('Step 6b: deletes the user’s votes via collectionGroup and decrements the parent voteCount', async () => {
    await db.doc('suggestions/s1').set({ title: 'idea', voteCount: 5 });
    await db.doc('suggestions/s1/votes/v1').set({ voterId: N, vote: 'up' });
    await db.doc('suggestions/s1/votes/foreign').set({ voterId: 9999, vote: 'up' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('suggestions/s1/votes/v1')).toBe(false);
    expect(await docExists('suggestions/s1/votes/foreign')).toBe(true);
    expect((await docData('suggestions/s1')).voteCount).toBe(4); // up → -1
  }, 30000);

  test('Step 6b: a vote with a null vote field is deleted without changing voteCount', async () => {
    await db.doc('suggestions/s1').set({ title: 'idea', voteCount: 3 });
    await db.doc('suggestions/s1/votes/v1').set({ voterId: N, vote: null });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('suggestions/s1/votes/v1')).toBe(false);
    expect((await docData('suggestions/s1')).voteCount).toBe(3); // delta 0
  }, 30000);

  test('Step 6b: ignores collectionGroup vote hits whose parent is not a suggestion (defensive guard)', async () => {
    await db.doc('decoys/d1').set({ unrelated: true });
    await db.doc('decoys/d1/votes/v1').set({ voterId: N, vote: 'up' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('decoys/d1/votes/v1')).toBe(true); // not under suggestions → untouched
  }, 30000);

  test('Step 6b: anonymises the user’s comments via collectionGroup by authorUid', async () => {
    await db.doc('suggestions/s1').set({ title: 'idea' });
    await db.doc('suggestions/s1/comments/c1').set({ authorUid: N, text: 'original' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    const c1 = await docData('suggestions/s1/comments/c1');
    expect(c1.authorUid).toBe(0);
    expect(c1.authorDeleted).toBe(true);
    expect(typeof c1.authorDeletedAt).toBe('number');
    expect(c1.text).toBe('[Comment from deleted user]');
  }, 30000);

  test('Step 6b: deletes the user’s subscription-preferences doc', async () => {
    await db.doc(`subscriptions/${UID}`).set({ digest: 'weekly' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists(`subscriptions/${UID}`)).toBe(false);
  }, 30000);

  test('Step 6b: deletes notifications matching uid OR recipientUid (deduped), keeping foreign ones', async () => {
    await db.doc('notifications/both').set({ uid: N, recipientUid: N });
    await db.doc('notifications/byUid').set({ uid: N, recipientUid: 9999 });
    await db.doc('notifications/byRecipient').set({ uid: 9999, recipientUid: N });
    await db.doc('notifications/foreign').set({ uid: 9999, recipientUid: 8888 });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('notifications/both')).toBe(false);
    expect(await docExists('notifications/byUid')).toBe(false);
    expect(await docExists('notifications/byRecipient')).toBe(false);
    expect(await docExists('notifications/foreign')).toBe(true);
  }, 30000);

  test('Step 7: deletes biometricKeys + otp/emailMetrics, and marks purchaseReceipts for deletion', async () => {
    await db.doc('biometricKeys/bk1').set({ uniqueId: N });
    await db.doc(`otpCodes/${EMAIL}`).set({ code: '123456' });
    await db.doc(`emailMetrics/${EMAIL}`).set({ sent: 3 });
    await db.doc('purchaseReceipts/pr1').set({ userId: UID, markedForDeletion: false });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('biometricKeys/bk1')).toBe(false);
    expect(await docExists(`otpCodes/${EMAIL}`)).toBe(false);
    expect(await docExists(`emailMetrics/${EMAIL}`)).toBe(false);
    const pr = await docData('purchaseReceipts/pr1');
    expect(pr.markedForDeletion).toBe(true);
    expect(pr.deletionScheduledAt).toBeGreaterThan(now());
  }, 30000);

  test('Step 8: deletes the user doc and all of its subcollections', async () => {
    for (const sub of ['backpack', 'giftWall', 'transactions', 'warnings', 'stalkers']) {
      await db.doc(`users/${UID}/${sub}/x1`).set({ v: 1 });
    }
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists(`users/${UID}`)).toBe(false);
    for (const sub of ['backpack', 'giftWall', 'transactions', 'warnings', 'stalkers']) {
      expect(await docExists(`users/${UID}/${sub}/x1`)).toBe(false);
    }
  }, 30000);

  test('Step 9: soft-deletes identityMap entries with clean standing for a non-suspended user', async () => {
    await db.doc('identityMap/im1').set({ uniqueId: N, unlinked: false });
    const userDoc = await seedUserDoc({ isSuspended: false });

    await hardDeleteAccount(userDoc);

    const im = await docData('identityMap/im1');
    expect(im.unlinked).toBe(true);
    expect(im.deletedAccount).toBe(true);
    expect(im.deletionStanding).toBe('clean');
    expect(typeof im.unlinkedAt).toBe('number');
  }, 30000);

  test('Step 9: records suspended standing in identityMap for a suspended user', async () => {
    await db.doc('identityMap/im1').set({ uniqueId: N });
    const userDoc = await seedUserDoc({ isSuspended: true });

    await hardDeleteAccount(userDoc);

    expect((await docData('identityMap/im1')).deletionStanding).toBe('suspended');
  }, 30000);

  test('Step 10: deletes the user’s deviceBindings', async () => {
    await db.doc('deviceBindings/db1').set({ uniqueId: N });
    await db.doc('deviceBindings/foreign').set({ uniqueId: 9999 });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('deviceBindings/db1')).toBe(false);
    expect(await docExists('deviceBindings/foreign')).toBe(true);
  }, 30000);

  test('Step 11: deletes the Firebase Auth user (real Auth emulator)', async () => {
    await auth.createUser({ uid: 'fb-1001' });
    const userDoc = await seedUserDoc({ firebaseUid: 'fb-1001' });

    await hardDeleteAccount(userDoc);

    await expect(auth.getUser('fb-1001')).rejects.toMatchObject({ code: 'auth/user-not-found' });
  }, 30000);

  test('Step 12: writes an audit log with a hashed uniqueId, zero PII, and the deletion reason', async () => {
    const userDoc = await seedUserDoc({ deletionReason: 'user_request', isSuspended: false });

    await hardDeleteAccount(userDoc);

    const audit = (await db.collection('adminAuditLog').get()).docs;
    expect(audit).toHaveLength(1);
    const a = audit[0].data();
    const expectedHash = crypto
      .createHmac('sha256', process.env.AUDIT_HASH_SECRET || 'dev-audit-secret')
      .update(UID)
      .digest('hex');
    expect(a.action).toBe('account_deleted');
    expect(a.hashedUniqueId).toBe(expectedHash);
    expect(a.triggeredBy).toBe('system');
    expect(a.reason).toBe('user_request');
    expect(a.standing).toBe('clean');
    expect(a.dataDeleted).toEqual(expect.arrayContaining(['user', 'auth', 'suggestions', 'votes']));
    // Zero PII: no raw identifiers or email anywhere in the audit record.
    expect(a.uniqueId).toBeUndefined();
    expect(a.email).toBeUndefined();
    expect(a.firebaseUid).toBeUndefined();
  }, 30000);

  test('Step 12: audit reason falls back to "unknown" when deletionReason is missing', async () => {
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    const a = (await db.collection('adminAuditLog').get()).docs[0].data();
    expect(a.reason).toBe('unknown');
  }, 30000);

  test('preserves deviceBans — they are never deleted by account deletion', async () => {
    await db.doc('deviceBans/ban1').set({ uniqueId: N, reason: 'abuse' });
    const userDoc = await seedUserDoc();

    await hardDeleteAccount(userDoc);

    expect(await docExists('deviceBans/ban1')).toBe(true);
  }, 30000);
});
