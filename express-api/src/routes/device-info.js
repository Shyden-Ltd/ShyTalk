/**
 * Device info endpoint — accepts device info from mobile clients,
 * enriches with IP geolocation, stores in Firestore, checks bans.
 *
 * POST /api/device-info  → Submit device info
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const { isValidDeviceId } = require('../utils/deviceId');
const {
  checkBans,
  clearBanCache,
  countBoundDevices,
  rollbackBindingIfOverCap,
  MAX_BOUND_DEVICES,
  BINDING_TRANSACTION_OPTIONS,
} = require('../utils/bans');
const log = require('../utils/log');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Fetch IP geolocation data from ip-api.com.
 * Returns { isp, asn, country, region } or empty object on failure.
 */
async function getIpGeo(ip) {
  try {
    // Validate IPv4 format to prevent URL injection
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return {};
    // Bounded: geo is best-effort telemetry — a hung ip-api must not hang
    // the device-info request (and with it, sign-in). SHY-0149.
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=isp,as,country,regionName`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    return {
      isp: data.isp || null,
      asn: data.as ? data.as.split(' ')[0] : null,
      country: data.country || null,
      region: data.regionName || null,
    };
  } catch {
    return {};
  }
}

// ─── Route ───────────────────────────────────────────────────────

router.post('/device-info', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (!isValidDeviceId(body.deviceId)) {
      // Reject `/` (path redirection), whitespace, over-length, non-string —
      // deviceId is used directly as a Firestore doc id (SHY-0170).
      return res.status(400).json({ error: 'deviceId is invalid' });
    }

    const { deviceId } = body;

    // The REAL edge IP. `req.ip` respects `trust proxy: 1` (index.js), so
    // the value is the rightmost X-Forwarded-For entry — the one appended
    // by OUR edge, not a client-forgeable leftmost decoy. Never parse the
    // XFF header directly here: the old leftmost-split let a forged
    // `X-Forwarded-For: <clean-ip>, <real-ip>` evade network bans (SHY-0149).
    const ip = req.ip;

    // Enrich with IP geolocation
    const geo = await getIpGeo(ip);

    // Build device doc
    const timestamp = now();
    const baseDoc = {
      deviceId,
      uniqueId: req.auth.uniqueId,
      manufacturer: body.manufacturer || null,
      model: body.model || null,
      osVersion: body.osVersion || null,
      screenResolution: body.screenResolution || null,
      screenDensity: body.screenDensity || null,
      totalRamMb: body.totalRamMb || null,
      appVersion: body.appVersion || null,
      buildNumber: body.buildNumber || null,
      locale: body.locale || null,
      networkType: body.networkType || null,
      carrierName: body.carrierName || null,
      firebaseInstallationId: body.firebaseInstallationId || null,
      lastIp: ip,
      isp: geo.isp || null,
      asn: geo.asn || null,
      country: geo.country || null,
      region: geo.region || null,
      lastSeenAt: timestamp,
    };

    const docRef = db.doc(`deviceBindings/${deviceId}`);

    // The cap check runs OUTSIDE the transaction: a count needs a query read,
    // and a query read inside a bind transaction breaks the document-level
    // conflict detection the device-lock depends on (see
    // BINDING_TRANSACTION_OPTIONS). A race can slip past this pre-check —
    // `rollbackBindingIfOverCap` below closes that window.
    //
    // At the cap this route does NOT refuse: it records the telemetry but never
    // claims the device. An unowned doc carries no uniqueId, so it can never be
    // a decoy, and the response still carries `banStatus` — refusing outright
    // would blank the very ban screen this endpoint exists to feed.
    const caller = req.auth.uniqueId;
    const callerRegistered = caller !== null && caller !== undefined;
    const atCap = callerRegistered && (await countBoundDevices(caller)) >= MAX_BOUND_DEVICES;

    let capped = false;
    let bound = false;
    await db.runTransaction(async (tx) => {
      const deviceDoc = { ...baseDoc };
      capped = false;
      bound = false;

      const existing = await tx.get(docRef);
      const data = existing.exists ? existing.data() || {} : null;
      const owner = data ? (data.uniqueId ?? data.userId ?? null) : null;

      if (!existing.exists) deviceDoc.firstSeen = timestamp;

      if (owner !== null) {
        // SHY-0170: device-info updates telemetry on every launch, but must NEVER
        // silently re-bind a device already owned by another account to the caller
        // — that would defeat the device-lock (see /api/devices/lock-check). An
        // already-owned device needs no cap check: claiming it costs no new slot.
        if (String(owner) !== String(caller)) delete deviceDoc.uniqueId;
      } else if (!callerRegistered) {
        // A not-yet-registered caller (valid token, no users doc yet) must never
        // claim a device — the rule /devices/lock-check already enforces.
        // Otherwise the doc stored a literal `uniqueId: null` alongside a
        // boundAt, implying an ownership that can never resolve.
        delete deviceDoc.uniqueId;
      } else if (atCap) {
        // UNOWNED and the caller is full: record telemetry, claim nothing.
        // Keyed on ownership, not existence — an unowned doc this route wrote
        // earlier must not be bindable for free on a second call (R3-C1).
        capped = true;
        delete deviceDoc.uniqueId;
      } else {
        deviceDoc.boundAt = timestamp;
        bound = true;
      }

      tx.set(docRef, deviceDoc, { merge: true });
    }, BINDING_TRANSACTION_OPTIONS);

    if (bound && (await rollbackBindingIfOverCap(caller, deviceId))) {
      // A concurrent bind pushed the account past the cap; the claim was
      // released. Telemetry stays; the device is simply unclaimed.
      bound = false;
      capped = true;
    }

    if (capped) {
      log.warn('device-info', 'device-binding cap reached — telemetry stored unbound', {
        uniqueId: caller,
        deviceId,
      });
    }

    // A newly-bound device can carry a hardware ban, changing the caller's
    // standing — drop their cached verdict so the gate sees it immediately.
    if (bound) clearBanCache(caller);

    // Check bans
    const banStatus = await checkBans(deviceId, ip, geo.asn || null);

    res.json({ success: true, banStatus });
  } catch (err) {
    log.error('device-info', 'Error processing device info submission', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
