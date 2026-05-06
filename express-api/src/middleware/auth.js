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

// In-flight Promise dedup. Without these, N concurrent first-touch requests
// for the same key issue N parallel Firestore reads — Spark-tier free quota
// is 50K reads/day and a typical app cold-start fires 5-10 parallel API
// calls per user, so 1000 users × 10 = 10K reads in the warmup minute alone
// without dedup (vs ~1K with). Keys mirror their respective caches.
// (Phase 2H finding #5)
const uniqueIdInFlight = new Map(); // uid → Promise<uniqueId|null>
const suspensionInFlight = new Map(); // uniqueId → Promise<boolean>

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
 * Admin guard — call at the top of admin route handlers.
 * Returns true if blocked (response already sent), false if admin.
 */
function requireAdmin(req, res) {
  // Audit L2 (Phase 2A): defensive optional-chaining all the way
  // down. Pre-fix used `req.auth?.token.admin` which throws TypeError
  // if `req.auth` is set but `token` is undefined. In practice the
  // auth middleware always sets both, but a future refactor that
  // changes the shape would crash the request rather than fail-closed.
  // `req.auth?.token?.admin` returns undefined → falls into the 403
  // branch — fail closed.
  if (!req.auth?.token?.admin) {
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
  clearSuspensionCache,
  clearUniqueIdCache,
  updateUniqueIdCache,
  resolveUniqueId,
};
