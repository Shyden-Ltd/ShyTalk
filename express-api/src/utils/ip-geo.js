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

// EVERY outcome is cached, including failures — just for much less time.
//
// An earlier version cached only results carrying an ASN, on the reasoning
// that a cached null asn switches ASN-scoped bans off for the TTL. True, but
// it made the problem far worse: with no negative caching, every failure and
// every ASN-less success re-queried, so a single anonymous caller could issue
// one outbound ip-api call per request — up to `generalLimiter`'s 200/min,
// against a free tier of ~45/min shared by the WHOLE app through one egress
// IP. Once starved, the failures were themselves uncached, so the budget never
// recovered under load and `networkBanMatches` refused every ASN ban for
// everyone. A 5-minute per-IP degradation became a global, indefinite,
// remotely-triggerable one.
//
// 30 seconds is short enough that routing data appearing (or a quota
// recovering) is picked up promptly, and long enough that the outbound rate is
// bounded by distinct IPs rather than by request volume.
const GEO_NEGATIVE_TTL_MS = 30 * 1000;
const GEO_MAX_ENTRIES = 5000;
const geoCache = new Map();

// When ip-api rate-limits us, STOP calling it.
//
// Without this the negative TTL inverts the outbound rate at the worst moment:
// 0.2 calls/min per IP while healthy (5-min positive TTL) but 2/min while
// failing (30s negative TTL) — a 10x increase in demand triggered by the
// supply running out. Against a ~45/min budget shared through one egress IP,
// the starved state then sustains itself above roughly 22 concurrently-active
// IPs and no amount of waiting clears it.
//
// ip-api answers a rate limit with HTTP 429 and an `X-Ttl` header saying how
// many seconds until the window resets. Honour it.
let pausedUntil = 0;

// Requests in flight, keyed on IP. Without this, N concurrent cold starts from
// one IP are N outbound lookups even with the cache — the classic stampede.
// `auth.js` documents the same pattern for uniqueId resolution.
const inFlight = new Map();

const ttlFor = (value) => (value && value.asn ? GEO_TTL_MS : GEO_NEGATIVE_TTL_MS);

function cacheGet(ip) {
  const hit = geoCache.get(ip);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlFor(hit.value)) {
    geoCache.delete(ip);
    return undefined;
  }
  // A COPY. Returning the cached object itself hands every caller the same
  // mutable reference for the whole TTL — latent today (both callers only
  // read) and a five-minute cache poisoning the first time one does not.
  return { ...hit.value };
}

function cacheSet(ip, value) {
  // Evict oldest-inserted first; Map preserves insertion order.
  if (geoCache.size >= GEO_MAX_ENTRIES) {
    // `size >= GEO_MAX_ENTRIES` guarantees a key, so no undefined guard.
    geoCache.delete(geoCache.keys().next().value);
  }
  geoCache.set(ip, { at: Date.now(), value });
}

/** Test seam — the suite must not inherit another file's cached lookups. */
function clearIpGeoCache() {
  geoCache.clear();
  inFlight.clear();
  pausedUntil = 0;
}

/**
 * @param {string} ip client IPv4
 * @returns {Promise<{isp?: string|null, asn?: string|null, country?: string|null, region?: string|null}>}
 *   the resolved fields, or `{}` when the lookup is impossible or fails.
 */
async function getIpGeo(ip) {
  // Validate IPv4 format to prevent URL injection
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return {};

  const cached = cacheGet(ip);
  if (cached !== undefined) return cached;

  // Rate-limited upstream: answer from nothing rather than adding to the
  // pile. Fail-open is already this function's contract.
  if (Date.now() < pausedUntil) return {};

  // Coalesce concurrent lookups for the same IP into one outbound call.
  const pending = inFlight.get(ip);
  if (pending) return pending;

  const promise = fetchGeo(ip)
    .then((geo) => {
      // EVERY outcome is cached — see GEO_NEGATIVE_TTL_MS. Caching only
      // successes left failures re-querying without limit.
      cacheSet(ip, geo);
      return geo;
    })
    .finally(() => inFlight.delete(ip));

  inFlight.set(ip, promise);
  return promise;
}

/** The bare lookup. Always resolves; never caches. */
async function fetchGeo(ip) {
  try {
    // Bounded: geo is best-effort telemetry — a hung ip-api must not hang
    // the device-info request (and with it, sign-in). SHY-0149.
    // `status` and `message` are in the mask DELIBERATELY. ip-api only returns
    // the fields you ask for, so without them the failure guard below could
    // never fire — measured: `?fields=isp,as,country,regionName`answers with no
    // `status` key at all, and the guard was inert.
    const resp = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,isp,as,country,regionName`,
      {
        signal: AbortSignal.timeout(3000),
      },
    );
    if (resp.status === 429) {
      // `X-Ttl` is seconds until the window resets; default to a minute if
      // the header is missing or unparseable.
      const ttl = Number(resp.headers?.get?.('X-Ttl'));
      pausedUntil = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 60) * 1000;
      return {};
    }
    if (!resp.ok) return {};
    const data = await resp.json();
    // ip-api reports a failed lookup — reserved range, invalid query — as
    // HTTP 200 with `status: "fail"`. (Rate limiting is a 429, already caught
    // by `resp.ok` above.) Without this the failure took the success path.
    if (data.status !== 'success') return {};

    const geo = {
      isp: data.isp || null,
      asn: data.as ? data.as.split(' ')[0] : null,
      country: data.country || null,
      region: data.regionName || null,
    };
    return geo;
  } catch {
    return {};
  }
}

module.exports = { getIpGeo, clearIpGeoCache };
