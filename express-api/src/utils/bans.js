/**
 * Ban checking — shared between the sign-in report (/api/device-info) and
 * the per-request ban gate in authMiddleware (SHY-0149, EPIC-0005).
 *
 * Two entry points with deliberately DIFFERENT error postures:
 *
 *  - `checkBans(deviceId, ip, asn)` — the sign-in ban REPORT. Fail-open
 *    (returns noBan on lookup error): it feeds the app's ban screen, and a
 *    transient error here must not turn a telemetry submission into a
 *    sign-in outage. The per-request gate below still enforces on every
 *    subsequent request, so nothing security-relevant rides on this path.
 *  - `checkUserBans(uniqueId, ip)` — the per-request GATE. Fail-closed BY
 *    PROPAGATION: no catch, so a lookup failure rejects up into
 *    authMiddleware's outer catch → 401. A safety control that fails open
 *    is not a control; this matches the suspension check's structural
 *    posture (whose rejection also lands in that catch).
 *
 * How a caller is matched to a device ban (both directions):
 *  - ban follows the ACCOUNT: `deviceBans.linkedUniqueId` == caller
 *    (String + legacy Number forms via Filter.or — same dual-form lesson
 *    as SHY-0165's participantIds).
 *  - ban follows the HARDWARE: any `deviceBindings` doc owned by the
 *    caller (`uniqueId`, legacy `userId`; String + Number forms) whose
 *    deviceId has an active `deviceBans` doc. This is what blocks a
 *    device-banned account on the WEB, where no deviceId exists.
 *
 * Network bans match the REAL edge IP the caller hands us (`req.ip` under
 * `trust proxy: 1` — never a client-forgeable X-Forwarded-For value) plus
 * the caller's STORED binding ASNs — no per-request geo lookup.
 *
 * Caching mirrors middleware/auth.js (Spark-tier read quota): 5-min TTL,
 * bounded size with eviction, in-flight Promise dedup, plus ONE global
 * cache of the active networkBans list shared across all requests.
 * `clearBanCache()` is invoked by the admin ban routes on every ban
 * mutation so a mid-session ban bites on the target's very next request.
 */

const { db, FieldValue } = require('./firebase');
const { Filter, FieldPath } = require('firebase-admin/firestore');
const log = require('./log');

// Bound per-request network-ban reads to keep Spark-tier quota safe if
// the active-ban list ever grows. Matches the cap the old expireBans
// cron used; 500 simultaneously-active network bans is far above any
// realistic ShyTalk-scale value.
const NETWORK_BANS_QUERY_LIMIT = 500;
// How many pages of that size the gate will walk before refusing to guess.
// 5,000 network bans is far beyond any realistic ShyTalk-scale value, and the
// lazy reaper keeps the steady state at roughly the active count.
const NETWORK_BANS_MAX_PAGES = 10;

// How many devices one account may bind. Enforced at WRITE time by the two
// binding-minting routes (/api/devices/lock-check and /api/device-info).
//
// This is a security control, not a product limit. A hardware ban is resolved
// by scanning the caller's deviceBindings; deviceIds are attacker-chosen
// strings and Firestore paginates by document id, so WITHOUT a cap an
// attacker could bind decoy devices that sort ahead of the banned one until
// it fell outside the scan window — and both minting routes are exempt from
// the ban gate, so a banned account could do it too. (Reviewer C1, SHY-0149.)
const MAX_BOUND_DEVICES = 20;

// The gate scans generously beyond the write-time cap, so a legitimate caller
// is never truncated. Hitting the limit means the cap was bypassed or predates
// it: the gate then cannot PROVE the caller is unbanned, so it fails closed
// (the query throws → authMiddleware's outer catch → 401) rather than logging
// a warning and letting them through.
const BINDINGS_SCAN_LIMIT = MAX_BOUND_DEVICES * 5;
const LINKED_BANS_SCAN_LIMIT = MAX_BOUND_DEVICES * 5;

/**
 * Options for the binding-minting transactions (lock-check, device-info, admin
 * create). Those transactions contain DOCUMENT reads only — never a query.
 *
 * A `tx.get(query)` widens a transaction's conflict set to every document the
 * query matches, and under the Firestore emulator it also proved to break the
 * document-level conflict detection the device-lock depends on: with a cap
 * query inside the bind transaction, two concurrent sign-ins on ONE fresh
 * device could BOTH commit `allowed`, collapsing SHY-0170's
 * one-device-one-account invariant. That invariant outranks the cap, so the
 * cap is enforced around the transaction instead (see enforceBindingCap /
 * rollbackBindingIfOverCap) and the transaction stays doc-only.
 *
 * The raised attempt budget still helps: concurrent sign-ins on the same
 * device legitimately contend, and exhausting Firestore's default 5 surfaces
 * as a 500 on a routine race.
 */
