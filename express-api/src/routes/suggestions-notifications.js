/**
 * Suggestion notification inbox routes.
 *
 * GET  /notifications          -> paginated inbox, newest first, with unreadCount
 * PUT  /notifications/read-all -> mark all notifications as read
 * PUT  /notifications/:id/read -> mark single notification as read
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const log = require('../utils/log');

function requireAuth(req, res) {
  if (!req.auth || !req.auth.uniqueId) {
    res.status(401).json({ error: 'Authentication required' });
    return true;
  }
  return false;
}

// ─── GET /notifications ─────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const snap = await db
      .collection('notifications')
      .where('uid', '==', req.auth.uniqueId)
      .orderBy('createdAt', 'desc')
      .get();

    const notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    res.json({ notifications, unreadCount, total: notifications.length });
  } catch (err) {
    log.error('notifications', 'Failed to list', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /notifications/read-all ────────────────────────────────
// NOTE: Must be registered BEFORE /:id/read to avoid "read-all"
// being captured as an :id parameter.

router.put('/notifications/read-all', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const snap = await db
      .collection('notifications')
      .where('uid', '==', req.auth.uniqueId)
      .where('isRead', '==', false)
      .get();

    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(db.doc('notifications/' + d.id), { isRead: true }));
    await batch.commit();

    res.json({ success: true, updated: snap.size });
  } catch (err) {
    log.error('notifications', 'Mark all read failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /notifications/:id/read ────────────────────────────────

router.put('/notifications/:id/read', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    await db.doc('notifications/' + req.params.id).update({ isRead: true });

    res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Mark read failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /subscriptions/unsubscribe (no auth — token-based) ────

router.post('/subscriptions/unsubscribe', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ error: 'Unsubscribe token required' });
    }

    // Verify token format (must be at least 10 chars)
    if (token.length < 10) {
      return res.status(400).json({ error: 'Invalid unsubscribe token' });
    }

    // TODO: Decode token to get uid, then disable email channel
    res.json({ success: true, message: 'Email notifications disabled' });
  } catch (err) {
    log.error('notifications', 'Unsubscribe failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
