/**
 * Server health check cron — monitors memory usage and PM2 restarts.
 *
 * Runs every 5 minutes. Creates alerts when thresholds are exceeded.
 */

const { execFile } = require('child_process');
const log = require('../utils/log');

// Track last-known restart counts to only alert on NEW restarts
const lastRestartCounts = {};

async function serverHealth(alertManager) {
  // Check memory usage
  const mem = process.memoryUsage();
  const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

  const config = alertManager.getConfig();
  const memThreshold = config.serverMemoryWarningPercent || 85;

  if (heapPercent > memThreshold) {
    await alertManager.createAlert(
      'high_memory',
      'warning',
      'High server memory usage',
      `Heap usage at ${heapPercent.toFixed(1)}% (threshold: ${memThreshold}%)`,
      {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        heapPercent: Math.round(heapPercent * 10) / 10,
      }
    );
  }

  // Check PM2 restart count — only alert on NEW restarts since last check
  if (config.pm2RestartAlert) {
    try {
      await new Promise((resolve) => {
        execFile('pm2', ['jlist'], { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout) {
            resolve();
            return;
          }
          try {
            const processes = JSON.parse(stdout);
            for (const proc of processes) {
              if (!proc.pm2_env) continue;
              const name = proc.name;
              const restarts = proc.pm2_env.restart_time || 0;
              const lastKnown = lastRestartCounts[name] || 0;

              if (restarts > lastKnown && lastKnown > 0) {
                alertManager.createAlert(
                  'pm2_restart',
                  'warning',
                  `PM2 process restarted: ${name}`,
                  `${restarts - lastKnown} new restart(s) (total: ${restarts})`,
                  { processName: name, restartCount: restarts, newRestarts: restarts - lastKnown }
                ).catch(err => log.error('server-health', 'Failed to create PM2 restart alert', { error: err.message }));
              }

              lastRestartCounts[name] = restarts;
            }
          } catch (_parseErr) {
            log.warn('cron', 'serverHealth: failed to parse PM2 output');
          }
          resolve();
        });
      });
    } catch (_pm2Err) {
      log.warn('cron', 'serverHealth: PM2 check failed', { error: _pm2Err.message });
    }
  }

  log.debug('cron', 'serverHealth: check completed', { heapPercent: Math.round(heapPercent * 10) / 10 });
}

module.exports = serverHealth;
