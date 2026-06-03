/**
 * System endpoints for external schedulers + health monitoring.
 *
 * GET  /api/system/health            — public (rate-limited), Better Stack heartbeat.
 *                                      Returns 200 immediately, async-fires
 *                                      the serverHealth() metrics check
 *                                      (memory + PM2 restart detection).
 *
 * Future endpoints (added per cron-cluster migration):
 * POST /api/system/sweep-account-deletions  — requires bearer
 * POST /api/system/sweep-bans               — requires bearer
 * POST /api/system/dispatch-notifications   — requires bearer
 *
 * Architecture: replaces what was an in-process node-cron every-5-min
 * schedule for serverHealth with an externally-triggered ping. Better
 * Stack's free-tier 3-min interval is faster than the previous 5-min
 * cron AND provides external uptime detection that an internal cron
 * can't (a hung Node process can't alert about itself).
 *
 * The handler returns 200 BEFORE invoking the metrics check so a slow
 * `pm2 jlist` call (10-sec timeout) doesn't cause Better Stack to mark
 * the monitor down on a healthy server.
 */

const router = require('express').Router();
const log = require('../utils/log');
const serverHealth = require('../cron/serverHealth');
const alertManager = require('../utils/alertManagerInstance');

router.get('/system/health', (req, res) => {
  // Respond immediately so the external monitor sees a fast 200. The
  // metrics check (memory threshold + PM2 restart detection) runs
  // fire-and-forget — a failure there is logged but doesn't affect
  // the heartbeat response.
  res.json({ status: 'ok' });

  serverHealth(alertManager).catch((err) => {
    log.error('system', 'serverHealth metrics check failed', { error: err.message });
  });
});

module.exports = router;
