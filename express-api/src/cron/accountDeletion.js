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
const crypto = require('crypto');

const AUDIT_HASH_SECRET = process.env.AUDIT_HASH_SECRET;
if (!AUDIT_HASH_SECRET && process.env.NODE_ENV === 'production') {
  log.error('cron', 'AUDIT_HASH_SECRET not set — audit log hashes will be insecure');
}

/**
 * Hard-delete all data for a single user account.
 * Follows the 12-step sequence from the design spec.
 */
async function hardDeleteAccount(userDoc) {
  const user = userDoc.data();
  const uniqueId = userDoc.id;
  const firebaseUid = user.firebaseUid;

  // Step 1: Send final email (before deleting user data)
  if (user.email) {
    try {
      const template = buildDeletionCompleteEmail();
      await sendEmail(user.email, template.subject, template.html);
    } catch (err) {
      log.error('cron', 'Failed to send deletion complete email', { uniqueId, error: err.message });
    }
  }

  // Step 2: Delete R2 storage
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
      if (keys.length > 0) {
        await r2.deleteObjects(keys);
      }
    } catch (err) {
      log.error('cron', 'Failed to delete R2 prefix', { prefix, error: err.message });
    }
  }

  // Step 3: Cleanup conversations (delete 1-on-1, remove from groups)
  try {
    const convQuery = db
      .collection('conversations')
      .where('participantIds', 'array-contains', Number(uniqueId));
    const convSnap = await convQuery.get();
    for (const convDoc of convSnap.docs) {
      const convId = convDoc.id;
      const convData = convDoc.data();
      const participantCount = (convData.participantIds || []).length;

      if (participantCount <= 2) {
        // 1-on-1: delete entire conversation + subcollections
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
        for (let i = 0; i < allDocs.length; i += 500) {
          const batch = db.batch();
          for (const path of allDocs.slice(i, i + 500)) {
            batch.delete(db.doc(path));
          }
          await batch.commit();
        }
      } else {
        // Group chat: remove participant only, keep conversation
        await db.doc(`conversations/${convId}`).update({
          participantIds: FieldValue.arrayRemove(Number(uniqueId)),
        });
        // Delete this user's settings/mutes in the group
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
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup conversations', { uniqueId, error: err.message });
  }

  // Step 4: Cleanup rooms
  try {
    const roomQuery = db
      .collection('rooms')
      .where('participantIds', 'array-contains', Number(uniqueId));
    const roomSnap = await roomQuery.get();
    for (const roomDoc of roomSnap.docs) {
      const roomData = roomDoc.data();
      if (String(roomData.ownerId) === uniqueId) {
        // Delete room + subcollections
        const [messages, seatRequests] = await Promise.all([
          queryDocs(db.collection(`rooms/${roomDoc.id}/messages`)),
          queryDocs(db.collection(`rooms/${roomDoc.id}/seatRequests`)),
        ]);
        const allDocs = [
          ...messages.map((m) => `rooms/${roomDoc.id}/messages/${m.id}`),
          ...seatRequests.map((s) => `rooms/${roomDoc.id}/seatRequests/${s.id}`),
          `rooms/${roomDoc.id}`,
        ];
        for (let i = 0; i < allDocs.length; i += 500) {
          const batch = db.batch();
          for (const path of allDocs.slice(i, i + 500)) {
            batch.delete(db.doc(path));
          }
          await batch.commit();
        }
      } else {
        // Remove user from room
        await db.doc(`rooms/${roomDoc.id}`).update({
          participantIds: FieldValue.arrayRemove(Number(uniqueId)),
        });
      }
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup rooms', { uniqueId, error: err.message });
  }

  // Step 5: Remove from follower/following arrays
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

  // Step 5b: Gift rankings cleanup
  try {
    const rankSnap = await db.collection('giftRankings').where('userId', '==', uniqueId).get();
    for (const doc of rankSnap.docs) {
      await db.doc(`giftRankings/${doc.id}`).delete();
    }
  } catch (err) {
    log.error('cron', 'Failed to cleanup gift rankings', { uniqueId, error: err.message });
  }

  // Step 6: Reports & appeals
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

  // Step 7: Auth-related (biometricKeys, otpCodes, emailMetrics, purchaseReceipts)
  try {
    const bioSnap = await db
      .collection('biometricKeys')
      .where('uniqueId', '==', Number(uniqueId))
      .get();
    for (const doc of bioSnap.docs) await db.doc(`biometricKeys/${doc.id}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to cleanup biometric keys', { uniqueId, error: err.message });
  }
  // Delete OTP codes (keyed by email)
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
  // Mark purchase receipts for deferred deletion (retain 180 days for financial audit)
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

  // Step 8: User doc + subcollections
  try {
    const subcollections = ['backpack', 'giftWall', 'transactions', 'warnings', 'stalkers'];
    for (const sub of subcollections) {
      const subDocs = await queryDocs(db.collection(`users/${uniqueId}/${sub}`));
      for (let i = 0; i < subDocs.length; i += 500) {
        const batch = db.batch();
        for (const doc of subDocs.slice(i, i + 500)) {
          batch.delete(db.doc(`users/${uniqueId}/${sub}/${doc.id}`));
        }
        await batch.commit();
      }
    }
    await db.doc(`users/${uniqueId}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to delete user doc', { uniqueId, error: err.message });
  }

  // Step 9: Identity map soft-delete
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

  // Step 10: Device bindings
  try {
    const bindingSnap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', Number(uniqueId))
      .get();
    for (const doc of bindingSnap.docs) await db.doc(`deviceBindings/${doc.id}`).delete();
  } catch (err) {
    log.error('cron', 'Failed to delete device bindings', { uniqueId, error: err.message });
  }

  // Step 11: Firebase Auth user (LAST data operation)
  try {
    await auth.deleteUser(firebaseUid);
  } catch (err) {
    log.error('cron', 'Failed to delete Firebase Auth user', { uniqueId, error: err.message });
  }

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
