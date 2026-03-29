/**
 * Account deletion cron job.
 *
 * Runs daily at 03:00 UTC:
 * 1. Processes pending deletions past their execute date (hard delete)
 * 2. Schedules inactive accounts for deletion (if enabled)
 *
 * Limited to 10 accounts per run for Firestore quota awareness.
 */

const { db, auth, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { queryDocs } = require('../utils/firestore-helpers');
const { sendEmail } = require('../utils/email');
const { buildDeletionCompleteEmail } = require('../utils/email-templates');
const r2 = require('../utils/r2');
const log = require('../utils/log');
const crypto = require('node:crypto');

const AUDIT_HASH_SECRET = process.env.AUDIT_HASH_SECRET;
if (!AUDIT_HASH_SECRET && process.env.NODE_ENV === 'production') {
  log.error('cron', 'AUDIT_HASH_SECRET not set — audit log hashes will be insecure');
}

/**
 * Delete docs in batches of 500.
 */
async function batchDeletePaths(paths) {
  for (let i = 0; i < paths.length; i += 500) {
    const batch = db.batch();
    for (const path of paths.slice(i, i + 500)) {
      batch.delete(db.doc(path));
    }
    await batch.commit();
  }
}

/** Step 1: Send final email */
async function sendDeletionEmail(user, uniqueId) {
  if (!user.email) return;
  try {
    const template = buildDeletionCompleteEmail();
    await sendEmail(user.email, template.subject, template.html);
  } catch (err) {
    log.error('cron', 'Failed to send deletion complete email', { uniqueId, error: err.message });
  }
}

/** Step 2: Delete R2 storage */
async function deleteUserR2Storage(uniqueId) {
  const prefixes = [
    `profiles/${uniqueId}/`,
    `covers/${uniqueId}/`,
    `messages/${uniqueId}/`,
    `groups/${uniqueId}/`,
    `evidence/${uniqueId}/`,
  ];
  for (const prefix of prefixes) {
    try {
      const keys = await r2.listObjects(prefix);
      if (keys.length > 0) await r2.deleteObjects(keys);
    } catch (err) {
      log.error('cron', 'Failed to delete R2 prefix', { prefix, error: err.message });
    }
  }
}

/** Delete a 1-on-1 conversation and all its subcollections. */
async function deleteOneOnOneConversation(convId) {
  const [messages, userSettings, mutes] = await Promise.all([
    queryDocs(db.collection(`conversations/${convId}/messages`)),
    queryDocs(db.collection(`conversations/${convId}/userSettings`)),
    queryDocs(db.collection(`conversations/${convId}/mutes`)),
  ]);
  const allDocs = [
    ...messages.map((m) => `conversations/${convId}/messages/${m.id}`),
    ...userSettings.map((s) => `conversations/${convId}/userSettings/${s.id}`),
    ...mutes.map((m) => `conversations/${convId}/mutes/${m.id}`),
    `conversations/${convId}`,
  ];
  await batchDeletePaths(allDocs);
}

/** Remove user from a group conversation. */
async function removeUserFromGroupConversation(convId, uniqueId) {
  await db.doc(`conversations/${convId}`).update({
    participantIds: FieldValue.arrayRemove(Number(uniqueId)),
  });
  const [userSettings, mutes] = await Promise.all([
    queryDocs(db.collection(`conversations/${convId}/userSettings`)),
    queryDocs(db.collection(`conversations/${convId}/mutes`)),
  ]);
  const toDelete = [
    ...userSettings
      .filter((s) => s.userId === String(uniqueId))
      .map((s) => `conversations/${convId}/userSettings/${s.id}`),
    ...mutes
      .filter((m) => m.id === String(uniqueId))
      .map((m) => `conversations/${convId}/mutes/${m.id}`),
  ];
  for (const path of toDelete) {
    await db.doc(path).delete();
  }
}

/** Step 3: Cleanup conversations */
async function cleanupConversations(uniqueId) {
  try {
    const convSnap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', Number(uniqueId))
      .get();
    for (const convDoc of convSnap.docs) {
      const participantCount = (convDoc.data().participantIds || []).length;
      if (participantCount <= 2) {
        await deleteOneOnOneConversation(convDoc.id);
      } else {
        await removeUserFromGroupConversation(convDoc.id, uniqueId);
      }
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup conversations', { uniqueId, error: err.message });
  }
}

/** Delete a room and all its subcollections. */
async function deleteOwnedRoom(roomDocId) {
  const [messages, seatRequests] = await Promise.all([
    queryDocs(db.collection(`rooms/${roomDocId}/messages`)),
    queryDocs(db.collection(`rooms/${roomDocId}/seatRequests`)),
  ]);
  const allDocs = [
    ...messages.map((m) => `rooms/${roomDocId}/messages/${m.id}`),
    ...seatRequests.map((s) => `rooms/${roomDocId}/seatRequests/${s.id}`),
    `rooms/${roomDocId}`,
  ];
  await batchDeletePaths(allDocs);
}

/** Step 4: Cleanup rooms */
async function cleanupRooms(uniqueId) {
  try {
    const roomSnap = await db
      .collection('rooms')
      .where('participantIds', 'array-contains', Number(uniqueId))
      .get();
    for (const roomDoc of roomSnap.docs) {
      if (String(roomDoc.data().ownerId) === uniqueId) {
        await deleteOwnedRoom(roomDoc.id);
      } else {
        await db.doc(`rooms/${roomDoc.id}`).update({
          participantIds: FieldValue.arrayRemove(Number(uniqueId)),
        });
      }
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup rooms', { uniqueId, error: err.message });
  }
}

/** Step 5: Remove from follower/following arrays */
async function cleanupFollowerFollowing(uniqueId) {
  try {
    const followerSnap = await db
      .collection('users')
      .where('followerIds', 'array-contains', Number(uniqueId))
      .get();
    for (const doc of followerSnap.docs) {
      await db.doc(`users/${doc.id}`).update({
        followerIds: FieldValue.arrayRemove(Number(uniqueId)),
      });
    }
    const followingSnap = await db
      .collection('users')
      .where('followingIds', 'array-contains', Number(uniqueId))
      .get();
    for (const doc of followingSnap.docs) {
      await db.doc(`users/${doc.id}`).update({
        followingIds: FieldValue.arrayRemove(Number(uniqueId)),
      });
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup follower/following', { uniqueId, error: err.message });
  }
}

/** Step 5b: Gift rankings cleanup */
async function cleanupGiftRankings(uniqueId) {
  try {
    const rankSnap = await db.collection('giftRankings').where('userId', '==', uniqueId).get();
    for (const doc of rankSnap.docs) {
      await db.doc(`giftRankings/${doc.id}`).delete();
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup gift rankings', { uniqueId, error: err.message });
  }
}

/** Step 6: Reports & appeals */
async function cleanupReportsAndAppeals(uniqueId) {
  try {
    const collections = ['reports', 'reportsArchive', 'suspensionAppeals'];
    for (const col of collections) {
      const snap1 = await db.collection(col).where('reportedUserId', '==', uniqueId).get();
      for (const doc of snap1.docs) await db.doc(`${col}/${doc.id}`).delete();
      const snap2 = await db.collection(col).where('reporterId', '==', uniqueId).get();
      for (const doc of snap2.docs) await db.doc(`${col}/${doc.id}`).delete();
      if (col === 'suspensionAppeals') {
        const snap3 = await db.collection(col).where('userId', '==', uniqueId).get();
        for (const doc of snap3.docs) await db.doc(`${col}/${doc.id}`).delete();
      }
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup reports/appeals', { uniqueId, error: err.message });
  }
}

/** Step 7: Auth-related cleanup */
async function cleanupAuthData(user, uniqueId) {
  try {
    const bioSnap = await db
      .collection('biometricKeys')
      .where('uniqueId', '==', Number(uniqueId))
      .get();
    for (const doc of bioSnap.docs) await db.doc(`biometricKeys/${doc.id}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to cleanup biometric keys', { uniqueId, error: err.message });
  }

  if (user.email) {
    try {
      const otpSnap = await db.doc(`otpCodes/${user.email.toLowerCase()}`).get();
      if (otpSnap.exists) await db.doc(`otpCodes/${user.email.toLowerCase()}`).delete();
      const metricsSnap = await db.doc(`emailMetrics/${user.email.toLowerCase()}`).get();
      if (metricsSnap.exists) await db.doc(`emailMetrics/${user.email.toLowerCase()}`).delete();
    } catch (err) {
      log.error('cron', 'Failed to cleanup OTP/email data', { uniqueId, error: err.message });
    }
  }

  try {
    const receiptSnap = await db
      .collection('purchaseReceipts')
      .where('userId', '==', uniqueId)
      .get();
    for (const doc of receiptSnap.docs) {
      await db.doc(`purchaseReceipts/${doc.id}`).update({
        markedForDeletion: true,
        deletionScheduledAt: now() + 180 * 86400000,
      });
    }
  } catch (err) {
    log.error('cron', 'Failed to mark purchase receipts for deletion', {
      uniqueId,
      error: err.message,
    });
  }
}

/** Step 8: User doc + subcollections */
async function deleteUserDocAndSubcollections(uniqueId) {
  try {
    const subcollections = ['backpack', 'giftWall', 'transactions', 'warnings', 'stalkers'];
    for (const sub of subcollections) {
      const subDocs = await queryDocs(db.collection(`users/${uniqueId}/${sub}`));
      await batchDeletePaths(subDocs.map((doc) => `users/${uniqueId}/${sub}/${doc.id}`));
    }
    await db.doc(`users/${uniqueId}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to delete user doc', { uniqueId, error: err.message });
  }
}

/** Step 9: Identity map soft-delete */
async function softDeleteIdentityMap(user, uniqueId) {
  try {
    const identitySnap = await db
      .collection('identityMap')
      .where('uniqueId', '==', Number(uniqueId))
      .get();
    for (const doc of identitySnap.docs) {
      await db.doc(`identityMap/${doc.id}`).update({
        unlinked: true,
        unlinkedAt: now(),
        deletedAccount: true,
        deletionStanding: user.isSuspended ? 'suspended' : 'clean',
      });
    }
  } catch (err) {
    log.error('cron', 'Failed to soft-delete identity map', { uniqueId, error: err.message });
  }
}

/** Step 10: Device bindings */
async function deleteDeviceBindings(uniqueId) {
  try {
    const bindingSnap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', Number(uniqueId))
      .get();
    for (const doc of bindingSnap.docs) await db.doc(`deviceBindings/${doc.id}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to delete device bindings', { uniqueId, error: err.message });
  }
}

/** Step 11: Firebase Auth user */
async function deleteFirebaseAuthUser(firebaseUid, uniqueId) {
  try {
    await auth.deleteUser(firebaseUid);
  } catch (err) {
    log.error('cron', 'Failed to delete Firebase Auth user', { uniqueId, error: err.message });
  }
}

/**
 * Hard-delete all data for a single user account.
 * Follows the 12-step sequence from the design spec.
 */
async function hardDeleteAccount(userDoc) {
  const user = userDoc.data();
  const uniqueId = userDoc.id;
  const firebaseUid = user.firebaseUid;

  await sendDeletionEmail(user, uniqueId);
  await deleteUserR2Storage(uniqueId);
  await cleanupConversations(uniqueId);
  await cleanupRooms(uniqueId);
  await cleanupFollowerFollowing(uniqueId);
  await cleanupGiftRankings(uniqueId);
  await cleanupReportsAndAppeals(uniqueId);
  await cleanupAuthData(user, uniqueId);
  await deleteUserDocAndSubcollections(uniqueId);
  await softDeleteIdentityMap(user, uniqueId);
  await deleteDeviceBindings(uniqueId);
  await deleteFirebaseAuthUser(firebaseUid, uniqueId);

  // Step 12: Audit log (zero PII)
  const hashedUniqueId = crypto
    .createHmac('sha256', AUDIT_HASH_SECRET || 'dev-audit-secret')
    .update(String(uniqueId))
    .digest('hex');

  await db.doc(`adminAuditLog/${generateId()}`).set({
    action: 'account_deleted',
    timestamp: now(),
    hashedUniqueId,
    reason: user.deletionReason || 'unknown',
    triggeredBy: 'system',
    dataDeleted: [
      'user',
      'conversations',
      'rooms',
      'r2',
      'reports',
      'appeals',
      'auth',
      'identity',
      'deviceBindings',
    ],
    standing: user.isSuspended ? 'suspended' : 'clean',
  });

  log.info('cron', 'Account hard-deleted', { uniqueId });
}

/**
 * Main cron function: process pending deletions + schedule inactive accounts.
 */
async function accountDeletion() {
  const timestamp = now();

  // 1. Process pending deletions past their execute date
  const pendingSnap = await db
    .collection('users')
    .where('deletionExecuteAt', '>', 0)
    .where('deletionExecuteAt', '<=', timestamp)
    .limit(10)
    .get();

  for (const doc of pendingSnap.docs) {
    try {
      // Re-read fresh doc to check if cancelled during processing
      const freshSnap = await db.doc(`users/${doc.id}`).get();
      if (!freshSnap.exists || !freshSnap.data().deletionExecuteAt) {
        continue;
      }
      await hardDeleteAccount(freshSnap);
    } catch (err) {
      log.error('cron', 'Account deletion failed', { uniqueId: doc.id, error: err.message });
    }
  }

  // 2. Schedule inactive accounts (if enabled)
  const configSnap = await db.doc('config/app').get();
  const config = configSnap.exists ? configSnap.data() : {};
  const thresholdMonths = config.inactiveAccountDeleteMonths || 0;

  if (thresholdMonths > 0) {
    const cutoff = timestamp - thresholdMonths * 30 * 86400000;
    const graceDays = config.accountDeletionGracePeriodDays || 30;

    const inactiveSnap = await db
      .collection('users')
      .where('lastActiveAt', '<', cutoff)
      .where('deletionScheduledAt', '==', null)
      .where('isSuspended', '==', false)
      .limit(10)
      .get();

    for (const doc of inactiveSnap.docs) {
      try {
        await db.doc(`users/${doc.id}`).update({
          deletionScheduledAt: timestamp,
          deletionReason: 'inactivity',
          deletionExecuteAt: timestamp + graceDays * 86400000,
        });
        log.info('cron', 'Inactive account scheduled for deletion', { uniqueId: doc.id });
      } catch (err) {
        log.error('cron', 'Failed to schedule inactive account', {
          uniqueId: doc.id,
          error: err.message,
        });
      }
    }
  }
}

module.exports = accountDeletion;
module.exports.hardDeleteAccount = hardDeleteAccount;
module.exports._hardDeleteAccount = hardDeleteAccount;
