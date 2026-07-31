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
const {
  dedupeKeyFor,
  isDuplicateNotification,
  enforceRetention,
} = require('./notification-retention');
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
  const results = { email: null, push: null, systemMessage: null, inApp: null };

  // In-app FIRST, deliberately. This is the durable record the inbox reads
  // (routes/suggestions-notifications.js:29 filters `notifications` by `uid`),
  // so it must not be contingent on a transport succeeding — an SMTP outage
  // should still leave the user something to find.
  //
  // SHY-0246: this channel was documented in the JSDoc above but never
  // implemented, so `{email:false, push:false, inApp:true, systemMessage:false}`
  // — the DEFAULT roadmap preference shipped at routes/subscriptions.js:21 —
  // dispatched successfully and delivered nothing at all.
  if (channels?.inApp && uid) {
    try {
      // SHY-0258: collapse a repeat of the SAME event for the same person
      // inside the dedup window. Checked before the write so a duplicate costs
      // one read rather than a permanent row.
      const nowMs = Date.now();
      const dedupeKey = dedupeKeyFor({ uid, type, relatedId });
      if (await isDuplicateNotification(db, { uid, type, relatedId }, nowMs)) {
        log.info('notification-channels', 'In-app notification deduplicated', {
          correlationId,
          uid,
          dedupeKey,
        });
        results.inApp = 'deduplicated';
      } else {
        await db.collection('notifications').add({
          // Three spellings of the recipient, matching the rows already written
          // at routes/suggestions.js:1422 so the inbox and clients need no change.
          // RAW uid, never String(uid) — the inbox query is type-sensitive
          // (see routes/suggestions.js notifySubscribers for the full note).
          uid,
          userId: uid,
          recipientUid: uid,
          type: type || 'notification',
          title: title || '',
          body: body || '',
          relatedId: relatedId || null,
          // SHY-0258: persisted so the dedup check is an equality query on a
          // stored field rather than a scan that recomputes identity per row.
          dedupeKey,
          isRead: false,
          createdAt: nowMs,
        });
        results.inApp = 'sent';

        // Lazy retention, attached to the write that made it necessary (the
        // house pattern — no cron). Deliberately AFTER results.inApp is set:
        // housekeeping must never downgrade a delivery that already succeeded.
        await enforceRetention(db, uid, nowMs);
      }
    } catch (err) {
      log.error('notification-channels', 'In-app notification write failed', {
        correlationId,
        uid,
        error: err.message,
      });
      results.inApp = 'failed';
    }
  }

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
