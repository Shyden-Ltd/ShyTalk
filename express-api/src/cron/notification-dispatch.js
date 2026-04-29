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
            } catch (cleanupErr) {
              // Don't fail the notification dispatch over a stale-token
              // write failure, but log it: stale tokens that linger here
              // mean future sends keep failing for that user (silent decay).
              log.warn('notification-dispatch', 'Failed to clear invalid pushToken (best-effort)', {
                uid: notif.uid,
                notifId: doc.id,
                error: cleanupErr.message,
              });
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
      } catch (statusErr) {
        // If we can't mark `failed`, the queue item stays `queued` and gets
        // re-dispatched on every cron tick — potentially re-spamming the
        // user AND burning Firestore quota. Log so this is visible in
        // production, even though we can't auto-recover.
        log.error(
          'notification-dispatch',
          'Failed to mark notification as failed (will re-attempt next tick)',
          {
            notifId: doc.id,
            error: statusErr.message,
          },
        );
      }
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    log.info('notification-dispatch', `Dispatched ${sent} notifications, ${failed} failed`);
  }
}

module.exports = dispatchNotifications;
