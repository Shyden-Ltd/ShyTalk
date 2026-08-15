/**
 * Best-effort IP geolocation.
 *
 * Extracted from `routes/device-info.js` (SHY-0143) so the unauthenticated
 * `/api/ban-status` route resolves an ASN the SAME way the authenticated
 * device-info path does. Two copies would drift, and the thing that drifts
 * here is which ASN a network ban is matched against — i.e. whether a ban
 * applies at all.
 *
 * Always resolves. Geo is telemetry, and a hung or unhappy third party must
 * never hang the request that needs it — for `/api/ban-status` that request
 * is on the cold-start critical path.
 */

// Cache keyed on the client IP. SHY-0143 put this on the cold-start path (and,
// on Android, the rotation path), so without a cache the call rate scales with
// launches. ip-api's free tier caps at ~45 req/min per CALLING ip — and the API
// server has ONE egress IP, so that cap is shared by every user. Past it,
// lookups fail, `asn` is null, and `networkBanMatches` refuses every
// ASN-scoped ban by design: the bans would silently stop matching for
// everyone, which is a security degradation that scales with success.
//
// A plain Map with a TTL, matching the shape `bans.js` already uses. Bounded so
// a deliberate walk through many IPs cannot grow it without limit.
const GEO_TTL_MS = 5 * 60 * 1000;
const GEO_MAX_ENTRIES = 5000;
const geoCache = new Map();

function cacheGet(ip) {
  const hit = geoCache.get(ip);
  if (!hit) return undefined;
  if (Date.now() - hit.at > GEO_TTL_MS) {
    geoCache.delete(ip);
    return undefined;
  }
  return hit.value;
}

function cacheSet(ip, value) {
  // Evict oldest-inserted first; Map preserves insertion order.
  if (geoCache.size >= GEO_MAX_ENTRIES) {
    const oldest = geoCache.keys().next().value;
    if (oldest !== undefined) geoCache.delete(oldest);
  }
  geoCache.set(ip, { at: Date.now(), value });
}

/** Test seam — the suite must not inherit another file's cached lookups. */
function clearIpGeoCache() {
  geoCache.clear();
}

/**
 * @param {string} ip client IPv4
 * @returns {Promise<{isp?: string|null, asn?: string|null, country?: string|null, region?: string|null}>}
 *   the resolved fields, or `{}` when the lookup is impossible or fails.
 */
async function getIpGeo(ip) {
  try {
    // Validate IPv4 format to prevent URL injection
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return {};

    const cached = cacheGet(ip);
    if (cached !== undefined) return cached;
    // Bounded: geo is best-effort telemetry — a hung ip-api must not hang
    // the device-info request (and with it, sign-in). SHY-0149.
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=isp,as,country,regionName`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    // ip-api reports a failed lookup as HTTP **200** with `status: "fail"` —
    // reserved ranges, invalid queries, and (critically) the over-quota
    // response. Without this check that took the success path, so a null ASN
    // got CACHED and ASN-scoped bans stayed off for the full TTL: exactly the
    // degradation the cache exists to prevent, caused by the cache.
    if (data.status && data.status !== 'success') return {};

    const geo = {
      isp: data.isp || null,
      asn: data.as ? data.as.split(' ')[0] : null,
      country: data.country || null,
      region: data.regionName || null,
    };
    // Only SUCCESSES are cached. Caching a failure would pin `asn` to null for
    // the TTL and keep ASN bans off for that IP even after the quota recovers.
    cacheSet(ip, geo);
    return geo;
  } catch {
    return {};
  }
}

module.exports = { getIpGeo, clearIpGeoCache };
