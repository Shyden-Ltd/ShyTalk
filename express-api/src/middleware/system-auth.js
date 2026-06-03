/**
 * System-endpoint authentication.
 *
 * Protects `/api/system/*` endpoints called by external schedulers
 * (GitHub Actions scheduled workflows replacing the in-process node-cron
 * jobs). The endpoints are publicly reachable URLs, so they need a
 * shared-secret guard separate from the Firebase Auth flow used by
 * end-users.
 *
 * The secret is held in `SYSTEM_SHARED_SECRET` env var. The caller
 * passes it as a bearer token:
 *
 *     Authorization: Bearer <SYSTEM_SHARED_SECRET>
 *
 * Per the same-secret-many-callers model, each scheduled workflow (and
 * any other ops-only tooling) configures the same value via repo
 * secrets / Better Stack monitor headers / etc. Rotation is
 * coordinated by updating the Express API env first, then the callers.
 *
 * Comparison uses `crypto.timingSafeEqual` so a token-guessing attacker
 * can't infer the secret one character at a time from response timing.
 */

const crypto = require('node:crypto');
const log = require('../utils/log');

function requireSystemAuth(req, res, next) {
  const expected = process.env.SYSTEM_SHARED_SECRET;

  if (!expected) {
    // Configuration error: deny by default so a misconfigured deploy
    // can't accidentally expose the sweep endpoints. Logged once per
    // request so ops can spot the gap without flooding.
    log.error('system-auth', 'SYSTEM_SHARED_SECRET not configured — denying request', {
      path: req.path,
    });
    return res.status(503).json({ error: 'System authentication not configured' });
  }

  const header = req.get('authorization') || '';
  // Prefix-check avoids regex backtracking risk on pathological inputs
  // (e.g. `Authorization: Bearer ` + 10kb of whitespace would force a
  // greedy regex to backtrack). The case-insensitive prefix check +
  // index slice does the same job as `/^Bearer\s+(.+)$/i` in
  // bounded time.
  const PREFIX_LEN = 'Bearer '.length;
  if (header.length <= PREFIX_LEN || header.slice(0, PREFIX_LEN).toLowerCase() !== 'bearer ') {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const provided = header.slice(PREFIX_LEN).trimStart();
  if (!provided) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  // timingSafeEqual requires equal-length buffers. Reject length
  // mismatch up-front to avoid the throw — that branch is constant
  // time regardless of secret contents because we don't compare
  // anything beyond the length check.
  if (expectedBuf.length !== providedBuf.length) {
    return res.status(401).json({ error: 'Invalid bearer token' });
  }

  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({ error: 'Invalid bearer token' });
  }

  next();
}

module.exports = { requireSystemAuth };
