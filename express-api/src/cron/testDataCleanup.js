/**
 * Cron: Clean up stale test data older than 1 hour.
 * Only runs in development environment.
 *
 * Safety net for test data that wasn't cleaned up by normal teardown.
 * Queries by _testRun prefix and filters by age client-side
 * (avoids needing composite Firestore indexes).
 */

const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// All collections that test-helpers.js tags with _testRun
const TAGGED_COLLECTIONS = [
  'users',
  'rooms',
  'gifts',
  'conversations',
  'banners',
  'funFacts',
  'reports',
  'suspensionAppeals',
  'alerts',
  'deviceBindings',
  'reportLocks',
];

// Subcollections to delete before their parent doc
const USER_SUBCOLLECTIONS = ['warnings', 'transactions', 'backpack', 'stalkers', 'giftWall'];

async function deleteSubcollections(docRef, subcollections) {
  for (const sub of subcollections) {
    const snap = await docRef.collection(sub).limit(500).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/** Delete stale docs from a tagged collection. Returns count and any deleted user IDs. */
async function cleanupTaggedCollection(colName, cutoff) {
  const snap = await db
    .collection(colName)
    .where('_testRun', '>=', TEST_PREFIX)
    .where('_testRun', '<', TEST_PREFIX + '\uf8ff')
    .limit(500)
    .get();

  if (snap.empty) return { deleted: 0, userIds: [] };

  const staleDocs = snap.docs.filter((doc) => {
    const createdAt = doc.data().createdAt;
    return typeof createdAt === 'number' ? createdAt < cutoff : true;
  });

  let deleted = 0;
  const userIds = [];

  for (const doc of staleDocs) {
    if (colName === 'users') {
      userIds.push(doc.data().uniqueId || doc.id);
      await deleteSubcollections(doc.ref, USER_SUBCOLLECTIONS);
    } else if (colName === 'conversations') {
      await deleteSubcollections(doc.ref, [
        'messages',
        'userSettings',
        'mutes',
        'settings',
        'mod_log',
      ]);
    }
    await doc.ref.delete();
    deleted++;
  }

  return { deleted, userIds };
}

/** Clean up device/network bans linked to deleted test users. */
async function cleanupLinkedBans(deletedUserUniqueIds) {
  let deleted = 0;
  for (const uid of deletedUserUniqueIds) {
    for (const uidVariant of [uid, String(uid)]) {
      for (const banCol of ['deviceBans', 'networkBans']) {
        const banSnap = await db
          .collection(banCol)
          .where('linkedUniqueId', '==', uidVariant)
          .limit(100)
          .get();
        if (banSnap.empty) continue;
        const batch = db.batch();
        banSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += banSnap.size;
      }
    }
  }
  return deleted;
}

/** Clean up test starting screens from config document. */
async function cleanupTestStartingScreens() {
  try {
    const ssDoc = await db.doc('config/startingScreens').get();
    if (!ssDoc.exists) return 0;

    const ssData = ssDoc.data() || {};
    const testScreenIds = Object.keys(ssData).filter(
      (key) => key.startsWith('pw-') || key.startsWith('screen-') || key.startsWith('test-'),
    );
    if (testScreenIds.length === 0) return 0;

    const updates = {};
    for (const id of testScreenIds) {
      updates[id] = FieldValue.delete();
    }
    await db.doc('config/startingScreens').update(updates);
    return testScreenIds.length;
  } catch {
    // Best-effort cleanup — config deletion failure is non-critical
    return 0;
  }
}

async function testDataCleanup() {
  if (process.env.NODE_ENV === 'production') return;

  const cutoff = Date.now() - MAX_AGE_MS;
  let totalDeleted = 0;
  const deletedUserUniqueIds = [];

  for (const colName of TAGGED_COLLECTIONS) {
    const result = await cleanupTaggedCollection(colName, cutoff);
    totalDeleted += result.deleted;
    deletedUserUniqueIds.push(...result.userIds);
  }

  totalDeleted += await cleanupLinkedBans(deletedUserUniqueIds);
  totalDeleted += await cleanupTestStartingScreens();

  // Restore counter if test users were deleted
  if (deletedUserUniqueIds.length > 0) {
    const counterRef = db.doc('counters/uniqueId');
    const maxSnap = await db.collection('users').orderBy('uniqueId', 'desc').limit(1).get();
    const maxId = maxSnap.empty ? 100000000 : maxSnap.docs[0].data().uniqueId;
    await counterRef.set({ value: maxId }, { merge: true });
  }

  if (totalDeleted > 0) {
    log.info('cron', 'testDataCleanup: removed stale test data', { deleted: totalDeleted });
  }
}

module.exports = testDataCleanup;
