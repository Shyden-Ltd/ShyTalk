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
 * POST   /api/admin/users/:uid/suspend      → Suspend a user (admin)
 * POST   /api/admin/users/:uid/unsuspend    → Unsuspend a user (admin)
 * GET    /api/appeals                       → List appeals (admin)
 * PATCH  /api/appeals/:id                   → Review an appeal (admin)
 * POST   /api/appeals                       → Submit an appeal
 * GET    /api/admin/audit-log               → Get admin audit log (admin)
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { sendFcmToTokens } = require('../utils/fcm');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');
const { writeRtdb, deleteRtdb } = require('../utils/rtdb');
const {
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  batchWrite,
  batchUpdateOp,
  fieldFilter,
  andFilter,
  orderBy,
} = require('../utils/firestore');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Remove invalid FCM tokens from admin user docs in Firestore.
 * For each invalid token, finds which admin user doc contains it and removes it.
 */
async function cleanupInvalidAdminTokens(env, invalidTokens, adminUsers) {
  if (!invalidTokens || invalidTokens.length === 0) return;

  const invalidSet = new Set(invalidTokens);
  const writes = [];

  for (const u of adminUsers) {
    if (!Array.isArray(u.fcmTokens)) continue;
    const filtered = u.fcmTokens.filter(t => !invalidSet.has(t));
    if (filtered.length !== u.fcmTokens.length) {
      writes.push(batchUpdateOp(env, `users/${u.id}`, { fcmTokens: filtered }));
    }
  }

  if (writes.length > 0) {
    await batchWrite(env, writes);
  }
}

// ─── Route registration ──────────────────────────────────────────

