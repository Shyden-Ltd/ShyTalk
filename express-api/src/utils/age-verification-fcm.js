/**
 * FCM push handlers for the three age-verification decision outcomes
 * (PR 10/14). Sends a data-only push to the user's stored fcmTokens
 * so the Android service can render a local notification while the
 * app is backgrounded — the system PM (PR 5) handles the in-app side
 * when the app is open.
 *
 * Best-effort by design:
 *   - No-op when the user has no fcmTokens (logged-out / no push
 *     permission) — these users will see the system PM next launch.
 *   - Sends are awaited at the call site but errors are swallowed
 *     into a structured log; the admin decision must NOT fail just
 *     because a push couldn't go through. The admin-age-verification
 *     route has a partial-failure flag (`pushNotified`) for ops.
 *
 * Wire format mirrors the existing PM push (data-only, all values
 * stringified). Type strings are the dispatch key the Android
 * `ShyTalkMessagingService` switches on:
 *   - AGE_VERIF_APPROVED
 *   - AGE_VERIF_REJECTED
 *   - AGE_VERIF_DOB_MODIFIED  (modifiedToVerified flag tells the
 *     handler whether to show the approve-style or reject-style copy)
 */

const { db } = require('./firebase');
const { sendFcmToTokens, cleanupInvalidTokens } = require('./fcm');
const log = require('./log');

async function loadFcmTokens(targetUserId) {
  const snap = await db.doc(`users/${targetUserId}`).get();
  if (!snap.exists) return { tokens: [], userExists: false };
  const tokens = snap.data().fcmTokens;
  return {
    tokens: Array.isArray(tokens) ? tokens : [],
    userExists: true,
  };
}

async function sendOutcomePush(targetUserId, data) {
  try {
    const { tokens, userExists } = await loadFcmTokens(targetUserId);
    if (!userExists) {
      log.warn('age-verification-fcm', 'Target user missing — skipping push', {
        targetUserId,
        type: data.type,
      });
      return false;
    }
    if (tokens.length === 0) return true; // not a failure — no devices
    const invalid = await sendFcmToTokens(tokens, data);
    if (invalid.length > 0) {
      // Best-effort cleanup of stale tokens — pruning failures here
      // shouldn't block the decision flow, but they MUST surface in
      // logs so ops can spot a Firestore-permission regression that
      // would otherwise let stale tokens accumulate forever.
      cleanupInvalidTokens(invalid, targetUserId).catch((cleanupErr) => {
        log.warn('age-verification-fcm', 'Stale-token cleanup failed', {
          targetUserId,
          invalidCount: invalid.length,
          error: cleanupErr?.message,
          code: cleanupErr?.code,
        });
      });
    }
    return true;
  } catch (err) {
    log.error('age-verification-fcm', 'push send failed', {
      targetUserId,
      type: data.type,
      error: err?.message,
      code: err?.code,
    });
    return false;
  }
}

/** Push for the Approve decision — the user is now 18+ verified. */
async function sendAgeVerificationApprovedPush(targetUserId) {
  return sendOutcomePush(targetUserId, {
    type: 'AGE_VERIF_APPROVED',
    targetUserId: String(targetUserId),
  });
}

/**
 * Push for the Reject decision. `reason` is the admin's user-facing
 * justification that's already in the system PM — we forward a short
 * preview so the lock-screen notification has substance.
 */
async function sendAgeVerificationRejectedPush(targetUserId, reason) {
  return sendOutcomePush(targetUserId, {
    type: 'AGE_VERIF_REJECTED',
    targetUserId: String(targetUserId),
    // Cap the reason at 80 chars for the lock-screen preview. The full
    // text is in the system PM body.
    reasonPreview: typeof reason === 'string' ? reason.slice(0, 80) : '',
  });
}

/**
 * Push for the Modify-DOB decision. `becameVerified` true means the
 * new DOB makes the user 18+ — handler renders approve-style copy.
 * Otherwise renders reject-style "still locked" copy.
 */
async function sendAgeVerificationDobModifiedPush(targetUserId, becameVerified) {
  return sendOutcomePush(targetUserId, {
    type: 'AGE_VERIF_DOB_MODIFIED',
    targetUserId: String(targetUserId),
    becameVerified: String(Boolean(becameVerified)),
  });
}

module.exports = {
  sendAgeVerificationApprovedPush,
  sendAgeVerificationRejectedPush,
  sendAgeVerificationDobModifiedPush,
};
