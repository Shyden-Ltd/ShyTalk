/**
 * Admin ban routes — device/network ban CRUD, bulk unban.
 *
 * GET    /admin/bans                  → List all active bans
 * POST   /admin/bans/device           → Ban a device
 * POST   /admin/bans/network          → Ban a network (ip/subnet/asn)
 * DELETE /admin/bans/device/:deviceId → Unban device
 * DELETE /admin/bans/network/:banId   → Unban network
 * POST   /admin/bans/unban-all/:uniqueId → Remove all bans for a user
 * GET    /admin/bans/user/:uniqueId     → Get all bans for a user
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');

// Phase 2H finding #2 dedup: scope admin guard by path prefix.
const _adminGuardWrapper = async (req, res, next) => {
  if (await requireAdmin(req, res)) return;
  next();
};
router.use('/admin/bans', _adminGuardWrapper);

const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const { clearBanCache, isBanActive } = require('../utils/bans');
const { syncBannedClaim } = require('../utils/banned-claim');
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
  return new Date(Date.now() + Number.parseInt(match[1], 10) * units[match[2]]).toISOString();
}

/**
 * Every enumerable user a device-ban mutation affects (SHY-0150): the
 * explicitly linked account AND the device's bound owner — an admin may ban
 * hardware without linking it, but the bound account's claim standing still
 * flips. Never throws: the ban mutation has already committed, and the lazy
 * middleware sync self-heals anything missed here.
 */
async function syncClaimsForDeviceBan(deviceId, linkedUniqueId) {
  try {
    const targets = new Set();
    // Same truthiness the ban docs store (`linkedUniqueId || null`).
    if (linkedUniqueId) {
      targets.add(String(linkedUniqueId));
    }
    const bindingSnap = await db.doc(`deviceBindings/${deviceId}`).get();
    if (bindingSnap.exists) {
      const binding = bindingSnap.data() || {};
      const owner = binding.uniqueId ?? binding.userId ?? null;
      if (owner !== null && owner !== undefined) targets.add(String(owner));
    }
    for (const target of targets) {
      await syncBannedClaim(target);
    }
  } catch (err) {
    log.error('banned-claim', 'device-ban claim sync failed — lazy path will self-heal', {
      deviceId,
      error: err.message,
    });
  }
}

// ─── List all active bans ────────────────────────────────────────

