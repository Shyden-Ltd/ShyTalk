/**
 * Logger singleton.
 *
 * In production, logs are written to Firestore via createLogger().
 * In non-production (dev/test), logs go to console only — no Firestore
 * writes — saving thousands of write ops per day on the free tier.
 */

if (process.env.NODE_ENV === 'production') {
  const { db } = require('./firebase');
  const { createLogger } = require('./logger');
  module.exports = createLogger(db);
} else {
  // Console-only logger with the same interface — zero Firestore writes
  let dailyCount = 0;
  let currentDay = new Date().toISOString().split('T')[0];

  function resetIfNewDay() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== currentDay) {
      dailyCount = 0;
      currentDay = today;
    }
  }

  module.exports = {
    async log(entry) {
      if (!entry || typeof entry !== 'object') return;
      resetIfNewDay();
      dailyCount++;
    },
    getDailyStats() {
      resetIfNewDay();
      return { count: dailyCount, hardCap: Infinity };
    },
    _resetDailyCount() {
      dailyCount = 0;
    },
    _setDailyCount(n) {
      dailyCount = n;
    },
    _setHardCap() {
      /* no-op on dev */
    },
    _resetCircuitBreaker() {
      /* no-op on dev */
    },
    _getConsecutiveFailures() {
      return 0;
    },
  };
}
