/**
 * Firebase Auth middleware for Express.
 *
 * Verifies Firebase ID tokens and resolves Firebase UID → uniqueId
 * via the identity system. Sets req.auth = { uid, uniqueId, token }.
 */

const { auth, db } = require('../utils/firebase');
const { checkUserBans, clearBanCache } = require('../utils/bans');
const { syncBannedClaim } = require('../utils/banned-claim');
const { recordAdmin } = require('../utils/admin-directory');
const log = require('../utils/log');

// ─── In-memory caches ────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

// uid → { uniqueId, expiresAt }
const uniqueIdCache = new Map();

// uniqueId → { isSuspended, expiresAt }
const suspensionCache = new Map();

// In-flight Promise dedup (Phase 2H finding #5). Without these, N concurrent
// first-touch requests for the same key issue N parallel Firestore reads —
// Spark-tier free quota is 50K reads/day; cold-start fires 5-10 parallel
// calls per user, so 1000 users × 10 = 10K reads in the warmup minute
// without dedup (vs ~1K with).
const uniqueIdInFlight = new Map(); // uid → Promise<uniqueId|null>
const suspensionInFlight = new Map(); // uniqueId → Promise<boolean>

// Admin-claim re-fetch cache (Phase 2H finding #2). The decoded ID token's
// `admin` claim is whatever Firebase wrote when the token was ISSUED —
// admin demotion via `setCustomUserClaims({admin:false})` doesn't
// invalidate an in-flight token, so a demoted admin keeps full powers for
// up to ~1h until natural token expiry. `requireAdmin` re-checks the live
// customClaims via `auth.getUser(uid)` with a short TTL, so the worst-case
// privilege-leak window is `ADMIN_CLAIM_TTL` (60s), not the full token
// lifetime.
const ADMIN_CLAIM_TTL = 60 * 1000;
// uid → { isAdmin, expiresAt }
const adminClaimCache = new Map();

function evictOldest(cache) {
  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// ─── Synthetic-token bypass (NODE_ENV=local ONLY) ──────────────────
//
// The manual-qa-runner synthesises sessions for personas it can't sign
// in via the Firebase Auth emulator (ephemeral personas: P-01 Adam,
// P-03 Mia — and also as a shortcut for provisioned personas to avoid
// the emulator round-trip on every scenario). The synthetic idToken
// has shape `synthetic:<name>:<uniqueId>` and is sent as the Bearer
// token on subsequent API calls.
//
// In production this token shape would fail `auth.verifyIdToken` and
// return 401 — which is the correct behaviour because no real user
// could forge such a token.
//
// In NODE_ENV=local, the entire stack runs against the Firebase
// emulator (which accepts unsigned tokens anyway) and the only callers
// are the test harness + developers running the local seed. Accepting
// synthetic tokens HERE lets the manual-qa-runner exercise cohort-gate
// and other auth-gated routes end-to-end without requiring every
// persona to have a real Firebase Auth user record.
//
// SECURITY:
//   - HARD GATE: NODE_ENV must literally equal 'local'. Any other
//     value (production, staging, undefined, '') refuses synthetic
//     tokens and falls through to real verification.
//   - The function returns null whenever the gate fails or the token
//     can't be parsed, so the caller falls through to the standard
//     verifyIdToken path.
//   - No suspension check is bypassed: synthetic tokens skip the
//     suspension lookup because in local-emulator state the
//     suspensions collection is the seed, and the test scenarios
//     either don't seed suspensions or seed them on purpose (in which
//     case the cohort gate, not auth, is what the scenario asserts).
function decodeSyntheticToken(idToken) {
  if (process.env.NODE_ENV !== 'local') return null;
  if (typeof idToken !== 'string' || !idToken.startsWith('synthetic:')) return null;
  const parts = idToken.split(':');
  if (parts.length !== 3) return null;
  const [, name, uniqueIdStr] = parts;
  if (!name || !/^\d+$/.test(uniqueIdStr)) return null;
  const uniqueId = parseInt(uniqueIdStr, 10);
  if (!Number.isFinite(uniqueId) || uniqueId <= 0) return null;
  return {
    uid: `synthetic-${name}-${uniqueId}`,
    uniqueId,
    token: { uid: `synthetic-${name}-${uniqueId}`, uniqueId, synthetic: true, name },
  };
}

// ─── UniqueId resolution ─────────────────────────────────────────

/**
 * Resolves a Firebase UID to the user's stable uniqueId by querying
 * the users collection for a doc where firebaseUid matches.
 * Returns null if no user doc is found (new user or cross-project).
 */
async function resolveUniqueId(uid) {
  const cached = uniqueIdCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.uniqueId;
  }

  // Inflight dedup: if another caller is already resolving this uid, await
  // their Promise instead of issuing a parallel Firestore query.
  const existing = uniqueIdInFlight.get(uid);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const snap = await db.collection('users').where('firebaseUid', '==', uid).limit(1).get();
      const uniqueId = snap.empty ? null : (snap.docs[0].data().uniqueId ?? null);
      uniqueIdCache.set(uid, { uniqueId, expiresAt: Date.now() + CACHE_TTL });
      evictOldest(uniqueIdCache);
      return uniqueId;
    } finally {
      // Always release the inflight slot — including on Firestore errors —
      // so a transient outage doesn't pin a stuck Promise that subsequent
      // callers keep awaiting forever.
      uniqueIdInFlight.delete(uid);
    }
  })();
  uniqueIdInFlight.set(uid, promise);
  return promise;
}