const BINDING_TRANSACTION_OPTIONS = Object.freeze({ maxAttempts: 15 });

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes — mirrors middleware/auth.js
const MAX_CACHE_SIZE = 500;

// String(uniqueId) → { standing: { deviceBan, asns }, expiresAt }
const userBanCache = new Map();
const userBanInFlight = new Map(); // String(uniqueId) → Promise<standing>

// ONE process-wide cache of the active network-ban list.
let networkBansCache = null; // { bans: Array, expiresAt: number }
let networkBansInFlight = null; // Promise<Array> | null

/** Drop the oldest entry once a cache exceeds MAX_CACHE_SIZE. */
function evictOldest(cache) {
  if (cache.size > MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/**
 * Is this ban currently in force?
 *
 * No `expiresAt` means permanent. An expiry we cannot parse means we cannot
 * prove the ban has lapsed — so it stays in force. The naive
 * `new Date(x).getTime() > Date.now()` yields `NaN > now === false`, which
 * silently RETIRES a ban whose expiry is corrupt: a safety control that fails
 * open (SHY-0149, found while writing the malformed-expiry test).
 */
function isBanActive(ban) {
  if (!ban.expiresAt) return true; // permanent
  const expiry = new Date(ban.expiresAt).getTime();
  if (Number.isNaN(expiry)) return true; // unparseable → cannot prove it lapsed
  return expiry > Date.now();
}

/** Build a ban result object. */
function buildBanResult(banType, ban) {
  return { isBanned: true, banType, reason: ban.reason || null, expiresAt: ban.expiresAt || null };
}

const NO_BAN = Object.freeze({ isBanned: false, banType: null, reason: null, expiresAt: null });

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
 * Normalize an ASN for comparison: geo enrichment stores 'AS64500'
 * (ip-api format) while the admin route validates ban values as
 * digits-only ('64500') — strict equality could never match (pre-existing
 * defect fixed under SHY-0149).
 */
function normalizeAsn(value) {
  return String(value).replace(/^AS/i, '');
}

/** Check if a network ban matches the given IP/ASN. */
function networkBanMatches(ban, ip, asn) {
  if (ban.type === 'ip') return ban.value === ip;
  if (ban.type === 'subnet') return isIpInSubnet(ip, ban.value);
  if (ban.type === 'asn') {
    // An absent caller ASN must never match — normalizeAsn(null) would
    // stringify to 'null' and could collide with a literal ban value.
    if (asn === null || asn === undefined) return false;
    return normalizeAsn(ban.value) === normalizeAsn(asn);
  }
  return false;
}

/**
 * Both String and (legacy) Number forms of an id, for Filter.or matching
 * against docs written by old clients. Guards the NaN case (SHY-0166): a
 * non-numeric uniqueId contributes only its String form.
 */
function idForms(uniqueId) {
  const forms = [String(uniqueId)];
  const numeric = Number(uniqueId);
  if (Number.isFinite(numeric)) forms.push(numeric);
  return forms;
}

/**
 * Fetch the currently-active network bans, through the process-wide cache.
 *
 * There is NO server-side expiry filter: `isBanActive` is the sole arbiter, in
 * JS (a Firestore range filter compares ISO strings by codepoint, which is not
 * an expiry check — see the note above). The scan is paged and fails CLOSED if
 * the collection outgrows its page budget, and genuinely-lapsed docs are lazily
 * reaped on the way through — the on-access reaping that retired `expireBans`.
 */
async function getActiveNetworkBans() {
  if (networkBansCache && Date.now() < networkBansCache.expiresAt) {
    return networkBansCache.bans;
  }
  if (networkBansInFlight) return networkBansInFlight;

  networkBansInFlight = (async () => {
    try {
      // NO server-side expiry filter. The obvious `where('expiresAt', '>', nowIso)`
      // compares ISO strings LEXICOGRAPHICALLY, which is not an expiry check: a
      // corrupt `expiresAt` of '' or '1999-13-45' sorts BELOW now and is dropped
      // before `isBanActive` can fail closed on it, and '2026-13-45' sorts above
      // now only until the calendar passes 2026 — a time bomb. String ordering
      // must never decide whether a safety control applies (reviewer R8-C1).
      //
      // `isBanActive` is therefore the sole arbiter, in JS. Genuinely-expired
      // docs are lazily reaped below, so the collection stays small and the
      // limit is not consumed by history — the same on-access reaping the
      // cron-elimination cluster used to retire `expireBans`.
      // The 500-doc budget now covers ACTIVE + not-yet-reaped EXPIRED docs, so a
      // single page can silently omit an active ban → fail-open. Page through
      // the whole collection, and if it is bigger than we are willing to scan,
      // FAIL CLOSED — exactly what the device-ban scan below does. A truncated
      // scan cannot prove the caller is unbanned (reviewer R9-C2).
      const active = [];
      const expired = [];
      let cursor = null;

      for (let page = 0; ; page++) {
        if (page >= NETWORK_BANS_MAX_PAGES) {
          log.error('bans', 'networkBans scan exceeded its page budget — failing closed', {
            pages: NETWORK_BANS_MAX_PAGES,
            perPage: NETWORK_BANS_QUERY_LIMIT,
          });
          throw new Error('networkBans scan truncated; cannot determine standing');
        }

        let query = db
          .collection('networkBans')
          .orderBy(FieldPath.documentId())
          .limit(NETWORK_BANS_QUERY_LIMIT);
        if (cursor) query = query.startAfter(cursor);
        const snap = await query.get();

        for (const doc of snap.docs) {
          const ban = doc.data();
          if (isBanActive(ban)) active.push(ban);
          else expired.push(doc.ref);
        }

        if (snap.size < NETWORK_BANS_QUERY_LIMIT) break; // last page
        cursor = snap.docs[snap.docs.length - 1].id;
      }

      // Drain the whole expired backlog we just walked, so the next scan is one
      // page again and the page budget is never consumed by history.
      reapExpiredNetworkBans(expired);

      networkBansCache = { bans: active, expiresAt: Date.now() + CACHE_TTL };
      return active;
    } finally {
      networkBansInFlight = null;
    }
  })();
  return networkBansInFlight;
}

/**
 * Delete network bans that have genuinely lapsed (a parseable expiry in the
 * past — never a corrupt one, which `isBanActive` keeps in force). Fire and
 * forget: reaping is housekeeping, and a failure must never fail a request.
 */
function reapExpiredNetworkBans(refs) {
  if (refs.length === 0) return;
  Promise.all(refs.map((ref) => ref.delete()))
    .then(() => log.info('bans', 'reaped expired network bans', { count: refs.length }))
    .catch((err) =>
      log.warn('bans', 'reaping expired network bans failed', { error: err.message }),
    );
}

/**
 * Resolve a caller's device standing: an active device ban (linked to the
 * account OR targeting a device bound to it) + the ASNs recorded on their
 * bindings (for network ASN matching without a live geo call).
 * Cached per uniqueId; in-flight-deduped.
 *
 * @returns {Promise<{ deviceBan: object|null, asns: string[] }>}
 */
async function getUserDeviceStanding(uniqueId) {
  const key = String(uniqueId);

  const cached = userBanCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    // Re-insert to move this key to the back of the Map's insertion order, so
    // `evictOldest` drops the least-recently-USED entry rather than the
    // least-recently-inserted one. Without this, a hot caller can be evicted
    // ahead of a cold one and pay a Firestore read (reviewer I4).
    userBanCache.delete(key);
    userBanCache.set(key, cached);
    return cached.standing;
  }

  const existing = userBanInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const forms = idForms(uniqueId);

      const [linkedSnap, bindingsSnap] = await Promise.all([
        db
          .collection('deviceBans')
          .where(Filter.or(...forms.map((f) => Filter.where('linkedUniqueId', '==', f))))
          .limit(LINKED_BANS_SCAN_LIMIT)
          .get(),
        db
          .collection('deviceBindings')
          .where(
            Filter.or(
              ...forms.map((f) => Filter.where('uniqueId', '==', f)),
              ...forms.map((f) => Filter.where('userId', '==', f)),
            ),
          )
          .limit(BINDINGS_SCAN_LIMIT)
          .get(),
      ]);

      // Fail CLOSED on truncation. A partial scan cannot prove the caller is
      // unbanned, and the un-scanned tail is exactly where an evader would
      // hide their ban (reviewer C1). Refuse rather than assume innocence:
      // this rejection reaches authMiddleware's outer catch → 401.
      if (linkedSnap.size >= LINKED_BANS_SCAN_LIMIT || bindingsSnap.size >= BINDINGS_SCAN_LIMIT) {
        log.error('bans', 'ban lookup truncated — failing closed', {
          uniqueId: key,
          linkedBans: linkedSnap.size,
          bindings: bindingsSnap.size,
        });
        throw new Error('Ban lookup truncated; cannot determine standing');
      }

      let deviceBan = linkedSnap.docs.map((d) => d.data()).find(isBanActive) || null;

      const asns = [...new Set(bindingsSnap.docs.map((d) => d.data().asn).filter((asn) => !!asn))];

      if (!deviceBan) {
        // Hardware-targeted bans (no account linkage): check the caller's
        // bound devices. Bounded by BINDINGS_QUERY_LIMIT doc reads, and only
        // on cache miss.
        const banSnaps = await Promise.all(
          bindingsSnap.docs.map((d) => db.doc(`deviceBans/${d.id}`).get()),
        );
        deviceBan =
          banSnaps
            .filter((snap) => snap.exists)
            .map((snap) => snap.data())
            .find(isBanActive) || null;
      }

      const standing = { deviceBan, asns };
      userBanCache.set(key, { standing, expiresAt: Date.now() + CACHE_TTL });
      evictOldest(userBanCache);
      return standing;
    } finally {
      userBanInFlight.delete(key);
    }
  })();
  userBanInFlight.set(key, promise);
  return promise;
}

