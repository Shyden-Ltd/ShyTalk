/**
 * Admin temporary unique ID routes.
 *
 * GET    /admin/users/check-id/:id   → Check if a unique ID is available
 * POST   /admin/users/:uniqueId/temp-id   → Set a temporary unique ID
 * DELETE /admin/users/:uniqueId/temp-id   → Clear a temporary unique ID
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ── Check ID availability ──
router.get('/admin/users/check-id/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id || id < 10000000) return res.status(400).json({ error: 'Invalid ID' });

    // Check real uniqueIds
    const realSnap = await db.collection('users').where('uniqueId', '==', id).limit(1).get();
    if (!realSnap.empty) {
      const user = realSnap.docs[0].data();
      return res.json({ available: false, conflictType: 'real', conflictUser: user.uniqueId });
    }

    // Check active temp IDs
    const tempSnap = await db.collection('users').where('tempUniqueId', '==', id).limit(1).get();
    if (!tempSnap.empty) {
      const user = tempSnap.docs[0].data();
      const expiry = user.tempUniqueIdExpiry;
      if (expiry && expiry > Date.now()) {
        return res.json({ available: false, conflictType: 'temp', conflictUser: user.uniqueId });
      }
    }

    res.json({ available: true });
  } catch (err) {
    log.error('admin-temp-id', 'Check ID failed', { id: req.params.id, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Set temporary unique ID ──
router.post('/admin/users/:uniqueId/temp-id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { tempUniqueId, expiryDate } = req.body || {};
    if (!tempUniqueId || tempUniqueId < 10000000) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    if (!expiryDate) {
      return res.status(400).json({ error: 'Expiry date is required' });
    }

    // Availability check
    const realSnap = await db
      .collection('users')
      .where('uniqueId', '==', tempUniqueId)
      .limit(1)
      .get();
    if (!realSnap.empty) {
      return res.status(409).json({ error: 'ID is in use as a real unique ID' });
    }

    const tempSnap = await db
      .collection('users')
      .where('tempUniqueId', '==', tempUniqueId)
      .limit(1)
      .get();
    if (!tempSnap.empty) {
      const user = tempSnap.docs[0].data();
      if (user.tempUniqueIdExpiry && user.tempUniqueIdExpiry > Date.now()) {
        return res.status(409).json({ error: 'ID is in use as an active temp ID' });
      }
    }

    const targetUniqueId = req.params.uniqueId;
    const timestamp = now();

    await db.doc(`users/${targetUniqueId}`).update({
      tempUniqueId,
      tempUniqueIdExpiry: expiryDate,
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'SET_TEMP_ID',
      targetUserId: targetUniqueId,
      details: `Set temp ID to ${tempUniqueId}, expires ${new Date(expiryDate).toISOString()}`,
      createdAt: timestamp,
    });

    // System PM (fire-and-forget)
    const expiryStr = new Date(expiryDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    sendSystemPm(
      targetUniqueId,
      `Your display ID has been temporarily changed to ${tempUniqueId}. It will expire on ${expiryStr} and return to your original ID.`,
    ).catch((err) =>
      log.warn('system-pm', 'Failed to send', { uniqueId: targetUniqueId, error: err.message }),
    );

    log.info('admin-temp-id', 'Temp ID set', {
      adminId: req.auth.uid,
      targetUniqueId,
      tempUniqueId,
      expiryDate,
    });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-temp-id', 'Set temp ID failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear temporary unique ID ──
router.delete('/admin/users/:uniqueId/temp-id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const targetUniqueId = req.params.uniqueId;
    const timestamp = now();

    await db.doc(`users/${targetUniqueId}`).update({
      tempUniqueId: FieldValue.delete(),
      tempUniqueIdExpiry: FieldValue.delete(),
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'CLEAR_TEMP_ID',
      targetUserId: targetUniqueId,
      details: 'Cleared temporary unique ID',
      createdAt: timestamp,
    });

    // System PM (fire-and-forget)
    sendSystemPm(targetUniqueId, 'Your display ID has been restored to your original ID.').catch(
      (err) =>
        log.warn('system-pm', 'Failed to send', { uniqueId: targetUniqueId, error: err.message }),
    );

    log.info('admin-temp-id', 'Temp ID cleared', { adminId: req.auth.uid, targetUniqueId });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-temp-id', 'Clear temp ID failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
