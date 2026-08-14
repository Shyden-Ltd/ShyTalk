'use strict';

/**
 * SHY-0060 — per-user rate limit on the age-gate check (AC86).
 *
 * Caps gate evaluations at MAX_PER_WINDOW per user per WINDOW_MS to blunt
 * threshold-enumeration attacks (scripting the gate across features to map each
 * threshold). Keyed by userId — NOT IP — so it is immune to the shared-`::1`
 * loopback problem that forces the express-rate-limit middleware to skip
 * non-prod, and is therefore active (and testable) in every environment.
 *
 * Pure in-memory sliding window with an injected clock (no real timers), so the
 * whole thing is unit-testable. A lazy sweep purges expired buckets so the map
 * stays bounded by the count of users active within one window.
 */

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 100;

// userId -> { count, windowStart }
const buckets = new Map();
let lastSweepMs = 0;

function sweepExpired(nowMs) {
  if (nowMs - lastSweepMs < WINDOW_MS) return;
  lastSweepMs = nowMs;
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

/**
 * Record one gate check for a user and report whether it is within budget.
 *
 * @param {number|string} userId
 * @param {number} [nowMs=Date.now()]
 * @returns {{ allowed: boolean, count: number }} `count` keeps climbing past the
 *   limit so the caller can alert exactly once (on `count === MAX + 1`).
 */
function recordGateCheck(userId, nowMs = Date.now()) {
  sweepExpired(nowMs);
  const key = String(userId ?? '');
  const bucket = buckets.get(key);
  if (!bucket || nowMs - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: nowMs });
    return { allowed: true, count: 1 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= MAX_PER_WINDOW, count: bucket.count };
}

/** Test hook — clear all buckets + the sweep clock. */
function __resetGateRateLimit() {
  buckets.clear();
  lastSweepMs = 0;
}

module.exports = { recordGateCheck, __resetGateRateLimit, MAX_PER_WINDOW, WINDOW_MS };
