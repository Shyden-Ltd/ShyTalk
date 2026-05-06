/**
 * Log configuration endpoints — public + admin.
 *
 * GET /log-config              → Public: read log config (mobile clients)
 * GET /admin/log-config        → Admin: read log config
 * PATCH /admin/log-config      → Admin: update log config
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const log = require('../utils/log');

const DEFAULT_CONFIG = {
  retentionHours: 48,
  levelPerSource: {
    'express-api': 'INFO',
    android: 'INFO',
    ios: 'INFO',
    'admin-panel': 'INFO',
    'landing-page': 'WARN',
  },
  excludedRoutes: [],
  hardCapDaily: 15000,
  batchSettings: { intervalSeconds: 30, wifiOnly: false },
};

const ALLOWED_FIELDS = [
  'retentionHours',
  'levelPerSource',
  'excludedRoutes',
  'hardCapDaily',
  'batchSettings',
];

// GET /log-config — Public (no admin guard), for mobile clients
router.get('/log-config', async (req, res) => {
  try {
    const doc = await db.doc('logConfig/settings').get();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(doc.exists ? doc.data() : DEFAULT_CONFIG);
  } catch (err) {
    log.error('admin-log-config', 'Error reading log config', { error: err.message });
    res.json(DEFAULT_CONFIG);
  }
});

// GET /admin/log-config — Admin only
router.get('/admin/log-config', async (req, res) => {
  if (await requireAdmin(req, res)) return;

  try {
    const doc = await db.doc('logConfig/settings').get();
    res.json(doc.exists ? doc.data() : DEFAULT_CONFIG);
  } catch (err) {
    log.error('admin-log-config', 'Error reading log config', { error: err.message });
    res.json(DEFAULT_CONFIG);
  }
});

// PATCH /admin/log-config — Admin only, update settings
router.patch('/admin/log-config', async (req, res) => {
  if (await requireAdmin(req, res)) return;

  try {
    const updates = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    await db.doc('logConfig/settings').set(updates, { merge: true });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-log-config', 'Error updating log config', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
