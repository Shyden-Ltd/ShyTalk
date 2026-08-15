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
 * @param {{method: string, path: string, headers?: object}} req path is the
 *   `/api`-relative path; `headers` is read by the anonymous-translate rule
 * @returns {boolean} true when the request must NOT be authenticated
 */
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
  const raw = req.path;
  const path = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  req = { ...req, path, rawPath: raw };

  return (
    req.path === '/health' ||
    req.path === '/log-config' ||
    req.path === '/logs' ||
    req.path === '/firebase-config' ||
    raw.startsWith('/auth/') ||
    (req.method === 'GET' && req.path === '/config/startingScreens') ||
    (raw.startsWith('/test/') && process.env.NODE_ENV !== 'production') ||
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
    raw.startsWith('/portal/totp-recovery/') ||
    // Cold-start ban gate (SHY-0143). Read-only and unauthenticated by
    // necessity: the client must learn it is banned BEFORE it routes, and at
    // that moment there may be no session — a signed-out user, or one whose
    // ban is why they were signed out. Auth-gating it made a banned user with
    // no session reach the sign-in screen. GET only; it writes nothing.
    (req.method === 'GET' && req.path === '/ban-status')
  );
}

module.exports = { skipsAuth };
