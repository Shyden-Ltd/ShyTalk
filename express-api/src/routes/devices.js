const express = require('express');
const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const { isValidDeviceId } = require('../utils/deviceId');
const log = require('../utils/log');

const router = express.Router();

/** Normalise a uniqueId (which may be stored as String or Number) to a string, or null. */
function normUniqueId(value) {
  return value === undefined || value === null ? null : String(value);
}

/**
 * POST /api/devices/lock-check — server-authoritative device-lock decision.
 *
 * SHY-0170 (EPIC-0006): replaces the old CLIENT-SIDE getDeviceBinding + bindDevice.
 * The "one device ↔ one account" anti-abuse / ban-evasion decision must be made by
 * the API (the authorization layer), not by a client that can be tampered with.
 *
 * Identity is taken from `req.auth.uniqueId` (the verified ID token), NEVER the body —
 * an attacker must not be able to assert another account's identity. A caller with a
 * valid token but no users doc (a brand-new, not-yet-registered person) has
 * `uniqueId === null`; for them ANY existing binding is "someone else's".
 *
 * Response: `{ status: 'allowed' | 'locked', boundToOther: boolean }`.
 *   - bound to a DIFFERENT uniqueId → locked (the caller signs out / blocks new-account).
 *   - unbound + an existing user     → allowed, and the device is atomically bound to them.
 *   - unbound + a new user           → allowed, left UNBOUND (they claim it once registered).
 *   - already bound to the caller    → allowed, no re-stamp.
 */
router.post('/devices/lock-check', async (req, res) => {
  try {
    const deviceId = req.body?.deviceId;
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (!isValidDeviceId(deviceId)) {
      // Reject `/` (path redirection), whitespace, over-length — never let an
      // unvalidated client value shape the Firestore doc path.
      return res.status(400).json({ error: 'deviceId is invalid' });
    }

    const caller = normUniqueId(req.auth?.uniqueId);
    const ref = db.doc(`deviceBindings/${deviceId}`);

    // Atomic read → decide → conditional-bind: two concurrent sign-ins on a fresh
    // device cannot both claim it (exactly one wins the transaction).
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      // Back-compat: the old client wrote `{ userId }`; the server writes `{ uniqueId }`.
      const boundUniqueId = normUniqueId(data ? (data.uniqueId ?? data.userId) : null);

      if (boundUniqueId !== null && boundUniqueId !== caller) {
        return { status: 'locked', boundToOther: true };
      }
      // Unbound + an existing user (has a uniqueId) → claim it now. A not-yet-
      // registered caller (uniqueId null) must never bind a device.
      if (boundUniqueId === null && caller !== null) {
        tx.set(ref, { uniqueId: caller, boundAt: now() }, { merge: true });
      }
      return { status: 'allowed', boundToOther: false };
    });

    log.info('devices', 'device lock-check', {
      deviceId,
      caller,
      status: result.status,
      boundToOther: result.boundToOther,
    });
    return res.json(result);
  } catch (err) {
    log.error('devices', 'lock-check failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
