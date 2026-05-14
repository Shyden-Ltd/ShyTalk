/**
 * UK OSA #17 PR 8 — segregation audit helpers.
 *
 * Centralised here (not in `src/middleware/sameCohort.js`) so the
 * helper is callable from any route file without dragging in the
 * `requireSameCohort` middleware machinery. The migration script
 * (`scripts/migrate-segregation-relationships.js`) writes the bulk
 * audit rows; these helpers capture per-request events.
 *
 *   - `auditAdminFlagBypass`: an admin moderator read a thread that
 *     was hidden by `crossCohortAtMigration: true`. Forensic record
 *     for UK OSA / GDPR Article 30 auditability.
 *
 * Fire-and-forget by design. Failure must NEVER block the calling
 * response (would itself be an existence side-channel). Errors are
 * swallowed because (a) the migration script already wrote a
 * permanent row per migrated thread, (b) PR 4's auditDedup row fires
 * for the runtime cohort gate path, so the admin-bypass row is
 * supplemental telemetry, not the only signal.
 */

const { db } = require('./firebase');

function surfaceOf(req) {
  if (req?.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  return `${req.baseUrl || ''}${req?.path || ''}`;
}

function auditAdminFlagBypass(req, conversationId) {
  const callerId = String(req?.auth?.uniqueId ?? '');
  db.collection('segregationEvents')
    .add({
      sourceUniqueId: callerId,
      sourceCohort: req?.auth?.token?.cohort || 'unknown',
      targetUniqueId: conversationId,
      targetConversationId: conversationId,
      targetCohort: 'mixed',
      surface: surfaceOf(req),
      action: 'admin_flag_bypass',
      timestamp: Date.now(),
      requestId: req?.id ?? null,
    })
    .catch(() => {
      // Audit-write failure does not surface to the response: a
      // failed audit is a known-acceptable trade-off here since the
      // migration script already wrote a row per migrated thread.
      // Logging a failure here would also leak "audit attempted"
      // signals across requests.
    });
}

module.exports = { auditAdminFlagBypass };
