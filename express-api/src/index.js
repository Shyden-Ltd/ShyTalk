require('dotenv').config({
  path: process.env.NODE_ENV === 'local' ? '.env.local' : '.env',
});
const express = require('express');
const helmet = require('helmet');
const corsMiddleware = require('./middleware/cors');
const { authMiddleware } = require('./middleware/auth');
const { generalLimiter, writeLimiter, sensitiveLimiter } = require('./middleware/rateLimit');
const portalRoutes = require('./routes/portal');
const { portalLimiter, recoveryLimiter } = require('./middleware/rateLimit');
const { startCronJobs } = require('./cron');
require('./utils/firebase'); // Initialize Firebase before routes
const { patchConsole } = require('./utils/consoleLogger');

// Route all console.log/warn/error through structured logger
patchConsole();

// Catch unhandled promise rejections (e.g., fire-and-forget in cron jobs)
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled promise rejection:', reason);
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));

// Lockdown middleware — adds `X-Robots-Tag: noindex, nofollow,
// noarchive` to every response from non-prod hostnames so search
// engines drop dev-api URLs from their index. The `/robots.txt`
// endpoint serves a Disallow:/ body on non-prod and a permissive
// Allow:/ on prod. Detection is by `req.hostname` (not NODE_ENV) so
// the dev VM's pm2 NODE_ENV=production setup doesn't accidentally
// disable the gate.
const { noIndex, robotsTxt } = require('./middleware/no-index');
app.use(noIndex);
app.get('/robots.txt', robotsTxt);

// Request/response logging (after body parsing, before auth)
const logger = require('./utils/loggerInstance');
const { createRequestLogger } = require('./middleware/requestLogger');
app.use(createRequestLogger(logger));

// Health check (no auth, rate-limited by IP via generalLimiter below).
// Returns the deployed git SHA so deploy workflows can assert the new
// code is actually serving — closes the "deploy succeeded but old pm2
// process still running" silent-failure class. The SHA is sourced from:
//   1. DEPLOYED_SHA env var (preferred — the deploy script sets this
//      via pm2 restart --update-env)
//   2. ~/.deployed-sha file (durable fallback that survives pm2 daemon
//      restarts; the deploy script writes it alongside the env var)
//   3. "unknown" for local dev runs
const path = require('node:path');
const fs = require('node:fs');
function resolveDeployedSha() {
  if (process.env.DEPLOYED_SHA) return process.env.DEPLOYED_SHA;
  // The .deployed-sha file lives one level above src/ so it survives
  // tarball-based redeploys that overwrite src/ contents.
  try {
    const shaPath = path.resolve(__dirname, '..', '.deployed-sha');
    if (fs.existsSync(shaPath)) {
      return fs.readFileSync(shaPath, 'utf8').trim() || 'unknown';
    }
  } catch {
    // Ignore — fall through to "unknown".
  }
  return 'unknown';
}
const DEPLOYED_SHA = resolveDeployedSha();
app.get('/api/health', generalLimiter, (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), sha: DEPLOYED_SHA });
});

// Auth routes (mounted BEFORE auth middleware — these handle their own auth)
// Each auth route already applies sensitiveLimiter internally.
app.use('/api', require('./routes/auth'));

// Auth middleware for all /api routes (except health, log-config, auth, and pre-auth endpoints)
app.use('/api', (req, res, next) => {
  if (
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
    // Apple App Store Server Notifications V2 webhook — auth is the JWS
    // signature verified inside the route, not a Bearer token (Apple does
    // not send one). Without this skip, every notification would 401.
    (req.method === 'POST' && req.path === '/apple-notifications/v2') ||
    // Portal TOTP recovery (unauthenticated — user has lost their TOTP device)
    req.path.startsWith('/portal/totp-recovery/')
  )
    return next();
  authMiddleware(req, res, next);
});

// General rate limit on authenticated API routes (after auth so req.auth.token.admin skip works)
// Test routes are exempt in non-production environments.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/test/') && process.env.NODE_ENV !== 'production') {
    return next();
  }
  return generalLimiter(req, res, next);
});