/**
 * Per-request ban verdict for the authMiddleware gate.
 *
 * FAIL-CLOSED: intentionally no try/catch — a lookup failure propagates to
 * authMiddleware's outer catch (→ 401), exactly like a suspension-lookup
 * failure. Do not add a catch that returns NO_BAN here.
 *
 * @param {string|number|null} uniqueId resolved caller id (null = no user doc yet)
 * @param {string} ip the REAL edge IP (`req.ip` under trust proxy) — never a
 *   client-supplied X-Forwarded-For value
 */
async function checkUserBans(uniqueId, ip) {
  let asns = [];

  // A caller with no `users` doc yet (uniqueId null) has no deviceBindings, so
  // there is nothing to resolve a DEVICE ban against — only network bans can
  // apply. This is a structural limit, not an oversight: the server cannot
  // attest which physical device a token came from unless the client tells it.
  // Two other controls cover that gap — /api/devices/lock-check refuses a new
  // account on a device already bound to someone else (SHY-0170), and
  // platform attestation (DeviceCheck / Play Integrity) makes a device ban
  // survive a reinstall (SHY-0151, this epic). A modified client that never
  // registers its device is SHY-0151's problem, by design.
  if (uniqueId !== null && uniqueId !== undefined) {
    const standing = await getUserDeviceStanding(uniqueId);
    // Re-check activity on the cached ban: a short-lived ban may expire
    // within the cache TTL and must stop blocking the moment it does.
    if (standing.deviceBan && isBanActive(standing.deviceBan)) {
      return buildBanResult('device', standing.deviceBan);
    }
    asns = standing.asns;
  }

  // Network bans apply even to callers with no user doc yet — a banned
  // network must not act through a fresh account.
  const normalizedAsns = asns.map(normalizeAsn);
  const networkBans = await getActiveNetworkBans();
  for (const ban of networkBans) {
    if (!isBanActive(ban)) continue; // expiry race between cache fill and use
    if (networkBanMatches(ban, ip, null)) {
      return buildBanResult(`network_${ban.type}`, ban);
    }
    if (ban.type === 'asn' && normalizedAsns.includes(normalizeAsn(ban.value))) {
      return buildBanResult('network_asn', ban);
    }
  }

  return NO_BAN;
}

