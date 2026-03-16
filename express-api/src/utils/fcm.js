/**
 * Shared FCM (Firebase Cloud Messaging) utilities.
 *
 * Extracted from rooms.js, conversations.js, and reports.js to eliminate duplication.
 */

const { messaging, db, FieldValue } = require('./firebase');
const log = require('./log');

/**
 * Send a data-only FCM message to multiple tokens via Firebase Admin SDK.
 * All values are stringified (FCM data messages require string values).
 * Returns a list of invalid tokens that should be cleaned up.
 */
async function sendFcmToTokens(tokens, data) {
  if (!tokens || tokens.length === 0) return [];

  const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

  const result = await messaging.sendEachForMulticast({
    tokens,
    data: stringData,
  });

  const invalidTokens = [];
  result.responses.forEach((resp, i) => {
    if (resp.error) {
      const code = resp.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/sender-id-mismatch' ||
        code === 'messaging/invalid-argument'
      ) {
        invalidTokens.push(tokens[i]);
      } else {
        log.warn('fcm', `FCM send failed for token index ${i}`, {
          code,
          message: resp.error.message,
        });
      }
    }
  });

  return invalidTokens;
}

/**
 * Remove invalid FCM tokens from a user's doc using arrayRemove.
 */
async function cleanupInvalidTokens(invalidTokens, userId) {
  if (!invalidTokens || invalidTokens.length === 0 || !userId) return;
  try {
    await db.doc(`users/${userId}`).update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
    });
  } catch (err) {
    log.error('fcm', 'Failed to clean invalid tokens', { userId, error: err.message });
  }
}

module.exports = { sendFcmToTokens, cleanupInvalidTokens };
