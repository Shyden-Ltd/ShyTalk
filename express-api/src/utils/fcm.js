/**
 * Shared FCM (Firebase Cloud Messaging) utilities.
 *
 * Extracted from rooms.js, conversations.js, and reports.js to eliminate duplication.
 */

const { messaging, db, FieldValue } = require('./firebase');
const log = require('./log');

// Local-mode FCM capture buffer for integration tests.
// In NODE_ENV=local the route never contacts real FCM — we record the
// payload here so a Playwright test can verify the contract via
// /api/test/fcm-captures (test-helpers.js). Cleared between tests
// via /api/test/fcm-captures/clear. Production never touches this.
const _fcmCaptures = [];
const FCM_CAPTURE_LIMIT = 1000;

function captureLocal(tokens, data) {
  if (_fcmCaptures.length >= FCM_CAPTURE_LIMIT) {
    // Bound the buffer so a long-lived dev process can't OOM.
    // Drop the oldest — tests should clear before running anyway.
    _fcmCaptures.shift();
  }
  _fcmCaptures.push({
    tokens: [...tokens],
    data: { ...data },
    ts: Date.now(),
  });
}

/**
 * Send a data-only FCM message to multiple tokens via Firebase Admin SDK.
 * All values are stringified (FCM data messages require string values).
 * Returns a list of invalid tokens that should be cleaned up.
 */
async function sendFcmToTokens(tokens, data) {
  if (!tokens || tokens.length === 0) return [];

  if (process.env.NODE_ENV === 'local') {
    captureLocal(tokens, data);
    log.info('fcm', `[FCM-LOCAL] Would send to ${tokens.length} tokens: ${data?.title}`);
    return [];
  }

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
  if (process.env.NODE_ENV === 'local') return;
  try {
    await db.doc(`users/${userId}`).update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
    });
  } catch (err) {
    log.error('fcm', 'Failed to clean invalid tokens', { userId, error: err.message });
  }
}

/**
 * Test helpers — local-mode only. Used by the integration suite to
 * verify FCM payload shape without hitting real Firebase Cloud
 * Messaging. Returns a defensive copy so callers can't mutate the
 * buffer in place.
 */
function getFcmCaptures() {
  return _fcmCaptures.map((c) => ({ ...c, tokens: [...c.tokens], data: { ...c.data } }));
}

function clearFcmCaptures() {
  _fcmCaptures.length = 0;
}

module.exports = {
  sendFcmToTokens,
  cleanupInvalidTokens,
  getFcmCaptures,
  clearFcmCaptures,
};
