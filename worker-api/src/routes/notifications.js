/**
 * Notification routes — FCM token management and notification sending.
 *
 * POST   /api/notifications/token    → Save FCM token
 * DELETE /api/notifications/token    → Remove FCM token
 * PATCH  /api/notifications/settings → Update notification settings
 */

const { json, jsonError, now, parseBody } = require('../utils');

function registerNotificationRoutes(router) {
  // ── Save FCM token ──
  router.post('/api/notifications/token', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.token) return jsonError('token required', 400);

    await env.DB.prepare(`
      INSERT INTO fcm_tokens (user_id, token, created_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, token) DO UPDATE SET created_at = ?
    `).bind(request.auth.uid, body.token, now(), now()).run();

    return json({ success: true });
  });

  // ── Remove FCM token ──
  router.delete('/api/notifications/token', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.token) return jsonError('token required', 400);

    await env.DB.prepare(
      'DELETE FROM fcm_tokens WHERE user_id = ? AND token = ?'
    ).bind(request.auth.uid, body.token).run();

    return json({ success: true });
  });

  // ── Update notification settings ──
  router.patch('/api/notifications/settings', async (request, env) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const allowedFields = [
      'pm_notifications_enabled', 'pm_sound_enabled',
      'pm_show_timestamps', 'pm_show_date_separators', 'pm_notification_preview',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key] ? 1 : 0;
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields', 400);
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    await env.DB.prepare(`UPDATE users SET ${setClauses} WHERE uid = ?`)
      .bind(...values, request.auth.uid).run();

    return json({ success: true });
  });
}

module.exports = { registerNotificationRoutes };
