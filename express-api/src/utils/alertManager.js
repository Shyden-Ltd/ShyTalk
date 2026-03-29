/**
 * Alert manager — creates alerts, tracks error spikes, and sends FCM notifications.
 *
 * Usage:
 *   const alertManager = require('./alertManagerInstance');
 *   alertManager.createAlert('error_spike', 'critical', 'Error spike on /api/users', '15 errors in 5 min', { route: '/api/users' });
 *   alertManager.trackError('/api/users');
 *   alertManager.trackSlowEndpoint('/api/rooms', 5200);
 */

const crypto = require('node:crypto');

const DEFAULT_ALERT_CONFIG = {
  errorSpikeThreshold: 10,
  errorSpikeWindowMinutes: 5,
  slowEndpointThresholdMs: 3000,
  cronFailureAlert: true,
  crashReportAlert: true,
  firestoreQuotaWarningPercent: 80,
  serverMemoryWarningPercent: 85,
  pm2RestartAlert: true,
  fcmRecipientUserIds: [],
};

const CONFIG_CACHE_TTL = 60 * 1000; // 60 seconds

function createAlertManager(db, messaging) {
  // In-memory error tracking: route -> timestamp[]
  const errorWindows = new Map();
  // Deduplication: route -> last alert timestamp
  const errorAlertDedup = new Map();
  const slowAlertDedup = new Map();

  // Config cache
  let cachedConfig = null;
  let configLoadedAt = 0;

  async function loadConfig() {
    const now = Date.now();
    if (cachedConfig && now - configLoadedAt < CONFIG_CACHE_TTL) {
      return cachedConfig;
    }
    try {
      const snap = await db.collection('alertConfig').doc('settings').get();
      if (snap.exists) {
        cachedConfig = { ...DEFAULT_ALERT_CONFIG, ...snap.data() };
      } else {
        cachedConfig = { ...DEFAULT_ALERT_CONFIG };
      }
      configLoadedAt = now;
    } catch {
      // Firestore unavailable — fall back to cached config or defaults
      if (!cachedConfig) cachedConfig = { ...DEFAULT_ALERT_CONFIG };
    }
    return cachedConfig;
  }

  async function createAlert(type, severity, title, message, context = {}) {
    try {
      const id = crypto.randomBytes(16).toString('hex');
      const alertDoc = {
        id,
        type,
        severity,
        title,
        message,
        context,
        createdAt: new Date().toISOString(),
        status: 'unresolved',
        acknowledgedBy: null,
        resolvedBy: null,
        resolvedAt: null,
      };

      await db.collection('alerts').doc(id).set(alertDoc);

      // Send FCM notifications to admin users
      const config = await loadConfig();
      const recipientIds = config.fcmRecipientUserIds || [];

      for (const userId of recipientIds) {
        try {
          const userSnap = await db.collection('users').doc(userId).get();
          if (!userSnap.exists) continue;
          const userData = userSnap.data();

          const tokens = [];
          if (Array.isArray(userData.fcmTokens)) {
            tokens.push(...userData.fcmTokens);
          } else if (typeof userData.fcmToken === 'string' && userData.fcmToken) {
            tokens.push(userData.fcmToken);
          }

          for (const token of tokens) {
            try {
              await messaging.send({
                notification: { title, body: message },
                token,
              });
            } catch {
              // Intentionally swallowed — FCM delivery is best-effort, must never disrupt alerting
            }
          }
        } catch {
          // Intentionally swallowed — user lookup failure must not prevent other recipients from being notified
        }
      }
    } catch {
      // Intentionally swallowed — alert creation must never throw to avoid masking the original error
    }
  }

  async function trackError(route) {
    try {
      const now = Date.now();
      const config = await loadConfig();
      const windowMs = (config.errorSpikeWindowMinutes || 5) * 60 * 1000;
      const threshold = config.errorSpikeThreshold || 10;

      // Add timestamp to rolling window
      if (!errorWindows.has(route)) {
        errorWindows.set(route, []);
      }
      const timestamps = errorWindows.get(route);
      timestamps.push(now);

      // Prune old entries
      const cutoff = now - windowMs;
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }

      // Check threshold
      if (timestamps.length >= threshold) {
        // Deduplicate: don't re-alert for same route within window
        const lastAlert = errorAlertDedup.get(route) || 0;
        if (now - lastAlert > windowMs) {
          errorAlertDedup.set(route, now);
          await createAlert(
            'error_spike',
            'critical',
            `Error spike on ${route}`,
            `${timestamps.length} errors in ${config.errorSpikeWindowMinutes} minutes`,
            { route, errorCount: timestamps.length },
          );
        }
      }
    } catch {
      // Intentionally swallowed — error tracking must never throw to avoid recursive error loops
    }
  }

  async function trackSlowEndpoint(route, durationMs) {
    try {
      const config = await loadConfig();
      const threshold = config.slowEndpointThresholdMs || 3000;

      if (durationMs <= threshold) return;

      const now = Date.now();
      const DEDUP_WINDOW = 5 * 60 * 1000; // 5 minutes

      const lastAlert = slowAlertDedup.get(route) || 0;
      if (now - lastAlert <= DEDUP_WINDOW) return;

      slowAlertDedup.set(route, now);
      await createAlert(
        'slow_endpoint',
        'warning',
        `Slow endpoint: ${route}`,
        `Response took ${durationMs}ms (threshold: ${threshold}ms)`,
        { route, durationMs, thresholdMs: threshold },
      );
    } catch {
      // Intentionally swallowed — slow endpoint tracking must never throw to avoid disrupting request flow
    }
  }

  function getConfig() {
    return cachedConfig || { ...DEFAULT_ALERT_CONFIG };
  }

  // Test helpers
  function _clearState() {
    errorWindows.clear();
    errorAlertDedup.clear();
    slowAlertDedup.clear();
    cachedConfig = null;
    configLoadedAt = 0;
  }

  return {
    createAlert,
    trackError,
    trackSlowEndpoint,
    getConfig,
    _clearState,
  };
}

module.exports = { createAlertManager, DEFAULT_ALERT_CONFIG };
