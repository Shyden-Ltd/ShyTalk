/**
 * User routes — profile CRUD, social graph, stalkers, device binding.
 *
 * GET    /api/users/:uid              → Get user profile
 * PATCH  /api/users/:uid              → Update user profile fields
 * POST   /api/users                   → Create or update user (upsert)
 * GET    /api/users/:uid/exists       → Check if user exists
 * POST   /api/users/:uid/unique-id    → Generate a unique numeric ID
 * POST   /api/users/:uid/block        → Block a user
 * DELETE /api/users/:uid/block/:blockedId → Unblock a user
 * POST   /api/users/:uid/follow       → Follow a user
 * DELETE /api/users/:uid/follow/:targetId → Unfollow a user
 * DELETE /api/users/:uid/followers/:followerId → Remove follower
 * GET    /api/users/:uid/blocked      → Get blocked user IDs
 * POST   /api/users/batch             → Get multiple users by IDs
 * POST   /api/users/:uid/stalkers/visit → Record a profile visit
 * GET    /api/users/:uid/stalkers     → Get stalkers list
 * POST   /api/users/:uid/stalkers/viewed → Mark stalkers as viewed
 * GET    /api/users/:uid/aliases      → Get aliases
 * PUT    /api/users/:uid/aliases/:targetId → Set alias
 * DELETE /api/users/:uid/aliases/:targetId → Remove alias
 * POST   /api/users/:uid/appeal       → Submit suspension appeal
 * POST   /api/users/:uid/lift-suspension → Lift expired suspension
 * GET    /api/users/:uid/flags        → Get user flags (suspension/warning)
 * POST   /api/users/:uid/acknowledge-warning → Acknowledge warning
 * GET    /api/users/:uid/warning-reason → Get warning reason
 * GET    /api/device-bindings/:deviceId → Get device binding
 * POST   /api/device-bindings         → Bind device
 */

const { json, jsonError, generateId, now, parseBody, normalizeKeys } = require('../utils');

