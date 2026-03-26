/**
 * Admin device bindings routes — list, search, get, create, unbind devices.
 *
 * GET    /admin/devices              → List all device bindings (paginated, searchable)
 * POST   /admin/devices              → Create/re-seed a device binding (admin only)
 * GET    /admin/devices/user/:uniqueId → Get all devices for a user
 * GET    /admin/devices/:deviceId    → Get single device binding
 * DELETE /admin/devices/:deviceId    → Unbind device (delete binding)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ─── List all device bindings (paginated + searchable) ──────────

router.get('/admin/devices', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const searchQuery = (req.query.q || '').toLowerCase().trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const snap = await db.collection('deviceBindings').get();
    let devices = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // In-memory search (Firestore doesn't support full-text search)
    if (searchQuery) {
      devices = devices.filter((device) => {
        const searchable = [
          device.id,
          device.uniqueId,
          device.manufacturer,
          device.model,
          device.lastIp,
          device.isp,
        ]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(' ');
        return searchable.includes(searchQuery);
      });
    }

    const total = devices.length;
    const paginated = devices.slice(offset, offset + limit);

    res.json({ devices: paginated, total });
  } catch (err) {
    log.error('admin-devices', 'Error listing device bindings', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Create / re-seed a device binding ───────────────────────────

router.post('/admin/devices', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { deviceId, uniqueId, manufacturer, model, lastIp, isp } = req.body;

    if (!deviceId || uniqueId === undefined) {
      return res.status(400).json({ error: 'deviceId and uniqueId are required' });
    }

    const bindingData = {
      deviceId,
      uniqueId: Number(uniqueId),
      manufacturer: manufacturer || 'Unknown',
      model: model || 'Unknown',
      lastIp: lastIp || null,
      isp: isp || null,
      boundAt: now(),
    };

    await db.doc(`deviceBindings/${deviceId}`).set(bindingData);

    res.json({ id: deviceId, ...bindingData });
  } catch (err) {
    log.error('admin-devices', 'Error creating device binding', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get all devices for a user ─────────────────────────────────

router.get('/admin/devices/user/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = Number(req.params.uniqueId);
    const snap = await db.collection('deviceBindings').where('uniqueId', '==', uniqueId).get();

    const devices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({ devices });
  } catch (err) {
    log.error('admin-devices', 'Error fetching devices for user', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get single device binding ──────────────────────────────────

router.get('/admin/devices/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }

    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    log.error('admin-devices', 'Error fetching device binding', {
      deviceId: req.params.deviceId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unbind device ──────────────────────────────────────────────

router.delete('/admin/devices/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;

    // Check if binding exists
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }
    const deviceData = snap.data();

    await db.doc(`deviceBindings/${deviceId}`).delete();

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBIND_DEVICE',
      targetDeviceId: deviceId,
      details: `Unbound device ${deviceId}`,
      createdAt: now(),
    });

    // Send system PM to the bound user (non-blocking)
    if (deviceData.uniqueId) {
      try {
        await sendSystemPm(
          deviceData.uniqueId,
          'Your device binding has been reset by a moderator.',
        );
      } catch (e) {
        log.warn('system-pm', 'Failed to send', { error: e.message });
      }
    }

    res.json({ success: true });
  } catch (err) {
    log.error('admin-devices', 'Error unbinding device', {
      deviceId: req.params.deviceId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