// Stricter limits on write-heavy routes
app.use('/api/conversations', writeLimiter);
app.use('/api/economy/gacha', writeLimiter);
app.use('/api/economy/gift', writeLimiter);
app.use('/api/economy/gift-direct', writeLimiter);
app.use('/api/economy/gift-batch', writeLimiter);
app.use('/api/economy/backpack-send', writeLimiter);
// NOTE: writeLimiter applies to ALL methods/routes under /api/notifications,
// including any future GET endpoints (e.g. notification history). The current
// surface is POST/DELETE/PATCH only, all writes — but if a feed-style GET is
// added later, split this into per-method mounts so reads don't inherit the
// 30/min/user write cap.
//
// Coverage: this is mount-time middleware registration in a bootstrap file;
// no in-test path imports src/index.js (each route's tests build their own
// express() app in isolation), so istanbul never instruments this line. The
// behaviour IS validated by tests in `tests/middleware/rateLimit.test.js`
// against the writeLimiter export and `tests/routes/notifications.test.js`
// against the route handlers.
/* istanbul ignore next -- bootstrap mount; behaviour tested in isolated route + middleware tests */
app.use('/api/notifications', writeLimiter);
app.use('/api/translate', writeLimiter);
// UK OSA #17 PR 5: cohort enumeration / activity-tracking defence.
// Both new endpoints fan-out to indexed Firestore queries; the search
// numeric branch additionally fires segregationEvents audit writes on
// every cross-cohort miss. 30/min/user prevents brute-force uniqueId
// scans and name-prefix bigram sweeps. writeLimiter intentionally has
// no admin bypass — the admin panel uses dedicated admin-* routes and
// should not be browsing the public discovery surface.
/* istanbul ignore next -- bootstrap mount; behaviour tested in isolated route + middleware tests */
app.use('/api/users/discover', writeLimiter);
/* istanbul ignore next -- bootstrap mount; behaviour tested in isolated route + middleware tests */
app.use('/api/users/search', writeLimiter);

// Strictest limits on sensitive operations
app.use('/api/economy/purchase', sensitiveLimiter);
app.use('/api/economy/trial-claim', sensitiveLimiter);
app.use('/api/economy/trial-activate', sensitiveLimiter);
app.use('/api/reports', sensitiveLimiter);
app.use('/api/appeals', sensitiveLimiter);
app.use('/api/users/:uniqueId/delete', sensitiveLimiter);
app.use('/api/users/:uniqueId/data-export', sensitiveLimiter);
// First-of-day PM-lock auto-unlock check (PR 11). Sensitive: it can
// flip a server-only field (`pmLocked`). Throttled inside the route
// to one Firestore write per user per UTC day, but the limiter caps
// any one client from spinning the auth-then-403 path in a tight loop.
app.use('/api/users/:uniqueId/pm-lock-check', sensitiveLimiter);
// Age verification — sensitive because it issues short-lived R2
// upload tokens and creates pending submissions. Rate limit prevents
// a malicious client from spamming submissions or harvesting upload
// URLs.
app.use('/api/age-verification', sensitiveLimiter);

// Portal rate limiter (no admin exemption) — skip for recovery routes
app.use('/api/portal', (req, res, next) => {
  if (req.path.startsWith('/totp-recovery/')) return next();
  portalLimiter(req, res, next);
});

// Recovery-specific rate limiter (per-email, 3 per 24h)
app.use('/api/portal/totp-recovery', recoveryLimiter);

// Mount portal routes
app.use('/api', portalRoutes);

// Mount route modules
app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/economy'));
app.use('/api', require('./routes/apple-notifications'));
app.use('/api', require('./routes/livekit'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/rooms'));
app.use('/api', require('./routes/data-export'));
app.use('/api', require('./routes/age-verification'));
app.use('/api', require('./routes/pm-lock-check'));
app.use('/api', require('./routes/conversations'));
app.use('/api', require('./routes/banners'));
app.use('/api', require('./routes/fun-facts'));
app.use('/api', require('./routes/admin-users'));
app.use('/api', require('./routes/admin-age-verification'));
app.use('/api', require('./routes/admin-economy'));
app.use('/api', require('./routes/admin-gifts'));
app.use('/api', require('./routes/admin-cleanup'));
app.use('/api', require('./routes/admin-backup'));
app.use('/api', require('./routes/admin-logs'));
app.use('/api', require('./routes/admin-log-config'));
app.use('/api', require('./routes/storage'));
app.use('/api', require('./routes/device-info'));
app.use('/api', require('./routes/admin-bans'));
app.use('/api', require('./routes/admin-devices'));
app.use('/api', require('./routes/admin-temp-id'));
app.use('/api', require('./routes/admin-alerts'));
app.use('/api', require('./routes/translate'));
app.use('/api', require('./routes/suggestions'));
app.use('/api', require('./routes/subscriptions'));
app.use('/api', require('./routes/suggestions-notifications'));
app.use('/api', require('./routes/admin-suggestions'));
app.use('/api', require('./routes/admin-audit-log'));
app.use('/api', require('./routes/suggestions-maintenance'));
app.use('/api', require('./routes/identity-graph'));
app.use('/api', require('./routes/roadmap-auth'));

const { createLogsRouter } = require('./routes/logs');
app.use('/api', createLogsRouter(logger));

// Dev-only routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', require('./routes/test-helpers'));
  app.use('/api', require('./routes/admin-migrate'));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.log({
    level: 'ERROR',
    source: 'server',
    message: 'Unhandled error',
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ShyTalk API listening on port ${PORT}`);
  startCronJobs();
});
