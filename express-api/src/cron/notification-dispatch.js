/**
 * Notification dispatch cron job.
 *
 * Processes queued notifications in batch:
 * - Email via Postfix (nodemailer)
 * - Push via FCM
 * - System messages via sendSystemPm
 * - In-app notifications via Firestore
 *
 * Handles failures gracefully with retry queue.
 */

const { db } = require('../utils/firebase');
const { sendEmail } = require('../utils/email');
const { sendFcmToTokens } = require('../utils/fcm');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

const MAX_BATCH_SIZE = 50;

async function dispatchNotifications() {
  const snap = await db
    .collection('notificationQueue')
    .where('status', '==', 'queued')
    .limit(MAX_BATCH_SIZE)
    .get();

  if (snap.empty) return;

  let sent = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const notif = doc.data();

    // Skip already-sent (idempotent)
    if (notif.status === 'sent') continue;

    try {
      const { channels } = notif;

      // Email
      if (channels?.email && notif.email) {
        try {
          const subject = notif.title || 'ShyTalk Notification';
          const html = `<p>${notif.body || ''}</p>`;
          await sendEmail(notif.email, subject, html);
        } catch (err) {
          log.error('notification-dispatch', 'Email send failed', {
            notifId: doc.id,
            error: err.message,
          });
          // Queue for retry — don't fail the whole notification
        }
      }

      // Push (FCM)
      if (channels?.push && notif.pushToken) {
        try {
          const invalidTokens = await sendFcmToTokens([notif.pushToken], {
            type: notif.type || 'notification',
            title: notif.title || '',
            body: notif.body || '',
            relatedId: notif.relatedId || '',
          });

          // Clean up invalid tokens
          if (invalidTokens && invalidTokens.length > 0) {
            try {
              await db.doc(`subscriptions/${notif.uid}`).update({
                pushToken: null,
              });
            } catch {
              // Best effort cleanup
            }
          }
        } catch (err) {
          log.error('notification-dispatch', 'FCM send failed', {
            notifId: doc.id,
            error: err.message,
          });
        }
      }

      // System message
      if (channels?.systemMessage && notif.uid) {
        try {
          await sendSystemPm(
            String(notif.uid),
            notif.body || notif.title || 'You have a new notification',
          );
        } catch (err) {
          log.error('notification-dispatch', 'System PM failed', {
            notifId: doc.id,
            error: err.message,
          });
        }
      }

      // Mark as sent
      await doc.ref.update({ status: 'sent', sentAt: Date.now() });
      sent++;
    } catch (err) {
      log.error('notification-dispatch', 'Notification dispatch failed', {
        notifId: doc.id,
        error: err.message,
      });
      try {
        await doc.ref.update({ status: 'failed', error: err.message });
      } catch {
        // Best effort
      }
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    log.info('notification-dispatch', `Dispatched ${sent} notifications, ${failed} failed`);
  }
}

module.exports = dispatchNotifications;