/**
 * Sign-in ban report for /api/device-info (moved verbatim from
 * device-info.js). Checks the SUBMITTED deviceId + the caller's network.
 * Fail-open by design — see the module docblock.
 * Returns { isBanned, banType, reason, expiresAt }.
 */
async function checkBans(deviceId, ip, asn) {
  try {
    const deviceBanSnap = await db.doc(`deviceBans/${deviceId}`).get();
    if (deviceBanSnap.exists && isBanActive(deviceBanSnap.data())) {
      return buildBanResult('device', deviceBanSnap.data());
    }

    const networkBans = await getActiveNetworkBans();
    for (const ban of networkBans) {
      // The query already excludes expired bans; the inline check is
      // defense-in-depth for the expiry race between cache fill and use.
      if (!isBanActive(ban)) continue;
      if (networkBanMatches(ban, ip, asn)) {
        return buildBanResult(`network_${ban.type}`, ban);
      }
    }

    return { ...NO_BAN };
  } catch (err) {
    log.error('bans', 'Error checking bans', { deviceId, error: err.message });
    return { ...NO_BAN };
  }
}

/**
 * How many devices this account already has bound. Used by the two
 * binding-minting routes to enforce MAX_BOUND_DEVICES at WRITE time — the
 * other half of the C1 fix, and the reason the gate's scan limit can never
 * be reached by a legitimate caller.
 *
 * Reads at most MAX_BOUND_DEVICES + 1 docs (we only need to know whether the
 * cap is reached, not the exact count).
 *
 * NEVER call this from inside a binding transaction. It issues a QUERY read,
 * and a query read inside those transactions widens the conflict set and
 * defeats the document-level conflict detection the device-lock relies on —
 * two concurrent sign-ins on one fresh device could both commit `allowed`.
 * The cap is deliberately enforced around the transaction instead (pre-check
 * here + `rollbackBindingIfOverCap` after). See BINDING_TRANSACTION_OPTIONS.
 *
 * @param {string|number|null} uniqueId
 * @returns {Promise<number>} count, saturating at MAX_BOUND_DEVICES + 1
 */