// ─── Suspension check ────────────────────────────────────────────

/**
 * Checks if a user is suspended by reading their user doc.
 * Uses uniqueId-based doc path: users/{uniqueId}.
 */
async function checkSuspension(uniqueId) {
  if (uniqueId === null || uniqueId === undefined) return false;

  const cached = suspensionCache.get(uniqueId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isSuspended;
  }

  // Inflight dedup — see resolveUniqueId for rationale.
  const existing = suspensionInFlight.get(uniqueId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const snap = await db.doc(`users/${uniqueId}`).get();
      const user = snap.exists ? snap.data() : null;
      const isSuspended = !!(user?.isSuspended || user?.is_suspended);
      suspensionCache.set(uniqueId, { isSuspended, expiresAt: Date.now() + CACHE_TTL });
      evictOldest(suspensionCache);
      return isSuspended;
    } finally {
      suspensionInFlight.delete(uniqueId);
    }
  })();
  suspensionInFlight.set(uniqueId, promise);
  return promise;
}

// ─── Middleware ───────────────────────────────────────────────────

/**
 * Express middleware: verifies Firebase ID token, resolves uniqueId,
 * checks suspension. Sets req.auth = { uid, uniqueId, token }.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.slice(7);

  // Synthetic-token bypass (NODE_ENV=local only — see helper for rationale).
  const synth = decodeSyntheticToken(idToken);
  if (synth) {
    req.auth = synth;
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // Resolve Firebase UID → stable uniqueId
    const uniqueId = await resolveUniqueId(uid);

    // Check suspension (only if user exists)
    const isSuspended = await checkSuspension(uniqueId);

    if (isSuspended && !isSuspensionExemptPath(req, uniqueId)) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // Per-request ban gate (SHY-0149): device + network bans, matched on
    // the REAL edge IP. Runs on every auth-gated request so the web,
    // direct-API, modified-client, and mid-session bypasses are all closed.
    //
    // The exemption is tested BEFORE the lookup, never after. An exempt path
    // is reachable by a banned user by definition, so its verdict is already
    // known — and a lookup FAILURE (fail-closed, rejects into the catch → 401)
    // must not confiscate the appeal / GDPR-export / ban-screen rights a ban
    // itself spares. Ordering this the other way locked those paths out of a
    // permanently-truncating account for good (reviewer C-NEW-1).
    if (!isBanExemptPath(req)) {
      const ban = await checkUserBans(uniqueId, req.ip);
      // SHY-0150 lazy claim sync: the fresh verdict and the decoded token
      // meet exactly here — when they disagree, reconcile the `banned`
      // custom claim so the Firestore rules gate tracks standings no route
      // ever mutated (lazy expiry, binding flips, UNLINKED network bans
      // caught by the live IP). Mint rides the verdict; clear goes through
      // the full recompute inside syncBannedClaim (never the IP-scoped
      // verdict). syncBannedClaim never throws — a sync failure must not
      // turn this request into the outer catch's 401.
      const tokenBanned = decoded.banned === true;
      if (ban.isBanned) {
        if (!tokenBanned) {
          await syncBannedClaim(uniqueId, { uid, verdictBanned: true, dedupe: true });
        }
        log.warn('auth', 'Request denied: banned', {
          path: req.path,
          uniqueId,
          banType: ban.banType,
        });
        return res.status(403).json({
          error: 'Account banned',
          code: 'banned',
          banType: ban.banType,
          reason: ban.reason,
          expiresAt: ban.expiresAt,
        });
      }
      if (tokenBanned) {
        await syncBannedClaim(uniqueId, { uid, dedupe: true });
      }
    }

    req.auth = { uid, uniqueId, token: decoded };
    next();
  } catch (err) {
    log.error('auth', 'Authentication failed', { error: err.message });
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Does this request read the caller's OWN user document?
 *
 * `GET /users/<callerUniqueId>` and nothing else — not a sub-path, not a write.
 * Compared as a VALUE: a `startsWith` would let `/users/691000010` through for
 * caller `69100001` and hand over a different account.
 *
 * Separate from the wholesale patterns below because this one HAS to be
 * self-scoped. Those match any id (`/^\/users\/[^/]+\/delete$/`) and leave
 * ownership to the route, which is fine for `delete` and `appeal` — endpoints
 * that only ever act on the caller. `GET /users/:id` serves OTHER PEOPLE'S
 * PROFILES, so the same treatment would restore exactly the browsing that
 * suspension exists to remove.
 */
