/**
 * Request/response logging middleware with trace ID propagation.
 *
 * Usage:
 *   const logger = require('../utils/loggerInstance');
 *   const { createRequestLogger } = require('./requestLogger');
 *   app.use(createRequestLogger(logger));
 */

const crypto = require('crypto');

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
  'credential',
]);

/**
 * Strip sensitive fields from request body (shallow clone, one level deep).
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clean = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) continue;
    clean[key] = value;
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
      } catch (_) {
        // Never throw from the logger middleware
      }
    });

    // Never block the request
    next();
  };
}

module.exports = { createRequestLogger, sanitizeBody };
