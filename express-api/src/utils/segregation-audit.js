/**
 * UK OSA #17 PR 8 + PR 11 — segregation audit helpers.
 *
 * Centralised here (not in `src/middleware/sameCohort.js`) so the
 * helpers are callable from any route file or background utility
 * without dragging in the `requireSameCohort` middleware machinery.
 * The migration script (`scripts/migrate-segregation-relationships.js`)
 * writes the bulk audit rows; these helpers capture per-request and
 * per-dispatch events.
 *
 *   - `auditAdminFlagBypass` (PR 8): an admin moderator read a thread
 *     that was hidden by `crossCohortAtMigration: true`. Forensic
 *     record for UK OSA / GDPR Article 30 auditability.
 *   - `auditFcmCohortDrop` (PR 11): the FCM dispatcher silently
 *     dropped a push because sender and recipient resolved to
 *     different cohorts. Identities are passed directly because the
 *     dispatcher runs without a `req` context (cron, async fan-out,
 *     retry workers can all reach it).
 *
 * All audit writes are fire-and-forget by design. Failure must NEVER
 * block the calling code path (would itself be an existence side-
 * channel via timing or surfaced errors). Errors are swallowed —
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

// PR 11 audit-write dedup. Mirrors the rationale in
// `middleware/sameCohort.js`: a determined attacker could spam cross-
// cohort pushes (DMs, room invites, seat requests) to force a write
// per call. Spark-tier daily-write budget (~20K) drains in minutes
// under attack, both DoS-ing the DEV project and corrupting the audit
// signal admins read. The DROP (load-bearing security action) stays
// unconditional in `fcm.js`; only the supplementary audit row is
// throttled. 1 write per (sender, recipient) pair per 5 minutes is the
// same window PR 4 uses for HTTP gates.
const FCM_AUDIT_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const FCM_AUDIT_DEDUP_MAX_KEYS = 10_000;
const fcmAuditDedup = {
  hits: new Map(),
  shouldWrite(sourceId, targetId) {
    const key = `${sourceId}:${targetId}`;
    const now = Date.now();
    const entry = this.hits.get(key);
    if (entry && now < entry.expiresAt) {
      this.hits.delete(key);
      this.hits.set(key, entry);
      return false;
    }
    this.hits.set(key, { expiresAt: now + FCM_AUDIT_DEDUP_WINDOW_MS });
    while (this.hits.size > FCM_AUDIT_DEDUP_MAX_KEYS) {
      const oldestKey = this.hits.keys().next().value;
      this.hits.delete(oldestKey);
    }
    return true;
  },
  reset() {
    this.hits.clear();
  },
};

function auditFcmCohortDrop({ sourceUniqueId, sourceCohort, targetUniqueId, targetCohort }) {
  const sourceId = String(sourceUniqueId);
  const targetId = String(targetUniqueId);
  if (!fcmAuditDedup.shouldWrite(sourceId, targetId)) {
    return Promise.resolve();
  }
  return db
    .collection('segregationEvents')
    .add({
      sourceUniqueId: sourceId,
      sourceCohort,
      targetUniqueId: targetId,
      targetCohort,
      surface: 'fcm:dispatch',
      action: 'push_blocked',
      timestamp: Date.now(),
      requestId: null,
    })
    .catch(() => {
      // Swallowed — the drop is the load-bearing security action;
      // the audit row is supplemental. Logging here would itself be
      // an "audit failed" side-channel.
    });
}

// Test-only: reset the dedup store between tests. Gated behind a test-
// env check for the same reason as `sameCohort._resetAuditDedup` — a
// route inadvertently exporting this would let an attacker wipe the
// dedup window and DoS the Spark-tier write quota in production.
const _resetFcmAuditDedup =
  process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined
    ? function _resetFcmAuditDedupTestOnly() {
        fcmAuditDedup.reset();
      }
    : function _resetFcmAuditDedupNoop() {};

module.exports = { auditAdminFlagBypass, auditFcmCohortDrop, _resetFcmAuditDedup };
