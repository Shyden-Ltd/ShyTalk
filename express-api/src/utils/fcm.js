/**
 * Shared FCM (Firebase Cloud Messaging) utilities.
 *
 * Extracted from rooms.js, conversations.js, and reports.js to eliminate duplication.
 */

const { messaging, db, FieldValue } = require('./firebase');
const log = require('./log');
const { effectiveCohort } = require('./firebase-claims');
const { auditFcmCohortDrop } = require('./segregation-audit');

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
 * UK OSA #17 PR 11 — defence-in-depth cohort filter at the FCM
 * dispatcher. Returns true when the push must be silently dropped
 * (cross-cohort, fail-closed on read errors). Returns false when the
 * push is safe to send (same cohort, or filter is not opt-in for this
 * call). System / admin / self pushes opt out by passing no IDs and
 * keep their existing behavior — no Firestore reads, no filter cost.
 *
 * Timing note: opt-in callers pay two parallel Firestore reads (sender
 * + recipient). Both reads happen regardless of cohort outcome, so the
 * SAME-cohort and CROSS-cohort paths are timing-symmetric — an
 * attacker observing dispatch latency cannot distinguish "allowed" vs
 * "dropped". The only timing signal is "filter opted in" vs "legacy
 * caller" (one round-trip pair vs zero), which corresponds to the
 * already-public call-site distinction (user→user vs system).
 */
async function isCrossCohortDispatch(senderUniqueId, recipientUniqueId) {
  const senderId = String(senderUniqueId);
  const recipientId = String(recipientUniqueId);
  let senderCohort;
  let recipientCohort;
  try {
    const [senderSnap, recipientSnap] = await Promise.all([
      db.doc(`users/${senderId}`).get(),
      db.doc(`users/${recipientId}`).get(),
    ]);
    if (!senderSnap.exists || !recipientSnap.exists) {
      // Fail-closed: a missing user doc is exactly the kind of state
      // the upstream gate may not have caught. Dropping costs at most
      // one missed push; allowing it could leak presence.
      return true;
    }
    senderCohort = effectiveCohort(senderSnap.data());
    recipientCohort = effectiveCohort(recipientSnap.data());
  } catch (err) {
    log.error('fcm', 'cohort lookup failed; dropping push (fail-closed)', {
      error: err?.message || String(err),
    });
    return true;
  }
  if (senderCohort === recipientCohort) return false;
  // Fire-and-forget — auditFcmCohortDrop swallows write errors.
  auditFcmCohortDrop({
    sourceUniqueId: senderId,
    sourceCohort: senderCohort,
    targetUniqueId: recipientId,
    targetCohort: recipientCohort,
  });
  return true;
}

/**
 * Send a data-only FCM message to multiple tokens via Firebase Admin SDK.
 * All values are stringified (FCM data messages require string values).
 * Returns a list of invalid tokens that should be cleaned up.
 *
 * Optional `{ senderUniqueId, recipientUniqueId }` opts the call into
 * the UK OSA #17 PR 11 cohort filter — when both are provided and
 * distinct, cross-cohort pairs are silently dropped at dispatch.
 */
async function sendFcmToTokens(tokens, data, { senderUniqueId, recipientUniqueId } = {}) {
  if (!tokens || tokens.length === 0) return [];

  if (
    senderUniqueId !== undefined &&
    senderUniqueId !== null &&
    recipientUniqueId !== undefined &&
    recipientUniqueId !== null &&
    String(senderUniqueId) !== String(recipientUniqueId) &&
    (await isCrossCohortDispatch(senderUniqueId, recipientUniqueId))
  ) {
    // Silent drop. No local-mode capture (cross-cohort drops must not
    // pollute integration-test buffers — tests assert "no payload"
    // means "no payload", not "captured but flagged").
    return [];
  }

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
