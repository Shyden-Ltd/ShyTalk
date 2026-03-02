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
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');

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

    const reporter = await env.DB.prepare(
      'SELECT display_name, unique_id FROM users WHERE uid = ?'
    ).bind(request.auth.uid).first();

    const reportId = generateId();

    await env.DB.prepare(`
      INSERT INTO reports (
        id, reporter_id, reporter_name, reporter_unique_id,
        reported_user_id, reported_user_name, reported_user_unique_id,
        conversation_id, message_id, message_text,
        reason, description, evidence_urls, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      reportId, request.auth.uid,
      reporter?.display_name || null, reporter?.unique_id || null,
      reportedUserId, reportedUserName || null, reportedUserUniqueId || null,
      conversationId || null, messageId || null, messageText || null,
      reason, description || null,
      evidenceUrls ? JSON.stringify(evidenceUrls) : null,
      now()
    ).run();

    // Fire-and-forget: FCM push notification to admin tokens
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil((async () => {
        try {
          const { results: adminTokens } = await env.DB.prepare(
            'SELECT token FROM admin_tokens'
          ).all();
          if (adminTokens.length > 0) {
            const data = {
              type: 'ADMIN_NEW_REPORT',
              reportId,
              reason,
              reportedUserName: reportedUserName || 'Unknown',
            };
            const invalid = await sendFcmToTokens(env, adminTokens.map(t => t.token), data);
            await cleanupInvalidTokens(env, invalid, 'admin_tokens');
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
    const status = url.searchParams.get('status') || 'pending';
    const userId = url.searchParams.get('userId');
    const search = url.searchParams.get('search');

    let query = 'SELECT * FROM reports WHERE 1=1';
    const binds = [];

    if (status) {
      query += ' AND status = ?';
      binds.push(status);
    }
    if (userId) {
      query += ' AND reported_user_id = ?';
      binds.push(userId);
    }
    if (search) {
      query += ' AND (reported_user_name LIKE ? OR reporter_name LIKE ? OR reason LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      binds.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY created_at ' + (status === 'pending' ? 'ASC' : 'DESC');
    query += ' LIMIT 500';

    const { results: reports } = await env.DB.prepare(query).bind(...binds).all();

    // Collect all unique reported user IDs for enrichment
    const reportedUserIds = [...new Set(reports.map(r => r.reported_user_id))];
    const reporterIds = [...new Set(reports.map(r => r.reporter_id))];

    // Batch-fetch user enrichment data
    const userMap = {};
    if (reportedUserIds.length > 0) {
      const placeholders = reportedUserIds.map(() => '?').join(',');
      const { results: users } = await env.DB.prepare(
        `SELECT uid, display_name, unique_id, gcs_score, gcs_last_deduction_at,
                warning_count, is_suspended, suspension_reason,
                pre_suspension_display_name, pre_suspension_profile_photo_url
         FROM users WHERE uid IN (${placeholders})`
      ).bind(...reportedUserIds).all();
      for (const u of users) {
        u.gcs_display_score = computeDisplayScore(u.gcs_score, u.gcs_last_deduction_at);
        userMap[u.uid] = u;
      }
    }

    const reporterMap = {};
    if (reporterIds.length > 0) {
      const placeholders = reporterIds.map(() => '?').join(',');
      const { results: reporters } = await env.DB.prepare(
        `SELECT uid, display_name, unique_id FROM users WHERE uid IN (${placeholders})`
      ).bind(...reporterIds).all();
      for (const r of reporters) reporterMap[r.uid] = r;
    }

    // Fetch locks
    const lockMap = {};
    const { results: locks } = await env.DB.prepare(
      'SELECT * FROM report_locks'
    ).all();
    for (const lock of locks) {
      lockMap[lock.report_id] = lock;
    }

    // Enrich reports
    const enriched = reports.map(r => ({
      ...r,
      evidence_urls: r.evidence_urls ? JSON.parse(r.evidence_urls) : [],
      reported_user: userMap[r.reported_user_id] || null,
      reporter: reporterMap[r.reporter_id] || null,
      lock: lockMap[r.reported_user_id] || null,
    }));

    // Group by reported user for pending reports
    if (status === 'pending') {
      const grouped = {};
      for (const r of enriched) {
        const key = r.reported_user_id;
        if (!grouped[key]) {
          grouped[key] = {
            reportedUserId: key,
            reportedUser: r.reported_user,
            lock: r.lock,
            reports: [],
          };
        }
        grouped[key].reports.push(r);
      }
      return json(Object.values(grouped));
    }

    return json(enriched);
  });

  // ── Resolve report (admin — full logic) ──
  router.post('/api/reports/:id/resolve', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const action = body?.action || 'dismissed';
    const timestamp = now();

    // Get the report
    const report = await env.DB.prepare(
      'SELECT * FROM reports WHERE id = ?'
    ).bind(params.id).first();
    if (!report) return jsonError('Report not found', 404);

    const stmts = [
      env.DB.prepare(`
        UPDATE reports SET status = 'resolved', action_taken = ?, resolved_at = ?, resolved_by = ?
        WHERE id = ?
      `).bind(action, timestamp, request.auth.uid, params.id),

      // Audit log
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'RESOLVE_REPORT', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, report.reported_user_id,
        `Report ${params.id}: ${action}`, timestamp),
    ];

    // If action involves warning, deduct GCS and set warning fields
    if (action === 'warned' || action === 'warned_severe') {
      const severity = action === 'warned_severe' ? 'severe' : 'standard';
      const deduction = severity === 'severe' ? 20 : 10;

      const user = await env.DB.prepare(
        'SELECT gcs_score, warning_count FROM users WHERE uid = ?'
      ).bind(report.reported_user_id).first();

      if (user) {
        const newGcs = Math.max(0, (user.gcs_score || 100) - deduction);
        const newWarningCount = (user.warning_count || 0) + 1;

        stmts.push(env.DB.prepare(`
          UPDATE users SET
            gcs_score = ?, gcs_last_deduction_at = ?,
            warning_count = ?, warning_reason = ?,
            has_active_warning = 1, warning_issued_at = ?
          WHERE uid = ?
        `).bind(newGcs, timestamp, newWarningCount, body.reason || report.reason,
          timestamp, report.reported_user_id));

        // Send warning PM (fire-and-forget)
        const ctx = request.ctx;
        if (ctx) {
          ctx.waitUntil(
            sendSystemPm(env, report.reported_user_id,
              `⚠️ You have received a warning.\n\nReason: ${body.reason || report.reason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100).`
            ).catch(err => console.error('Failed to send warning PM:', err))
          );
        }
      }
    }

    // Send resolution PM to reporter (fire-and-forget)
    const ctx = request.ctx;
    if (ctx && report.reporter_id) {
      const actionText = action === 'dismissed' ? 'reviewed and dismissed'
        : action === 'warned' ? 'reviewed and a warning was issued'
        : action === 'warned_severe' ? 'reviewed and a severe warning was issued'
        : action === 'suspended' ? 'reviewed and the user has been suspended'
        : 'reviewed';
      ctx.waitUntil(
        sendSystemPm(env, report.reporter_id,
          `Your report has been ${actionText}. Thank you for helping keep ShyTalk safe.`
        ).catch(err => console.error('Failed to send reporter PM:', err))
      );
    }

    await env.DB.batch(stmts);

    // Release lock
    await env.DB.prepare(
      'DELETE FROM report_locks WHERE report_id = ?'
    ).bind(report.reported_user_id).run();

    return json({ success: true });
  });

  // ── Resolve all pending reports for a user ──
  router.post('/api/reports/resolve-all/:userId', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const action = body?.action || 'dismissed';
    const timestamp = now();

    const { results: reports } = await env.DB.prepare(
      "SELECT id, reporter_id FROM reports WHERE reported_user_id = ? AND status = 'pending'"
    ).bind(params.userId).all();

    if (reports.length === 0) return json({ success: true, resolved: 0 });

    const stmts = [];
    for (const report of reports) {
      stmts.push(env.DB.prepare(`
        UPDATE reports SET status = 'resolved', action_taken = ?, resolved_at = ?, resolved_by = ?
        WHERE id = ?
      `).bind(action, timestamp, request.auth.uid, report.id));
    }

    // Apply warning if applicable
    if (action === 'warned' || action === 'warned_severe') {
      const severity = action === 'warned_severe' ? 'severe' : 'standard';
      const deduction = severity === 'severe' ? 20 : 10;

      const user = await env.DB.prepare(
        'SELECT gcs_score, warning_count FROM users WHERE uid = ?'
      ).bind(params.userId).first();

      if (user) {
        const newGcs = Math.max(0, (user.gcs_score || 100) - deduction);
        const newWarningCount = (user.warning_count || 0) + 1;

        stmts.push(env.DB.prepare(`
          UPDATE users SET
            gcs_score = ?, gcs_last_deduction_at = ?,
            warning_count = ?, warning_reason = ?,
            has_active_warning = 1, warning_issued_at = ?
          WHERE uid = ?
        `).bind(newGcs, timestamp, newWarningCount, body.reason || 'Multiple reports',
          timestamp, params.userId));

        const ctx = request.ctx;
        if (ctx) {
          ctx.waitUntil(
            sendSystemPm(env, params.userId,
              `⚠️ You have received a warning based on multiple reports.\n\nReason: ${body.reason || 'Multiple reports'}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100).`
            ).catch(err => console.error('Failed to send warning PM:', err))
          );
        }
      }
    }

    // Audit log
    stmts.push(env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'RESOLVE_ALL_REPORTS', ?, ?, ?)
    `).bind(generateId(), request.auth.uid, params.userId,
      `Resolved ${reports.length} reports: ${action}`, timestamp));

    await env.DB.batch(stmts);

    // Send resolution PMs to all reporters (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      const uniqueReporters = [...new Set(reports.map(r => r.reporter_id).filter(Boolean))];
      for (const reporterId of uniqueReporters) {
        ctx.waitUntil(
          sendSystemPm(env, reporterId,
            'Your report has been reviewed. Thank you for helping keep ShyTalk safe.'
          ).catch(() => {})
        );
      }
    }

    // Release lock
    await env.DB.prepare(
      'DELETE FROM report_locks WHERE report_id = ?'
    ).bind(params.userId).run();

    return json({ success: true, resolved: reports.length });
  });

  // ── Report statistics ──
  router.get('/api/reports/stats', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const pending = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM reports WHERE status = 'pending'"
    ).first();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const resolvedToday = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM reports WHERE status = 'resolved' AND resolved_at >= ?"
    ).bind(todayMs).first();

    const avgResponse = await env.DB.prepare(
      "SELECT AVG(resolved_at - created_at) as avg_ms FROM reports WHERE status = 'resolved' AND resolved_at IS NOT NULL"
    ).first();

    const avgResponseHours = avgResponse?.avg_ms
      ? Math.round(avgResponse.avg_ms / (60 * 60 * 1000) * 10) / 10
      : 0;

    const { results: reviewers } = await env.DB.prepare(`
      SELECT resolved_by, COUNT(*) as count
      FROM reports WHERE status = 'resolved' AND resolved_at >= ?
      GROUP BY resolved_by
    `).bind(todayMs).all();

    return json({
      pendingCount: pending?.count || 0,
      resolvedToday: resolvedToday?.count || 0,
      avgResponseHours,
      activeReviewers: reviewers,
    });
  });

  // ── CSV export ──
  router.get('/api/reports/export', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let query = "SELECT * FROM reports WHERE status = 'resolved'";
    const binds = [];

    if (from) {
      query += ' AND resolved_at >= ?';
      binds.push(new Date(from).getTime());
    }
    if (to) {
      query += ' AND resolved_at <= ?';
      binds.push(new Date(to + 'T23:59:59.999Z').getTime());
    }

    query += ' ORDER BY resolved_at DESC LIMIT 5000';

    const { results } = await env.DB.prepare(query).bind(...binds).all();

    // Build CSV
    const headers = [
      'id', 'reporter_name', 'reported_user_name', 'reason', 'description',
      'action_taken', 'resolved_at', 'resolved_by', 'created_at'
    ];
    const csvRows = [headers.join(',')];
    for (const r of results) {
      csvRows.push(headers.map(h => {
        let val = r[h] ?? '';
        if (h === 'resolved_at' || h === 'created_at') {
          val = val ? new Date(val).toISOString() : '';
        }
        // Escape CSV value
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(','));
    }

    return new Response(csvRows.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="reports-export.csv"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  // ── Lock report (admin) ──
  router.post('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const admin = await env.DB.prepare(
      'SELECT display_name FROM users WHERE uid = ?'
    ).bind(request.auth.uid).first();

    await env.DB.prepare(`
      INSERT INTO report_locks (report_id, locked_by, locked_at, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET locked_by = ?, locked_at = ?, display_name = ?
    `).bind(
      params.id, request.auth.uid, now(), admin?.display_name || null,
      request.auth.uid, now(), admin?.display_name || null
    ).run();

    return json({ success: true });
  });

  // ── Unlock report (admin) ──
  router.delete('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare(
      'DELETE FROM report_locks WHERE report_id = ?'
    ).bind(params.id).run();

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // SUSPENSIONS (admin)
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

    const user = await env.DB.prepare(
      'SELECT display_name, profile_photo_url, cover_photo_url FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);

    const timestamp = now();
    const stmts = [
      env.DB.prepare(`
        UPDATE users SET
          is_suspended = 1,
          suspension_reason = ?,
          suspension_start_date = ?,
          suspension_end_date = ?,
          suspension_can_appeal = ?,
          suspended_by = ?,
          pre_suspension_display_name = ?,
          pre_suspension_profile_photo_url = ?,
          pre_suspension_cover_photo_url = ?,
          display_name = 'Suspended Account',
          profile_photo_url = NULL,
          cover_photo_url = NULL,
          avatar_url = NULL,
          current_room_id = NULL
        WHERE uid = ?
      `).bind(
        body.reason.trim(), timestamp, endTimestamp,
        body.canAppeal ? 1 : 0, request.auth.uid,
        user.display_name, user.profile_photo_url, user.cover_photo_url,
        params.uid
      ),
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'SUSPEND', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, params.uid, body.reason, timestamp),
    ];
    await env.DB.batch(stmts);

    // Evict from rooms (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(evictSuspendedUser(env, params.uid));
    }

    return json({ success: true });
  });

  // ── Unsuspend user ──
  router.post('/api/admin/users/:uid/unsuspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT pre_suspension_display_name, pre_suspension_profile_photo_url, pre_suspension_cover_photo_url FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);

    const updates = [
      'is_suspended = 0',
      'suspension_reason = NULL',
      'suspension_start_date = NULL',
      'suspension_end_date = NULL',
      'suspension_can_appeal = NULL',
      'suspended_by = NULL',
    ];
    const binds = [];

    if (user.pre_suspension_display_name) {
      updates.push('display_name = ?');
      binds.push(user.pre_suspension_display_name);
    }
    if (user.pre_suspension_profile_photo_url) {
      updates.push('profile_photo_url = ?');
      binds.push(user.pre_suspension_profile_photo_url);
    }
    if (user.pre_suspension_cover_photo_url) {
      updates.push('cover_photo_url = ?');
      binds.push(user.pre_suspension_cover_photo_url);
    }
    updates.push(
      'pre_suspension_display_name = NULL',
      'pre_suspension_profile_photo_url = NULL',
      'pre_suspension_cover_photo_url = NULL'
    );

    binds.push(params.uid);
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`
    ).bind(...binds).run();

    // Audit log
    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'UNSUSPEND', ?, NULL, ?)
    `).bind(generateId(), request.auth.uid, params.uid, now()).run();

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

    const user = await env.DB.prepare(
      'SELECT is_suspended, suspension_can_appeal FROM users WHERE uid = ?'
    ).bind(uid).first();

    if (!user?.is_suspended) return jsonError('User is not suspended', 400);
    if (!user.suspension_can_appeal) return jsonError('Appeals are not allowed for this suspension', 403);

    const existing = await env.DB.prepare(
      "SELECT id FROM suspension_appeals WHERE user_id = ? AND status = 'pending'"
    ).bind(uid).first();

    if (existing) return jsonError('An appeal is already pending', 409);

    const appealId = generateId();
    await env.DB.prepare(`
      INSERT INTO suspension_appeals (id, user_id, appeal_text, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).bind(appealId, uid, body.appealText, now()).run();

    return json({ success: true, appealId });
  });

  // ── List appeals (admin) — supports status filter ──
  router.get('/api/appeals', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = `
      SELECT sa.*, u.display_name, u.unique_id, u.suspension_reason, u.suspension_end_date
      FROM suspension_appeals sa
      JOIN users u ON u.uid = sa.user_id
    `;
    const binds = [];

    if (status) {
      query += ' WHERE sa.status = ?';
      binds.push(status);
    }

    query += ' ORDER BY sa.created_at DESC LIMIT 100';

    const { results: appeals } = await env.DB.prepare(query).bind(...binds).all();

    return json(appeals);
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

    const appeal = await env.DB.prepare(
      'SELECT user_id FROM suspension_appeals WHERE id = ?'
    ).bind(params.id).first();

    if (!appeal) return jsonError('Appeal not found', 404);

    const stmts = [
      env.DB.prepare(`
        UPDATE suspension_appeals SET status = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
      `).bind(status, request.auth.uid, now(), params.id),
    ];

    if (status === 'approved') {
      const user = await env.DB.prepare(
        'SELECT pre_suspension_display_name, pre_suspension_profile_photo_url, pre_suspension_cover_photo_url FROM users WHERE uid = ?'
      ).bind(appeal.user_id).first();

      let unsuspendSql = `UPDATE users SET
        is_suspended = 0, suspension_reason = NULL,
        suspension_start_date = NULL, suspension_end_date = NULL,
        suspension_can_appeal = NULL, suspended_by = NULL,
        pre_suspension_display_name = NULL,
        pre_suspension_profile_photo_url = NULL,
        pre_suspension_cover_photo_url = NULL`;
      const unsuspendBinds = [];

      if (user?.pre_suspension_display_name) {
        unsuspendSql += ', display_name = ?';
        unsuspendBinds.push(user.pre_suspension_display_name);
      }
      if (user?.pre_suspension_profile_photo_url) {
        unsuspendSql += ', profile_photo_url = ?';
        unsuspendBinds.push(user.pre_suspension_profile_photo_url);
      }
      if (user?.pre_suspension_cover_photo_url) {
        unsuspendSql += ', cover_photo_url = ?';
        unsuspendBinds.push(user.pre_suspension_cover_photo_url);
      }

      unsuspendSql += ' WHERE uid = ?';
      unsuspendBinds.push(appeal.user_id);

      stmts.push(env.DB.prepare(unsuspendSql).bind(...unsuspendBinds));
    }

    // Audit log
    stmts.push(env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(), request.auth.uid,
      status === 'approved' ? 'APPEAL_APPROVED' : 'APPEAL_DENIED',
      appeal.user_id, null, now()
    ));

    await env.DB.batch(stmts);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // AUDIT LOG (admin)
  // ══════════════════════════════════════════════════════════════

  router.get('/api/admin/audit-log', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const { results } = await env.DB.prepare(`
      SELECT al.*, u.display_name as admin_name
      FROM admin_audit_log al
      LEFT JOIN users u ON u.uid = al.admin_id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return json(results);
  });
}

