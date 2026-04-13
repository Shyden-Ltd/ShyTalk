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

  const snap = await db.collection('users').where('firebaseUid', '==', uid).limit(1).get();

  const uniqueId = snap.empty ? null : (snap.docs[0].data().uniqueId ?? null);

  uniqueIdCache.set(uid, { uniqueId, expiresAt: Date.now() + CACHE_TTL });
  evictOldest(uniqueIdCache);

  return uniqueId;
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

  const snap = await db.doc(`users/${uniqueId}`).get();
  const user = snap.exists ? snap.data() : null;
  const isSuspended = !!(user?.isSuspended || user?.is_suspended);

  suspensionCache.set(uniqueId, { isSuspended, expiresAt: Date.now() + CACHE_TTL });
  evictOldest(suspensionCache);

  return isSuspended;
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
  if (!req.auth?.token.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

function clearSuspensionCache(uniqueId) {
  suspensionCache.delete(uniqueId);
}

/** Clear uniqueId cache entry — call after firebaseUid is updated. */
function clearUniqueIdCache(uid) {
  if (uid) {
    uniqueIdCache.delete(uid);
  } else {
    uniqueIdCache.clear();
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
};
