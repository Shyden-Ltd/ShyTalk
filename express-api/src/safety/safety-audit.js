'use strict';

/**
 * SHY-0060 — audit log of BLOCKED age-gate attempts (AC53).
 *
 * Every block writes one row to the `safetyAudit` collection for compliance
 * reporting + abuse detection (repeated failed attempts on age-gated features).
 * The write is FIRE-AND-FORGET (AC79): the caller does not await it and it can
 * never fail or delay the gate response — a Firestore hiccup is swallowed with
 * a logged error, not propagated.
 *
 * PII: the userId is SHA-256 hashed (AC53/AC85 — never plaintext in audit
 * logs). Only the numeric age + ISO region + threshold are stored alongside;
 * the DOB is never written here.
 */

const crypto = require('node:crypto');
const log = require('../utils/log');
const { now } = require('../utils/helpers');

const SAFETY_AUDIT_COLLECTION = 'safetyAudit';

/** Stable SHA-256 of a userId — the only identifier persisted to the audit. */
function hashUserId(userId) {
  return crypto
    .createHash('sha256')
    .update(String(userId ?? ''))
    .digest('hex');
}

/**
 * Fire-and-forget: record one blocked attempt. Returns the write Promise (so a
 * test can await it) but callers on the request path must NOT await — the
 * `.catch` keeps a failed write from becoming an unhandled rejection.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} p
 * @param {number|string} p.userId  hashed before storage
 * @param {string} p.feature
 * @param {number} p.threshold      the age the feature required
 * @param {number|null} p.userAge   the user's verified age, or null (unverified)
 * @param {string|null} p.region    ISO alpha-2, or null (undetected)
 * @returns {Promise<unknown>}
 */
function logBlockedFeatureAttempt(db, { userId, feature, threshold, userAge, region }) {
  const entry = {
    userIdHash: hashUserId(userId),
    feature,
    threshold,
    userAge: userAge ?? null,
    region: region ?? null,
    timestamp: now(),
  };
  return db
    .collection(SAFETY_AUDIT_COLLECTION)
    .add(entry)
    .catch((err) => {
      log.error('safety-audit', 'Failed to write blocked-attempt audit', {
        feature,
        error: err?.message,
      });
    });
}

module.exports = { logBlockedFeatureAttempt, hashUserId, SAFETY_AUDIT_COLLECTION };
