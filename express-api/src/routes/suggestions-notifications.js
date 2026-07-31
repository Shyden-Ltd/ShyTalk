/**
 * Suggestion notification inbox routes.
 *
 * GET  /notifications          -> paginated inbox, newest first, with unreadCount
 * PUT  /notifications/read-all -> mark all notifications as read
 * PUT  /notifications/:id/read -> mark single notification as read
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const {
  NOTIFICATION_TTL_MS,
  RETENTION_SCAN_CAP,
  notificationTime,
} = require('../utils/notification-retention');
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

    // SHY-0258: no `orderBy('createdAt')`. Firestore's orderBy silently EXCLUDES
    // documents that lack the ordered field, so an undated row was invisible
    // here — present in the collection, absent from the inbox, and impossible
    // to mark read. Sorted in memory instead, where a missing timestamp is
    // handled explicitly (same reasoning as the audit-log fix in SHY-0260).
    const snap = await db
      .collection('notifications')
      .where('uid', '==', req.auth.uniqueId)
      .limit(RETENTION_SCAN_CAP)
      .get();

    // Rows past the retention TTL are not shown and not counted. Retention is
    // enforced lazily on write, so a person who has received nothing recently
    // can still be holding expired rows; without this filter the unread badge
    // reports notifications the product considers gone.
    const cutoff = Date.now() - NOTIFICATION_TTL_MS;
    const notifications = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => notificationTime(n) >= cutoff)
      .sort((a, b) => notificationTime(b) - notificationTime(a));
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

// POST /subscriptions/unsubscribe is handled by subscriptions.js (HMAC-based token verification)

module.exports = router;
