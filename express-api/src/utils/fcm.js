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
const INVALID_IDENTIFIER_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/sender-id-mismatch',
  'messaging/invalid-argument',
]);

/**
 * Send a data-only FCM message to a user's devices, whichever registration
 * model each of them speaks.
 *
 * SHY-0244. Firebase Messaging deprecated the registration-token model in
 * favour of registering by Firebase Installation ID. On the CLIENT the two are
 * mutually exclusive -- a manifest flag switches the whole app instance -- so a
 * given build speaks one or the other, and a fleet mid-rollover speaks both.
 *
 * The server has no such constraint. firebase-admin 14 accepts `tokens` and
 * `fids` in the same `sendEachForMulticast` call, so both populations are
 * reached in ONE dispatch and no flag day is needed here.
 *
 * Returns `{ invalidTokens, invalidFids }` SEPARATELY, because a rejected
 * entry has to be removed from the array it actually came from. Guessing which
 * kind an identifier was by looking at its shape would decide who receives a
 * moderation notice on a string format.
 */
async function sendFcmToIdentifiers(
  { tokens = [], fids = [] } = {},
  data,
  { senderUniqueId, recipientUniqueId } = {},
) {
  const tokenList = tokens || [];
  const fidList = fids || [];
  const empty = { invalidTokens: [], invalidFids: [] };
  if (tokenList.length === 0 && fidList.length === 0) return empty;

  if (
    senderUniqueId !== undefined &&
    senderUniqueId !== null &&
    recipientUniqueId !== undefined &&
    recipientUniqueId !== null &&
    String(senderUniqueId) !== String(recipientUniqueId) &&
    (await isCrossCohortDispatch(senderUniqueId, recipientUniqueId))
  ) {
    // Silent drop. No local-mode capture (cross-cohort drops must not
    // pollute integration-test buffers -- tests assert "no payload"
    // means "no payload", not "captured but flagged").
    return empty;
  }

  if (process.env.NODE_ENV === 'local') {
    captureLocal([...tokenList, ...fidList], data);
    log.info(
      'fcm',
      `[FCM-LOCAL] Would send to ${tokenList.length} tokens + ${fidList.length} fids: ${data?.title}`,
    );
    return empty;
  }

  const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

  // Empty arrays are OMITTED rather than sent. `{ tokens: [] }` is a different
  // request from one with no `tokens` key at all, and a plausible argument
  // error.
  const message = { data: stringData };
  if (tokenList.length > 0) message.tokens = tokenList;
  if (fidList.length > 0) message.fids = fidList;

  const result = await messaging.sendEachForMulticast(message);

  // The SDK processes tokens first, then fids, and `responses` follows that
  // order. Reading the mapping backwards would reap a LIVE device and keep the
  // dead one -- invisibly, since a reap has no symptom until somebody stops
  // receiving notifications.
  const ordered = [
    ...tokenList.map((value) => ({ value, kind: 'token' })),
    ...fidList.map((value) => ({ value, kind: 'fid' })),
  ];

  const invalidTokens = [];
  const invalidFids = [];
  result.responses.forEach((resp, i) => {
    if (!resp.error) return;
    const code = resp.error.code;
    const entry = ordered[i];
    if (!entry) {
      // More responses than identifiers sent: the mapping assumption this
      // function rests on has been broken by the SDK. Reaping on a mapping we
      // no longer trust could delete live devices, so nothing is reaped.
      log.warn('fcm', `FCM returned response ${i} with no identifier sent for it`, { code });
      return;
    }
    if (INVALID_IDENTIFIER_CODES.has(code)) {
      if (entry.kind === 'token') invalidTokens.push(entry.value);
      else invalidFids.push(entry.value);
    } else {
      log.warn('fcm', `FCM send failed for ${entry.kind} index ${i}`, {
        code,
        message: resp.error.message,
      });
    }
  });

  return { invalidTokens, invalidFids };
}

/**
 * Token-only dispatch, kept for the callers that have not moved yet.
 *
 * Returns the bare invalid-token list its callers already expect, so this stays
 * a drop-in. New call sites should use `sendFcmToIdentifiers`.
 */
async function sendFcmToTokens(tokens, data, opts = {}) {
  const { invalidTokens } = await sendFcmToIdentifiers({ tokens: tokens || [] }, data, opts);
  return invalidTokens;
}

/**
 * Remove rejected identifiers from the fields they actually came from.
 *
 * SHY-0244. Tokens live in `fcmTokens` and installation IDs in
 * `fcmInstallationIds`, so each is reaped from its own array. Removing a fid
 * from `fcmTokens` would be a silent no-op that leaves the dead entry in place
 * forever.
 */
async function cleanupInvalidIdentifiers({ invalidTokens = [], invalidFids = [] } = {}, userId) {
  if (!userId) return;
  if (invalidTokens.length === 0 && invalidFids.length === 0) return;
  if (process.env.NODE_ENV === 'local') return;

  const update = {};
  if (invalidTokens.length > 0) update.fcmTokens = FieldValue.arrayRemove(...invalidTokens);
  if (invalidFids.length > 0) {
    update.fcmInstallationIds = FieldValue.arrayRemove(...invalidFids);
  }

  try {
    await db.doc(`users/${userId}`).update(update);
  } catch (err) {
    log.error('fcm', 'Failed to clean invalid identifiers', { userId, error: err.message });
  }
}

/**
 * Push to one user: read their identifiers, dispatch once, reap what bounced.
 *
 * SHY-0244. This exists because ten call sites each repeated that sequence by
 * hand, and four of them silently skipped the reap -- `users.js`,
 * `admin-users.js` and both sites in `suggestions.js` discarded the invalid
 * list, so dead identifiers accumulated there indefinitely. A caller cannot
 * forget a step it no longer performs.
 *
 * `opts.userData` lets a caller that already holds the user document avoid a
 * second read; everything else is identical.
 */
async function sendPushToUser(userId, data, { userData, senderUniqueId, recipientUniqueId } = {}) {
  let user = userData;
  if (!user) {
    const snap = await db.doc(`users/${userId}`).get();
    if (!snap || !snap.exists) {
      log.warn('fcm', `push requested for user ${userId} but no user document exists`);
      return;
    }
    user = snap.data() || {};
  }

  const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
  const fids = Array.isArray(user.fcmInstallationIds) ? user.fcmInstallationIds : [];

  if (tokens.length === 0 && fids.length === 0) {
    // Loud on purpose. A dispatch that reaches nobody and returns success is
    // indistinguishable from a delivered push, which is how a push outage runs
    // undetected on a surface that carries moderation notices.
    log.warn('fcm', `no push identifiers stored for user ${userId} — notification reached nobody`, {
      type: data?.type,
    });
    return;
  }

  const invalid = await sendFcmToIdentifiers({ tokens, fids }, data, {
    senderUniqueId,
    recipientUniqueId,
  });

  await cleanupInvalidIdentifiers(invalid, userId);
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
  sendPushToUser,
  sendFcmToIdentifiers,
  cleanupInvalidIdentifiers,
  sendFcmToTokens,
  cleanupInvalidTokens,
  getFcmCaptures,
  clearFcmCaptures,
};
