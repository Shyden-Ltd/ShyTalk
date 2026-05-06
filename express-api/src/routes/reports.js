/**
 * Report & moderation routes — reports, suspensions, appeals, audit log.
 *
 * POST   /api/reports                       → Submit a report
 * GET    /api/reports                       → List reports (admin, enriched, filterable)
 * POST   /api/reports/:id/resolve           → Resolve a report with full logic (admin)
 * POST   /api/reports/resolve-all/:userId   → Resolve all pending reports for user (admin)
 * GET    /api/reports/stats                 → Report statistics (admin)
 * GET    /api/reports/export                → CSV export of resolved reports (admin)
 * POST   /api/reports/:id/lock              → Lock a report (admin)
 * DELETE /api/reports/:id/lock              → Unlock a report (admin)
 * POST   /api/admin/users/:uniqueId/suspend      → Suspend a user (admin)
 * POST   /api/admin/users/:uniqueId/unsuspend    → Unsuspend a user (admin)
 * GET    /api/appeals                       → List appeals (admin)
 * PATCH  /api/appeals/:id                   → Review an appeal (admin)
 * POST   /api/appeals                       → Submit an appeal
 * GET    /api/admin/audit-log               → Get admin audit log (admin)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin, clearSuspensionCache, resolveUniqueId } = require('../middleware/auth');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');
const { getDoc, queryDocs } = require('../utils/firestore-helpers');
const { sendFcmToTokens } = require('../utils/fcm');
const log = require('../utils/log');
const { createWarning } = require('./admin-users');

// See admin-users.js for rationale; same caps apply here so a long reason
// can't sneak in through the report-resolve path and bypass the warn/suspend
// boundary checks. The reporter-side caps below cover POST /reports input
// — without them, a regular user could write up to the 1MB body limit per
// report, and admin resolution would propagate that string into multiple
// Firestore documents (warnings + user doc + audit log).
const REASON_MAX_LENGTH = 500;
const ADMIN_NOTE_MAX_LENGTH = 2000;
const DESCRIPTION_MAX_LENGTH = 2000;
const MESSAGE_TEXT_MAX_LENGTH = 1000;
// reportedUserName is forwarded into the FCM admin-alert payload at the bottom of
// POST /reports. FCM rejects oversized payloads with `messaging/invalid-argument`,
// which `cleanupInvalidAdminTokens` then matches and DELETES from every admin doc —
// so a single oversized report could blackhole all admin push notifications. Cap
// matches the displayName max in the user model.
const REPORTED_USER_NAME_MAX_LENGTH = 50;
// evidenceUrls is iterated by the orphan-storage cron, which loads up to 1000 reports'
// urls into a Set in memory. Cap entry-count + per-entry length so a malicious report
// can't OOM the cron on the Oracle Cloud free tier (1 GB RAM).
const EVIDENCE_URLS_MAX_COUNT = 10;
const EVIDENCE_URL_MAX_LENGTH = 500;

// Stable error tokens for the moderation partial-failure contract. Centralised
// so the admin client (public/admin/js/tabs/reports.js) references one source of
// truth — a typo or rename in either handler would otherwise silently break the
// consumer's branch on the response body. Keys suffix `_FAILED` to mirror the
// value tokens; locked by a snapshot test.
const MOD_ERROR = Object.freeze({
  WARNING_CREATE_FAILED: 'warning_create_failed',
  SUSPENSION_UPDATE_FAILED: 'suspension_update_failed',
  CASCADE_FAILED: 'cascade_failed',
  AUDIT_WRITE_FAILED: 'audit_write_failed',
  REPORTS_COMMIT_FAILED: 'reports_commit_failed',
});

// Wrap a thunk so a synchronous throw becomes a rejected promise instead of
// bubbling to the caller. The Promise.resolve().then(opThunk) trampoline
// catches sync throws inside opThunk; .catch(onError) absorbs both that and
// async rejection. Used wherever a fire-and-forget side-effect (audit log,
// lock release) must NOT 500 a fully-applied moderation action.
function safeFireAndForget(opThunk, onError) {
  return Promise.resolve().then(opThunk).catch(onError);
}

/**
 * Remove invalid FCM tokens from admin user docs in Firestore.
 * For each invalid token, finds which admin user doc contains it and removes it.
 */
async function cleanupInvalidAdminTokens(invalidTokens, adminUsers) {
  if (!invalidTokens || invalidTokens.length === 0) return;

  const invalidSet = new Set(invalidTokens);

  for (let i = 0; i < adminUsers.length; i += 500) {
    const chunk = adminUsers.slice(i, i + 500);
    const batch = db.batch();
    let hasWrites = false;

    for (const u of chunk) {
      if (!Array.isArray(u.fcmTokens)) continue;
      const filtered = u.fcmTokens.filter((t) => !invalidSet.has(t));
      if (filtered.length !== u.fcmTokens.length) {
        batch.set(db.doc(`users/${u.id}`), { fcmTokens: filtered }, { merge: true });
        hasWrites = true;
      }
    }

    if (hasWrites) await batch.commit();
  }
}

// ─── Route definitions ───────────────────────────────────────────

