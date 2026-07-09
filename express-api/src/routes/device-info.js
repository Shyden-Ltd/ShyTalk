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
const { checkBans, clearBanCache, countBoundDevices, MAX_BOUND_DEVICES } = require('../utils/bans');
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

    // Atomic read → decide → write. The binding cap must be enforced against
    // a snapshot that a concurrent sign-in cannot invalidate: three separate
    // calls (get → count → set) let N parallel requests each observe a
    // pre-cap count and all commit, defeating the cap (reviewer C-NEW-2).
    // The transaction body is retried on contention, so it rebuilds its doc
    // from `baseDoc` each attempt rather than mutating shared state.
    let capped = false;
    let bound = false;
    await db.runTransaction(async (tx) => {
      const deviceDoc = { ...baseDoc };
      capped = false;
      bound = false;

      const existing = await tx.get(docRef);
      if (!existing.exists) {
        // This route mints bindings too, and is likewise exempt from the ban
        // gate — without a cap it reopens the decoy-flood hardware-ban
        // evasion that lock-check blocks (SHY-0149 C1). At the cap we record
        // the telemetry but do NOT bind: an unowned doc carries no uniqueId,
        // so it can never be used as a decoy, and the response below still
        // carries `banStatus` — refusing outright would blank the very ban
        // screen this endpoint exists to feed.
        if ((await countBoundDevices(req.auth.uniqueId, tx)) >= MAX_BOUND_DEVICES) {
          capped = true;
          delete deviceDoc.uniqueId;
          deviceDoc.firstSeen = timestamp;
        } else {
          deviceDoc.firstSeen = timestamp;
          deviceDoc.boundAt = timestamp;
          bound = true;
        }
      } else {
        // SHY-0170: device-info updates telemetry on every launch, but must NEVER
        // silently re-bind a device already owned by another account to the caller
        // — that would defeat the device-lock (see /api/devices/lock-check). The
        // uniqueId binding is owned by lock-check; here we only re-affirm it when it
        // is unset or already the caller's, never overwrite a foreign owner.
        const data = existing.data() || {};
        const owner = data.uniqueId ?? data.userId ?? null;
        if (owner !== null && String(owner) !== String(req.auth.uniqueId)) {
          delete deviceDoc.uniqueId;
        }
      }

      tx.set(docRef, deviceDoc, { merge: true });
    });

    if (capped) {
      log.warn('device-info', 'device-binding cap reached — telemetry stored unbound', {
        uniqueId: req.auth.uniqueId,
        deviceId,
      });
    }

    // A newly-bound device can carry a hardware ban, changing the caller's
    // standing — drop their cached verdict so the gate sees it immediately.
    if (bound) clearBanCache(req.auth.uniqueId);

    // Check bans
    const banStatus = await checkBans(deviceId, ip, geo.asn || null);

    res.json({ success: true, banStatus });
  } catch (err) {
    log.error('device-info', 'Error processing device info submission', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
