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
 * secrets / Better Stack monitor headers / etc. Rotation is coordinated
 * by updating the Express API env first, then the callers.
 *
 * Verification uses an HMAC-of-HMAC comparison rather than a direct
 * `timingSafeEqual` of the bytes. Both HMACs are always 32 bytes
 * regardless of the provided token's length, so the work done by the
 * comparison is identical in EVERY rejection path — same-length wrong
 * token, wrong-length token, and matching token all execute the same
 * sequence of allocations + a 32-byte timing-safe compare. This
 * eliminates the byte-length side channel that the naive
 * `if (expectedBuf.length !== providedBuf.length) return 401` pattern
 * leaks (because `Buffer.from(provided, 'utf8')` is O(provided.length),
 * an attacker can binary-search the secret's byte length by measuring
 * the response delta between the fast-path length-mismatch and the
 * slower constant-time compare).
 *
 * Reference: https://www.synopsys.com/blogs/software-security/timing-attacks-explained/
 */

const crypto = require('node:crypto');
const log = require('../utils/log');

const BEARER_PREFIX = 'Bearer ';

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
  // Prefix-check + slice avoids regex backtracking on pathological
  // inputs (e.g. `Authorization: Bearer ` + 10kb of whitespace would
  // force `/^Bearer\s+(.+)$/i` to backtrack). The slice + trimStart
  // accepts RFC-6750-compliant whitespace after `Bearer`.
  if (
    header.length <= BEARER_PREFIX.length ||
    header.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX.toLowerCase()
  ) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const provided = header.slice(BEARER_PREFIX.length).trimStart();
  if (!provided) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  // HMAC both the expected and the provided string under a shared key
  // (the expected secret itself) so both digests are always 32 bytes
  // regardless of input length. timingSafeEqual then compares two
  // fixed-length buffers in constant time. No length-mismatch branch
  // is needed at all — wrong-length, wrong-content, and right tokens
  // all take the same code path.
  const referenceDigest = crypto.createHmac('sha256', expected).update(expected).digest();
  const providedDigest = crypto.createHmac('sha256', expected).update(provided).digest();
  if (!crypto.timingSafeEqual(referenceDigest, providedDigest)) {
    return res.status(401).json({ error: 'Invalid bearer token' });
  }

  next();
}

module.exports = { requireSystemAuth };
