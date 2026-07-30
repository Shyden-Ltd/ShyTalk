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

/**
 * A uniqueId is a non-negative integer, given either as a number or as its
 * plain decimal string. Deliberately stricter than `Number()`, which happily
 * turns '   ', '' and null into 0, and accepts '1e3', -1 and 1.5.
 */
function isNonNegativeIntegerId(value) {
  // Beyond MAX_SAFE_INTEGER, `Number()` silently rounds — two different 20-digit
  // ids can collide on one float and reassign a binding's owner (R8-I2).
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  }
  if (typeof value === 'string') {
    return /^\d+$/.test(value) && Number(value) <= Number.MAX_SAFE_INTEGER;
  }
  return false;
}
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const {
  clearBanCache,
  countBoundDevices,
  rollbackBindingIfOverCap,
  MAX_BOUND_DEVICES,
  BINDING_TRANSACTION_OPTIONS,
} = require('../utils/bans');
const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ─── List all device bindings (paginated + searchable) ──────────

router.get('/admin/devices', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const searchQuery = (req.query.q || '').toLowerCase().trim();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const snap = await db.collection('deviceBindings').get();
    let devices = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

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
    if (await requireAdmin(req, res)) return;

    const { deviceId, uniqueId, manufacturer, model, lastIp, isp } = req.body;

    // `uniqueId` is written as `Number(uniqueId)`, so every value that coerces
    // must be rejected up front. `Number()` is far too permissive here: null,
    // false, '' AND any whitespace-only string all become account 0, while
    // '1e3', -1 and 1.5 produce ids no account can ever have (reviewers R5-I4,
    // R6-I1, R7-I1/I2). A uniqueId is a non-negative integer — nothing else.
    if (!deviceId || !isNonNegativeIntegerId(uniqueId)) {
      return res.status(400).json({ error: 'deviceId and uniqueId are required' });
    }

    // The same per-account cap the client routes enforce (SHY-0149 C1). An
    // uncapped admin write could push an account past the ban gate's scan
    // limit, and support tooling should not be able to do that by accident —
    // delete a stale binding first.
    //
    // The cap applies whenever this write would COST the target a new binding
    // slot: a brand-new device, or an existing one being reassigned away from
    // its current owner. Re-seeding a device's own metadata (same owner) is
    // free (reviewer R3-I2).
    const bindingData = {
      deviceId,
      uniqueId: Number(uniqueId),
      manufacturer: manufacturer || 'Unknown',
      model: model || 'Unknown',
      lastIp: lastIp || null,
      isp: isp || null,
      boundAt: now(),
    };

    // Doc-only transaction, cap pre-checked outside and reconciled after — a
    // query read inside would break the device-lock's conflict detection (see
    // BINDING_TRANSACTION_OPTIONS).
    const docRef = db.doc(`deviceBindings/${deviceId}`);
    const capReached = (await countBoundDevices(uniqueId)) >= MAX_BOUND_DEVICES;
    const outcome = await db.runTransaction(async (tx) => {
      const existing = await tx.get(docRef);
      const currentOwner = existing.exists
        ? (existing.data()?.uniqueId ?? existing.data()?.userId ?? null)
        : null;
      const costsASlot = currentOwner === null || String(currentOwner) !== String(uniqueId);

      if (costsASlot && capReached) {
        return { blocked: true };
      }

      // merge:true — a real binding carries ~20 telemetry fields written by
      // /api/device-info; a full replace would silently wipe them (R4-I3).
      tx.set(docRef, bindingData, { merge: true });
      return { blocked: false, currentOwner, bound: costsASlot };
    }, BINDING_TRANSACTION_OPTIONS);

    if (
      outcome.blocked ||
      (outcome.bound && (await rollbackBindingIfOverCap(uniqueId, deviceId)))
    ) {
      return res.status(403).json({
        error: 'Device limit reached for this account',
        code: 'device_limit',
      });
    }

    // A binding change alters which hardware bans reach an account — clear the
    // new owner, and the previous one too when the device changed hands (they
    // just lost a device that may have been carrying their ban).
    clearBanCache(uniqueId);
    if (outcome.currentOwner !== null && String(outcome.currentOwner) !== String(uniqueId)) {
      clearBanCache(outcome.currentOwner);
    }

    res.json({ id: deviceId, ...bindingData });
  } catch (err) {
    log.error('admin-devices', 'Error creating device binding', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get all devices for a user ─────────────────────────────────

router.get('/admin/devices/user/:uniqueId', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const uniqueId = Number(req.params.uniqueId);
    const snap = await db.collection('deviceBindings').where('uniqueId', '==', uniqueId).get();

    const devices = snap.docs.map((d) => ({ ...d.data(), id: d.id }));

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
    if (await requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }

    res.json({ ...snap.data(), id: snap.id });
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
    if (await requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;

    // Check if binding exists
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }
    const deviceData = snap.data();

    await db.doc(`deviceBindings/${deviceId}`).delete();
    // Removing a binding can lift a hardware ban that reached the owner
    // through it — clear their cached standing (SHY-0149). An owner-less
    // binding falls back to the full clear (clearBanCache() with no argument),
    // which is the conservative choice.
    const owner = deviceData.uniqueId ?? deviceData.userId;
    if (owner === null || owner === undefined) clearBanCache();
    else clearBanCache(owner);

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBIND_DEVICE',
      targetDeviceId: deviceId,
      details: `Unbound device ${deviceId}`,
      createdAt: now(),
      timestamp: now(),
    });

    // Send system PM to the bound user. Track failure for admin UI's
    // PartialFailureToast — `pms: { failed, total }` is the standard shape.
    let pmFailed = 0;
    let pmTotal = 0;
    if (deviceData.uniqueId) {
      pmTotal = 1;
      try {
        await sendSystemPm(
          deviceData.uniqueId,
          'Your device binding has been reset by a moderator.',
        );
      } catch (e) {
        log.warn('system-pm', 'Failed to send', { error: e.message });
        pmFailed = 1;
      }
    }

    res.json({ success: true, pms: { failed: pmFailed, total: pmTotal } });
  } catch (err) {
    log.error('admin-devices', 'Error unbinding device', {
      deviceId: req.params.deviceId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
