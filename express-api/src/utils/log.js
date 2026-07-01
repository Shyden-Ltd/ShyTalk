/**
 * Structured logging helpers for route handlers and cron jobs.
 *
 * Usage:
 *   const log = require('../utils/log');
 *   log.info('economy', 'Daily reward claimed', { userId, amount });
 *   log.error('rooms', 'Failed to close room', { roomId, error: err.message });
 *   log.warn('auth', 'Invalid token', { ip });
 *
 * All calls are fire-and-forget (never throw, never block the response).
 */

const logger = require('./loggerInstance');

function logEntry(level, source, message, context) {
  let pending;
  try {
    // Only the SYNCHRONOUS call is guarded here — a sync throw from
    // logger.log() must never propagate to the caller.
    pending = logger.log({ level, source, message, context });
  } catch {
    // Intentionally swallowed — logging must never throw to avoid masking the caller's real error
    return;
  }
  // Handle async rejection OUTSIDE the try: a promise inside a try is not
  // caught by it (the try only guards the synchronous call above), so
  // attaching .catch here is both correct and clears sonar's "promise in
  // try without await" flag without making this fire-and-forget helper async.
  Promise.resolve(pending).catch(() => {}); // Swallow async errors — never throw from logging
}

module.exports = {
  debug: (source, message, context) => logEntry('DEBUG', source, message, context),
  info: (source, message, context) => logEntry('INFO', source, message, context),
  warn: (source, message, context) => logEntry('WARN', source, message, context),
  error: (source, message, context) => logEntry('ERROR', source, message, context),
  fatal: (source, message, context) => logEntry('FATAL', source, message, context),
};
