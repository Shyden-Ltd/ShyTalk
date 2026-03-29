/**
 * Central logger utility with quota protection and sanitization.
 *
 * Usage:
 *   const logger = require('./loggerInstance');
 *   logger.log({ level: 'INFO', source: 'auth', message: 'User signed in', userId: '123' });
 */

const crypto = require('node:crypto');

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
  'credential',
]);
const DEFAULT_HARD_CAP = 15000;
const PASSTHROUGH_FIELDS = [
  'sessionTraceId',
  'requestTraceId',
  'userId',
  'deviceId',
  'context',
  'appVersion',
  'platform',
  'osVersion',
];

/**
 * Recursively remove sensitive keys from an object.
 * Returns a new object; never mutates the input.
 */
function sanitize(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    clean[key] = typeof value === 'object' ? sanitize(value) : value;
  }
  return clean;
}

/**
 * Create a logger bound to a Firestore db instance.
 */
function createLogger(db) {
  let dailyCount = 0;
  let hardCap = DEFAULT_HARD_CAP;
  let currentDay = new Date().toISOString().split('T')[0];
  let consecutiveFailures = 0;
  let circuitBreakerOpenedAt = 0;
  const CIRCUIT_BREAKER_THRESHOLD = 10;
  const CIRCUIT_BREAKER_COOLDOWN = 60000; // 60 seconds

  function resetIfNewDay() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== currentDay) {
      dailyCount = 0;
      currentDay = today;
    }
  }

  function shouldThrottle(level) {
    const ratio = dailyCount / hardCap;
    if (ratio >= 1) {
      return level !== 'ERROR' && level !== 'FATAL';
    }
    if (ratio >= 0.8) {
      return level === 'DEBUG' || level === 'INFO';
    }
    if (ratio >= 0.6) {
      return level === 'DEBUG';
    }
    return false;
  }

  function validateEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const { level, source, message } = entry;
    if (!level || !VALID_LEVELS.includes(level)) return null;
    if (!source || typeof source !== 'string') return null;
    if (!message || typeof message !== 'string') return null;
    return { level, source, message };
  }

  function isCircuitBreakerBlocking() {
    if (consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
    // Half-open: allow one probe write every 60s to check if Firestore recovered
    return Date.now() - circuitBreakerOpenedAt < CIRCUIT_BREAKER_COOLDOWN;
  }

  function buildLogDoc(entry, level, source, message) {
    const doc = {
      id: crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
    };
    for (const field of PASSTHROUGH_FIELDS) {
      if (entry[field] !== undefined) {
        doc[field] = field === 'context' ? sanitize(entry[field]) : entry[field];
      }
    }
    return doc;
  }

  function handleLogError(err) {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerOpenedAt = Date.now();
    }
    try {
      if (consecutiveFailures <= CIRCUIT_BREAKER_THRESHOLD) {
        // eslint-disable-next-line no-console
        console.error('[logger] Failed to write log:', err.message);
      } else if (consecutiveFailures === CIRCUIT_BREAKER_THRESHOLD + 1) {
        // eslint-disable-next-line no-console
        console.error(
          '[logger] Circuit breaker open — suppressing Firestore writes until next success',
        );
      }
    } catch {
      // Intentionally swallowed — error reporting must never itself throw to avoid infinite loops
    }
  }

  async function log(entry) {
    try {
      const validated = validateEntry(entry);
      if (!validated) return;
      const { level, source, message } = validated;

      resetIfNewDay();
      if (shouldThrottle(level)) return;
      if (isCircuitBreakerBlocking()) return;

      const doc = buildLogDoc(entry, level, source, message);
      dailyCount++;
      await db.collection('logs').doc(doc.id).set(doc);
      consecutiveFailures = 0;
    } catch (err) {
      handleLogError(err);
    }
  }

  function getDailyStats() {
    resetIfNewDay();
    return { count: dailyCount, hardCap };
  }

  // Test helpers
  function _resetDailyCount() {
    dailyCount = 0;
  }
  function _setDailyCount(n) {
    dailyCount = n;
  }
  function _setHardCap(n) {
    hardCap = n;
  }
  function _resetCircuitBreaker() {
    consecutiveFailures = 0;
    circuitBreakerOpenedAt = 0;
  }
  function _getConsecutiveFailures() {
    return consecutiveFailures;
  }

  return {
    log,
    getDailyStats,
    _resetDailyCount,
    _setDailyCount,
    _setHardCap,
    _resetCircuitBreaker,
    _getConsecutiveFailures,
  };
}

module.exports = { createLogger, sanitize, VALID_LEVELS };
