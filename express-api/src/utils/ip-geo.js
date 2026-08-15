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

/**
 * @param {string} ip client IPv4
 * @returns {Promise<{isp?: string|null, asn?: string|null, country?: string|null, region?: string|null}>}
 *   the resolved fields, or `{}` when the lookup is impossible or fails.
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

module.exports = { getIpGeo };
