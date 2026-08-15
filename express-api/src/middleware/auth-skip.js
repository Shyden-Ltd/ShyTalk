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
 * @param {{method: string, path: string}} req path is the `/api`-relative path
 * @returns {boolean} true when the request must NOT be authenticated
 */
function skipsAuth(req) {
  // Express's default (non-strict) router matches `/api/ban-status/` to the
  // `/ban-status` route, so without normalising here a trailing slash would
  // reach an auth-gated path that the route itself happily serves — a 401 on
  // a URL that is supposed to be public. Normalise once, at the top, so every
  // comparison below is against the same shape.
  const path = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
  req = { ...req, path };

  return (
    req.path === '/health' ||
    req.path === '/log-config' ||
    req.path === '/logs' ||
    req.path === '/firebase-config' ||
    req.path.startsWith('/auth/') ||
    (req.method === 'GET' && req.path === '/config/startingScreens') ||
    (req.path.startsWith('/test/') && process.env.NODE_ENV !== 'production') ||
    (req.method === 'GET' && /^\/users\/[^/]+\/data-export\/download$/.test(req.path)) ||
    // Public suggestion endpoints (browsing without login)
    (req.method === 'GET' && req.path === '/suggestions') ||
    (req.method === 'GET' && req.path === '/suggestions/search') ||
    (req.method === 'GET' && req.path === '/suggestions/blocked') ||
    (req.method === 'GET' && req.path === '/suggestions/tags') ||
    (req.method === 'GET' &&
      /^\/suggestions\/[^/]+$/.test(req.path) &&
      req.path !== '/suggestions/mine') ||
    // One-click email unsubscribe (token-based, no auth)
    (req.method === 'POST' && req.path === '/subscriptions/unsubscribe') ||
    // Anonymous public-content translation (SHY-0072): header-less POSTs
    // skip auth (the route serves the public flow and 401s chat-shaped
    // bodies); callers presenting a token still flow through
    // authMiddleware and keep the chat contract.
    (req.method === 'POST' && req.path === '/translate' && !req.headers.authorization) ||
    // Apple App Store Server Notifications V2 webhook — auth is the JWS
    // signature verified inside the route, not a Bearer token (Apple does
    // not send one). Without this skip, every notification would 401.
    (req.method === 'POST' && req.path === '/apple-notifications/v2') ||
    // Portal TOTP recovery (unauthenticated — user has lost their TOTP device)
    req.path.startsWith('/portal/totp-recovery/') ||
    // Cold-start ban gate (SHY-0143). Read-only and unauthenticated by
    // necessity: the client must learn it is banned BEFORE it routes, and at
    // that moment there may be no session — a signed-out user, or one whose
    // ban is why they were signed out. Auth-gating it made a banned user with
    // no session reach the sign-in screen. GET only; it writes nothing.
    (req.method === 'GET' && req.path === '/ban-status')
  );
}

module.exports = { skipsAuth };
