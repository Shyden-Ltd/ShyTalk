/**
 * Server health check cron — monitors memory usage and PM2 restarts.
 *
 * Runs every 5 minutes. Creates alerts when thresholds are exceeded.
 */

const { execFile } = require('node:child_process');
const os = require('node:os');
const log = require('../utils/log');

// Track last-known restart counts to only alert on NEW restarts
const lastRestartCounts = {};

async function serverHealth(alertManager) {
  // Check memory usage — RSS vs system total (not V8 heap ratio, which is
  // misleadingly high because V8 keeps heapTotal close to heapUsed)
  const mem = process.memoryUsage();
  const systemTotalBytes = os.totalmem();
  const rssPercent = (mem.rss / systemTotalBytes) * 100;
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const systemTotalMB = Math.round(systemTotalBytes / 1024 / 1024);

  const config = alertManager.getConfig();
  const memThreshold = config.serverMemoryWarningPercent || 30;

  if (rssPercent > memThreshold) {
    await alertManager.createAlert(
      'high_memory',
      'warning',
      'High server memory usage',
      `RSS at ${rssMB}MB / ${systemTotalMB}MB (${rssPercent.toFixed(1)}%, threshold: ${memThreshold}%)`,
      {
        rssMB,
        systemTotalMB,
        rssPercent: Math.round(rssPercent * 10) / 10,
      },
    );
  }

  // Check PM2 restart count — only alert on NEW restarts since last check
  if (config.pm2RestartAlert) {
    try {
      await new Promise((resolve) => {
        execFile('pm2', ['jlist'], { timeout: 10000 }, (err, stdout) => {
          // NOSONAR: PATH is inherited from the server process which runs under a managed service account
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
                alertManager
                  .createAlert(
                    'pm2_restart',
                    'warning',
                    `PM2 process restarted: ${name}`,
                    `${restarts - lastKnown} new restart(s) (total: ${restarts})`,
                    {
                      processName: name,
                      restartCount: restarts,
                      newRestarts: restarts - lastKnown,
                    },
                  )
                  .catch((alertErr) =>
                    log.error('server-health', 'Failed to create PM2 restart alert', {
                      error: alertErr.message,
                    }),
                  );
              }

              lastRestartCounts[name] = restarts;
            }
          } catch {
            // PM2 output parsing failed — logged as warning but non-fatal for health check
            log.warn('cron', 'serverHealth: failed to parse PM2 output');
          }
          resolve();
        });
      });
    } catch (pm2Err) {
      // PM2 binary unavailable or exec failed — log and continue health check
      log.warn('cron', 'serverHealth: PM2 check failed', { error: pm2Err.message });
    }
  }

  log.debug('cron', 'serverHealth: check completed', {
    rssMB,
    rssPercent: Math.round(rssPercent * 10) / 10,
  });
}

module.exports = serverHealth;