function registerUserRoutes(router) {
  // ── Get user profile ──
  router.get('/api/users/:uid', async (request, env, params) => {
    const user = await env.DB.prepare('SELECT * FROM users WHERE uid = ?')
      .bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    // Attach social graph arrays
    const [blocks, following, followers] = await Promise.all([
      env.DB.prepare('SELECT blocked_user_id FROM user_blocks WHERE user_id = ?')
        .bind(params.uid).all(),
      env.DB.prepare('SELECT following_id FROM user_follows WHERE follower_id = ?')
        .bind(params.uid).all(),
      env.DB.prepare('SELECT follower_id FROM user_follows WHERE following_id = ?')
        .bind(params.uid).all(),
    ]);

    user.blockedUserIds = blocks.results.map(r => r.blocked_user_id);
    user.followingIds = following.results.map(r => r.following_id);
    user.followerIds = followers.results.map(r => r.follower_id);

    return json(user);
  });

  // ── Update user profile ──
  router.patch('/api/users/:uid', async (request, env, params) => {
    if (request.auth.uid !== params.uid) {
      return jsonError('Cannot update another user', 403);
    }

    const rawBody = await parseBody(request);
    if (!rawBody) return jsonError('Invalid JSON body', 400);
    const body = normalizeKeys(rawBody);

    // Only allow whitelisted fields
    const allowedFields = [
      'display_name', 'description', 'nationality', 'date_of_birth', 'gender',
      'profile_photo_url', 'cover_photo_url',
      'pm_privacy', 'pm_notifications_enabled', 'pm_sound_enabled',
      'pm_show_timestamps', 'pm_show_date_separators', 'pm_notification_preview',
      'hide_following', 'hide_online_status', 'hide_age',
      'self_destruct_alert_enabled', 'min_gift_animation_value',
      'dnd_enabled', 'dnd_start_hour', 'dnd_start_minute', 'dnd_end_hour', 'dnd_end_minute',
      'accepted_legal_version', 'current_room_id', 'last_room_name',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields to update', 400);
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    await env.DB.prepare(`UPDATE users SET ${setClauses} WHERE uid = ?`)
      .bind(...values, params.uid).run();

    return json({ success: true });
  });

  // ── Create or update user ──
  router.post('/api/users', async (request, env) => {
    const rawBody = await parseBody(request);
    if (!rawBody) return jsonError('uid required', 400);
    const body = normalizeKeys(rawBody);
    if (!body.uid) return jsonError('uid required', 400);

    const uid = body.uid;
    if (request.auth.uid !== uid) {
      return jsonError('Cannot create user for another uid', 403);
    }

    const existing = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?')
      .bind(uid).first();

    if (existing) {
      // Update last_seen_at
      await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE uid = ?')
        .bind(now(), uid).run();
      return json({ success: true, created: false });
    }

    // Insert new user
    await env.DB.prepare(`
      INSERT INTO users (uid, display_name, profile_photo_url, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(uid, body.display_name || null, body.profile_photo_url || null, now(), now()).run();

    return json({ success: true, created: true });
  });

  // ── Check if user exists ──
  router.get('/api/users/:uid/exists', async (request, env, params) => {
    const row = await env.DB.prepare('SELECT 1 FROM users WHERE uid = ?')
      .bind(params.uid).first();
    return json({ exists: !!row });
  });

  // ── Generate unique numeric ID ──
  router.post('/api/users/:uid/unique-id', async (request, env, params) => {
    if (request.auth.uid !== params.uid) {
      return jsonError('Cannot generate ID for another user', 403);
    }

    // Check if already has one
    const user = await env.DB.prepare('SELECT unique_id FROM users WHERE uid = ?')
      .bind(params.uid).first();
    if (user?.unique_id) {
      return json({ uniqueId: user.unique_id });
    }

    // Atomic increment of counter + assign to user
    const counter = await env.DB.prepare(
      "UPDATE counters SET value = value + 1 WHERE name = 'unique_id' RETURNING value"
    ).first();

    await env.DB.prepare('UPDATE users SET unique_id = ? WHERE uid = ?')
      .bind(counter.value, params.uid).run();

    return json({ uniqueId: counter.value });
  });

  // ── Block user ──
  router.post('/api/users/:uid/block', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    const body = await parseBody(request);
    if (!body?.blockedUserId) return jsonError('blockedUserId required', 400);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_blocks (user_id, blocked_user_id, created_at) VALUES (?, ?, ?)'
    ).bind(params.uid, body.blockedUserId, now()).run();

    return json({ success: true });
  });

  // ── Unblock user ──
  router.delete('/api/users/:uid/block/:blockedId', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare('DELETE FROM user_blocks WHERE user_id = ? AND blocked_user_id = ?')
      .bind(params.uid, params.blockedId).run();

    return json({ success: true });
  });

  // ── Follow user ──
  router.post('/api/users/:uid/follow', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    const body = await parseBody(request);
    if (!body?.targetUserId) return jsonError('targetUserId required', 400);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'
    ).bind(params.uid, body.targetUserId, now()).run();

    return json({ success: true });
  });

  // ── Unfollow user ──
  router.delete('/api/users/:uid/follow/:targetId', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?')
      .bind(params.uid, params.targetId).run();

    return json({ success: true });
  });

  // ── Remove follower ──
  router.delete('/api/users/:uid/followers/:followerId', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?')
      .bind(params.followerId, params.uid).run();

    return json({ success: true });
  });

  // ── Get blocked user IDs ──
  router.get('/api/users/:uid/blocked', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const { results } = await env.DB.prepare(
      'SELECT blocked_user_id FROM user_blocks WHERE user_id = ?'
    ).bind(params.uid).all();

    return json(results.map(r => r.blocked_user_id));
  });

  // ── Batch get users ──
  router.post('/api/users/batch', async (request, env) => {
    const body = await parseBody(request);
    const ids = body?.uids || body?.userIds;
    if (!ids || !Array.isArray(ids)) {
      return jsonError('uids array required', 400);
    }

    const capped = ids.slice(0, 100);
    if (capped.length === 0) return json({ users: [] });

    const placeholders = capped.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT * FROM users WHERE uid IN (${placeholders})`
    ).bind(...capped).all();

    return json({ users: results });
  });

  // ── Record profile visit (stalker) ──
  router.post('/api/users/:uid/stalkers/visit', async (request, env, params) => {
    const visitorId = request.auth.uid;
    if (visitorId === params.uid) return json({ success: true }); // skip self-visits

    const existing = await env.DB.prepare(
      'SELECT visit_count FROM stalkers WHERE profile_user_id = ? AND visitor_id = ?'
    ).bind(params.uid, visitorId).first();

    const timestamp = now();

    if (existing) {
      await env.DB.prepare(`
        UPDATE stalkers SET visit_count = visit_count + 1, last_visited_at = ?
        WHERE profile_user_id = ? AND visitor_id = ?
      `).bind(timestamp, params.uid, visitorId).run();

      // Increment new_stalker_count only
      await env.DB.prepare(
        'UPDATE users SET new_stalker_count = new_stalker_count + 1 WHERE uid = ?'
      ).bind(params.uid).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO stalkers (profile_user_id, visitor_id, visit_count, first_visited_at, last_visited_at)
        VALUES (?, ?, 1, ?, ?)
      `).bind(params.uid, visitorId, timestamp, timestamp).run();

      // Increment both counters
      await env.DB.prepare(
        'UPDATE users SET stalker_count = stalker_count + 1, new_stalker_count = new_stalker_count + 1 WHERE uid = ?'
      ).bind(params.uid).run();
    }

    return json({ success: true });
  });

  // ── Get stalkers ──
  router.get('/api/users/:uid/stalkers', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const { results } = await env.DB.prepare(
      'SELECT * FROM stalkers WHERE profile_user_id = ? ORDER BY last_visited_at DESC'
    ).bind(params.uid).all();

    return json(results);
  });

  // ── Mark stalkers viewed ──
  router.post('/api/users/:uid/stalkers/viewed', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare(
      'UPDATE users SET new_stalker_count = 0, stalkers_last_viewed_at = ? WHERE uid = ?'
    ).bind(now(), params.uid).run();

    return json({ success: true });
  });

  // ── Aliases ──
  router.get('/api/users/:uid/aliases', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const { results } = await env.DB.prepare(
      'SELECT target_user_id, alias FROM user_aliases WHERE user_id = ?'
    ).bind(params.uid).all();

    const aliases = {};
    for (const r of results) aliases[r.target_user_id] = r.alias;
    return json(aliases);
  });

  router.put('/api/users/:uid/aliases/:targetId', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    const body = await parseBody(request);
    if (!body?.alias) return jsonError('alias required', 400);

    await env.DB.prepare(`
      INSERT INTO user_aliases (user_id, target_user_id, alias) VALUES (?, ?, ?)
      ON CONFLICT(user_id, target_user_id) DO UPDATE SET alias = ?
    `).bind(params.uid, params.targetId, body.alias, body.alias).run();

    return json({ success: true });
  });

  router.delete('/api/users/:uid/aliases/:targetId', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare('DELETE FROM user_aliases WHERE user_id = ? AND target_user_id = ?')
      .bind(params.uid, params.targetId).run();

    return json({ success: true });
  });

  // ── Suspension appeal ──
  router.post('/api/users/:uid/appeal', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    const body = await parseBody(request);
    if (!body?.appealText) return jsonError('appealText required', 400);

    await env.DB.prepare(`
      INSERT INTO suspension_appeals (id, user_id, appeal_text, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).bind(generateId(), params.uid, body.appealText, now()).run();

    await env.DB.prepare(
      "UPDATE users SET suspension_appeal_status = 'pending' WHERE uid = ?"
    ).bind(params.uid).run();

    return json({ success: true });
  });

  // ── Lift expired suspension ──
  router.post('/api/users/:uid/lift-suspension', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const user = await env.DB.prepare(
      'SELECT is_suspended, suspension_end_date FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user || !user.is_suspended) {
      return jsonError('User is not suspended', 400);
    }

    if (user.suspension_end_date && user.suspension_end_date > now()) {
      return jsonError('Suspension has not expired yet', 400);
    }

    await env.DB.prepare(`
      UPDATE users SET
        is_suspended = 0, suspension_reason = NULL,
        suspension_start_date = NULL, suspension_end_date = NULL,
        suspension_can_appeal = 1, suspension_appeal_status = NULL,
        suspended_by = NULL, warning_count = 0
      WHERE uid = ?
    `).bind(params.uid).run();

    return json({ success: true });
  });

  // ── User flags ──
  router.get('/api/users/:uid/flags', async (request, env, params) => {
    const user = await env.DB.prepare(
      'SELECT is_suspended, suspension_end_date, has_active_warning, warning_reason FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);

    return json({
      isSuspended: !!user.is_suspended,
      suspensionEndDate: user.suspension_end_date,
      hasActiveWarning: !!user.has_active_warning,
      warningReason: user.warning_reason,
    });
  });

  // ── Acknowledge warning ──
  router.post('/api/users/:uid/acknowledge-warning', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    await env.DB.prepare(
      'UPDATE users SET has_active_warning = 0, warning_reason = NULL WHERE uid = ?'
    ).bind(params.uid).run();

    return json({ success: true });
  });

  // ── Warning reason ──
  router.get('/api/users/:uid/warning-reason', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const user = await env.DB.prepare(
      'SELECT warning_reason FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    return json({ reason: user?.warning_reason || null });
  });

  // ── Device bindings ──
  router.get('/api/device-bindings/:deviceId', async (request, env, params) => {
    const row = await env.DB.prepare(
      'SELECT user_id FROM device_bindings WHERE device_id = ?'
    ).bind(params.deviceId).first();

    return json({ userId: row?.user_id || null });
  });

  router.post('/api/device-bindings', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.deviceId) return jsonError('deviceId required', 400);

    await env.DB.prepare(`
      INSERT INTO device_bindings (device_id, user_id, bound_at) VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET user_id = ?, bound_at = ?
    `).bind(body.deviceId, request.auth.uid, now(), request.auth.uid, now()).run();

    return json({ success: true });
  });
}

module.exports = { registerUserRoutes };