function isOwnUserDocRead(req, uniqueId) {
  if (req.method !== 'GET') return false;
  if (uniqueId === undefined || uniqueId === null || uniqueId === '') return false;
  const m = /^\/users\/([^/]+)$/.exec(req.path);
  return !!m && m[1] === String(uniqueId);
}

/**
 * Paths a SUSPENDED user may still reach: the appeal flow plus the
 * account-deletion / GDPR-export rights that suspension must not remove.
 *
 * Plus a read of their OWN user doc, which is how a client DISCOVERS the
 * suspension at all. Without it the app called `GET /users/:id`, got this
 * gate's 403, and — having no way to tell a moderation verdict from a dead
 * network — showed "Unable to Connect. Please check your internet connection."
 * to a suspended user with full connectivity (found on the app-android gauntlet
 * cell, 2026-08-02; every remaining sign-in failure was the suspended persona).
 *
 * That made the appeal exemption directly below self-defeating: `/appeal` stayed
 * reachable, but the button that calls it lives on the suspension screen, and
 * the app could never learn to render it. Fixed here rather than in the client
 * so Android, iOS and web are all repaired without an app release.
 */
function isSuspensionExemptPath(req, uniqueId) {
  if (isOwnUserDocRead(req, uniqueId)) return true;
  return (
    // IDENTITY RESOLUTION, not a capability — and the FIRST call the app makes,
    // which is why blocking it hid every other symptom behind "Unable to
    // Connect". The route is already suspension-aware: it returns
    // `{ found: true, suspended: true }` and deliberately does NOT update
    // firebaseUid or mint custom claims for a suspended caller (Phase-2A audit
    // M5, which fixed the opposite bug — suspended users being granted claims
    // before this gate ran). Exempting the gate is safe precisely BECAUSE the
    // route is the real guard: it hands a suspended caller nothing but the news.
    (req.method === 'POST' && req.path === '/users/sign-in') ||
    /^\/users\/[^/]+\/appeal$/.test(req.path) ||
    /^\/users\/[^/]+\/lift-suspension$/.test(req.path) ||
    /^\/users\/[^/]+\/delete$/.test(req.path) ||
    /^\/users\/[^/]+\/cancel-delete$/.test(req.path) ||
    /^\/users\/[^/]+\/deletion-status$/.test(req.path) ||
    /^\/users\/[^/]+\/data-export/.test(req.path) ||
    (req.method === 'POST' && req.path === '/appeals') ||
    // Portal self-service. portal.js mounts `authMiddlewareStrict` per-route,
    // and that middleware carves these two out — but EVERY /api request runs
    // through THIS middleware first (index.js mounts it globally), so without
    // the same carve-out here the strict exemption was unreachable: a
    // suspended user could not view their own portal profile or even sign
    // out. Pre-existing for suspension; the ban gate would have inherited it
    // (reviewer R3-C2).
    req.path === '/portal/me' ||
    req.path === '/portal/sign-out'
  );
}