/**
 * Evict a suspended user from all rooms they're in.
 */
async function evictSuspendedUser(env, userId) {
  try {
    const { results: participations } = await env.DB.prepare(
      'SELECT room_id FROM room_participants WHERE user_id = ?'
    ).bind(userId).all();

    for (const { room_id: roomId } of participations) {
      const room = await env.DB.prepare(
        'SELECT owner_id FROM rooms WHERE id = ?'
      ).bind(roomId).first();

      if (!room) continue;

      if (room.owner_id === userId) {
        try {
          const doId = env.ROOM_DO.idFromName(roomId);
          const stub = env.ROOM_DO.get(doId);
          await stub.fetch(new Request('https://do/broadcast', {
            method: 'POST',
            body: JSON.stringify({ type: 'room_closed' }),
          }));
        } catch {}
        await env.DB.prepare("UPDATE rooms SET status = 'CLOSED' WHERE id = ?").bind(roomId).run();
      } else {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?').bind(roomId, userId),
          env.DB.prepare('DELETE FROM room_seats WHERE room_id = ? AND user_id = ?').bind(roomId, userId),
        ]);
        try {
          const doId = env.ROOM_DO.idFromName(roomId);
          const stub = env.ROOM_DO.get(doId);
          await stub.fetch(new Request('https://do/broadcast', {
            method: 'POST',
            body: JSON.stringify({ type: 'room_updated' }),
          }));
        } catch {}
      }
    }
  } catch (err) {
    console.error(`Failed to evict suspended user ${userId} from rooms:`, err);
  }
}

module.exports = { registerReportRoutes };
