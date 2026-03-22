/**
 * Notification routes — FCM token management and notification settings.
 *
 * POST   /api/notifications/token    -> Save FCM token
 * DELETE /api/notifications/token    -> Remove FCM token
 * PATCH  /api/notifications/settings -> Update notification settings
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');

// -- Save FCM token --
router.post('/notifications/token', async (req, res) => {
  try {
    if (!req.body?.token || typeof req.body.token !== 'string' || req.body.token.length > 500) {
      return res.status(400).json({ error: 'token must be a non-empty string' });
    }

    const uniqueId = req.auth.uniqueId;
    await db.doc(`users/${uniqueId}`).update({
      fcmTokens: FieldValue.arrayUnion(req.body.token),
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error saving FCM token', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Remove FCM token --
router.delete('/notifications/token', async (req, res) => {
  try {
    if (!req.body?.token || typeof req.body.token !== 'string' || req.body.token.length > 500) {
      return res.status(400).json({ error: 'token must be a non-empty string' });
    }

    const uniqueId = req.auth.uniqueId;
    await db.doc(`users/${uniqueId}`).update({
      fcmTokens: FieldValue.arrayRemove(req.body.token),
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error removing FCM token', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Update notification settings --
router.patch('/notifications/settings', async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Invalid body' });
    }

    const allowedFields = [
      'pmNotificationsEnabled',
      'pmSoundEnabled',
      'pmShowTimestamps',
      'pmShowDateSeparators',
      'pmNotificationPreview',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in req.body) updates[key] = !!req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields' });
    }

    await db.doc(`users/${req.auth.uniqueId}`).update(updates);

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error updating notification settings', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