async function countBoundDevices(uniqueId) {
  if (uniqueId === null || uniqueId === undefined) return 0;
  const forms = idForms(uniqueId);
  const query = db
    .collection('deviceBindings')
    .where(
      Filter.or(
        ...forms.map((f) => Filter.where('uniqueId', '==', f)),
        ...forms.map((f) => Filter.where('userId', '==', f)),
      ),
    )
    .limit(MAX_BOUND_DEVICES + 1);
  const snap = await query.get();
  return snap.size;
}

/**
 * Compensating half of the binding cap. Call AFTER a transaction has claimed
 * `deviceId` for `uniqueId`.
 *
 * The pre-check before the transaction stops the ordinary over-cap bind. It
 * cannot stop a RACE: N concurrent requests can each observe a pre-cap count
 * and all commit. We cannot close that inside the transaction, because a
 * count needs a query read and a query read breaks the device-lock's
 * conflict detection (see BINDING_TRANSACTION_OPTIONS). So we close it after:
 * re-count, and if the account now exceeds the cap, release the binding this
 * request just took — and only that one, and only while we still own it.
 *
 * Racing requests each release their own claim, so the account settles at or
 * below the cap. The device keeps its telemetry; it merely goes back to being
 * unclaimed, which is exactly the at-cap state.
 *
 * @returns {Promise<boolean>} true when the caller was over the cap (so the
 *   route must refuse), regardless of whether a doc was actually released —
 *   a concurrent actor may have deleted or re-claimed it first.
 */
async function rollbackBindingIfOverCap(uniqueId, deviceId) {
  if ((await countBoundDevices(uniqueId)) <= MAX_BOUND_DEVICES) return false;

  const ref = db.doc(`deviceBindings/${deviceId}`);
  const released = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false; // someone deleted it first
    const data = snap.data() || {};
    const owner = data.uniqueId ?? data.userId ?? null;
    // Never release someone else's claim — a concurrent winner may hold it.
    if (owner === null || String(owner) !== String(uniqueId)) return false;
    tx.update(ref, { uniqueId: FieldValue.delete(), boundAt: FieldValue.delete() });
    return true;
  }, BINDING_TRANSACTION_OPTIONS);

  // Log only what actually happened — an operator reading "binding released"
  // during an incident must be able to trust it (reviewer R6-I3).
  if (released) {
    log.warn('bans', 'binding released — cap exceeded by a concurrent bind', {
      uniqueId,
      deviceId,
    });
  } else {
    log.warn('bans', 'over cap, but the target binding was already gone or reclaimed', {
      uniqueId,
      deviceId,
    });
  }
  clearBanCache(uniqueId);
  return true;
}

/**
 * Invalidate ban caches. With a uniqueId: that caller only (both id forms
 * share the String key). Without: EVERYTHING, including the network-ban
 * list — the admin ban routes call this form on every ban mutation, so a
 * ban with no account linkage (hardware- or network-targeted) still bites
 * on the target's next request.
 */
function clearBanCache(uniqueId) {
  if (uniqueId !== undefined) {
    userBanCache.delete(String(uniqueId));
    return;
  }
  userBanCache.clear();
  networkBansCache = null;
}

module.exports = {
  checkBans,
  checkUserBans,
  clearBanCache,
  countBoundDevices,
  rollbackBindingIfOverCap,
  isBanActive,
  buildBanResult,
  networkBanMatches,
  isIpInSubnet,
  NETWORK_BANS_QUERY_LIMIT,
  MAX_BOUND_DEVICES,
  BINDINGS_SCAN_LIMIT,
  BINDING_TRANSACTION_OPTIONS,
  MAX_CACHE_SIZE,
};
