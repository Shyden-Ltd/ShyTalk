/**
 * Rate limiting middleware — per-user (uid) limits for API abuse prevention.
 *
 * Uses in-memory store (no external deps, fits Oracle free tier's 1GB RAM).
 * Three tiers: general API, write-heavy routes, and sensitive operations.
 */

const { rateLimit } = require('express-rate-limit');
const log = require('../utils/log');

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
  skip: (req) => req.auth?.token?.admin === true,
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
  skip: (req) => req.auth?.token?.admin === true,
  handler: (req, res) => {
    log.warn('rateLimit', 'Sensitive rate limit hit', {
      uid: req.auth?.uid,
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(429).json({ error: 'Rate limit exceeded for this operation' });
  },
});

module.exports = { generalLimiter, writeLimiter, sensitiveLimiter };
