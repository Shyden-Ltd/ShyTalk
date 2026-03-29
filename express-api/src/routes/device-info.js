/**
 * Device info endpoint — accepts device info from mobile clients,
 * enriches with IP geolocation, stores in Firestore, checks bans.
 *
 * POST /api/device-info  → Submit device info
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const log = require('../utils/log');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Check whether an IPv4 address falls within a CIDR range.
 */
function isIpInSubnet(ip, cidr) {
  try {
    const [subnet, bits] = cidr.split('/');
    const prefixLen = Number.parseInt(bits, 10);
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    const ipNum =
      ip.split('.').reduce((acc, oct) => ((acc << 8) >>> 0) + Number.parseInt(oct, 10), 0) >>> 0;
    const subNum =
      subnet.split('.').reduce((acc, oct) => ((acc << 8) >>> 0) + Number.parseInt(oct, 10), 0) >>>
      0;
    return (ipNum & mask) === (subNum & mask);
  } catch {
    return false;
  }
}

/**
 * Fetch IP geolocation data from ip-api.com.
 * Returns { isp, asn, country, region } or empty object on failure.
 */
async function getIpGeo(ip) {
  try {
    // Validate IPv4 format to prevent URL injection
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return {};
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=isp,as,country,regionName`);
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

    const { deviceId } = body;

    // Extract client IP
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;

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
      deviceDoc.firstSeen = timestamp;
      deviceDoc.boundAt = timestamp;
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

/** Check if a ban is currently active (not expired). */
function isBanActive(ban) {
  return !ban.expiresAt || new Date(ban.expiresAt).getTime() > Date.now();
}

/** Build a ban result object. */
function buildBanResult(banType, ban) {
  return { isBanned: true, banType, reason: ban.reason || null, expiresAt: ban.expiresAt || null };
}

/** Check if a network ban matches the given IP/ASN. */
function networkBanMatches(ban, ip, asn) {
  if (ban.type === 'ip') return ban.value === ip;
  if (ban.type === 'subnet') return isIpInSubnet(ip, ban.value);
  if (ban.type === 'asn') return ban.value === asn;
  return false;
}

/**
 * Check device bans and network bans.
 * Returns { isBanned, banType, reason, expiresAt }.
 */
async function checkBans(deviceId, ip, asn) {
  const noBan = { isBanned: false, banType: null, reason: null, expiresAt: null };

  try {
    const deviceBanSnap = await db.doc(`deviceBans/${deviceId}`).get();
    if (deviceBanSnap.exists && isBanActive(deviceBanSnap.data())) {
      return buildBanResult('device', deviceBanSnap.data());
    }

    const networkBansSnap = await db.collection('networkBans').limit(500).get();
    for (const doc of networkBansSnap.docs) {
      const ban = doc.data();
      if (!isBanActive(ban)) continue;
      if (networkBanMatches(ban, ip, asn)) {
        return buildBanResult(`network_${ban.type}`, ban);
      }
    }

    return noBan;
  } catch (err) {
    log.error('device-info', 'Error checking bans', { deviceId, error: err.message });
    return noBan;
  }
}

module.exports = router;
