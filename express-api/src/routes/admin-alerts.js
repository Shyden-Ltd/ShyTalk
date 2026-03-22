/**
 * Admin alert routes — list, acknowledge, resolve alerts and manage config.
 *
 * GET    /admin/alerts         → List alerts with filters (admin only)
 * PATCH  /admin/alerts/:alertId → Update alert status (admin only)
 * GET    /admin/alert-config   → Get alert thresholds (admin only)
 * PATCH  /admin/alert-config   → Update alert thresholds (admin only)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { DEFAULT_ALERT_CONFIG } = require('../utils/alertManager');
const log = require('../utils/log');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /admin/alerts — List alerts with optional filters
router.get('/admin/alerts', async (req, res) => {
  if (requireAdmin(req, res)) return;

  try {
    const { type, severity, status } = req.query;
    let limit = parseInt(req.query.limit, 10) || DEFAULT_LIMIT;
    if (limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let query = db.collection('alerts').orderBy('createdAt', 'desc');

    if (type) query = query.where('type', '==', type);
    if (severity) query = query.where('severity', '==', severity);
    if (status) query = query.where('status', '==', status);

    query = query.limit(limit);

    const snapshot = await query.get();
    const alerts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.json({ alerts });
  } catch (err) {
    log.error('admin-alerts', 'Error listing alerts', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /admin/alerts/:alertId — Update alert status
router.patch('/admin/alerts/:alertId', async (req, res) => {
  if (requireAdmin(req, res)) return;

  try {
    const { alertId } = req.params;
    const { status } = req.body;

    if (!status || !['acknowledged', 'resolved'].includes(status)) {
      return res
        .status(400)
        .json({ error: 'Invalid status. Must be "acknowledged" or "resolved".' });
    }

    const ref = db.collection('alerts').doc(alertId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const update = { status };
    const adminId = req.auth.uniqueId || req.auth.uid;
    if (status === 'acknowledged') {
      update.acknowledgedBy = adminId;
    } else if (status === 'resolved') {
      update.resolvedBy = adminId;
      update.resolvedAt = new Date().toISOString();
    }

    await ref.update(update);

    res.json({ success: true, alertId, ...update });
  } catch (err) {
    log.error('admin-alerts', 'Error updating alert', {
      alertId: req.params.alertId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/alert-config — Get alert thresholds
router.get('/admin/alert-config', async (req, res) => {
  if (requireAdmin(req, res)) return;

  try {
    const snap = await db.collection('alertConfig').doc('settings').get();
    const config = snap.exists
      ? { ...DEFAULT_ALERT_CONFIG, ...snap.data() }
      : { ...DEFAULT_ALERT_CONFIG };

    res.json({ config });
  } catch (err) {
    log.error('admin-alerts', 'Error getting alert config', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /admin/alert-config — Update alert thresholds
router.patch('/admin/alert-config', async (req, res) => {
  if (requireAdmin(req, res)) return;

  try {
    const allowedKeys = Object.keys(DEFAULT_ALERT_CONFIG);
    const update = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await db.collection('alertConfig').doc('settings').set(update, { merge: true });

    // Return merged config
    const snap = await db.collection('alertConfig').doc('settings').get();
    const config = { ...DEFAULT_ALERT_CONFIG, ...snap.data() };

    res.json({ success: true, config });
  } catch (err) {
    log.error('admin-alerts', 'Error updating alert config', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
