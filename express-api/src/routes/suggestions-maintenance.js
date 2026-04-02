const router = require('express').Router();
const { db } = require('../utils/firebase');
const log = require('../utils/log');
const { now } = require('../utils/helpers');

function requireAdmin(req, res) {
  if (!req.auth || !req.auth.token || !req.auth.token.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(db.doc(name + '/' + d.id)));
  await batch.commit();
  return snap.size;
}

router.post('/admin/maintenance/clear-suggestions', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const deleted = await deleteCollection('suggestions');
    await db.collection('adminAuditLog').add({
      adminUid: req.auth.uniqueId,
      actionType: 'maintenance_clear_suggestions',
      targetType: 'maintenance',
      targetId: 'all',
      details: { deleted },
      timestamp: now(),
    });
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('maintenance', 'Clear suggestions failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/maintenance/clear-subscriptions', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const deleted = await deleteCollection('subscriptions');
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('maintenance', 'Clear subscriptions failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/maintenance/clear-notifications', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const deleted = await deleteCollection('notifications');
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('maintenance', 'Clear notifications failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/maintenance/clear-identity-graphs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    if (!req.body.confirmDangerous)
      return res.status(400).json({ error: 'Confirmation required: set confirmDangerous to true' });
    const deleted = await deleteCollection('identityGraphs');
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('maintenance', 'Clear identity graphs failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/maintenance/clear-audit-log', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const deleted = await deleteCollection('adminAuditLog');
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('maintenance', 'Clear audit log failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
