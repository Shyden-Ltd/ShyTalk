/**
 * Firebase Auth middleware for Express.
 *
 * Verifies Firebase ID tokens and resolves Firebase UID → uniqueId
 * via the identity system. Sets req.auth = { uid, uniqueId, token }.
 */

const { auth, db } = require('../utils/firebase');
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

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // Resolve Firebase UID → stable uniqueId
    const uniqueId = await resolveUniqueId(uid);

    // Check suspension (only if user exists)
    const isSuspended = await checkSuspension(uniqueId);

    if (isSuspended) {
      const isSuspensionExempt =
        /^\/users\/[^/]+\/appeal$/.test(req.path) ||
        /^\/users\/[^/]+\/lift-suspension$/.test(req.path) ||
        /^\/users\/[^/]+\/delete$/.test(req.path) ||
        /^\/users\/[^/]+\/cancel-delete$/.test(req.path) ||
        /^\/users\/[^/]+\/deletion-status$/.test(req.path) ||
        /^\/users\/[^/]+\/data-export/.test(req.path) ||
        (req.method === 'POST' && req.path === '/appeals');
      if (!isSuspensionExempt) {
        return res.status(403).json({ error: 'Account suspended' });
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

  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    const uid = decoded.uid;

    // Resolve Firebase UID → stable uniqueId
    const uniqueId = await resolveUniqueId(uid);

    // Check suspension (only if user exists)
    const isSuspended = await checkSuspension(uniqueId);

    if (isSuspended) {
      const isSuspensionExempt =
        req.path === '/portal/me' ||
        req.path === '/portal/sign-out' ||
        /^\/users\/[^/]+\/appeal$/.test(req.path);
      if (!isSuspensionExempt) {
        return res.status(403).json({ error: 'Account suspended' });
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
  // Jest test environments stub req.auth.token.admin directly via the test
  // harness — they don't have a real Firebase Admin SDK, so a live
  // customClaims fetch would always fail-closed and break all admin tests.
  // Skip the live check ONLY under Jest (process.env.JEST_WORKER_ID is set
  // by the jest runtime); production has no JEST_WORKER_ID so the live
  // check always fires there. Dedicated tests for the live-check behaviour
  // explicitly mock `auth.getUser` and run the live path via
  // process.env.AUTH_FORCE_LIVE_ADMIN_CHECK.
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
  suspensionCache.delete(uniqueId);
  // Also drop any inflight Promise so the NEXT caller refetches from
  // Firestore (the inflight Promise was about to resolve to the OLD value).
  suspensionInFlight.delete(uniqueId);
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
  updateUniqueIdCache,
  resolveUniqueId,
};
