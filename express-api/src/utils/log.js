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
  try {
    logger.log({ level, source, message, context });
  } catch (_) {
    // Never throw from logging
  }
}

module.exports = {
  debug: (source, message, context) => logEntry('DEBUG', source, message, context),
  info: (source, message, context) => logEntry('INFO', source, message, context),
  warn: (source, message, context) => logEntry('WARN', source, message, context),
  error: (source, message, context) => logEntry('ERROR', source, message, context),
  fatal: (source, message, context) => logEntry('FATAL', source, message, context),
};
