/**
 * Notification routes — FCM token management and notification settings.
 *
 * POST   /api/notifications/token    → Save FCM token
 * DELETE /api/notifications/token    → Remove FCM token
 * PATCH  /api/notifications/settings → Update notification settings
 */

const { json, jsonError, now, parseBody } = require('../utils');
const { getDoc, updateDoc } = require('../utils/firestore');

function registerNotificationRoutes(router) {
  // ── Save FCM token ──
  router.post('/api/notifications/token', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.token) return jsonError('token required', 400);

    const uid = request.auth.uid;
    const userDoc = await getDoc(env, `users/${uid}`);
    const tokens = userDoc?.fcmTokens || [];

    if (!tokens.includes(body.token)) {
      tokens.push(body.token);
      await updateDoc(env, `users/${uid}`, { fcmTokens: tokens });
    }

    return json({ success: true });
  });

  // ── Remove FCM token ──
  router.delete('/api/notifications/token', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.token) return jsonError('token required', 400);

    const uid = request.auth.uid;
    const userDoc = await getDoc(env, `users/${uid}`);
    const tokens = (userDoc?.fcmTokens || []).filter(t => t !== body.token);

    await updateDoc(env, `users/${uid}`, { fcmTokens: tokens });

    return json({ success: true });
  });

  // ── Update notification settings ──
  router.patch('/api/notifications/settings', async (request, env) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const allowedFields = [
      'pmNotificationsEnabled', 'pmSoundEnabled',
      'pmShowTimestamps', 'pmShowDateSeparators', 'pmNotificationPreview',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = !!body[key];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields', 400);
    }

    await updateDoc(env, `users/${request.auth.uid}`, updates);

    return json({ success: true });
  });
}

module.exports = { registerNotificationRoutes };