function registerReportRoutes(router) {

  // ── Submit report ──
  router.post('/api/reports', async (request, env) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const {
      reportedUserId, reportedUserName, reportedUserUniqueId,
      conversationId, messageId, messageText,
      reason, description, evidenceUrls,
    } = body;

    if (!reportedUserId || !reason) {
      return jsonError('reportedUserId and reason required', 400);
    }

    // Fetch reporter info
    const reporter = await getDoc(env, `users/${request.auth.uid}`);

    const reportId = generateId();
    const timestamp = now();

    await setDoc(env, `reports/${reportId}`, {
      reporterId:              request.auth.uid,
      reporterName:            reporter?.displayName ?? reporter?.display_name ?? null,
      reporterUniqueId:        reporter?.uniqueId ?? reporter?.unique_id ?? null,
      reportedUserId:          reportedUserId,
      reportedUserName:        reportedUserName || null,
      reportedUserUniqueId:    reportedUserUniqueId || null,
      conversationId:          conversationId || null,
      messageId:               messageId || null,
      messageText:             messageText || null,
      reason:                  reason,
      description:             description || null,
      evidenceUrls:            evidenceUrls || [],
      status:                  'pending',
      actionTaken:             null,
      resolvedAt:              null,
      resolvedBy:              null,
      createdAt:               timestamp,
    });

    // Fire-and-forget: FCM push notification to admin tokens
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil((async () => {
        try {
          const adminUsers = await queryCollection(env, 'users', {
            where: fieldFilter('userType', 'EQUAL', 'admin'),
          });
          const tokens = [];
          for (const u of adminUsers) {
            if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
          }
          if (tokens.length > 0) {
            const data = {
              type:             'ADMIN_NEW_REPORT',
              reportId,
              reason,
              reportedUserName: reportedUserName || 'Unknown',
            };
            const invalid = await sendFcmToTokens(env, tokens, data);
            await cleanupInvalidAdminTokens(env, invalid, adminUsers);
          }
        } catch (err) {
          console.error('Failed to send report notification:', err);
        }
      })());
    }

    return json({ success: true, reportId });
  });

  // ── List reports (admin — enriched, filterable) ──
  router.get('/api/reports', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status') || 'pending';
    const userIdFilter = url.searchParams.get('userId');
    const search = url.searchParams.get('search')?.toLowerCase();

    // Build Firestore filters
    const filters = [fieldFilter('status', 'EQUAL', statusFilter)];
    if (userIdFilter) {
      filters.push(fieldFilter('reportedUserId', 'EQUAL', userIdFilter));
    }

    const direction = statusFilter === 'pending' ? 'ASCENDING' : 'DESCENDING';

    const reports = await queryCollection(env, 'reports', {
      where:   filters.length === 1 ? filters[0] : andFilter(...filters),
      orderBy: [orderBy('createdAt', direction)],
      limit:   500,
    });

    // Client-side search filter (Firestore doesn't support full-text search)
    const filtered = search
      ? reports.filter(r =>
          (r.reportedUserName  || '').toLowerCase().includes(search) ||
          (r.reporterName      || '').toLowerCase().includes(search) ||
          (r.reason            || '').toLowerCase().includes(search) ||
          (r.description       || '').toLowerCase().includes(search)
        )
      : reports;

    // Collect all unique user IDs for enrichment
    const reportedUserIds = [...new Set(filtered.map(r => r.reportedUserId).filter(Boolean))];
    const reporterIds     = [...new Set(filtered.map(r => r.reporterId).filter(Boolean))];

    // Parallel-fetch user enrichment data and report locks
    const [reportedUserDocs, reporterDocs, locks] = await Promise.all([
      Promise.all(reportedUserIds.map(uid => getDoc(env, `users/${uid}`))),
      Promise.all(reporterIds.map(uid => getDoc(env, `users/${uid}`))),
      queryCollection(env, 'reportLocks', {}),
    ]);

    // Build lookup maps
    const userMap = {};
    for (let i = 0; i < reportedUserIds.length; i++) {
      const u = reportedUserDocs[i];
      if (u) {
        const gcsScore         = u.gcsScore         ?? u.gcs_score          ?? 100;
        const gcsLastDeduction = u.gcsLastDeductionAt ?? u.gcs_last_deduction_at ?? null;
        u.gcsDisplayScore = computeDisplayScore(gcsScore, gcsLastDeduction);
        userMap[reportedUserIds[i]] = u;
      }
    }

    const reporterMap = {};
    for (let i = 0; i < reporterIds.length; i++) {
      const u = reporterDocs[i];
      if (u) reporterMap[reporterIds[i]] = u;
    }

    const lockMap = {};
    for (const lock of locks) {
      // reportLocks documents are keyed by userId (the reported user)
      lockMap[lock.id] = lock;
    }

    // Enrich reports
    const enriched = filtered.map(r => ({
      ...r,
      evidenceUrls:  r.evidenceUrls || [],
      reportedUser:  userMap[r.reportedUserId] || null,
      reporter:      reporterMap[r.reporterId] || null,
      lock:          lockMap[r.reportedUserId] || null,
    }));

    // Group by reported user for pending reports
    if (statusFilter === 'pending') {
      const grouped = {};
      for (const r of enriched) {
        const key = r.reportedUserId;
        if (!grouped[key]) {
          grouped[key] = {
            uid:            key,
            reportedUserId: key,
            displayName:    r.reportedUser?.displayName ?? r.reportedUser?.display_name ?? null,
            profilePhotoUrl: r.reportedUser?.profilePhotoUrl ?? r.reportedUser?.profile_photo_url ?? null,
            uniqueId:       r.reportedUser?.uniqueId ?? r.reportedUser?.unique_id ?? null,
            warningCount:   r.reportedUser?.warningCount ?? r.reportedUser?.warning_count ?? 0,
            isSuspended:    r.reportedUser?.isSuspended ?? r.reportedUser?.is_suspended ?? false,
            gcsDisplayScore: r.reportedUser?.gcsDisplayScore ?? 100,
            lock:           r.lock,
            reports:        [],
            reportCount:    0,
          };
        }
        grouped[key].reports.push(r);
        grouped[key].reportCount = grouped[key].reports.length;
      }
      return json({ users: Object.values(grouped) });
    }

    return json({ users: enriched });
  });

  // ── Resolve report (admin — full logic) ──
  router.post('/api/reports/:id/resolve', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const action = body?.action || 'dismissed';
    const timestamp = now();

    // Fetch the report
    const report = await getDoc(env, `reports/${params.id}`);
    if (!report) return jsonError('Report not found', 404);

    // Resolve the report
    await updateDoc(env, `reports/${params.id}`, {
      status:     'resolved',
      actionTaken: action,
      resolvedAt:  timestamp,
      resolvedBy:  request.auth.uid,
    });

    // Audit log (fire-and-forget)
    const auditWrite = setDoc(env, `adminAuditLog/${generateId()}`, {
      adminId:      request.auth.uid,
      action:       'RESOLVE_REPORT',
      targetUserId: report.reportedUserId,
      details:      `Report ${params.id}: ${action}`,
      createdAt:    timestamp,
    });

    // Warning actions: deduct GCS and update user
    if (action === 'warned' || action === 'warned_severe') {
      const severity  = action === 'warned_severe' ? 'severe' : 'standard';
      const deduction = severity === 'severe' ? 20 : 10;

      const user = await getDoc(env, `users/${report.reportedUserId}`);
      if (user) {
        const gcsScore     = user.gcsScore     ?? user.gcs_score     ?? 100;
        const warningCount = user.warningCount  ?? user.warning_count ?? 0;
        const newGcs           = Math.max(0, gcsScore - deduction);
        const newWarningCount  = warningCount + 1;
        const warningReason    = body?.reason || report.reason;

        await updateDoc(env, `users/${report.reportedUserId}`, {
          gcsScore:           newGcs,
          gcsLastDeductionAt: timestamp,
          warningCount:       newWarningCount,
          warningReason:      warningReason,
          hasActiveWarning:   true,
          hasNewWarning:      true,
          warningIssuedAt:    timestamp,
        });

        // Send warning PM (fire-and-forget)
        const ctx = request.ctx;
        if (ctx) {
          ctx.waitUntil(
            sendSystemPm(env, report.reportedUserId,
              `\u26a0\ufe0f You have received a warning.\n\nReason: ${warningReason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100).`
            ).catch(err => console.error('Failed to send warning PM:', err))
          );
        }
      }
    }

    // Resolution PM to reporter (fire-and-forget)
    const ctx = request.ctx;
    if (ctx && report.reporterId) {
      const actionText = action === 'dismissed'      ? 'reviewed and dismissed'
        : action === 'warned'                        ? 'reviewed and a warning was issued'
        : action === 'warned_severe'                 ? 'reviewed and a severe warning was issued'
        : action === 'suspended'                     ? 'reviewed and the user has been suspended'
        : 'reviewed';
      ctx.waitUntil(
        sendSystemPm(env, report.reporterId,
          `Your report has been ${actionText}. Thank you for helping keep ShyTalk safe.`
        ).catch(err => console.error('Failed to send reporter PM:', err))
      );
    }

    // Release lock and write audit log in parallel
    await Promise.all([
      auditWrite,
      deleteDoc(env, `reportLocks/${report.reportedUserId}`),
    ]);

    return json({ success: true });
  });

  // ── Resolve all pending reports for a user ──
  router.post('/api/reports/resolve-all/:userId', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const action = body?.action || 'dismissed';
    const timestamp = now();

    // Fetch all pending reports for this user
    const reports = await queryCollection(env, 'reports', {
      where: andFilter(
        fieldFilter('reportedUserId', 'EQUAL', params.userId),
        fieldFilter('status', 'EQUAL', 'pending')
      ),
    });

    if (reports.length === 0) return json({ success: true, resolved: 0 });

    // Resolve all reports via batch
    const writes = reports.map(r => batchUpdateOp(env, `reports/${r.id}`, {
      status:     'resolved',
      actionTaken: action,
      resolvedAt:  timestamp,
      resolvedBy:  request.auth.uid,
    }));

    // Apply warning if applicable
    if (action === 'warned' || action === 'warned_severe') {
      const severity  = action === 'warned_severe' ? 'severe' : 'standard';
      const deduction = severity === 'severe' ? 20 : 10;

      const user = await getDoc(env, `users/${params.userId}`);
      if (user) {
        const gcsScore     = user.gcsScore     ?? user.gcs_score     ?? 100;
        const warningCount = user.warningCount  ?? user.warning_count ?? 0;
        const newGcs          = Math.max(0, gcsScore - deduction);
        const newWarningCount = warningCount + 1;
        const warningReason   = body?.reason || 'Multiple reports';

        writes.push(batchUpdateOp(env, `users/${params.userId}`, {
          gcsScore:           newGcs,
          gcsLastDeductionAt: timestamp,
          warningCount:       newWarningCount,
          warningReason:      warningReason,
          hasActiveWarning:   true,
          hasNewWarning:      true,
          warningIssuedAt:    timestamp,
        }));

        const ctx = request.ctx;
        if (ctx) {
          ctx.waitUntil(
            sendSystemPm(env, params.userId,
              `\u26a0\ufe0f You have received a warning based on multiple reports.\n\nReason: ${warningReason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100).`
            ).catch(err => console.error('Failed to send warning PM:', err))
          );
        }
      }
    }

    // Execute batch writes
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    // Audit log and lock release in parallel
    await Promise.all([
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'RESOLVE_ALL_REPORTS',
        targetUserId: params.userId,
        details:      `Resolved ${reports.length} reports: ${action}`,
        createdAt:    timestamp,
      }),
      deleteDoc(env, `reportLocks/${params.userId}`),
    ]);

    // Resolution PMs to all unique reporters (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      const uniqueReporters = [...new Set(reports.map(r => r.reporterId).filter(Boolean))];
      for (const reporterId of uniqueReporters) {
        ctx.waitUntil(
          sendSystemPm(env, reporterId,
            'Your report has been reviewed. Thank you for helping keep ShyTalk safe.'
          ).catch(() => {})
        );
      }
    }

    return json({ success: true, resolved: reports.length });
  });

  // ── Report statistics ──
  router.get('/api/reports/stats', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    // Fetch pending and resolved-today in parallel
    const [pendingReports, resolvedTodayReports, allResolved] = await Promise.all([
      queryCollection(env, 'reports', {
        where: fieldFilter('status', 'EQUAL', 'pending'),
        limit: 1000,
      }),
      queryCollection(env, 'reports', {
        where: andFilter(
          fieldFilter('status', 'EQUAL', 'resolved'),
          fieldFilter('resolvedAt', 'GREATER_THAN_OR_EQUAL', todayMs)
        ),
        limit: 1000,
      }),
      queryCollection(env, 'reports', {
        where: andFilter(
          fieldFilter('status', 'EQUAL', 'resolved'),
          fieldFilter('resolvedAt', 'GREATER_THAN', 0)
        ),
        limit: 5000,
      }),
    ]);

    // Compute average response time from all resolved reports
    let totalMs = 0;
    let countWithTimes = 0;
    for (const r of allResolved) {
      if (r.resolvedAt && r.createdAt) {
        totalMs += (r.resolvedAt - r.createdAt);
        countWithTimes++;
      }
    }
    const avgResponseHours = countWithTimes > 0
      ? Math.round((totalMs / countWithTimes) / (60 * 60 * 1000) * 10) / 10
      : 0;

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

    return json({
      pendingCount:     pendingReports.length,
      resolvedToday:    resolvedTodayReports.length,
      avgResponseHours,
      activeReviewers,
    });
  });

  // ── CSV export ──
  router.get('/api/reports/export', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to   = url.searchParams.get('to');

    const fromMs = from ? new Date(from).getTime() : null;
    const toMs   = to   ? new Date(to + 'T23:59:59.999Z').getTime() : null;

    // Build query filters
    const filters = [fieldFilter('status', 'EQUAL', 'resolved')];
    if (fromMs && !isNaN(fromMs)) {
      filters.push(fieldFilter('resolvedAt', 'GREATER_THAN_OR_EQUAL', fromMs));
    }

    const results = await queryCollection(env, 'reports', {
      where:   filters.length === 1 ? filters[0] : andFilter(...filters),
      orderBy: [orderBy('resolvedAt', 'DESCENDING')],
      limit:   5000,
    });

    // Client-side upper bound filter (Firestore requires composite index for two range filters)
    const rows = toMs && !isNaN(toMs)
      ? results.filter(r => r.resolvedAt && r.resolvedAt <= toMs)
      : results;

    // Build CSV
    const headers = [
      'id', 'reporterName', 'reportedUserName', 'reason', 'description',
      'actionTaken', 'resolvedAt', 'resolvedBy', 'createdAt',
    ];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      csvRows.push(headers.map(h => {
        let val = r[h] ?? '';
        if (h === 'resolvedAt' || h === 'createdAt') {
          val = val ? new Date(val).toISOString() : '';
        }
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(','));
    }

    return new Response(csvRows.join('\n'), {
      status: 200,
      headers: {
        'Content-Type':        'text/csv',
        'Content-Disposition': `attachment; filename="reports-export.csv"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  // ── Lock report (admin) ──
  router.post('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const admin = await getDoc(env, `users/${request.auth.uid}`);
    const displayName = admin?.displayName ?? admin?.display_name ?? null;

    // reportLocks is keyed by the reported userId (same as report ID here)
    await setDoc(env, `reportLocks/${params.id}`, {
      lockedBy:    request.auth.uid,
      lockedAt:    now(),
      displayName: displayName,
    });

    return json({ success: true });
  });

  // ── Unlock report (admin) ──
  router.delete('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await deleteDoc(env, `reportLocks/${params.id}`);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // SUSPENSIONS (admin — canonical routes)
  // ══════════════════════════════════════════════════════════════

  // ── Suspend user ──
  router.post('/api/admin/users/:uid/suspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.reason) return jsonError('reason is required', 400);
    if (typeof body.canAppeal !== 'boolean') return jsonError('canAppeal must be a boolean', 400);

    let endTimestamp = null;
    if (body.endDate) {
      const d = new Date(body.endDate);
      if (isNaN(d.getTime())) return jsonError('endDate must be a valid ISO-8601 date', 400);
      if (d.getTime() <= Date.now()) return jsonError('endDate must be in the future', 400);
      endTimestamp = d.getTime();
    }

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const timestamp = now();

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        isSuspended:                  true,
        suspensionReason:             body.reason.trim(),
        suspensionStartDate:          timestamp,
        suspensionExpiry:             endTimestamp,
        suspensionCanAppeal:          body.canAppeal,
        suspendedBy:                  request.auth.uid,
        preSuspensionDisplayName:     user.displayName     ?? user.display_name     ?? null,
        preSuspensionProfilePhotoUrl: user.profilePhotoUrl ?? user.profile_photo_url ?? null,
        preSuspensionCoverPhotoUrl:   user.coverPhotoUrl   ?? user.cover_photo_url   ?? null,
        displayName:                  'Suspended Account',
        profilePhotoUrl:              null,
        coverPhotoUrl:                null,
        avatarUrl:                    null,
        bio:                          null,
        currentRoomId:                null,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'SUSPEND',
        targetUserId: params.uid,
        details:      body.reason.trim(),
        createdAt:    timestamp,
      }),
    ]);

    // Evict from rooms (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(
        evictSuspendedUser(env, params.uid)
          .catch(err => console.error('Failed to evict suspended user:', err))
      );
    }

    return json({ success: true });
  });

  // ── Unsuspend user ──
  router.post('/api/admin/users/:uid/unsuspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const preName  = user.preSuspensionDisplayName     ?? user.pre_suspension_display_name     ?? null;
    const prePhoto = user.preSuspensionProfilePhotoUrl  ?? user.pre_suspension_profile_photo_url ?? null;
    const preCover = user.preSuspensionCoverPhotoUrl    ?? user.pre_suspension_cover_photo_url   ?? null;

    const restore = {};
    if (preName)  restore.displayName     = preName;
    if (prePhoto) restore.profilePhotoUrl = prePhoto;
    if (preCover) restore.coverPhotoUrl   = preCover;

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        isSuspended:                  false,
        suspensionReason:             null,
        suspensionStartDate:          null,
        suspensionExpiry:             null,
        suspensionCanAppeal:          null,
        suspendedBy:                  null,
        preSuspensionDisplayName:     null,
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl:   null,
        ...restore,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'UNSUSPEND',
        targetUserId: params.uid,
        details:      null,
        createdAt:    now(),
      }),
    ]);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // APPEALS
  // ══════════════════════════════════════════════════════════════

  // ── Submit appeal ──
  router.post('/api/appeals', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.appealText) return jsonError('appealText is required', 400);

    const uid = request.auth.uid;

    const user = await getDoc(env, `users/${uid}`);
    const isSuspended      = user?.isSuspended      ?? user?.is_suspended      ?? false;
    const canAppeal        = user?.suspensionCanAppeal ?? user?.suspension_can_appeal ?? false;

    if (!isSuspended) return jsonError('User is not suspended', 400);
    if (!canAppeal)   return jsonError('Appeals are not allowed for this suspension', 403);

    // Check for existing pending appeal
    const existing = await queryCollection(env, 'suspensionAppeals', {
      where: andFilter(
        fieldFilter('userId', 'EQUAL', uid),
        fieldFilter('status', 'EQUAL', 'pending')
      ),
      limit: 1,
    });

    if (existing.length > 0) return jsonError('An appeal is already pending', 409);

    const appealId = generateId();
    await setDoc(env, `suspensionAppeals/${appealId}`, {
      userId:     uid,
      appealText: body.appealText,
      status:     'pending',
      reviewedBy: null,
      reviewedAt: null,
      createdAt:  now(),
    });

    return json({ success: true, appealId });
  });

  // ── List appeals (admin) ──
  router.get('/api/appeals', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    const query = {};
    if (statusFilter) {
      query.where = fieldFilter('status', 'EQUAL', statusFilter);
    }
    query.orderBy = [orderBy('createdAt', 'DESCENDING')];
    query.limit   = 100;

    const appeals = await queryCollection(env, 'suspensionAppeals', query);

    // Enrich with user data (display name, uniqueId, suspension info)
    const enriched = await Promise.all(appeals.map(async a => {
      const uid = a.userId ?? a.user_id;
      const userData = uid ? await getDoc(env, `users/${uid}`) : null;
      return {
        ...a,
        displayName:      userData?.displayName     ?? userData?.display_name     ?? null,
        uniqueId:         userData?.uniqueId        ?? userData?.unique_id        ?? null,
        suspensionReason: userData?.suspensionReason ?? userData?.suspension_reason ?? null,
        suspensionExpiry: userData?.suspensionExpiry ?? userData?.suspension_end_date ?? null,
      };
    }));

    return json(enriched);
  });

  // ── Review appeal (admin) ──
  router.patch('/api/appeals/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const status = body?.status;
    if (!status || !['approved', 'denied'].includes(status)) {
      return jsonError('status must be "approved" or "denied"', 400);
    }

    const appeal = await getDoc(env, `suspensionAppeals/${params.id}`);
    if (!appeal) return jsonError('Appeal not found', 404);

    const timestamp = now();
    const userId    = appeal.userId ?? appeal.user_id;

    // Update the appeal document
    await updateDoc(env, `suspensionAppeals/${params.id}`, {
      status:     status,
      reviewedBy: request.auth.uid,
      reviewedAt: timestamp,
    });

    // If approved, unsuspend the user
    if (status === 'approved') {
      const user = await getDoc(env, `users/${userId}`);
      if (user) {
        const preName  = user.preSuspensionDisplayName     ?? user.pre_suspension_display_name     ?? null;
        const prePhoto = user.preSuspensionProfilePhotoUrl  ?? user.pre_suspension_profile_photo_url ?? null;
        const preCover = user.preSuspensionCoverPhotoUrl    ?? user.pre_suspension_cover_photo_url   ?? null;

        const restore = {};
        if (preName)  restore.displayName     = preName;
        if (prePhoto) restore.profilePhotoUrl = prePhoto;
        if (preCover) restore.coverPhotoUrl   = preCover;

        await updateDoc(env, `users/${userId}`, {
          isSuspended:                  false,
          suspensionReason:             null,
          suspensionStartDate:          null,
          suspensionExpiry:             null,
          suspensionCanAppeal:          null,
          suspendedBy:                  null,
          preSuspensionDisplayName:     null,
          preSuspensionProfilePhotoUrl: null,
          preSuspensionCoverPhotoUrl:   null,
          ...restore,
        });
      }
    }

    // Audit log
    await setDoc(env, `adminAuditLog/${generateId()}`, {
      adminId:      request.auth.uid,
      action:       status === 'approved' ? 'APPEAL_APPROVED' : 'APPEAL_DENIED',
      targetUserId: userId,
      details:      null,
      createdAt:    timestamp,
    });

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // AUDIT LOG (admin)
  // ══════════════════════════════════════════════════════════════

  router.get('/api/admin/audit-log', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url   = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    const entries = await queryCollection(env, 'adminAuditLog', {
      orderBy: [orderBy('createdAt', 'DESCENDING')],
      limit,
    });

    // Enrich with admin display name
    const adminIds = [...new Set(entries.map(e => e.adminId).filter(Boolean))];
    const adminDocs = await Promise.all(adminIds.map(id => getDoc(env, `users/${id}`)));

    const adminNameMap = {};
    for (let i = 0; i < adminIds.length; i++) {
      const doc = adminDocs[i];
      if (doc) {
        adminNameMap[adminIds[i]] = doc.displayName ?? doc.display_name ?? null;
      }
    }

    const enriched = entries.map(e => ({
      ...e,
      adminName: adminNameMap[e.adminId] || null,
    }));

    return json(enriched);
  });
}

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
async function evictSuspendedUser(env, userId) {
  const rooms = await queryCollection(env, 'rooms', {
    where: fieldFilter('participantIds', 'ARRAY_CONTAINS', userId),
  });

  if (rooms.length === 0) return;

  const writes = [];

  for (const room of rooms) {
    if (room.ownerId === userId) {
      // Owner suspended — close the room
      try {
        await writeRtdb(env, `rooms/${room.id}/events/lastEvent`, {
          type: 'room_closed',
          ts:   Date.now(),
        });
      } catch (_) { /* best-effort */ }
      try {
        await deleteRtdb(env, `rooms/${room.id}`);
      } catch (_) { /* best-effort */ }
      writes.push(batchUpdateOp(env, `rooms/${room.id}`, {
        state:    'CLOSED',
        closedAt: now(),
      }));
    } else {
      // Regular participant — remove from participants and clear their seat
      const participantIds = (room.participantIds || []).filter(id => id !== userId);

      const seats = room.seats ? { ...room.seats } : {};
      for (const [index, seat] of Object.entries(seats)) {
        if (seat && (seat.userId === userId || seat.user_id === userId)) {
          seats[index] = { userId: null, state: 'EMPTY', isMuted: false };
        }
      }

      writes.push(batchUpdateOp(env, `rooms/${room.id}`, { participantIds, seats }));

      // Notify room of the update
      try {
        await writeRtdb(env, `rooms/${room.id}/events/lastEvent`, {
          type: 'room_updated',
          ts:   Date.now(),
        });
      } catch (_) { /* best-effort */ }
    }
  }

  // Clear user's currentRoomId
  writes.push(batchUpdateOp(env, `users/${userId}`, { currentRoomId: null }));

  // Batch write in chunks of 500
  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }
}

module.exports = { registerReportRoutes };