// ── Submit report ──
router.post('/reports', async (req, res) => {
  try {
    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const {
      reportedUserId,
      reportedUserName,
      conversationId,
      messageId,
      messageText,
      reason,
      description,
      evidenceUrls,
    } = body;

    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: 'reportedUserId and reason required' });
    }

    // Reporter-side text caps. Without these, a regular authenticated user
    // can submit up to ~1MB strings, and admin resolution propagates them
    // into 3 Firestore docs (warning, user doc, audit log).
    if (typeof reason !== 'string' || reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== 'string' || description.length > DESCRIPTION_MAX_LENGTH)
    )
      return res.status(400).json({ error: `description exceeds ${DESCRIPTION_MAX_LENGTH} chars` });
    if (
      messageText !== undefined &&
      messageText !== null &&
      (typeof messageText !== 'string' || messageText.length > MESSAGE_TEXT_MAX_LENGTH)
    )
      return res
        .status(400)
        .json({ error: `messageText exceeds ${MESSAGE_TEXT_MAX_LENGTH} chars` });
    if (
      reportedUserName !== undefined &&
      reportedUserName !== null &&
      (typeof reportedUserName !== 'string' ||
        reportedUserName.length > REPORTED_USER_NAME_MAX_LENGTH)
    )
      return res
        .status(400)
        .json({ error: `reportedUserName exceeds ${REPORTED_USER_NAME_MAX_LENGTH} chars` });
    if (evidenceUrls !== undefined && evidenceUrls !== null) {
      if (!Array.isArray(evidenceUrls))
        return res.status(400).json({ error: 'evidenceUrls must be an array' });
      if (evidenceUrls.length > EVIDENCE_URLS_MAX_COUNT)
        return res
          .status(400)
          .json({ error: `evidenceUrls exceeds ${EVIDENCE_URLS_MAX_COUNT} entries` });
      for (const url of evidenceUrls) {
        if (typeof url !== 'string' || url.length > EVIDENCE_URL_MAX_LENGTH)
          return res
            .status(400)
            .json({ error: `evidenceUrls entry exceeds ${EVIDENCE_URL_MAX_LENGTH} chars` });
      }
    }

    // Server-authoritative uniqueId resolution. Trusting client-supplied
    // reportedUserUniqueId would let any reporter cause an admin to suspend
    // an arbitrary chosen victim — when admin resolves with action='suspended',
    // the cascade keys off reportedUserUniqueId and immediately closes that
    // user's rooms regardless of who actually owns the reported behaviour.
    const reportedUserUniqueId = await resolveUniqueId(reportedUserId);
    if (!reportedUserUniqueId) {
      return res.status(400).json({ error: 'reportedUserId does not match any known user' });
    }

    // Fetch reporter info
    const reporter = await getDoc(`users/${req.auth.uniqueId}`);

    const reportId = generateId();
    const timestamp = now();

    await db.doc(`reports/${reportId}`).set(
      {
        reporterId: req.auth.uniqueId,
        reporterName: reporter?.displayName ?? reporter?.display_name ?? null,
        reporterUniqueId: reporter?.uniqueId ?? reporter?.unique_id ?? null,
        reportedUserId: reportedUserId,
        reportedUserName: reportedUserName || null,
        reportedUserUniqueId,
        conversationId: conversationId || null,
        messageId: messageId || null,
        messageText: messageText || null,
        reason: reason,
        description: description || null,
        evidenceUrls: evidenceUrls || [],
        status: 'pending',
        actionTaken: null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: timestamp,
      },
      { merge: true },
    );

    // Fire-and-forget: FCM push notification to admin tokens
    (async () => {
      try {
        const adminUsers = await queryDocs(db.collection('users').where('userType', '==', 'ADMIN'));
        const tokens = [];
        for (const u of adminUsers) {
          if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
        }
        if (tokens.length > 0) {
          const data = {
            type: 'ADMIN_NEW_REPORT',
            reportId,
            reason,
            reportedUserName: reportedUserName || 'Unknown',
          };
          const invalid = await sendFcmToTokens(tokens, data);
          await cleanupInvalidAdminTokens(invalid, adminUsers);
        }
      } catch (err) {
        log.error('reports', 'Failed to send report notification', { error: err.message });
      }
    })().catch((err) =>
      log.error('reports', 'Report notification fire-and-forget failed', { error: err.message }),
    );

    res.json({ success: true, reportId });
  } catch (err) {
    log.error('reports', 'POST /api/reports failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List reports (admin — enriched, filterable) ──
router.get('/reports', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const statusFilter = req.query.status || 'pending';
    const userIdFilter = req.query.userId;
    const search = req.query.search?.toLowerCase();

    // Build Firestore query — only use status + orderBy to avoid needing a
    // composite index.  The userId filter is applied client-side afterwards.
    const direction = statusFilter === 'pending' ? 'asc' : 'desc';
    const query = db
      .collection('reports')
      .where('status', '==', statusFilter)
      .orderBy('createdAt', direction)
      .limit(500);

    const reports = await queryDocs(query);

    // Client-side userId filter (avoids Firestore composite index requirement)
    const userFiltered = userIdFilter
      ? reports.filter((r) => r.reportedUserId === userIdFilter)
      : reports;

    // Client-side search filter (Firestore doesn't support full-text search)
    const filtered = search
      ? userFiltered.filter(
          (r) =>
            (r.reportedUserName || '').toLowerCase().includes(search) ||
            (r.reporterName || '').toLowerCase().includes(search) ||
            (r.reason || '').toLowerCase().includes(search) ||
            (r.description || '').toLowerCase().includes(search),
        )
      : userFiltered;

    // Collect all unique user IDs for enrichment.
    // User documents are keyed by uniqueId (numeric), NOT Firebase Auth UID.
    // Re-resolve reportedUserUniqueId server-side from each unique reportedUserId
    // rather than trusting `r.reportedUserUniqueId` from the stored report — pre-IDOR-fix
    // reports may carry a client-injected value, which would surface the wrong
    // user's profile in the admin moderation queue.
    const reportedUserIds = [...new Set(filtered.map((r) => r.reportedUserId).filter(Boolean))];
    const reportedUniqueIdMap = {}; // reportedUserId → server-resolved reportedUserUniqueId
    // Promise.allSettled (not Promise.all) so a single transient lookup failure
    // doesn't 500 the entire moderation queue. Reports whose target user can't
    // be resolved render with reportedUser: null instead.
    const resolutionResults = await Promise.allSettled(
      reportedUserIds.map((uid) => resolveUniqueId(uid)),
    );
    resolutionResults.forEach((result, idx) => {
      const uid = reportedUserIds[idx];
      if (result.status === 'fulfilled' && result.value) {
        reportedUniqueIdMap[uid] = result.value;
      } else if (result.status === 'rejected') {
        log.warn('reports', 'resolveUniqueId failed during list enrichment', {
          reportedUserId: uid,
          error: result.reason?.message,
        });
      }
    });
    const reportedUniqueIds = [...new Set(Object.values(reportedUniqueIdMap))];
    const reporterIds = [...new Set(filtered.map((r) => r.reporterId).filter(Boolean))];

    // Parallel-fetch user enrichment data and report locks
    const [reportedUserDocs, reporterDocs, locks] = await Promise.all([
      Promise.all(reportedUniqueIds.map((uid) => getDoc(`users/${uid}`))),
      Promise.all(reporterIds.map((uid) => getDoc(`users/${uid}`))),
      queryDocs(db.collection('reportLocks')),
    ]);

    // Build lookup maps — index by reportedUserId for enrichment
    const userMap = {};
    for (let i = 0; i < reportedUniqueIds.length; i++) {
      const reportedUser = reportedUserDocs[i];
      if (reportedUser) {
        const gcsScore = reportedUser.gcsScore ?? reportedUser.gcs_score ?? 100;
        const gcsLastDeduction =
          reportedUser.gcsLastDeductionAt ?? reportedUser.gcs_last_deduction_at ?? null;
        reportedUser.gcsDisplayScore = computeDisplayScore(gcsScore, gcsLastDeduction);
        // Find the reportedUserId(s) that map to this uniqueId and index by them
        for (const [ruid, uniqueId] of Object.entries(reportedUniqueIdMap)) {
          if (String(uniqueId) === String(reportedUniqueIds[i])) {
            userMap[ruid] = reportedUser;
          }
        }
      }
    }

    const reporterMap = {};
    for (let i = 0; i < reporterIds.length; i++) {
      const reporter = reporterDocs[i];
      if (reporter) reporterMap[reporterIds[i]] = reporter;
    }

    const lockMap = {};
    for (const lock of locks) {
      // reportLocks documents are keyed by userId (the reported user)
      lockMap[lock.id] = lock;
    }

    // Enrich reports. Strip the stored `reportedUserUniqueId` (could be
    // client-injected on pre-IDOR-fix reports) and replace with the
    // server-resolved value from `reportedUniqueIdMap`. The admin UI keys
    // its "navigate to user" action off this field, so leaking the stored
    // value would let a malicious reporter steer admins to a wrong profile.
    const enriched = filtered.map((r) => {
      const { reportedUserUniqueId: _stored, ...rest } = r;
      return {
        ...rest,
        reportedUserUniqueId: reportedUniqueIdMap[r.reportedUserId] ?? null,
        evidenceUrls: r.evidenceUrls || [],
        reportedUser: userMap[r.reportedUserId] || null,
        reporter: reporterMap[r.reporterId] || null,
        lock: lockMap[r.reportedUserId] || null,
      };
    });

    // Group by reported user for pending reports
    if (statusFilter === 'pending') {
      const grouped = {};
      for (const r of enriched) {
        const key = r.reportedUserId;
        if (!grouped[key]) {
          grouped[key] = {
            reportedUserId: key,
            displayName: r.reportedUser?.displayName ?? r.reportedUser?.display_name ?? null,
            profilePhotoUrl:
              r.reportedUser?.profilePhotoUrl ?? r.reportedUser?.profile_photo_url ?? null,
            // Drop the `r.reportedUserUniqueId` fallback — it could be
            // client-injected on pre-IDOR-fix reports.
            uniqueId:
              r.reportedUser?.uniqueId ??
              r.reportedUser?.unique_id ??
              reportedUniqueIdMap[r.reportedUserId] ??
              null,
            warningCount: r.reportedUser?.warningCount ?? r.reportedUser?.warning_count ?? 0,
            isSuspended: r.reportedUser?.isSuspended ?? r.reportedUser?.is_suspended ?? false,
            gcsDisplayScore: r.reportedUser?.gcsDisplayScore ?? 100,
            lock: r.lock,
            reports: [],
            reportCount: 0,
          };
        }
        grouped[key].reports.push(r);
        grouped[key].reportCount = grouped[key].reports.length;
      }
      return res.json({ users: Object.values(grouped) });
    }

    // Resolved/archived: also group by reported user for consistent structure
    const grouped = {};
    for (const r of enriched) {
      const key = r.reportedUserId;
      if (!grouped[key]) {
        grouped[key] = {
          reportedUserId: key,
          displayName: r.reportedUser?.displayName ?? r.reportedUser?.display_name ?? null,
          profilePhotoUrl:
            r.reportedUser?.profilePhotoUrl ?? r.reportedUser?.profile_photo_url ?? null,
          // Drop the `r.reportedUserUniqueId` fallback (IDOR sliver, see comment above).
          uniqueId:
            r.reportedUser?.uniqueId ??
            r.reportedUser?.unique_id ??
            reportedUniqueIdMap[r.reportedUserId] ??
            null,
          warningCount: r.reportedUser?.warningCount ?? r.reportedUser?.warning_count ?? 0,
          isSuspended: r.reportedUser?.isSuspended ?? r.reportedUser?.is_suspended ?? false,
          gcsDisplayScore: r.reportedUser?.gcsDisplayScore ?? 100,
          lock: r.lock,
          reports: [],
          reportCount: 0,
        };
      }
      grouped[key].reports.push(r);
      grouped[key].reportCount = grouped[key].reports.length;
    }
    res.json({ users: Object.values(grouped) });
  } catch (err) {
    log.error('reports', 'GET /api/reports failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Normalise short action names sent by the admin panel to the canonical stored values.
// The admin panel sends 'warn' / 'suspend' / 'dismiss'; the backend stores 'warned' / 'suspended' / 'dismissed'.
const ACTION_ALIASES = { warn: 'warned', suspend: 'suspended', dismiss: 'dismissed' };
function normaliseAction(raw) {
  return ACTION_ALIASES[raw] || raw || 'dismissed';
}

// ── Resolve report (admin — full logic) ──
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (body?.reason && body.reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
    if (body?.adminNote && body.adminNote.length > ADMIN_NOTE_MAX_LENGTH)
      return res.status(400).json({ error: `adminNote exceeds ${ADMIN_NOTE_MAX_LENGTH} chars` });

    const action = normaliseAction(body?.action);
    const timestamp = now();

    // Fetch the report
    const report = await getDoc(`reports/${req.params.id}`);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Resolve the cascade target BEFORE marking the report resolved. If the target
    // user no longer exists, refuse with 404 so the report stays pending — otherwise
    // we'd have a status='resolved' report whose downstream warn/suspend actions
    // silently no-op'd against a wrong-format doc key.
    let resolvedTargetUniqueId = null;
    if (action === 'warned' || action === 'warned_severe' || action === 'suspended') {
      resolvedTargetUniqueId = await resolveUniqueId(report.reportedUserId);
      if (!resolvedTargetUniqueId) {
        return res.status(404).json({ error: 'reported user no longer exists' });
      }
    }

    // Resolve the report
    await db.doc(`reports/${req.params.id}`).update({
      status: 'resolved',
      actionTaken: action,
      resolvedAt: timestamp,
      resolvedBy: req.auth.uid,
    });

    // targetUserId is the canonical uniqueId so forensic queries match
    // admin-economy.js / admin-temp-id.js / admin-users.js convention. Falls
    // back to the raw uid if the resolve throws — report is already committed
    // above and a 500 here would lie about the moderation state.
    let auditTargetUniqueId;
    if (resolvedTargetUniqueId) {
      auditTargetUniqueId = resolvedTargetUniqueId;
    } else {
      try {
        auditTargetUniqueId =
          (await resolveUniqueId(report.reportedUserId)) ?? report.reportedUserId;
      } catch (resolveErr) {
        log.warn('reports', 'audit-log uniqueId resolution failed; logging raw reportedUserId', {
          reportedUserId: report.reportedUserId,
          error: resolveErr.message,
        });
        auditTargetUniqueId = report.reportedUserId;
      }
    }
    // Fire-and-forget so a Firestore throw doesn't 500 a fully-applied
    // moderation action. The promise is awaited later — but only via .catch —
    // so the failure becomes a flag in the response, never an upstream throw.
    // safeFireAndForget also absorbs synchronous throws (bad path, mocking
    // quirks) that would otherwise bypass the promise chain and bubble up.
    let auditLogFailed = false;
    const auditPromise = safeFireAndForget(
      () =>
        db.doc(`adminAuditLog/${generateId()}`).set(
          {
            adminId: req.auth.uid,
            action: 'RESOLVE_REPORT',
            targetUserId: auditTargetUniqueId,
            details: `Report ${req.params.id}: ${action}`,
            createdAt: timestamp,
          },
          { merge: true },
        ),
      (err) => {
        log.error('reports', 'Failed to write RESOLVE_REPORT audit log', {
          reportId: req.params.id,
          error: err?.message ?? String(err),
        });
        auditLogFailed = true;
      },
    );

    // PM-failure tracking parallel to the bulk handler. `targetPmFailed`
    // covers warn/suspend PMs to the moderation target; `reporterPmFailed`
    // covers the reporter ack PM. Both surface as `pms: { failed, total }`.
    let targetPmFailed = false;
    let reporterPmFailed = false;
    let warnPmPromise = null;
    let suspendPmPromise = null;
    let reporterPmPromise = null;

    // Warning actions: create warning doc (which deducts GCS)
    let warningFailed = false;
    if (action === 'warned' || action === 'warned_severe') {
      const severity = body?.severity || (action === 'warned_severe' ? 4 : 2);
      const warningReason = body?.reason || report.reason;
      // resolvedTargetUniqueId was checked non-null at the top of the handler before
      // the report-status update, so it is safe to use here. Trusting the stored
      // `report.reportedUserUniqueId` would re-introduce the IDOR for pre-existing
      // reports whose stored value was supplied by an earlier client.
      const warnUniqueId = resolvedTargetUniqueId;

      try {
        await createWarning(warnUniqueId, {
          reason: warningReason,
          severity,
          adminNote: body?.adminNote || null,
          source: 'report',
          linkedReportId: req.params.id,
          adminUid: req.auth.uid,
          adminUniqueId: req.auth.uniqueId,
        });

        warnPmPromise = sendSystemPm(
          report.reportedUserId,
          `\u26a0\ufe0f You have received a warning.\n\nReason: ${warningReason}\n\nRepeated violations may result in suspension.`,
        ).catch((err) => {
          log.error('reports', 'Failed to send warning PM', {
            userId: report.reportedUserId,
            error: err.message,
          });
          targetPmFailed = true;
        });
      } catch (warnErr) {
        // Report is already marked resolved above; failure here means the
        // warning did NOT land. The admin must see this in the response body
        // (not just log.error) to be able to retry.
        log.error('reports', 'Failed to create warning from report', {
          reportId: req.params.id,
          error: warnErr.message,
        });
        warningFailed = true;
      }
    }

    // Suspension action: suspend the reported user
    let cascade = null;
    let suspensionFailed = false;
    if (action === 'suspended') {
      const suspensionDays = body?.suspensionDays ? Number(body.suspensionDays) : 0;
      const canAppeal = body?.canAppeal ?? false;
      const endTimestamp = suspensionDays > 0 ? Date.now() + suspensionDays * 86400000 : null;

      // resolvedTargetUniqueId was server-resolved at the top of the handler; using
      // it here defeats any client-injected `report.reportedUserUniqueId`.
      const reportedUniqueId = resolvedTargetUniqueId;
      const reportedUser = await getDoc(`users/${reportedUniqueId}`);

      try {
        await db.doc(`users/${reportedUniqueId}`).update({
          isSuspended: true,
          suspensionReason: report.reason || 'Moderation action',
          suspensionStartDate: timestamp,
          suspensionEndDate: endTimestamp,
          suspensionCanAppeal: canAppeal,
          suspendedBy: req.auth.uid,
          preSuspensionDisplayName: reportedUser?.displayName ?? reportedUser?.display_name ?? null,
          preSuspensionProfilePhotoUrl:
            reportedUser?.profilePhotoUrl ?? reportedUser?.profile_photo_url ?? null,
          preSuspensionCoverPhotoUrl:
            reportedUser?.coverPhotoUrl ?? reportedUser?.cover_photo_url ?? null,
          displayName: 'Suspended Account',
          profilePhotoUrl: null,
          coverPhotoUrl: null,
          avatarUrl: null,
          description: null,
          currentRoomId: null,
        });
        clearSuspensionCache(Number(reportedUniqueId)); // Phase 2H finding #1

        // Awaited (was fire-and-forget) so cascade partial-failure surfaces in
        // the response and the admin UI can warn about manual cleanup.
        try {
          cascade = await evictSuspendedUser(reportedUniqueId);
        } catch (cascadeErr) {
          log.error('reports', 'Failed to evict suspended user from resolve', {
            userId: reportedUniqueId,
            error: cascadeErr.message,
          });
          cascade = buildCascadeFailure(cascadeErr, MOD_ERROR.CASCADE_FAILED);
        }

        suspendPmPromise = sendSystemPm(
          report.reportedUserId,
          `Your account has been suspended.\n\nReason: ${report.reason || 'Moderation action'}${canAppeal ? '\n\nYou may submit an appeal.' : ''}`,
        ).catch((err) => {
          log.error('reports', 'Failed to send suspension PM from resolve', {
            userId: report.reportedUserId,
            error: err.message,
          });
          targetPmFailed = true;
        });
      } catch (susErr) {
        log.error('reports', 'Failed to suspend user from resolve', {
          reportId: req.params.id,
          error: susErr.message,
        });
        suspensionFailed = true;
      }
    }

    // Resolution PM to reporter (fire-and-forget)
    if (report.reporterId) {
      let actionText;
      if (action === 'dismissed') {
        actionText = 'reviewed and dismissed';
      } else if (action === 'warned') {
        actionText = 'reviewed and a warning was issued';
      } else if (action === 'warned_severe') {
        actionText = 'reviewed and a severe warning was issued';
      } else if (action === 'suspended') {
        actionText = 'reviewed and the user has been suspended';
      } else {
        actionText = 'reviewed';
      }
      reporterPmPromise = sendSystemPm(
        report.reporterId,
        `Your report has been ${actionText}. Thank you for helping keep ShyTalk safe.`,
      ).catch((err) => {
        log.error('reports', 'Failed to send reporter PM', {
          reportId: req.params.id,
          reporterId: report.reporterId,
          error: err.message,
        });
        reporterPmFailed = true;
      });
    }

    // Lock release IS important (admin needs it cleared to take the next
    // moderation action against this user) but a Firestore reject here would
    // 500 a fully-applied moderation. Surface as `lockRelease.failed` flag
    // so the admin sees the moderation succeeded AND knows to retry the lock.
    let lockReleaseFailed = false;
    await safeFireAndForget(
      () => db.doc(`reportLocks/${req.params.id}`).delete(),
      (err) => {
        log.error('reports', 'Failed to release report lock', {
          reportId: req.params.id,
          error: err?.message ?? String(err),
        });
        lockReleaseFailed = true;
      },
    );

    // INVARIANT: every promise added here MUST have an absorbing .catch.
    // Promise.all rejects on first unhandled — would 500 a fully-applied
    // moderation. Do NOT split this await into multiple — flag mutations
    // happen inside the .catch handlers and must all settle before
    // responseBody is built.
    await Promise.all(
      [auditPromise, warnPmPromise, suspendPmPromise, reporterPmPromise].filter(Boolean),
    );

    const responseBody = { success: true };
    if (cascade) responseBody.cascade = cascade;
    if (warningFailed) {
      responseBody.warning = { failed: true, error: MOD_ERROR.WARNING_CREATE_FAILED };
    }
    if (suspensionFailed) {
      responseBody.suspension = { failed: true, error: MOD_ERROR.SUSPENSION_UPDATE_FAILED };
    }
    if (auditLogFailed) {
      responseBody.auditLog = { failed: true, error: MOD_ERROR.AUDIT_WRITE_FAILED };
    }
    if (lockReleaseFailed) {
      responseBody.lockRelease = { failed: true };
    }
    const totalSinglePms =
      (warnPmPromise !== null ? 1 : 0) +
      (suspendPmPromise !== null ? 1 : 0) +
      (reporterPmPromise !== null ? 1 : 0);
    const failedSinglePms = (targetPmFailed ? 1 : 0) + (reporterPmFailed ? 1 : 0);
    if (failedSinglePms > 0) {
      responseBody.pms = { failed: failedSinglePms, total: totalSinglePms };
    }
    res.json(responseBody);
  } catch (err) {
    log.error('reports', 'POST /api/reports/:id/resolve failed', {
      reportId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Resolve all pending reports for a user ──
router.post('/reports/resolve-all/:userId', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (body?.reason && body.reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
    if (body?.adminNote && body.adminNote.length > ADMIN_NOTE_MAX_LENGTH)
      return res.status(400).json({ error: `adminNote exceeds ${ADMIN_NOTE_MAX_LENGTH} chars` });

    const action = normaliseAction(body?.action);
    const timestamp = now();

    // Fetch all pending reports for this user
    const reports = await queryDocs(
      db
        .collection('reports')
        .where('reportedUserId', '==', req.params.userId)
        .where('status', '==', 'pending'),
    );

    // Resolve audit target AFTER the empty-reports early-return below so we
    // do not burn a Firestore op on a no-op call. Wrapped in try/catch so a
    // transient Firestore throw does not 500 the request (audit log gets the
    // raw UID instead, response still succeeds).
    let auditTargetUniqueId = req.params.userId;
    if (reports.length > 0) {
      try {
        auditTargetUniqueId = (await resolveUniqueId(req.params.userId)) ?? req.params.userId;
      } catch (resolveErr) {
        log.warn('reports', 'audit-log uniqueId resolution failed in bulk resolve', {
          userId: req.params.userId,
          error: resolveErr.message,
        });
      }
    }

    if (reports.length === 0) return res.json({ success: true, resolved: 0 });

    // Build batch writes for resolving all reports
    const allWrites = reports.map((r) => ({
      path: `reports/${r.id}`,
      data: {
        status: 'resolved',
        actionTaken: action,
        resolvedAt: timestamp,
        resolvedBy: req.auth.uid,
      },
    }));

    // Track every PM that targets the suspended/warned user. Reporter PMs are
    // tracked separately in `pmsFailed`; this flag covers warning + suspension
    // PMs delivered to the moderation target. Without this the admin saw only
    // reporter-PM failures and silently lost target-PM delivery info.
    let targetPmFailed = false;
    let warnPmPromise = null;
    let suspendPmPromise = null;

    // Apply warning if applicable (uses createWarning to write warning doc + update user)
    let warningFailed = false;
    if (action === 'warned' || action === 'warned_severe') {
      const severity = body?.severity || (action === 'warned_severe' ? 4 : 2);
      const warningReason = body?.reason || 'Multiple reports';
      // Re-resolve from req.params.userId (server-trusted Firebase Auth UID per
      // public/admin/js/tabs/reports.js). Stored reports[].reportedUserUniqueId may
      // have been client-injected before the F1 IDOR fix; trusting it on the bulk
      // path would re-open the IDOR through the "Resolve all" admin button.
      const warnUniqueId = await resolveUniqueId(req.params.userId);
      if (!warnUniqueId) {
        return res.status(404).json({ error: 'reported user no longer exists' });
      }

      try {
        await createWarning(warnUniqueId, {
          reason: warningReason,
          severity,
          adminNote: body?.adminNote || null,
          source: 'report',
          linkedReportId: null,
          adminUid: req.auth.uid,
          adminUniqueId: req.auth.uniqueId,
        });

        warnPmPromise = sendSystemPm(
          req.params.userId,
          `\u26a0\ufe0f You have received a warning based on multiple reports.\n\nReason: ${warningReason}\n\nRepeated violations may result in suspension.`,
        ).catch((err) => {
          log.error('reports', 'Failed to send warning PM', {
            userId: req.params.userId,
            error: err.message,
          });
          targetPmFailed = true;
        });
      } catch (warnErr) {
        log.error('reports', 'Failed to create warning from bulk resolve', {
          userId: req.params.userId,
          error: warnErr.message,
        });
        warningFailed = true;
      }
    }

    // Suspension action: suspend the reported user
    let cascade = null;
    let suspensionFailed = false;
    let suspendAuditFailed = false;
    let suspendAuditPromise = null;
    if (action === 'suspended') {
      const suspensionDays = body?.suspensionDays ? Number(body.suspensionDays) : 0;
      const canAppeal = body?.canAppeal ?? false;
      const endTimestamp = suspensionDays > 0 ? Date.now() + suspensionDays * 86400000 : null;

      // Same IDOR-defeating re-resolve as the warn branch above.
      const reportedUniqueId = await resolveUniqueId(req.params.userId);
      if (!reportedUniqueId) {
        return res.status(404).json({ error: 'reported user no longer exists' });
      }
      const reportedUser = await getDoc(`users/${reportedUniqueId}`);

      try {
        await db.doc(`users/${reportedUniqueId}`).update({
          isSuspended: true,
          suspensionReason: 'Multiple reports',
          suspensionStartDate: timestamp,
          suspensionEndDate: endTimestamp,
          suspensionCanAppeal: canAppeal,
          suspendedBy: req.auth.uid,
          preSuspensionDisplayName: reportedUser?.displayName ?? reportedUser?.display_name ?? null,
          preSuspensionProfilePhotoUrl:
            reportedUser?.profilePhotoUrl ?? reportedUser?.profile_photo_url ?? null,
          preSuspensionCoverPhotoUrl:
            reportedUser?.coverPhotoUrl ?? reportedUser?.cover_photo_url ?? null,
          displayName: 'Suspended Account',
          profilePhotoUrl: null,
          coverPhotoUrl: null,
          avatarUrl: null,
          description: null,
          currentRoomId: null,
        });
        clearSuspensionCache(Number(reportedUniqueId));

        try {
          cascade = await evictSuspendedUser(reportedUniqueId);
        } catch (cascadeErr) {
          log.error('reports', 'Failed to evict suspended user from bulk resolve', {
            userId: reportedUniqueId,
            error: cascadeErr.message,
          });
          cascade = buildCascadeFailure(cascadeErr, MOD_ERROR.CASCADE_FAILED);
        }

        suspendPmPromise = sendSystemPm(
          reports[0]?.reportedUserId ?? req.params.userId,
          `Your account has been suspended.\n\nReason: Multiple reports${canAppeal ? '\n\nYou may submit an appeal.' : ''}`,
        ).catch((err) => {
          log.error('reports', 'Failed to send suspension PM from bulk resolve', {
            userId: req.params.userId,
            error: err.message,
          });
          targetPmFailed = true;
        });

        suspendAuditPromise = safeFireAndForget(
          () =>
            db.doc(`adminAuditLog/${generateId()}`).set(
              {
                adminId: req.auth.uid,
                action: 'SUSPEND',
                targetUserId: reportedUniqueId,
                details: `Suspended via bulk resolve (${reports.length} reports)`,
                createdAt: timestamp,
              },
              { merge: true },
            ),
          (err) => {
            log.error('reports', 'Failed to write suspension audit log from bulk resolve', {
              userId: reportedUniqueId,
              error: err.message,
            });
            suspendAuditFailed = true;
          },
        );
      } catch (susErr) {
        log.error('reports', 'Failed to suspend user from bulk resolve', {
          userId: req.params.userId,
          error: susErr.message,
        });
        suspensionFailed = true;
      }
    }

    // Wrap chunk-commit so a Firestore throw on chunk N (after warn/suspend
    // already committed against the user) does NOT 500 the response. A 500
    // here would leave the admin UI thinking the entire moderation action
    // failed, when in fact warn/suspend applied — they'd retry, double-warning
    // the user. Track which reports landed so the admin sees the truth.
    let reportsCommitted = 0;
    let reportsCommitFailed = false;
    for (let i = 0; i < allWrites.length; i += 500) {
      const chunk = allWrites.slice(i, i + 500);
      const batch = db.batch();
      for (const w of chunk) {
        batch.set(db.doc(w.path), w.data, { merge: true });
      }
      try {
        await batch.commit();
        reportsCommitted += chunk.length;
      } catch (chunkErr) {
        log.error('reports', 'Failed to commit reports batch in bulk resolve', {
          userId: req.params.userId,
          chunkStart: i,
          chunkSize: chunk.length,
          error: chunkErr.message,
        });
        reportsCommitFailed = true;
      }
    }

    let bulkAuditFailed = false;
    const bulkAuditPromise = safeFireAndForget(
      () =>
        db.doc(`adminAuditLog/${generateId()}`).set(
          {
            adminId: req.auth.uid,
            action: 'RESOLVE_ALL_REPORTS',
            targetUserId: auditTargetUniqueId,
            details: `Resolved ${reports.length} reports: ${action}`,
            createdAt: timestamp,
          },
          { merge: true },
        ),
      (err) => {
        log.error('reports', 'Failed to write RESOLVE_ALL_REPORTS audit log', {
          userId: req.params.userId,
          error: err?.message ?? String(err),
        });
        bulkAuditFailed = true;
      },
    );

    // Lock release IS important but a Firestore reject must NOT 500 a
    // fully-applied moderation. Surface as `lockRelease.failed` flag.
    let lockReleaseFailed = false;
    await safeFireAndForget(
      () => db.doc(`reportLocks/${req.params.userId}`).delete(),
      (err) => {
        log.error('reports', 'Failed to release report lock (bulk)', {
          userId: req.params.userId,
          error: err?.message ?? String(err),
        });
        lockReleaseFailed = true;
      },
    );

    const uniqueReporters = [...new Set(reports.map((r) => r.reporterId).filter(Boolean))];
    let pmsFailed = 0;
    const reporterPmPromises = uniqueReporters.map((reporterId) =>
      sendSystemPm(
        reporterId,
        'Your report has been reviewed. Thank you for helping keep ShyTalk safe.',
      ).catch((err) => {
        log.error('reports', 'Failed to send reporter PM (resolve-all)', {
          userId: req.params.userId,
          reporterId,
          error: err.message,
        });
        pmsFailed += 1;
      }),
    );

    // INVARIANT: every promise added here MUST have an absorbing .catch.
    // Promise.all rejects on the first unhandled reject, which would 500 a
    // fully-applied moderation. The .catch handlers also mutate outer-scope
    // flags (auditLog/pmsFailed/etc) — do NOT split this await into multiple
    // awaits or the flags may be unset when the response is built.
    await Promise.all(
      [
        bulkAuditPromise,
        suspendAuditPromise,
        warnPmPromise,
        suspendPmPromise,
        ...reporterPmPromises,
      ].filter(Boolean),
    );

    const responseBody = { success: true, resolved: reportsCommitted };
    if (reportsCommitFailed || reportsCommitted < reports.length) {
      responseBody.reports = {
        committed: reportsCommitted,
        failed: reports.length - reportsCommitted,
        total: reports.length,
        error: MOD_ERROR.REPORTS_COMMIT_FAILED,
      };
    }
    if (cascade) responseBody.cascade = cascade;
    if (warningFailed) {
      responseBody.warning = { failed: true, error: MOD_ERROR.WARNING_CREATE_FAILED };
    }
    if (suspensionFailed) {
      responseBody.suspension = { failed: true, error: MOD_ERROR.SUSPENSION_UPDATE_FAILED };
    }
    if (bulkAuditFailed || suspendAuditFailed) {
      responseBody.auditLog = { failed: true, error: MOD_ERROR.AUDIT_WRITE_FAILED };
    }
    if (lockReleaseFailed) {
      responseBody.lockRelease = { failed: true };
    }
    const totalPms =
      uniqueReporters.length +
      (warnPmPromise !== null ? 1 : 0) +
      (suspendPmPromise !== null ? 1 : 0);
    const totalPmsFailed = pmsFailed + (targetPmFailed ? 1 : 0);
    if (totalPmsFailed > 0) {
      responseBody.pms = { failed: totalPmsFailed, total: totalPms };
    }
    res.json(responseBody);
  } catch (err) {
    log.error('reports', 'POST /api/reports/resolve-all/:userId failed', {
      userId: req.params.userId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Report statistics ──
router.get('/reports/stats', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    // Fetch pending and resolved-today in parallel
    const [pendingReports, resolvedTodayReports, allResolved] = await Promise.all([
      queryDocs(db.collection('reports').where('status', '==', 'pending').limit(1000)),
      queryDocs(
        db
          .collection('reports')
          .where('status', '==', 'resolved')
          .where('resolvedAt', '>=', todayMs)
          .limit(1000),
      ),
      queryDocs(
        db
          .collection('reports')
          .where('status', '==', 'resolved')
          .where('resolvedAt', '>', 0)
          .limit(5000),
      ),
    ]);

    // Compute average response time from all resolved reports
    let totalMs = 0;
    let countWithTimes = 0;
    for (const r of allResolved) {
      if (r.resolvedAt && r.createdAt) {
        totalMs += r.resolvedAt - r.createdAt;
        countWithTimes++;
      }
    }
    const avgResponseHours =
      countWithTimes > 0 ? Math.round((totalMs / countWithTimes / (60 * 60 * 1000)) * 10) / 10 : 0;

    // Active reviewers today
    const reviewerCounts = {};
    for (const r of resolvedTodayReports) {
      if (r.resolvedBy) {
        reviewerCounts[r.resolvedBy] = (reviewerCounts[r.resolvedBy] || 0) + 1;
      }
    }
    const activeReviewers = Object.entries(reviewerCounts).map(([resolvedBy, count]) => ({
      resolvedBy,
      count,
    }));

    res.json({
      pendingCount: pendingReports.length,
      resolvedToday: resolvedTodayReports.length,
      avgResponseHours,
      activeReviewers,
    });
  } catch (err) {
    log.error('reports', 'GET /api/reports/stats failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── CSV export ──
router.get('/reports/export', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const from = req.query.from;
    const to = req.query.to;

    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to + 'T23:59:59.999Z').getTime() : null;

    // Build Firestore query
    let query = db.collection('reports').where('status', '==', 'resolved');

    if (fromMs && !Number.isNaN(fromMs)) {
      query = query.where('resolvedAt', '>=', fromMs);
    }

    query = query.orderBy('resolvedAt', 'desc').limit(5000);

    const results = await queryDocs(query);

    // Client-side upper bound filter (Firestore requires composite index for two range filters)
    const rows =
      toMs && !Number.isNaN(toMs)
        ? results.filter((r) => r.resolvedAt && r.resolvedAt <= toMs)
        : results;

    // Build CSV
    const headers = [
      'id',
      'reporterName',
      'reportedUserName',
      'reason',
      'description',
      'actionTaken',
      'resolvedAt',
      'resolvedBy',
      'createdAt',
    ];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      csvRows.push(
        headers
          .map((h) => {
            let val = r[h] ?? '';
            if (h === 'resolvedAt' || h === 'createdAt') {
              val = val ? new Date(val).toISOString() : '';
            }
            val = String(val).replaceAll('"', '""');
            return `"${val}"`;
          })
          .join(','),
      );
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reports-export.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    log.error('reports', 'GET /api/reports/export failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Lock report (admin) ──
router.post('/reports/:id/lock', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const admin = await getDoc(`users/${req.auth.uniqueId}`);
    const displayName = admin?.displayName ?? admin?.display_name ?? null;

    // reportLocks is keyed by the reported userId (same as report ID here)
    await db.doc(`reportLocks/${req.params.id}`).set(
      {
        lockedBy: req.auth.uid,
        lockedAt: now(),
        displayName: displayName,
      },
      { merge: true },
    );

    res.json({ success: true });
  } catch (err) {
    log.error('reports', 'POST /api/reports/:id/lock failed', {
      reportId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Unlock report (admin) ──
router.delete('/reports/:id/lock', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    await db.doc(`reportLocks/${req.params.id}`).delete();

    res.json({ success: true });
  } catch (err) {
    log.error('reports', 'DELETE /api/reports/:id/lock failed', {
      reportId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// SUSPENSIONS (admin — canonical routes)
// ══════════════════════════════════════════════════════════════

// ── Suspend user ──
router.post('/admin/users/:uniqueId/suspend', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
    if (body.reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
    if (typeof body.canAppeal !== 'boolean')
      return res.status(400).json({ error: 'canAppeal must be a boolean' });

    let endTimestamp = null;
    if (body.endDate) {
      const endDate = new Date(body.endDate);
      if (Number.isNaN(endDate.getTime()))
        return res.status(400).json({ error: 'endDate must be a valid ISO-8601 date' });
      if (endDate.getTime() <= Date.now())
        return res.status(400).json({ error: 'endDate must be in the future' });
      endTimestamp = endDate.getTime();
    }

    const user = await getDoc(`users/${req.params.uniqueId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const timestamp = now();

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({
        isSuspended: true,
        suspensionReason: body.reason.trim(),
        suspensionStartDate: timestamp,
        suspensionEndDate: endTimestamp,
        suspensionCanAppeal: body.canAppeal,
        suspendedBy: req.auth.uid,
        preSuspensionDisplayName: user.displayName ?? user.display_name ?? null,
        preSuspensionProfilePhotoUrl: user.profilePhotoUrl ?? user.profile_photo_url ?? null,
        preSuspensionCoverPhotoUrl: user.coverPhotoUrl ?? user.cover_photo_url ?? null,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        avatarUrl: null,
        description: null,
        currentRoomId: null,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set(
        {
          adminId: req.auth.uid,
          action: 'SUSPEND',
          targetUserId: req.params.uniqueId,
          details: body.reason.trim(),
          createdAt: timestamp,
        },
        { merge: true },
      ),
    ]);
    clearSuspensionCache(Number(req.params.uniqueId));

    // Awaited (was fire-and-forget) so cascade partial-failure is visible to admin.
    // cascade is unconditionally assigned below (success: evictSuspendedUser
    // return value; failure: buildCascadeFailure). Earlier iterations had a
    // fire-and-forget cascade where this default was the response — now dead.
    let cascade;
    try {
      cascade = await evictSuspendedUser(req.params.uniqueId);
    } catch (err) {
      log.error('reports', 'Failed to evict suspended user', {
        userId: req.params.uniqueId,
        error: err.message,
      });
      cascade = buildCascadeFailure(err, MOD_ERROR.CASCADE_FAILED);
    }

    res.json({ success: true, cascade });
  } catch (err) {
    log.error('reports', 'POST /api/admin/users/:uniqueId/suspend failed', {
      userId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Unsuspend user ──
router.post('/admin/users/:uniqueId/unsuspend', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const user = await getDoc(`users/${req.params.uniqueId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const preName = user.preSuspensionDisplayName ?? user.pre_suspension_display_name ?? null;
    const prePhoto =
      user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url ?? null;
    const preCover = user.preSuspensionCoverPhotoUrl ?? user.pre_suspension_cover_photo_url ?? null;

    const restore = {};
    if (preName) restore.displayName = preName;
    if (prePhoto) restore.profilePhotoUrl = prePhoto;
    if (preCover) restore.coverPhotoUrl = preCover;

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({
        isSuspended: false,
        suspensionReason: null,
        suspensionStartDate: null,
        suspensionEndDate: null,
        suspensionCanAppeal: null,
        suspendedBy: null,
        preSuspensionDisplayName: null,
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl: null,
        ...restore,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set(
        {
          adminId: req.auth.uid,
          action: 'UNSUSPEND',
          targetUserId: req.params.uniqueId,
          details: null,
          createdAt: now(),
        },
        { merge: true },
      ),
    ]);

    clearSuspensionCache(Number(req.params.uniqueId));
    res.json({ success: true });
  } catch (err) {
    log.error('reports', 'POST /api/admin/users/:uniqueId/unsuspend failed', {
      userId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// APPEALS
// ══════════════════════════════════════════════════════════════

// ── Submit appeal ──
router.post('/appeals', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.appealText) return res.status(400).json({ error: 'appealText is required' });
    if (typeof body.appealText !== 'string' || body.appealText.length > 500) {
      return res
        .status(400)
        .json({ error: 'appealText must be a string of at most 500 characters' });
    }

    const uniqueId = req.auth.uniqueId;

    const user = await getDoc(`users/${uniqueId}`);
    const isSuspended = user?.isSuspended ?? user?.is_suspended ?? false;
    const canAppeal = user?.suspensionCanAppeal ?? user?.suspension_can_appeal ?? false;

    if (!isSuspended) return res.status(400).json({ error: 'User is not suspended' });
    if (!canAppeal)
      return res.status(403).json({ error: 'Appeals are not allowed for this suspension' });

    // Check for existing pending appeal
    const existing = await queryDocs(
      db
        .collection('suspensionAppeals')
        .where('userId', '==', uniqueId)
        .where('status', '==', 'pending')
        .limit(1),
    );

    if (existing.length > 0) return res.status(409).json({ error: 'An appeal is already pending' });

    const appealId = generateId();
    await db.doc(`suspensionAppeals/${appealId}`).set(
      {
        userId: uniqueId,
        appealText: body.appealText,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now(),
      },
      { merge: true },
    );

    res.json({ success: true, appealId });
  } catch (err) {
    log.error('reports', 'POST /api/appeals failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List appeals (admin) ──
router.get('/appeals', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const statusFilter = req.query.status;

    let query = db.collection('suspensionAppeals');
    if (statusFilter) {
      query = query.where('status', '==', statusFilter);
    }
    query = query.limit(100);

    const appeals = await queryDocs(query);
    appeals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Enrich with user data (display name, uniqueId, suspension info)
    const enriched = await Promise.all(
      appeals.map(async (a) => {
        const uid = a.userId ?? a.user_id;
        const userData = uid ? await getDoc(`users/${uid}`) : null;
        const userUniqueId = userData?.uniqueId ?? userData?.unique_id ?? null;
        return {
          ...a,
          userUniqueId,
          uniqueId: userUniqueId,
          userDisplayName: userData?.displayName ?? userData?.display_name ?? null,
          displayName: userData?.displayName ?? userData?.display_name ?? null,
          userInfo: {
            uniqueId: userUniqueId,
            displayName: userData?.displayName ?? userData?.display_name ?? null,
            profilePhotoUrl: userData?.profilePhotoUrl ?? userData?.profile_photo_url ?? null,
            suspensionReason: userData?.suspensionReason ?? userData?.suspension_reason ?? null,
            suspensionStartDate:
              userData?.suspensionStartDate ?? userData?.suspension_start_date ?? null,
            suspensionEndDate: userData?.suspensionEndDate ?? userData?.suspension_end_date ?? null,
          },
          suspensionReason: userData?.suspensionReason ?? userData?.suspension_reason ?? null,
          suspensionEndDate: userData?.suspensionEndDate ?? userData?.suspension_end_date ?? null,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    log.error('reports', 'GET /api/appeals failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Review appeal (admin) ──
router.patch('/appeals/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    const status = body?.status;
    if (!status || !['approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: 'status must be "approved" or "denied"' });
    }

    const appeal = await getDoc(`suspensionAppeals/${req.params.id}`);
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

    const timestamp = now();
    const userId = appeal.userId ?? appeal.user_id;

    // Update the appeal document
    const appealUpdate = {
      status: status,
      reviewedBy: req.auth.uid,
      reviewedAt: timestamp,
    };
    if (body.adminNote !== undefined) appealUpdate.adminNote = body.adminNote;
    await db.doc(`suspensionAppeals/${req.params.id}`).update(appealUpdate);

    // Update user's appeal status on the user document
    await db.doc(`users/${userId}`).update({
      suspensionAppealStatus: status, // 'approved' or 'denied'
      ...(status === 'denied' ? { suspensionCanAppeal: false } : {}),
    });

    // If approved, unsuspend the user
    if (status === 'approved') {
      const user = await getDoc(`users/${userId}`);
      if (user) {
        const preName = user.preSuspensionDisplayName ?? user.pre_suspension_display_name ?? null;
        const prePhoto =
          user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url ?? null;
        const preCover =
          user.preSuspensionCoverPhotoUrl ?? user.pre_suspension_cover_photo_url ?? null;

        const restore = {};
        if (preName) restore.displayName = preName;
        if (prePhoto) restore.profilePhotoUrl = prePhoto;
        if (preCover) restore.coverPhotoUrl = preCover;

        await db.doc(`users/${userId}`).update({
          isSuspended: false,
          suspensionReason: null,
          suspensionStartDate: null,
          suspensionEndDate: null,
          suspensionCanAppeal: null,
          suspendedBy: null,
          preSuspensionDisplayName: null,
          preSuspensionProfilePhotoUrl: null,
          preSuspensionCoverPhotoUrl: null,
          ...restore,
        });
        clearSuspensionCache(userId);
      }
    }

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set(
      {
        adminId: req.auth.uid,
        action: status === 'approved' ? 'APPEAL_APPROVED' : 'APPEAL_DENIED',
        targetUserId: userId,
        details: null,
        createdAt: timestamp,
      },
      { merge: true },
    );

    res.json({ success: true });
  } catch (err) {
    log.error('reports', 'PATCH /api/appeals/:id failed', {
      appealId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/audit-log — removed: superseded by admin-audit-log.js which
// supports filtering, pagination, and reads from all audit collections.

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

const { evictSuspendedUser, buildCascadeFailure } = require('../utils/evict-suspended-user');

module.exports = router;
// Attach the MOD_ERROR token table to the exported router so the
// snapshot test can lock its values without parsing the source.
module.exports.MOD_ERROR = MOD_ERROR;