/**
 * Paths a BANNED user may still reach: everything a suspended user may
 * (appeals + GDPR rights survive a ban), PLUS the two ban-delivery /
 * device-binding channels — /device-info is how the app LEARNS it is
 * banned (the ban screen), and /devices/lock-check runs pre-ban-screen in
 * the sign-in flow. Gating those would replace the ban screen with a
 * generic error while enforcing nothing (both are telemetry/verdict
 * endpoints, not abuse-capable actions).
 *
 * ONE deliberate subtraction: `/portal/me`. A SUSPENDED user reaches it and
 * portal.js answers with an explicit `isSuspended` payload — but portal.js
 * has no ban branch at all, so exempting a BANNED user would hand them a
 * normal-looking dashboard with no hint they are banned. The gate's own 403
 * (`code: 'banned'` + reason + expiresAt) IS the ban notice, and it is the
 * same shape every other client already renders. Signing out, by contrast,
 * must always work — a ban is not a reason to trap someone in a session.
 */
function isBanExemptPath(req) {
  if (req.path === '/portal/me') return false;
  // No uniqueId passed ON PURPOSE, and the omission is load-bearing rather than
  // incidental: `isOwnUserDocRead` returns false without one, so the own-doc
  // read that a SUSPENDED user needs is NOT inherited by a banned one. A ban
  // needs no such channel — the gate's own 403 (`code: 'banned'` + reason +
  // expiresAt) IS the ban notice, exactly as `/portal/me` is subtracted above
  // for the same reason.
  return (
    isSuspensionExemptPath(req) || req.path === '/device-info' || req.path === '/devices/lock-check'
  );
}

/**
 * Strict auth middleware: verifies Firebase ID token with checkRevoked,
 * resolves uniqueId, checks suspension. For portal and admin routes
 * where token revocation must be enforced.
 *
 * Suspension exemption paths: /portal/me, /portal/sign-out, /users/{id}/appeal
 */
