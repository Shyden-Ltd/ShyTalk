/**
 * Admin user routes — user CRUD, warnings, GCS reset, route aliases.
 *
 * GET    /api/user/:uid                 → Full user profile (admin)
 * PATCH  /api/user/:uid                 → Update user fields (admin)
 * POST   /api/user/:uid/warn            → Issue warning (admin)
 * POST   /api/user/:uid/reset-gcs       → Reset GCS score (admin)
 * GET    /api/search/uniqueId/:id       → Search by unique ID (alias)
 * POST   /api/resolve/uids-to-uniqueIds → Resolve UIDs to unique IDs (alias)
 * POST   /api/resolve/uniqueIds-to-uids → Resolve unique IDs to UIDs (alias)
 * POST   /api/user/:uid/suspend         → Suspend user (alias)
 * POST   /api/user/:uid/unsuspend       → Unsuspend user (alias)
 * POST   /api/report-locks/:uid/lock    → Lock reports for user (alias)
 * DELETE /api/report-locks/:uid         → Unlock reports for user (alias)
 * GET    /api/conversations/:id/messages → Admin view conversation messages
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');

function registerAdminUserRoutes(router) {

  // ══════════════════════════════════════════════════════════════
  // USER CRUD (admin)
  // ══════════════════════════════════════════════════════════════

  // ── Get user profile (admin — no ownership check) ──
  router.get('/api/user/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare('SELECT * FROM users WHERE uid = ?')
      .bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    // Enrich with GCS display score
    user.gcs_display_score = computeDisplayScore(user.gcs_score, user.gcs_last_deduction_at);

    return json(user);
  });

  // ── Update user fields (admin — whitelisted fields) ──
  router.patch('/api/user/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    // Admin can update more fields than regular users
    const allowedFields = [
      'display_name', 'description', 'nationality', 'date_of_birth', 'gender',
      'profile_photo_url', 'avatar_url', 'cover_photo_url', 'user_type',
      'shy_coins', 'shy_beans', 'luck_score', 'pity_counter',
      'is_super_shy', 'super_shy_expiry', 'super_shy_tier',
      'login_streak', 'gcs_score', 'warning_count', 'warning_reason',
      'has_active_warning', 'pm_privacy', 'accepted_legal_version',
      'current_room_id',
    ];

    const updates = {};
    for (const key of allowedFields) {
      // Support both camelCase and snake_case input
      const snakeKey = key;
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (snakeKey in body) updates[snakeKey] = body[snakeKey];
      else if (camelKey in body) updates[snakeKey] = body[camelKey];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields to update', 400);
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    await env.DB.prepare(`UPDATE users SET ${setClauses} WHERE uid = ?`)
      .bind(...values, params.uid).run();

    // Audit log
    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'EDIT_USER', ?, ?, ?)
    `).bind(generateId(), request.auth.uid, params.uid,
      `Updated fields: ${Object.keys(updates).join(', ')}`, now()).run();

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // WARNINGS & GCS (admin)
  // ══════════════════════════════════════════════════════════════

  // ── Issue warning ──
  router.post('/api/user/:uid/warn', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.reason) return jsonError('reason is required', 400);

    const severity = body.severity || 'standard';
    const deduction = severity === 'severe' ? 20 : 10;
    const timestamp = now();

    const user = await env.DB.prepare(
      'SELECT gcs_score, warning_count, display_name FROM users WHERE uid = ?'
    ).bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    const newGcs = Math.max(0, (user.gcs_score || 100) - deduction);
    const newWarningCount = (user.warning_count || 0) + 1;

    const stmts = [
      // Update user warning fields
      env.DB.prepare(`
        UPDATE users SET
          gcs_score = ?,
          gcs_last_deduction_at = ?,
          warning_count = ?,
          warning_reason = ?,
          has_active_warning = 1,
          warning_issued_at = ?
        WHERE uid = ?
      `).bind(newGcs, timestamp, newWarningCount, body.reason, timestamp, params.uid),

      // Audit log
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'WARN', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, params.uid,
        `Severity: ${severity}, GCS: ${user.gcs_score || 100} → ${newGcs}, Reason: ${body.reason}`,
        timestamp),
    ];

    await env.DB.batch(stmts);

    // Send system PM to warned user (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(
        sendSystemPm(env, params.uid,
          `⚠️ You have received a warning from the moderation team.\n\nReason: ${body.reason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100). Repeated violations may result in suspension.`
        ).catch(err => console.error('Failed to send warning PM:', err))
      );
    }

    return json({
      success: true,
      newGcs,
      deduction,
      warningCount: newWarningCount,
    });
  });

  // ── Reset GCS ──
  router.post('/api/user/:uid/reset-gcs', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const timestamp = now();

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users SET
          gcs_score = 100,
          gcs_last_deduction_at = NULL,
          warning_count = 0,
          has_active_warning = 0,
          warning_reason = NULL,
          warning_issued_at = NULL
        WHERE uid = ?
      `).bind(params.uid),

      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'RESET_GCS', ?, 'GCS reset to 100', ?)
      `).bind(generateId(), request.auth.uid, params.uid, timestamp),
    ]);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // ADMIN VIEW CONVERSATION MESSAGES
  // ══════════════════════════════════════════════════════════════

  router.get('/api/conversations/:id/messages', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const messageLimit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    const { results } = await env.DB.prepare(`
      SELECT * FROM private_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(params.id, messageLimit).all();

    // Return chronological order
    return json(results.reverse());
  });

  // ══════════════════════════════════════════════════════════════
  // ROUTE ALIASES (match admin page's expected paths)
  // ══════════════════════════════════════════════════════════════

  // ── Search by unique ID ──
  router.get('/api/search/uniqueId/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE unique_id = ?'
    ).bind(parseInt(params.id)).first();
    if (!user) return jsonError('User not found', 404);

    user.gcs_display_score = computeDisplayScore(user.gcs_score, user.gcs_last_deduction_at);
    return json(user);
  });

  // ── UID ↔ Unique ID resolvers ──
  router.post('/api/resolve/uids-to-uniqueIds', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const uids = body?.uids || [];
    if (uids.length === 0) return json({});

    const placeholders = uids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT uid, unique_id FROM users WHERE uid IN (${placeholders})`
    ).bind(...uids).all();

    const map = {};
    for (const r of results) map[r.uid] = r.unique_id;
    return json(map);
  });

  router.post('/api/resolve/uniqueIds-to-uids', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const uniqueIds = body?.uniqueIds || [];
    if (uniqueIds.length === 0) return json({});

    const placeholders = uniqueIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT uid, unique_id FROM users WHERE unique_id IN (${placeholders})`
    ).bind(...uniqueIds).all();

    const map = {};
    for (const r of results) map[r.unique_id] = r.uid;
    return json(map);
  });

  // ── Suspend/unsuspend aliases (singular /api/user/:uid path) ──
  router.post('/api/user/:uid/suspend', async (request, env, params) => {
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
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users SET
          is_suspended = 1, suspension_reason = ?, suspension_start_date = ?,
          suspension_end_date = ?, suspension_can_appeal = ?, suspended_by = ?,
          pre_suspension_display_name = ?,
          pre_suspension_profile_photo_url = ?,
          pre_suspension_cover_photo_url = ?,
          display_name = 'Suspended Account',
          profile_photo_url = NULL, cover_photo_url = NULL,
          avatar_url = NULL, bio = NULL, current_room_id = NULL
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
    ]);

    return json({ success: true });
  });

  router.post('/api/user/:uid/unsuspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT pre_suspension_display_name, pre_suspension_profile_photo_url, pre_suspension_cover_photo_url FROM users WHERE uid = ?'
    ).bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    const updates = [
      'is_suspended = 0', 'suspension_reason = NULL',
      'suspension_start_date = NULL', 'suspension_end_date = NULL',
      'suspension_can_appeal = NULL', 'suspended_by = NULL',
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

    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'UNSUSPEND', ?, NULL, ?)
    `).bind(generateId(), request.auth.uid, params.uid, now()).run();

    return json({ success: true });
  });

  // ── Report locks by UID (admin page uses reported user's UID as key) ──
  router.post('/api/report-locks/:uid/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Look up admin display name for the lock
    const admin = await env.DB.prepare(
      'SELECT display_name FROM users WHERE uid = ?'
    ).bind(request.auth.uid).first();

    await env.DB.prepare(`
      INSERT INTO report_locks (report_id, locked_by, locked_at, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET locked_by = ?, locked_at = ?, display_name = ?
    `).bind(
      params.uid, request.auth.uid, now(), admin?.display_name || null,
      request.auth.uid, now(), admin?.display_name || null
    ).run();

    return json({ success: true, displayName: admin?.display_name || null });
  });

  router.delete('/api/report-locks/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare(
      'DELETE FROM report_locks WHERE report_id = ?'
    ).bind(params.uid).run();

    return json({ success: true });
  });
}

module.exports = { registerAdminUserRoutes };
