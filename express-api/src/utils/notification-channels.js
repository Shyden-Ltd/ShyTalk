/**
 * Inline per-channel notification dispatch.
 *
 * Extracted from the deleted `cron/notification-dispatch.js` so the
 * queue-write + cron-poll mechanism is gone — callers dispatch
 * directly. Per-channel try/catch isolates failures: a stale FCM
 * token doesn't block email, an SMTP timeout doesn't block system PM.
 *
 * The function returns a per-channel result object (sent / failed /
 * skipped) for grep-able structured logging at the caller. It never
 * throws to the caller for delivery failures — fire-and-forget at the
 * route layer is the expected pattern.
 */

const crypto = require('node:crypto');
const { db } = require('./firebase');
const { sendEmail } = require('./email');
const { sendFcmToTokens } = require('./fcm');
const { sendSystemPm } = require('./system-pm');
const log = require('./log');

/**
 * Dispatch a single notification to its configured channels.
 *
 * @param {object} notif
 * @param {object} [notif.channels] - { email?, push?, systemMessage?, inApp? }
 * @param {string} [notif.uid]
 * @param {string} [notif.type]
 * @param {string} [notif.title]
 * @param {string} [notif.body]
 * @param {string|null} [notif.email]
 * @param {string|null} [notif.pushToken]
 * @param {string} [notif.relatedId]
 * @returns {Promise<{email: string|null, push: string|null, systemMessage: string|null}>}
 *   Per-channel result: 'sent', 'failed', or null when the channel was
 *   not requested / no recipient address was present.
 */
async function dispatchNotificationInline(notif) {
  const { channels, uid, type, title, body, email, pushToken, relatedId } = notif || {};
  const correlationId = `notif-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const results = { email: null, push: null, systemMessage: null };

  if (channels?.email && email) {
    try {
      await sendEmail(email, title || 'ShyTalk Notification', `<p>${body || ''}</p>`);
      results.email = 'sent';
    } catch (err) {
      log.error('notification-channels', 'Email send failed', {
        correlationId,
        uid,
        error: err.message,
      });
      results.email = 'failed';
    }
  }

  if (channels?.push && pushToken) {
    try {
      const invalidTokens = await sendFcmToTokens([pushToken], {
        type: type || 'notification',
        title: title || '',
        body: body || '',
        relatedId: relatedId || '',
      });
      results.push = 'sent';
      // Clean up tokens FCM rejected. Best-effort — stale tokens that
      // linger here mean future sends keep failing for this user.
      if (invalidTokens && invalidTokens.length > 0 && uid) {
        try {
          await db.doc(`subscriptions/${uid}`).update({ pushToken: null });
        } catch (cleanupErr) {
          log.warn('notification-channels', 'Failed to clear invalid pushToken (best-effort)', {
            correlationId,
            uid,
            error: cleanupErr.message,
          });
        }
      }
    } catch (err) {
      log.error('notification-channels', 'FCM send failed', {
        correlationId,
        uid,
        error: err.message,
      });
      results.push = 'failed';
    }
  }

  if (channels?.systemMessage && uid) {
    try {
      await sendSystemPm(String(uid), body || title || 'You have a new notification');
      results.systemMessage = 'sent';
    } catch (err) {
      log.error('notification-channels', 'System PM failed', {
        correlationId,
        uid,
        error: err.message,
      });
      results.systemMessage = 'failed';
    }
  }

  log.info('notification-channels', 'Notification dispatched', {
    correlationId,
    uid,
    type,
    results,
  });

  return results;
}

module.exports = { dispatchNotificationInline };