async function authMiddlewareStrict(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.slice(7);

  // Synthetic-token bypass (NODE_ENV=local only). The strict variant
  // normally adds revocation-checking via verifyIdToken(token, true) —
  // there's nothing to revoke on a synthetic token, so the bypass is
  // semantically equivalent here. Both middlewares behave identically
  // for synthetic tokens; only the live-token branches differ.
  const synth = decodeSyntheticToken(idToken);
  if (synth) {
    req.auth = synth;
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    const uid = decoded.uid;

    // Resolve Firebase UID → stable uniqueId
    const uniqueId = await resolveUniqueId(uid);

    // Check suspension (only if user exists)
    const isSuspended = await checkSuspension(uniqueId);

    const isStrictSuspensionExempt =
      req.path === '/portal/me' ||
      req.path === '/portal/sign-out' ||
      /^\/users\/[^/]+\/appeal$/.test(req.path);

    if (isSuspended && !isStrictSuspensionExempt) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // A BAN exempts strictly less than a suspension does. `/portal/me` is
    // reachable while suspended (portal.js answers with an `isSuspended`
    // payload) but NOT while banned — portal.js has no ban branch, so a banned
    // caller would receive a normal-looking dashboard. This is the same
    // subtraction `isBanExemptPath` makes for the outer gate. The two lists
    // must agree: today the outer gate reaches every /portal/* request first
    // and masks a divergence here (reviewer R5-C1).
    const isStrictBanExempt = isStrictSuspensionExempt && req.path !== '/portal/me';

    // Per-request ban gate (SHY-0149). Exemption is checked BEFORE the lookup
    // so a fail-closed rejection cannot strip those rights (reviewer C-NEW-1).
    if (!isStrictBanExempt) {
      const ban = await checkUserBans(uniqueId, req.ip);
      // SHY-0150 lazy claim sync — same reconciliation as authMiddleware
      // (see the comment there); the two gates must not diverge.
      const tokenBanned = decoded.banned === true;
      if (ban.isBanned) {
        if (!tokenBanned) {
          await syncBannedClaim(uniqueId, { uid, verdictBanned: true, dedupe: true });
        }
        log.warn('auth', 'Request denied: banned (strict)', {
          path: req.path,
          uniqueId,
          banType: ban.banType,
        });
        return res.status(403).json({
          error: 'Account banned',
          code: 'banned',
          banType: ban.banType,
          reason: ban.reason,
          expiresAt: ban.expiresAt,
        });
      }
      if (tokenBanned) {
        await syncBannedClaim(uniqueId, { uid, dedupe: true });
      }
    }

    req.auth = { uid, uniqueId, token: decoded };
    next();
  } catch (err) {
    log.error('auth', 'Authentication failed', { error: err.message });
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Re-check the live `admin` custom claim for a uid by querying Firebase
 * Auth (`auth.getUser`). Decoded ID tokens carry whatever claims existed
 * when the token was ISSUED, so a demoted admin's still-valid token shows
 * `admin: true` until natural expiry. This helper consults the live
 * customClaims, with a 60s TTL cache to keep the lookup cheap on hot
 * admin paths. (Phase 2H finding #2)
 *
 * Cached value is the boolean `customClaims.admin` from Firebase. Returns
 * `false` on lookup failure — fail closed, an admin route should never
 * grant privileges based on a Firestore-side outage.
 */
async function isLiveAdmin(uid) {
  // Skip the live check under Jest UNLESS AUTH_FORCE_LIVE_ADMIN_CHECK is set.
  // Most admin tests assert behaviour OTHER than the live re-check and would
  // otherwise need to seed live customClaims for every admin caller; skipping
  // (return true) lets them pass on the token claim alone. Production has no
  // JEST_WORKER_ID, so the live check ALWAYS fires there. Tests that DO exercise
  // the live path set AUTH_FORCE_LIVE_ADMIN_CHECK and establish the live claim
  // for REAL via auth.setCustomUserClaims against the Auth emulator — no mock of
  // auth.getUser is involved (EPIC-0003 real-only; see livekit-cohort.test.js
  // "admin cohort-bypass re-verifies the LIVE admin claim").
  if (process.env.JEST_WORKER_ID && !process.env.AUTH_FORCE_LIVE_ADMIN_CHECK) {
    return true;
  }
  if (!uid) return false;
  const cached = adminClaimCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isAdmin;
  }
  try {
    const userRecord = await auth.getUser(uid);
    const isAdmin = userRecord?.customClaims?.admin === true;
    adminClaimCache.set(uid, { isAdmin, expiresAt: Date.now() + ADMIN_CLAIM_TTL });
    evictOldest(adminClaimCache);
    // SHY-0258: build the admin directory from traffic. This is the only place
    // a LIVE admin claim is confirmed, and admin claims are granted outside the
    // API, so there is no other moment at which we could learn who the admins
    // are without scanning every user. Deliberately not awaited — a directory
    // write must never delay or fail authentication — and cache-gated above, so
    // it costs one write per admin per TTL, not one per request.
    if (isAdmin) {
      recordAdmin(uid, uniqueIdCache.get(uid)?.uniqueId ?? null).catch(() => {});
    }
    return isAdmin;
  } catch (err) {
    log.error('auth', 'Admin-claim re-fetch failed', { uid, error: err.message });
    return false;
  }
}

/**
 * Admin guard — call at the top of admin route handlers.
 *
 * Returns true if blocked (response already sent), false if admin.
 *
 * Two-layer check:
 *   1. Fast: `req.auth.token.admin` (decoded ID token claim).
 *   2. Live: `auth.getUser(uid).customClaims.admin` via 60s TTL cache.
 *
 * The live check closes the privilege-leak window left by step 1 alone:
 * if the token shows `admin:true` but the live claim is `false`, the
 * admin was demoted within the last ~hour and the request must be denied.
 *
 * Async — every caller does `if (await requireAdmin(req, res)) return;`.
 */
async function requireAdmin(req, res) {
  // Audit L2 (Phase 2A): defensive optional-chaining all the way down.
  // Fail closed on undefined req.auth/token rather than crashing.
  if (!req.auth?.token?.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  // Phase 2H finding #2: re-check the live customClaims so a demoted admin
  // can't keep using their not-yet-expired token. Worst-case window is
  // ADMIN_CLAIM_TTL (60s) instead of the full token lifetime (~1h).
  const liveAdmin = await isLiveAdmin(req.auth.uid);
  if (!liveAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

function clearSuspensionCache(uniqueId) {
  // Guard on `=== undefined` (a genuine no-arg call), NOT truthiness: unlike the
  // string uids the sibling helpers take, uniqueId can arrive as Number(badId) →
  // NaN (e.g. identity-graph.js), and `if (NaN)` truthiness would wrongly wipe
  // the whole cache. A passed 0/NaN/null falls to the targeted delete (a safe
  // no-op) instead.
  if (uniqueId === undefined) {
    // No id → clear everything (mirrors clearUniqueIdCache/clearAdminClaimCache),
    // so the no-arg clearAuthCaches() test-isolation helper actually empties it.
    // suspensionInFlight is cleared for mirror-consistency; the no-arg path runs
    // between requests (test isolation) so there is no in-flight entry to drop —
    // the production ban/unban-during-traffic case goes through the targeted
    // branch below.
    suspensionCache.clear();
    suspensionInFlight.clear();
  } else {
    suspensionCache.delete(uniqueId);
    // Also drop any inflight Promise so the NEXT caller refetches from
    // Firestore (the inflight Promise was about to resolve to the OLD value).
    suspensionInFlight.delete(uniqueId);
  }
}

/**
 * Drop the cached admin claim for a uid. Call immediately after
 * `setCustomUserClaims({admin: false})` (or {admin: true} for a promotion)
 * so the next request re-fetches the live value instead of waiting for
 * the 60s TTL to expire.
 */
function clearAdminClaimCache(uid) {
  if (uid) {
    adminClaimCache.delete(uid);
  } else {
    adminClaimCache.clear();
  }
}

/** Clear uniqueId cache entry — call after firebaseUid is updated. */
function clearUniqueIdCache(uid) {
  if (uid) {
    uniqueIdCache.delete(uid);
    uniqueIdInFlight.delete(uid);
  } else {
    uniqueIdCache.clear();
    uniqueIdInFlight.clear();
  }
}

/** Update uniqueId cache — call after sign-in resolves a new mapping. */
function updateUniqueIdCache(uid, uniqueId) {
  uniqueIdCache.set(uid, { uniqueId, expiresAt: Date.now() + CACHE_TTL });
  evictOldest(uniqueIdCache);
}

module.exports = {
  authMiddleware,
  authMiddlewareStrict,
  requireAdmin,
  isLiveAdmin,
  clearSuspensionCache,
  clearUniqueIdCache,
  clearAdminClaimCache,
  // Re-exported from utils/bans so middleware consumers (tests, admin
  // routes already importing from here) have one import surface.
  clearBanCache,
  updateUniqueIdCache,
  resolveUniqueId,
};
