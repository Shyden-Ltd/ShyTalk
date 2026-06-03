/**
 * Server health metrics check — memory usage + PM2 restart detection.
 *
 * Originally a 5-min in-process cron; now invoked by the Better Stack
 * heartbeat endpoint at GET /api/system/health. The in-flight guard
 * below ensures concurrent heartbeat hits don't double-fire the PM2
 * check or race on `lastRestartCounts` (which would emit duplicate
 * alerts because alertManager has no dedup of its own).
 */

const { execFile } = require('node:child_process');
const os = require('node:os');
const log = require('../utils/log');

// Track last-known restart counts to only alert on NEW restarts. Now
// shared across HTTP-triggered invocations; the in-flight guard below
// keeps the read-then-write race window single-threaded.
const lastRestartCounts = {};

// Concurrent-invocation guard. Multiple Better Stack hits (or a future
// secondary monitor) firing during a slow `pm2 jlist` (10s timeout)
// would otherwise overlap, double-counting restarts and forking
// duplicate child processes. A boolean flag is enough — JavaScript's
// single-threaded model means the read+write in the guard is atomic.
let inFlight = false;

async function serverHealth(alertManager) {
  if (inFlight) {
    log.debug('server-health', 'check already in flight — skipping concurrent invocation');
    return;
  }
  inFlight = true;
  try {
    return await runHealthCheck(alertManager);
  } finally {
    inFlight = false;
  }
}

async function runHealthCheck(alertManager) {
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
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- PATH inherited from managed PM2 service account
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
