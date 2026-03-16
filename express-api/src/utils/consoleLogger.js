/**
 * Console override that funnels console.log/warn/error/info into
 * the structured logger while preserving stdout output.
 *
 * Must be called once during app startup, AFTER loggerInstance is created.
 *
 * Behaviour:
 *   - Keeps original console output (developers still see logs in PM2/terminal)
 *   - Also writes each console call as a structured log entry to Firestore
 *   - Source is detected from the message prefix (e.g. "[CRON]" → "cron")
 *   - Falls back to source "express-api"
 */

/* eslint-disable no-console */

const logger = require('./loggerInstance');

const LEVEL_MAP = {
  log: 'INFO',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

// Detect source from common prefix patterns
const SOURCE_PATTERNS = [
  { regex: /^\[CRON\]/i, source: 'cron' },
  { regex: /^\[AUTO-BAN\]/i, source: 'admin' },
  { regex: /^(GET|POST|PUT|PATCH|DELETE) \//, source: 'http' },
];

function detectSource(message) {
  for (const { regex, source } of SOURCE_PATTERNS) {
    if (regex.test(message)) return source;
  }
  return 'express-api';
}

function patchConsole() {
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  for (const [method, level] of Object.entries(LEVEL_MAP)) {
    console[method] = (...args) => {
      // Always keep original console output
      originalConsole[method](...args);

      // Also send to structured logger
      try {
        const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

        logger.log({
          level,
          source: detectSource(message),
          message: message.slice(0, 2000), // cap length
        });
      } catch (_) {
        // Never fail from logging
      }
    };
  }
}

module.exports = { patchConsole };
