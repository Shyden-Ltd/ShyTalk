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
const { db, rtdb } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin, clearSuspensionCache } = require('../middleware/auth');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');
const { getDoc, queryDocs } = require('../utils/firestore-helpers');
const { sendFcmToTokens } = require('../utils/fcm');
const log = require('../utils/log');
const { createWarning } = require('./admin-users');

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
      reportedUserUniqueId,
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
        reportedUserUniqueId: reportedUserUniqueId || null,
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
    if (requireAdmin(req, res)) return;

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

    // Collect all unique user IDs for enrichment
    // User documents are keyed by uniqueId (numeric), NOT Firebase Auth UID.
    // Build a mapping from reportedUserId → reportedUserUniqueId from report data,
    // then use uniqueId to fetch user documents.
    const reportedUniqueIdMap = {}; // reportedUserId → reportedUserUniqueId
    for (const r of filtered) {
      if (
        r.reportedUserId &&
        r.reportedUserUniqueId !== null &&
        r.reportedUserUniqueId !== undefined
      ) {
        reportedUniqueIdMap[r.reportedUserId] = r.reportedUserUniqueId;
      }
    }
    const reportedUserIds = [...new Set(filtered.map((r) => r.reportedUserId).filter(Boolean))];
    const reportedUniqueIds = [
      ...new Set(
        reportedUserIds
          .map((uid) => reportedUniqueIdMap[uid])
          .filter((id) => id !== null && id !== undefined),
      ),
    ];
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

    // Enrich reports
    const enriched = filtered.map((r) => ({
      ...r,
      evidenceUrls: r.evidenceUrls || [],
      reportedUser: userMap[r.reportedUserId] || null,
      reporter: reporterMap[r.reporterId] || null,
      lock: lockMap[r.reportedUserId] || null,
    }));

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
            uniqueId:
              r.reportedUser?.uniqueId ??
              r.reportedUser?.unique_id ??
              r.reportedUserUniqueId ??
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
          uniqueId:
            r.reportedUser?.uniqueId ?? r.reportedUser?.unique_id ?? r.reportedUserUniqueId ?? null,
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
    if (requireAdmin(req, res)) return;

    const body = req.body;
    const action = normaliseAction(body?.action);
    const timestamp = now();

    // Fetch the report
    const report = await getDoc(`reports/${req.params.id}`);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Resolve the report
    await db.doc(`reports/${req.params.id}`).update({
      status: 'resolved',
      actionTaken: action,
      resolvedAt: timestamp,
      resolvedBy: req.auth.uid,
    });

    // Audit log (fire-and-forget)
    const auditWrite = db.doc(`adminAuditLog/${generateId()}`).set(
      {
        adminId: req.auth.uid,
        action: 'RESOLVE_REPORT',
        targetUserId: report.reportedUserId,
        details: `Report ${req.params.id}: ${action}`,
        createdAt: timestamp,
      },
      { merge: true },
    );

    // Warning actions: create warning doc (which deducts GCS)
    if (action === 'warned' || action === 'warned_severe') {
      const severity = body?.severity || (action === 'warned_severe' ? 4 : 2);
      const warningReason = body?.reason || report.reason;
      // createWarning expects uniqueId (user doc key), not Firebase Auth UID
      const warnUniqueId = report.reportedUserUniqueId ?? report.reportedUserId;

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

        // Send warning PM (fire-and-forget)
        sendSystemPm(
          report.reportedUserId,
          `\u26a0\ufe0f You have received a warning.\n\nReason: ${warningReason}\n\nRepeated violations may result in suspension.`,
        ).catch((err) =>
          log.error('reports', 'Failed to send warning PM', {
            userId: report.reportedUserId,
            error: err.message,
          }),
        );
      } catch (warnErr) {
        log.error('reports', 'Failed to create warning from report', {
          reportId: req.params.id,
          error: warnErr.message,
        });
      }
    }

    // Suspension action: suspend the reported user
    if (action === 'suspended') {
      const suspensionDays = body?.suspensionDays ? Number(body.suspensionDays) : 0;
      const canAppeal = body?.canAppeal ?? false;
      const endTimestamp = suspensionDays > 0 ? Date.now() + suspensionDays * 86400000 : null;

      // User documents are keyed by uniqueId, not Firebase Auth UID
      const reportedUniqueId = report.reportedUserUniqueId ?? report.reportedUserId;
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

        // Evict from rooms (fire-and-forget)
        evictSuspendedUser(reportedUniqueId).catch((err) =>
          log.error('reports', 'Failed to evict suspended user from resolve', {
            userId: reportedUniqueId,
            error: err.message,
          }),
        );

        // Send suspension PM (fire-and-forget)
        sendSystemPm(
          report.reportedUserId,
          `Your account has been suspended.\n\nReason: ${report.reason || 'Moderation action'}${canAppeal ? '\n\nYou may submit an appeal.' : ''}`,
        ).catch(() => {});
      } catch (susErr) {
        log.error('reports', 'Failed to suspend user from resolve', {
          reportId: req.params.id,
          error: susErr.message,
        });
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
      sendSystemPm(
        report.reporterId,
        `Your report has been ${actionText}. Thank you for helping keep ShyTalk safe.`,
      ).catch((err) =>
        log.error('reports', 'Failed to send reporter PM', {
          reporterId: report.reporterId,
          error: err.message,
        }),
      );
    }

    // Release lock and write audit log in parallel
    await Promise.all([auditWrite, db.doc(`reportLocks/${req.params.id}`).delete()]);

    res.json({ success: true });
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
    if (requireAdmin(req, res)) return;

    const body = req.body;
    const action = normaliseAction(body?.action);
    const timestamp = now();

    // Fetch all pending reports for this user
    const reports = await queryDocs(
      db
        .collection('reports')
        .where('reportedUserId', '==', req.params.userId)
        .where('status', '==', 'pending'),
    );

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

    // Apply warning if applicable (uses createWarning to write warning doc + update user)
    if (action === 'warned' || action === 'warned_severe') {
      const severity = body?.severity || (action === 'warned_severe' ? 4 : 2);
      const warningReason = body?.reason || 'Multiple reports';
      // createWarning expects uniqueId (user doc key), not Firebase Auth UID
      const warnUniqueId = reports[0]?.reportedUserUniqueId ?? req.params.userId;

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

        // Send warning PM (fire-and-forget)
        sendSystemPm(
          req.params.userId,
          `\u26a0\ufe0f You have received a warning based on multiple reports.\n\nReason: ${warningReason}\n\nRepeated violations may result in suspension.`,
        ).catch((err) =>
          log.error('reports', 'Failed to send warning PM', {
            userId: req.params.userId,
            error: err.message,
          }),
        );
      } catch (warnErr) {
        log.error('reports', 'Failed to create warning from bulk resolve', {
          userId: req.params.userId,
          error: warnErr.message,
        });
      }
    }

    // Suspension action: suspend the reported user
    if (action === 'suspended') {
      const suspensionDays = body?.suspensionDays ? Number(body.suspensionDays) : 0;
      const canAppeal = body?.canAppeal ?? false;
      const endTimestamp = suspensionDays > 0 ? Date.now() + suspensionDays * 86400000 : null;

      // User docs are keyed by uniqueId; get it from the report data
      const reportedUniqueId = reports[0]?.reportedUserUniqueId ?? req.params.userId;
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

        evictSuspendedUser(reportedUniqueId).catch((err) =>
          log.error('reports', 'Failed to evict suspended user from bulk resolve', {
            userId: reportedUniqueId,
            error: err.message,
          }),
        );

        // Send suspension PM (fire-and-forget)
        sendSystemPm(
          reports[0]?.reportedUserId ?? req.params.userId,
          `Your account has been suspended.\n\nReason: Multiple reports${canAppeal ? '\n\nYou may submit an appeal.' : ''}`,
        ).catch((err) =>
          log.error('reports', 'Failed to send suspension PM from bulk resolve', {
            userId: req.params.userId,
            error: err.message,
          }),
        );

        // Audit log for suspension action
        db.doc(`adminAuditLog/${generateId()}`)
          .set(
            {
              adminId: req.auth.uid,
              action: 'SUSPEND',
              targetUserId: reportedUniqueId,
              details: `Suspended via bulk resolve (${reports.length} reports)`,
              createdAt: timestamp,
            },
            { merge: true },
          )
          .catch((err) =>
            log.error('reports', 'Failed to write suspension audit log from bulk resolve', {
              userId: reportedUniqueId,
              error: err.message,
            }),
          );
      } catch (susErr) {
        log.error('reports', 'Failed to suspend user from bulk resolve', {
          userId: req.params.userId,
          error: susErr.message,
        });
      }
    }

    // Execute batch writes in chunks of 500
    const combinedWrites = allWrites;
    for (let i = 0; i < combinedWrites.length; i += 500) {
      const chunk = combinedWrites.slice(i, i + 500);
      const batch = db.batch();
      for (const w of chunk) {
        batch.set(db.doc(w.path), w.data, { merge: true });
      }
      await batch.commit();
    }

    // Audit log and lock release in parallel
    await Promise.all([
      db.doc(`adminAuditLog/${generateId()}`).set(
        {
          adminId: req.auth.uid,
          action: 'RESOLVE_ALL_REPORTS',
          targetUserId: req.params.userId,
          details: `Resolved ${reports.length} reports: ${action}`,
          createdAt: timestamp,
        },
        { merge: true },
      ),
      db.doc(`reportLocks/${req.params.userId}`).delete(),
    ]);

    // Resolution PMs to all unique reporters (fire-and-forget)
    const uniqueReporters = [...new Set(reports.map((r) => r.reporterId).filter(Boolean))];
    for (const reporterId of uniqueReporters) {
      sendSystemPm(
        reporterId,
        'Your report has been reviewed. Thank you for helping keep ShyTalk safe.',
      ).catch((err) =>
        log.error('reports', 'Failed to send reporter PM (resolve-all)', {
          reporterId,
          error: err.message,
        }),
      );
    }

    res.json({ success: true, resolved: reports.length });
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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
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

    // Evict from rooms (fire-and-forget)
    evictSuspendedUser(req.params.uniqueId).catch((err) =>
      log.error('reports', 'Failed to evict suspended user', {
        userId: req.params.uniqueId,
        error: err.message,
      }),
    );

    res.json({ success: true });
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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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

