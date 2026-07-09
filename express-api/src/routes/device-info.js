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
const { checkBans, countBoundDevices, MAX_BOUND_DEVICES } = require('../utils/bans');
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
    const deviceDoc = {
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

    // Check if doc already exists to set firstSeen/boundAt
    const docRef = db.doc(`deviceBindings/${deviceId}`);
    const existing = await docRef.get();
    if (!existing.exists) {
      // Cap binding creation here too — this route also mints bindings and is
      // likewise exempt from the ban gate, so without the cap it reopens the
      // decoy-flood hardware-ban evasion that lock-check now blocks
      // (SHY-0149 C1). Telemetry updates to devices the caller already owns
      // take the `else` branch and are never capped.
      if ((await countBoundDevices(req.auth.uniqueId)) >= MAX_BOUND_DEVICES) {
        log.warn('device-info', 'device-binding cap reached', {
          uniqueId: req.auth.uniqueId,
          deviceId,
        });
        return res.status(403).json({
          error: 'Device limit reached for this account',
          code: 'device_limit',
        });
      }
      deviceDoc.firstSeen = timestamp;
      deviceDoc.boundAt = timestamp;
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

    // Write to Firestore
    await docRef.set(deviceDoc, { merge: true });

    // Check bans
    const banStatus = await checkBans(deviceId, ip, geo.asn || null);

    res.json({ success: true, banStatus });
  } catch (err) {
    log.error('device-info', 'Error processing device info submission', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
