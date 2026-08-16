/**
 * Which `/api` requests bypass `authMiddleware`.
 *
 * Extracted from `index.js` (SHY-0143) for one reason: it had no test. The
 * predicate is what makes `/api/ban-status` answerable with no Firebase
 * session, and the ban-gate story turns on exactly that — yet nothing in the
 * suite imported `index.js`, and the route test mounts the router bare, so it
 * would have passed identically had the skip been deleted, typo'd, or scoped
 * to POST. A guard registered in a bootstrap file nothing exercises is a guard
 * nobody is checking.
 *
 * @param {import('http').IncomingMessage & {path: string}} req the LIVE Express
 *   request — never a copy. `path` is `/api`-relative; `headers` is read by
 *   the anonymous-translate rule and is a prototype accessor, not an own key.
 * @returns {boolean} true when the request must NOT be authenticated
 */
/**
 * Strip ONE trailing slash, except from the root. Shared so the two
 * predicates below cannot drift: `/api/ban-status/` must be classified the
 * same way by both, or a trailing slash becomes a way to reach the route
 * while side-stepping the attestation that guards it.
 */
function normalisePath(raw) {
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function skipsAuth(req) {
  // Express's default (non-strict) router matches `/api/ban-status/` to the
  // `/ban-status` route, so a trailing slash would otherwise reach an
  // auth-gated path the route itself happily serves — a 401 on a URL that is
  // meant to be public.
  //
  // Only the EQUALITY comparisons get the normalised path. Applying it
  // globally silently un-skipped the three `startsWith('…/')` rules: '/auth/'
  // became '/auth', which does not start with '/auth/', so those exact paths
  // flipped from public to auth-required.
  // NEVER rebuild `req`. An earlier version did `req = { ...req, path }`, and
  // object spread copies only OWN enumerable keys — while `req.headers`,
  // `req.query`, `req.ip`, `req.get()` and friends are all accessors on
  // `IncomingMessage.prototype`. The copy therefore had no `headers`, so the
  // `/translate` rule below threw `TypeError: Cannot read properties of
  // undefined` INSIDE the auth middleware, 500-ing every POST /api/translate,
  // anonymous and authenticated alike.
  //
  // Two plain locals instead, used explicitly per rule.
  const raw = req.path;
  const path = normalisePath(raw);

  return (
    path === '/health' ||
    path === '/log-config' ||
    path === '/logs' ||
    path === '/firebase-config' ||
    raw.startsWith('/auth/') ||
    (req.method === 'GET' && path === '/config/startingScreens') ||
    (raw.startsWith('/test/') && process.env.NODE_ENV !== 'production') ||
    (req.method === 'GET' && /^\/users\/[^/]+\/data-export\/download$/.test(path)) ||
    // Public suggestion endpoints (browsing without login)
    (req.method === 'GET' && path === '/suggestions') ||
    (req.method === 'GET' && path === '/suggestions/search') ||
    (req.method === 'GET' && path === '/suggestions/blocked') ||
    (req.method === 'GET' && path === '/suggestions/tags') ||
    (req.method === 'GET' && /^\/suggestions\/[^/]+$/.test(path) && path !== '/suggestions/mine') ||
    // One-click email unsubscribe (token-based, no auth)
    (req.method === 'POST' && path === '/subscriptions/unsubscribe') ||
    // Anonymous public-content translation (SHY-0072): header-less POSTs
    // skip auth (the route serves the public flow and 401s chat-shaped
    // bodies); callers presenting a token still flow through
    // authMiddleware and keep the chat contract.
    (req.method === 'POST' && path === '/translate' && !req.headers.authorization) ||
    // Apple App Store Server Notifications V2 webhook — auth is the JWS
    // signature verified inside the route, not a Bearer token (Apple does
    // not send one). Without this skip, every notification would 401.
    (req.method === 'POST' && path === '/apple-notifications/v2') ||
    // Portal TOTP recovery (unauthenticated — user has lost their TOTP device)
    raw.startsWith('/portal/totp-recovery/') ||
    // Cold-start ban gate (SHY-0143). Read-only and unauthenticated by
    // necessity: the client must learn it is banned BEFORE it routes, and at
    // that moment there may be no session — a signed-out user, or one whose
    // ban is why they were signed out. Auth-gating it made a banned user with
    // no session reach the sign-in screen. GET only; it writes nothing.
    (req.method === 'GET' && path === '/ban-status')
  );
}

/**
 * Which unauthenticated requests must still prove they come from a genuine
 * app install (SHY-0300).
 *
 * App Check runs INSTEAD of auth for these paths, not as well as: they have
 * no session by definition, which is the whole reason they are on the skip
 * list. Attestation is the only remaining control that distinguishes "our app
 * asking whether this device is banned" from "anyone asking about any device
 * id".
 *
 * Deliberately ONE path for now. The other unauthenticated paths each have
 * their own caller set and their own rollout risk — most sharply
 * `/apple-notifications/v2`, which APPLE calls and which can never carry an
 * App Check token; adding it here would break purchases. Widening this list
 * is a per-path decision with per-path evidence, not a sweep.
 *
 * @param {import('http').IncomingMessage & {path: string}} req the LIVE request
 * @returns {boolean} true when the request must carry an App Check token
 */
function requiresAppCheck(req) {
  return req.method === 'GET' && normalisePath(req.path) === '/ban-status';
}

module.exports = { skipsAuth, requiresAppCheck };
