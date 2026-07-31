const express = require('express');
const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const { isValidDeviceId } = require('../utils/deviceId');
const { recordSignIn } = require('../utils/identity-graph-writer');
const {
  countBoundDevices,
  clearBanCache,
  rollbackBindingIfOverCap,
  MAX_BOUND_DEVICES,
  BINDING_TRANSACTION_OPTIONS,
} = require('../utils/bans');
const log = require('../utils/log');

const router = express.Router();

/** Normalise a uniqueId (which may be stored as String or Number) to a string, or null. */
function normUniqueId(value) {
  return value === undefined || value === null ? null : String(value);
}

/** Is this binding already owned by `caller`? (An owned device costs no slot.) */
async function isBoundTo(ref, caller) {
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  return normUniqueId(data.uniqueId ?? data.userId) === caller;
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

    // Cap binding creation. Unbounded bindings let an attacker bury a
    // hardware-banned device beneath decoys until the ban gate's scan no longer
    // reached it — and this route is ban-exempt (SHY-0149 C1).
    //
    // The check sits OUTSIDE the transaction on purpose: a count needs a query
    // read, and a query read inside this transaction breaks the document-level
    // conflict detection the device-lock depends on (see
    // BINDING_TRANSACTION_OPTIONS). A concurrent race can therefore slip past
    // this pre-check — `rollbackBindingIfOverCap` below closes that window.
    // Re-using an ALREADY-owned device never reaches the bind branch, so a
    // capped account keeps working on the devices it has.
    if (caller !== null && (await countBoundDevices(caller)) >= MAX_BOUND_DEVICES) {
      const boundToCaller = await isBoundTo(ref, caller);
      if (!boundToCaller) {
        log.warn('devices', 'device-binding cap reached', { caller, deviceId });
        return res.status(403).json({
          error: 'Device limit reached for this account',
          code: 'device_limit',
        });
      }
    }

    // Atomic read → decide → conditional-bind: two concurrent sign-ins on a fresh
    // device cannot both claim it (exactly one wins the transaction). DOC READS
    // ONLY — see BINDING_TRANSACTION_OPTIONS.
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
        return { status: 'allowed', boundToOther: false, bound: true };
      }
      return { status: 'allowed', boundToOther: false, bound: false };
    }, BINDING_TRANSACTION_OPTIONS);

    if (result.bound) {
      // Close the race the pre-check cannot: if concurrent binds pushed this
      // account past the cap, release the claim this request just took.
      if (await rollbackBindingIfOverCap(caller, deviceId)) {
        return res.status(403).json({
          error: 'Device limit reached for this account',
          code: 'device_limit',
        });
      }
      // A newly-claimed device can carry a hardware ban, which changes the
      // caller's standing. Drop their cached verdict so the ban bites on their
      // very next request rather than after the cache TTL (SHY-0149).
      clearBanCache(caller);
    }

    // SHY-0257: record the identifiers this sign-in presented, so the identity
    // graph is built from real traffic rather than only by hand. Deliberately
    // NOT awaited and never able to reject — anti-abuse bookkeeping must not be
    // able to fail or delay a sign-in. `req.ip` is the established convention
    // here (Express resolves it via `trust proxy`).
    recordSignIn({
      uniqueId: caller,
      ip: req.ip,
      deviceId,
    }).catch((err) => log.error('devices', 'identity-graph record failed', { error: err.message }));

    log.info('devices', 'device lock-check', {
      deviceId,
      caller,
      status: result.status,
      boundToOther: result.boundToOther,
    });
    // `bound` is an internal signal for cache invalidation, not part of the
    // client contract — the app only ever reads status/boundToOther.
    return res.json({ status: result.status, boundToOther: result.boundToOther });
  } catch (err) {
    log.error('devices', 'lock-check failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
