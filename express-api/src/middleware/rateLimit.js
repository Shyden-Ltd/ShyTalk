/**
 * Rate limiting middleware — per-user (uid) limits for API abuse prevention.
 *
 * Uses in-memory store (no external deps, fits Oracle free tier's 1GB RAM).
 * Three tiers: general API, write-heavy routes, and sensitive operations.
 *
 * Local + dev are exempt: a single Playwright run easily exceeds 200
 * req/min/IP because all loopback connections share `::1`, and the
 * pre-push hook (or a manual-qa cycle) would deterministically trip
 * dev-sanity assertions on `/api/health` once the suite is ~200 calls
 * in. Production is the only environment that needs the limit; the
 * `NODE_ENV !== 'production'` skip preserves that without making local
 * test runs flake on rate-limit budgets.
 */

const { rateLimit } = require('express-rate-limit');
const log = require('../utils/log');

const isNonProd = () => process.env.NODE_ENV !== 'production';

// Key by authenticated user ID (falls back to IP for unauthenticated requests)
const keyGenerator = (req) => req.auth?.uid || req.ip;

// General API rate limit: 200 requests per minute per user
// Admin users are exempt — the admin panel legitimately makes many parallel
// API calls (logs, alerts, economy, search) across multiple tabs.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  validate: false,
  skip: (req) => isNonProd() || req.auth?.token?.admin === true,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});

// Write-heavy routes (messages, gifts, gacha): 30 per minute per user
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  validate: false,
  skip: () => isNonProd(),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, slow down' });
  },
});

// Sensitive operations (appeals, reports, purchases): 5 per minute per user
// Admin users are exempt — admin panel tests legitimately create reports/appeals.
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  validate: false,
  skip: (req) => isNonProd() || req.auth?.token?.admin === true,
  handler: (req, res) => {
    log.warn('rateLimit', 'Sensitive rate limit hit', {
      uid: req.auth?.uid,
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(429).json({ error: 'Rate limit exceeded for this operation' });
  },
});

// Cohort override: 5 per minute per admin — NO admin skip. Cohort changes
// drive custom-claim re-mint AND a transactional audit-log write; an admin
// loop here pollutes adminAuditLog and burns Firestore write quota. Caps the
// blast radius of a compromised/rogue admin token to ~300 ops/hour, which
// is well above legitimate moderation volume (manual case-by-case review).
const adminCohortLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  validate: false,
  skip: () => isNonProd(),
  handler: (req, res) => {
    log.warn('rateLimit', 'Cohort override rate limit hit', {
      uid: req.auth?.uid,
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(429).json({ error: 'Rate limit exceeded for cohort override' });
  },
});

// Portal routes: 60 per minute per user — NO admin skip (prevents
// admin tokens from flooding checkRevoked calls via authMiddlewareStrict)
const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.uid || req.ip,
  validate: false,
  skip: () => isNonProd(),
});

// Bounded LRU store for the recoveryLimiter. The default `MemoryStore` from
// `express-rate-limit` uses an unbounded `Map` and only prunes expired keys
// once per `windowMs` — at 24h with email-keyed buckets, a botnet of unique
// emails can grow the Map to millions of entries before any pruning. The
// Oracle free-tier API VM has 1 GB RAM; sustained attack → OOM-killed pm2
// → restart loop that wipes legitimate-user counters too. Phase 2H finding #4.
//
// Caps the keyspace at MAX_KEYS (10_000 — sufficient for ~3K active users
// at 3 attempts/24h each, far above realistic ShyTalk recovery volume) and
// evicts the least-recently-used entry on overflow. Entries past `windowMs`
// self-clear when accessed.
class BoundedLruRateLimitStore {
  constructor({ windowMs, maxKeys = 10_000 }) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map(); // insertion-ordered → cheap LRU via delete+set
  }
  init() {}
  async increment(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (entry && now >= entry.resetTime.getTime()) {
      entry = undefined;
    }
    if (!entry) {
      entry = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
    } else {
      // LRU touch: re-insert to move to the most-recent end.
      this.hits.delete(key);
    }
    entry.totalHits += 1;
    this.hits.set(key, entry);
    while (this.hits.size > this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      this.hits.delete(oldestKey);
    }
    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }
  async decrement(key) {
    const entry = this.hits.get(key);
    if (entry && entry.totalHits > 0) entry.totalHits -= 1;
  }
  async resetKey(key) {
    this.hits.delete(key);
  }
  async resetAll() {
    this.hits.clear();
  }
  // Test-only observability hook.
  _size() {
    return this.hits.size;
  }
}

// Recovery endpoints (password reset, TOTP recovery): 3 per 24 hours per email
const recoveryLimiter = rateLimit({
  store: new BoundedLruRateLimitStore({ windowMs: 24 * 60 * 60 * 1000, maxKeys: 10_000 }),
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Trim AND lowercase to match the route-side normalisation (portal.js:524
  // does `email.trim().toLowerCase()` before user lookup). Without `.trim()`
  // an attacker could spam OTPs to `victim@x.com` by alternating
  // ` victim@x.com`, `victim@x.com `, and `victim@x.com` — three distinct
  // rate-limit buckets all targeting the same Firebase user (Phase 2H finding #3).
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    return email || req.ip;
  },
  validate: false,
  skip: () => isNonProd(),
});

module.exports = {
  generalLimiter,
  writeLimiter,
  sensitiveLimiter,
  adminCohortLimiter,
  portalLimiter,
  recoveryLimiter,
  // Test-only export so suite can pin LRU eviction without standing up the
  // full rate-limit middleware. Production callers use `recoveryLimiter` only.
  BoundedLruRateLimitStore,
};
