/**
 * Admin ban routes — device/network ban CRUD, bulk unban.
 *
 * GET    /admin/bans                  → List all active bans
 * POST   /admin/bans/device           → Ban a device
 * POST   /admin/bans/network          → Ban a network (ip/subnet/asn)
 * DELETE /admin/bans/device/:deviceId → Unban device
 * DELETE /admin/bans/network/:banId   → Unban network
 * POST   /admin/bans/unban-all/:userId → Remove all bans for a user
 * GET    /admin/bans/user/:userId     → Get all bans for a user
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Parse a duration string (e.g. '24h', '7d', '30d', 'permanent') into
 * an ISO-8601 expiry timestamp, or null for permanent bans.
 */
function parseExpiry(duration) {
  if (!duration || duration === 'permanent') return null;
  const units = { h: 3600000, d: 86400000 };
  const match = duration.match(/^(\d+)([hd])$/);
  if (!match) return null;
  return new Date(Date.now() + parseInt(match[1]) * units[match[2]]).toISOString();
}

// ─── List all active bans ────────────────────────────────────────

router.get('/admin/bans', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const [deviceSnap, networkSnap] = await Promise.all([
      db.collection('deviceBans').get(),
      db.collection('networkBans').get(),
    ]);

    const nowMs = Date.now();

    const deviceBans = deviceSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => !b.expiresAt || new Date(b.expiresAt).getTime() > nowMs);

    const networkBans = networkSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => !b.expiresAt || new Date(b.expiresAt).getTime() > nowMs);

    res.json({ deviceBans, networkBans });
  } catch (err) {
    log.error('admin-bans', 'Error listing bans', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Ban a device ────────────────────────────────────────────────

router.post('/admin/bans/device', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { deviceId, reason, duration, linkedUserId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const expiresAt = parseExpiry(duration);

    await db.doc(`deviceBans/${deviceId}`).set({
      deviceId,
      reason,
      duration: duration || 'permanent',
      expiresAt,
      linkedUserId: linkedUserId || null,
      createdAt: now(),
      createdBy: req.auth.uid,
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'BAN_DEVICE',
      targetDeviceId: deviceId,
      details: `Reason: ${reason}, Duration: ${duration || 'permanent'}`,
      createdAt: now(),
    });

    // Send system PM if linked to a user (non-blocking)
    if (linkedUserId) {
      try { await sendSystemPm(linkedUserId, 'A restriction has been placed on your account.'); } catch (e) { log.warn('system-pm', 'Failed to send', { userId: linkedUserId, error: e.message }); }
    }

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error banning device', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Ban a network ───────────────────────────────────────────────

router.post('/admin/bans/network', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { type, value, reason, duration, linkedUserId } = req.body || {};

    const validTypes = ['ip', 'subnet', 'asn'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'type must be one of: ip, subnet, asn' });
    }
    if (!value || typeof value !== 'string') return res.status(400).json({ error: 'value is required' });

    // Validate format based on type
    const IP_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    const CIDR_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;
    if (type === 'ip' && !IP_REGEX.test(value)) {
      return res.status(400).json({ error: 'Invalid IP address format' });
    }
    if (type === 'subnet' && !CIDR_REGEX.test(value)) {
      return res.status(400).json({ error: 'Invalid CIDR subnet format (e.g. 192.168.0.0/24)' });
    }
    if (type === 'asn' && !/^\d+$/.test(value)) {
      return res.status(400).json({ error: 'ASN must be numeric' });
    }

    const banId = generateId();
    const expiresAt = parseExpiry(duration);

    await db.doc(`networkBans/${banId}`).set({
      type,
      value,
      reason,
      duration: duration || 'permanent',
      expiresAt,
      linkedUserId: linkedUserId || null,
      createdAt: now(),
      createdBy: req.auth.uid,
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'BAN_NETWORK',
      targetValue: value,
      details: `Type: ${type}, Reason: ${reason}, Duration: ${duration || 'permanent'}`,
      createdAt: now(),
    });

    // Send system PM if linked to a user (non-blocking)
    if (linkedUserId) {
      try { await sendSystemPm(linkedUserId, 'A restriction has been placed on your account.'); } catch (e) { log.warn('system-pm', 'Failed to send', { userId: linkedUserId, error: e.message }); }
    }

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error banning network', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban device ────────────────────────────────────────────────

router.delete('/admin/bans/device/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await db.doc(`deviceBans/${req.params.deviceId}`).delete();

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_DEVICE',
      targetDeviceId: req.params.deviceId,
      createdAt: now(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning device', { deviceId: req.params.deviceId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban network ───────────────────────────────────────────────

router.delete('/admin/bans/network/:banId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await db.doc(`networkBans/${req.params.banId}`).delete();

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_NETWORK',
      targetBanId: req.params.banId,
      createdAt: now(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning network', { banId: req.params.banId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban all for user ──────────────────────────────────────────

router.post('/admin/bans/unban-all/:userId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const userId = req.params.userId;

    const [deviceSnap, networkSnap] = await Promise.all([
      db.collection('deviceBans').where('linkedUserId', '==', userId).get(),
      db.collection('networkBans').where('linkedUserId', '==', userId).get(),
    ]);

    const allDocs = [...deviceSnap.docs, ...networkSnap.docs];

    await Promise.all(allDocs.map(d => d.ref.delete()));

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_ALL',
      targetUserId: userId,
      details: `Removed ${allDocs.length} ban(s)`,
      createdAt: now(),
    });

    // Send system PM about restriction lifted (non-blocking)
    try { await sendSystemPm(userId, 'A restriction on your account has been lifted.'); } catch (e) { log.warn('system-pm', 'Failed to send', { userId, error: e.message }); }

    res.json({ success: true, removed: allDocs.length });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning all for user', { userId: req.params.userId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get bans for user ───────────────────────────────────────────

router.get('/admin/bans/user/:userId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const userId = req.params.userId;

    const [deviceSnap, networkSnap] = await Promise.all([
      db.collection('deviceBans').where('linkedUserId', '==', userId).get(),
      db.collection('networkBans').where('linkedUserId', '==', userId).get(),
    ]);

    const deviceBans = deviceSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const networkBans = networkSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ deviceBans, networkBans });
  } catch (err) {
    log.error('admin-bans', 'Error getting bans for user', { userId: req.params.userId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