router.get('/admin/bans', async (req, res) => {
  try {
    const [deviceSnap, networkSnap] = await Promise.all([
      db.collection('deviceBans').get(),
      db.collection('networkBans').get(),
    ]);

    // ONE definition of "active" — the same predicate the gate enforces with.
    // These filters used to inline `new Date(x).getTime() > now`, which for a
    // corrupt expiry is `NaN > now === false`: the console would show a ban as
    // gone while the gate was still enforcing it (reviewer R8-I1).
    const deviceBans = deviceSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter(isBanActive);

    const networkBans = networkSnap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .filter(isBanActive);

    res.json({ deviceBans, networkBans });
  } catch (err) {
    log.error('admin-bans', 'Error listing bans', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Ban a device ────────────────────────────────────────────────

router.post('/admin/bans/device', async (req, res) => {
  try {
    const { deviceId, reason, duration, linkedUniqueId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    const expiresAt = parseExpiry(duration);

    await db.doc(`deviceBans/${deviceId}`).set({
      deviceId,
      reason,
      duration: duration || 'permanent',
      expiresAt,
      linkedUniqueId: linkedUniqueId || null,
      createdAt: now(),
      createdBy: req.auth.uid,
    });

    // Full clear (not per-uid): the ban may target a device bound to a
    // user other than linkedUniqueId — the gate must see it on the
    // target's NEXT request (SHY-0149 mid-session AC).
    clearBanCache();

    // SHY-0150: mint the `banned` claim (+ revoke refresh tokens) for the
    // linked account and/or the device's bound owner, so the rules layer
    // denies their direct Firestore writes too. AFTER clearBanCache — the
    // recompute must read the standing this mutation just created.
    await syncClaimsForDeviceBan(deviceId, linkedUniqueId);

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'BAN_DEVICE',
      targetDeviceId: deviceId,
      details: `Reason: ${reason}, Duration: ${duration || 'permanent'}`,
      createdAt: now(),
      timestamp: now(),
    });

    // Send system PM if linked to a user (non-blocking). Track failure so
    // the admin UI's PartialFailureToast.buildPartialFailureMessage() can
    // surface it via the standard `pms: { failed, total }` shape.
    let pmFailed = 0;
    let pmTotal = 0;
    if (linkedUniqueId) {
      pmTotal = 1;
      try {
        await sendSystemPm(linkedUniqueId, 'A restriction has been placed on your account.');
      } catch (e) {
        log.warn('system-pm', 'Failed to send', { uniqueId: linkedUniqueId, error: e.message });
        pmFailed = 1;
      }
    }

    res.json({ success: true, pms: { failed: pmFailed, total: pmTotal } });
  } catch (err) {
    log.error('admin-bans', 'Error banning device', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Ban a network ───────────────────────────────────────────────

router.post('/admin/bans/network', async (req, res) => {
  try {
    const { type, value, reason, duration, linkedUniqueId } = req.body || {};

    const validTypes = ['ip', 'subnet', 'asn'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'type must be one of: ip, subnet, asn' });
    }
    if (!value || typeof value !== 'string')
      return res.status(400).json({ error: 'value is required' });
    if (!reason) return res.status(400).json({ error: 'reason is required' });

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
      linkedUniqueId: linkedUniqueId || null,
      createdAt: now(),
      createdBy: req.auth.uid,
    });

    // Invalidate the gate's cached active-networkBans list immediately.
    clearBanCache();

    // SHY-0150: a LINKED network ban has an enumerable target — mint its
    // claim now. An unlinked one has none (structural limit): the lazy
    // middleware sync mints from the live verdict when the banned network
    // next calls the API.
    if (linkedUniqueId) {
      await syncBannedClaim(String(linkedUniqueId));
    }

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'BAN_NETWORK',
      targetValue: value,
      details: `Type: ${type}, Reason: ${reason}, Duration: ${duration || 'permanent'}`,
      createdAt: now(),
      timestamp: now(),
    });

    // Send system PM if linked to a user (non-blocking). Track failure so
    // the admin UI's PartialFailureToast.buildPartialFailureMessage() can
    // surface it via the standard `pms: { failed, total }` shape.
    let pmFailed = 0;
    let pmTotal = 0;
    if (linkedUniqueId) {
      pmTotal = 1;
      try {
        await sendSystemPm(linkedUniqueId, 'A restriction has been placed on your account.');
      } catch (e) {
        log.warn('system-pm', 'Failed to send', { uniqueId: linkedUniqueId, error: e.message });
        pmFailed = 1;
      }
    }

    res.json({ success: true, pms: { failed: pmFailed, total: pmTotal } });
  } catch (err) {
    log.error('admin-bans', 'Error banning network', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban device ────────────────────────────────────────────────

router.delete('/admin/bans/device/:deviceId', async (req, res) => {
  try {
    // Capture the linked account BEFORE the delete — it is the recompute
    // target once the ban is gone (SHY-0150).
    const banSnap = await db.doc(`deviceBans/${req.params.deviceId}`).get();
    const linkedUniqueId = banSnap.exists ? banSnap.data().linkedUniqueId : null;

    await db.doc(`deviceBans/${req.params.deviceId}`).delete();
    // An unban must lift the gate as promptly as a ban engages it.
    clearBanCache();

    // SHY-0150: RECOMPUTE (never blind-clear) — another active ban keeps
    // the claim. AFTER clearBanCache so the recompute reads fresh standing.
    await syncClaimsForDeviceBan(req.params.deviceId, linkedUniqueId);

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_DEVICE',
      targetDeviceId: req.params.deviceId,
      createdAt: now(),
      timestamp: now(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning device', {
      deviceId: req.params.deviceId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban network ───────────────────────────────────────────────

router.delete('/admin/bans/network/:banId', async (req, res) => {
  try {
    // Capture the linked account BEFORE the delete (SHY-0150 recompute).
    const banSnap = await db.doc(`networkBans/${req.params.banId}`).get();
    const linkedUniqueId = banSnap.exists ? banSnap.data().linkedUniqueId : null;

    await db.doc(`networkBans/${req.params.banId}`).delete();
    // An unban must lift the gate as promptly as a ban engages it.
    clearBanCache();

    // SHY-0150: RECOMPUTE (never blind-clear) — another active ban keeps
    // the claim.
    if (linkedUniqueId) {
      await syncBannedClaim(String(linkedUniqueId));
    }

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_NETWORK',
      targetBanId: req.params.banId,
      createdAt: now(),
      timestamp: now(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning network', {
      banId: req.params.banId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unban all for user ──────────────────────────────────────────

router.post('/admin/bans/unban-all/:uniqueId', async (req, res) => {
  try {
    const uniqueId = req.params.uniqueId;
    const numericId = Number(uniqueId);
    const stringId = String(uniqueId);

    const [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum] = await Promise.all([
      db.collection('deviceBans').where('linkedUniqueId', '==', stringId).get(),
      db.collection('deviceBans').where('linkedUniqueId', '==', numericId).get(),
      db.collection('networkBans').where('linkedUniqueId', '==', stringId).get(),
      db.collection('networkBans').where('linkedUniqueId', '==', numericId).get(),
    ]);

    // Deduplicate by doc id in case both queries match the same doc
    const seen = new Set();
    const allDocs = [];
    for (const snap of [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum]) {
      for (const d of snap.docs) {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          allDocs.push(d);
        }
      }
    }

    await Promise.all(allDocs.map((d) => d.ref.delete()));
    // An unban must lift the gate as promptly as a ban engages it.
    clearBanCache();

    // SHY-0150: RECOMPUTE — an UNLINKED hardware ban on a still-bound
    // device survives unban-all (its queries only see linked docs), and
    // the recompute correctly keeps the claim in that case.
    await syncBannedClaim(String(uniqueId));

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBAN_ALL',
      targetUserId: uniqueId,
      details: `Removed ${allDocs.length} ban(s)`,
      createdAt: now(),
      timestamp: now(),
    });

    // Send system PM about restriction lifted. Track failure for admin UI.
    let pmFailed = 0;
    try {
      await sendSystemPm(uniqueId, 'A restriction on your account has been lifted.');
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uniqueId, error: e.message });
      pmFailed = 1;
    }

    res.json({
      success: true,
      removed: allDocs.length,
      pms: { failed: pmFailed, total: 1 },
    });
  } catch (err) {
    log.error('admin-bans', 'Error unbanning all for user', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get bans for user ───────────────────────────────────────────

router.get('/admin/bans/user/:uniqueId', async (req, res) => {
  try {
    const uniqueId = req.params.uniqueId;
    const numericId = Number(uniqueId);
    const stringId = String(uniqueId);

    const [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum] = await Promise.all([
      db.collection('deviceBans').where('linkedUniqueId', '==', stringId).get(),
      db.collection('deviceBans').where('linkedUniqueId', '==', numericId).get(),
      db.collection('networkBans').where('linkedUniqueId', '==', stringId).get(),
      db.collection('networkBans').where('linkedUniqueId', '==', numericId).get(),
    ]);

    // Deduplicate by doc id in case both queries match the same doc
    const seenDevice = new Set();
    const deviceBans = [];
    for (const snap of [deviceSnapStr, deviceSnapNum]) {
      for (const d of snap.docs) {
        if (!seenDevice.has(d.id)) {
          seenDevice.add(d.id);
          deviceBans.push({ ...d.data(), id: d.id });
        }
      }
    }

    const seenNetwork = new Set();
    const networkBans = [];
    for (const snap of [networkSnapStr, networkSnapNum]) {
      for (const d of snap.docs) {
        if (!seenNetwork.has(d.id)) {
          seenNetwork.add(d.id);
          networkBans.push({ ...d.data(), id: d.id });
        }
      }
    }

    res.json({ deviceBans, networkBans });
  } catch (err) {
    log.error('admin-bans', 'Error getting bans for user', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