/**
 * Evict a suspended user from all rooms they're in.
 *
 * Queries rooms where the user appears in participantIds, removes them from
 * the participant list, clears their seat, and clears their currentRoomId.
 * If the user is the owner, the room is closed and an RTDB close event is fired.
 */
async function evictSuspendedUser(userId) {
  const rooms = await queryDocs(
    db.collection('rooms').where('participantIds', 'array-contains', userId),
  );

  if (rooms.length === 0) return;

  const batchOps = [];
  const rtdbEvents = []; // Collect RTDB writes to fire AFTER Firestore batch

  for (const room of rooms) {
    if (room.ownerId === userId) {
      // Owner suspended — close the room
      batchOps.push({
        path: `rooms/${room.id}`,
        data: { state: 'CLOSED', closedAt: now() },
      });
      rtdbEvents.push({ roomId: room.id, type: 'room_closed', remove: true });
    } else {
      // Regular participant — remove from participants and clear their seat
      const participantIds = (room.participantIds || []).filter((id) => id !== userId);

      const seats = room.seats ? { ...room.seats } : {};
      for (const [index, seat] of Object.entries(seats)) {
        if (seat && (seat.userId === userId || seat.user_id === userId)) {
          seats[index] = { userId: null, state: 'EMPTY', isMuted: false };
        }
      }

      batchOps.push({
        path: `rooms/${room.id}`,
        data: { participantIds, seats },
      });
      rtdbEvents.push({ roomId: room.id, type: 'room_updated', remove: false });
    }
  }

  // Clear user's currentRoomId
  batchOps.push({
    path: `users/${userId}`,
    data: { currentRoomId: null },
  });

  // Commit Firestore batch first
  for (let i = 0; i < batchOps.length; i += 500) {
    const chunk = batchOps.slice(i, i + 500);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(db.doc(op.path), op.data, { merge: true });
    }
    await batch.commit();
  }

  // Then fire RTDB events (after Firestore is committed)
  for (const evt of rtdbEvents) {
    try {
      await rtdb.ref(`rooms/${evt.roomId}/events/lastEvent`).set({
        type: evt.type,
        ts: Date.now(),
      });
    } catch (err) {
      log.warn('reports', `Failed to write ${evt.type} RTDB event`, {
        roomId: evt.roomId,
        error: err.message,
      });
    }
    if (evt.remove) {
      try {
        await rtdb.ref(`rooms/${evt.roomId}`).remove();
      } catch (err) {
        log.warn('reports', 'Failed to remove RTDB room node', {
          roomId: evt.roomId,
          error: err.message,
        });
      }
    }
  }
}

module.exports = router;
