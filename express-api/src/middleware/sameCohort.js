/**
 * UK OSA #17 PR 4 — `requireSameCohort` gate + `segregationEvents`
 * audit logger. Wired into user-to-user interaction routes so that
 * cross-cohort requests (adult ↔ minor) return `404 Not Found` with
 * a byte-identical body to the legitimate "target user not found"
 * branch.
 *
 * The 404 (rather than 403) is deliberate: 403 leaks the existence
 * of a cross-cohort user, which defeats the segregation goal. See
 * `.project/plans/2026-05-13-age-segregation-design.md` § "404 not
 * 403".
 *
 * Admin callers bypass the gate (they need cross-cohort visibility
 * for moderation) and no audit doc is written for admin actions.
 *
 * Failure mode: if the `segregationEvents` write fails, the caller
 * still receives the 404. The audit error is logged via `log.error`
 * but never surfaced to the client — leaking "audit failed" would
 * itself be an existence side-channel.
 */

const { db } = require('../utils/firebase');
const { effectiveCohort, cohortFromClaim } = require('../utils/firebase-claims');
const { isLiveAdmin } = require('./auth');
const log = require('../utils/log');

function surfaceOf(req) {
  // Prefer the route template (`/users/:uniqueId/follow`) — it's the
  // useful aggregation key for security analytics. Fall back to the
  // concrete path if there's no matched route on the request.
  if (req?.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  return `${req.baseUrl || ''}${req.path || ''}`;
}

// Audit-write dedup. A determined attacker (or bot net) could spam
// cross-cohort attempts and exhaust the Firestore daily-write quota
// — both DoS-ing the DEV Spark-tier project and corrupting the
// audit signal admins rely on. Synchronous LRU of recently-logged
// `source:target:surface` tuples — write only the first hit in the
// dedup window. The actual 404 response still fires every time —
// only the audit doc creation is throttled.
const AUDIT_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const AUDIT_DEDUP_MAX_KEYS = 10_000;
const auditDedup = {
  hits: new Map(),
  shouldWrite(sourceId, targetId, surface) {
    const key = `${sourceId}:${targetId}:${surface}`;
    const now = Date.now();
    const entry = this.hits.get(key);
    if (entry && now < entry.expiresAt) {
      // LRU touch: re-insert to mark as most-recent.
      this.hits.delete(key);
      this.hits.set(key, entry);
      return false;
    }
    this.hits.set(key, { expiresAt: now + AUDIT_DEDUP_WINDOW_MS });
    while (this.hits.size > AUDIT_DEDUP_MAX_KEYS) {
      const oldestKey = this.hits.keys().next().value;
      this.hits.delete(oldestKey);
    }
    return true;
  },
  reset() {
    this.hits.clear();
  },
};

async function requireSameCohort(req, res, targetUniqueId, fetchUserFn) {
  // Self-target short-circuit. Centralised here so callers don't
  // each need their own `if (caller === target) skip-gate` guard.
  const callerUniqueId = req?.auth?.uniqueId;
  if (
    callerUniqueId !== undefined &&
    callerUniqueId !== null &&
    String(targetUniqueId) === String(callerUniqueId)
  ) {
    return false;
  }

  // Admin bypass — re-verifies via the live customClaims store so a
  // demoted admin can't keep cross-cohort visibility for the rest of
  // their ID-token lifetime (~1h). Mirrors the `requireAdmin` two-
  // layer pattern in auth.js. 60s cache in `adminClaimCache` keeps
  // the hot path cheap.
  if (req?.auth?.token?.admin === true) {
    const liveAdmin = req?.auth?.uid ? await isLiveAdmin(req.auth.uid) : false;
    if (liveAdmin) return false;
  }

  const targetDoc = await fetchUserFn(targetUniqueId);
  if (!targetDoc) {
    res.status(404).json({ error: 'Not found' });
    return true;
  }

  const callerCohort = cohortFromClaim(req);
  const targetCohort = effectiveCohort(targetDoc);
  if (callerCohort === targetCohort) return false;

  // Cross-cohort. Fire-and-forget audit (deduped), then 404. The
  // audit failure must NEVER leak via the response — `.catch` keeps
  // the 404 path unconditional.
  const surface = surfaceOf(req);
  const sourceUniqueId = String(req?.auth?.uniqueId ?? '');
  if (auditDedup.shouldWrite(sourceUniqueId, String(targetUniqueId), surface)) {
    writeSegregationEvent({
      sourceUniqueId,
      sourceCohort: callerCohort,
      targetUniqueId: String(targetUniqueId),
      targetCohort,
      surface,
      action: 'blocked',
      timestamp: Date.now(),
      requestId: req?.id ?? null,
    }).catch((err) =>
      log.error('segregationEvents', 'write failed', { error: err?.message || String(err) }),
    );
  }

  res.status(404).json({ error: 'Not found' });
  return true;
}

async function writeSegregationEvent(evt) {
  await db.collection('segregationEvents').add(evt);
}

// Test-only: reset the dedup store between tests so per-test
// expectations on segregationEvents writes are independent.
//
// SECURITY: gate the export behind a test-env check. Reachable from a
// production route file (via `require` of this middleware) would let a
// route inadvertently — or maliciously — wipe the dedup window, which
// would let an attacker spam the audit collection without throttling
// (DoS the Spark-tier Firestore quota; corrupt the signal admins read).
// The export is a no-op outside Jest / explicit test env.
const _resetAuditDedup =
  process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined
    ? function _resetAuditDedupTestOnly() {
        auditDedup.reset();
      }
    : function _resetAuditDedupNoop() {
        // Intentional no-op outside tests. The dedup store is the
        // load-bearing audit-DoS defence in production.
      };

module.exports = { requireSameCohort, writeSegregationEvent, _resetAuditDedup };
