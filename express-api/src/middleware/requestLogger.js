/**
 * Request/response logging middleware with trace ID propagation.
 *
 * Usage:
 *   const logger = require('../utils/loggerInstance');
 *   const { createRequestLogger } = require('./requestLogger');
 *   app.use(createRequestLogger(logger));
 */

const crypto = require('node:crypto');

// Substring-match denylist. The previous shallow + exact-match list missed
// nested credentials (`{ user: { password } }`, `{ data: { idToken } }`)
// and credential field names not on the explicit list (`passcode`, `otp`,
// `totp`, `verifier`, `clientSecret`, `apiKey`, `recoveryCode`,
// `appleSignedPayload`, `firebaseIdToken`, etc.). Logs are searchable by
// uid; an admin reviewing one user's logs could grab another user's
// still-valid credentials. Phase 2H finding #6.
//
// Pattern matches whole-key substrings — `pin`, `pinHash`, `oldPin`,
// `userPasscode`, `idToken`, `accessToken`, `apiKey`, `clientSecret`,
// `recoveryCode`, `appleSignedPayload`, etc. all redact correctly.
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passcode|pin|otp|totp|code|credential|verifier|signature|recovery|apple.*payload|hash|apikey/i;

// Cap recursion depth defensively. Express body-parser has its own
// `parameterLimit` and `depth` defaults that bound the inbound payload,
// but a custom express.raw() route could feed in a deeper structure.
// 8 is plenty for any legitimate API DTO and is far below Node's stack
// limit on a stock Mac/Linux build.
const SANITIZE_DEPTH_LIMIT = 8;

/**
 * Strip sensitive fields from request body. Recurses into nested objects
 * and arrays so credentials nested under DTO wrappers (`{ user: { password } }`,
 * `{ data: { idToken } }`) are also removed. Sensitive keys are deleted
 * (not present in output) to match the existing log-consumer contract.
 */
function sanitizeBody(body, depth = 0) {
  if (depth > SANITIZE_DEPTH_LIMIT) return null;
  if (body === null || body === undefined) return body;
  if (Array.isArray(body)) return body.map((v) => sanitizeBody(v, depth + 1));
  if (typeof body !== 'object') return body;
  const clean = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    clean[key] = sanitizeBody(value, depth + 1);
  }
  return clean;
}

/**
 * Create Express middleware that logs every request/response.
 *
 * @param {object} logger - Logger instance with a `log(entry)` method.
 * @returns {Function} Express middleware
 */
function createRequestLogger(logger) {
  return function requestLoggerMiddleware(req, res, next) {
    // Skip logging for health checks — they add ~1,440 writes/day for no value
    if (req.path === '/api/health') {
      return next();
    }

    const startTime = Date.now();

    // Generate request trace ID
    const requestTraceId = crypto.randomBytes(16).toString('hex');
    const sessionTraceId = req.headers['x-session-trace-id'] || null;

    // Attach to request for downstream use
    req.requestTraceId = requestTraceId;
    req.sessionTraceId = sessionTraceId;

    res.setHeader('x-request-trace-id', requestTraceId);

    // Log after response completes
    res.on('finish', () => {
      try {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;

        let level = 'INFO';
        if (statusCode >= 500) level = 'ERROR';
        else if (statusCode >= 400) level = 'WARN';

        const method = req.method;
        const path = req.originalUrl || req.url;
        const message = `${method} ${path} ${statusCode} ${durationMs}ms`;

        logger.log({
          level,
          source: 'http',
          message,
          requestTraceId,
          sessionTraceId,
          userId: req.auth?.uid || null,
          context: {
            method,
            path,
            statusCode,
            durationMs,
            requestBody:
              req.body !== null && req.body !== undefined ? sanitizeBody(req.body) : null,
            userAgent: req.headers['user-agent'] || null,
          },
        });
      } catch {
        // Intentionally swallowed — request logging must never throw to avoid disrupting HTTP responses
      }
    });

    // Never block the request
    next();
  };
}

module.exports = { createRequestLogger, sanitizeBody };
