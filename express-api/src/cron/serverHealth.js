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

/**
 * Pure restart-delta detection (extracted SHY-0120 slice 6, EPIC-0003).
 *
 * Given a parsed `pm2 jlist` array and the last-known restart counts (MUTATED
 * in place to the new counts), return the processes that have NEW restarts
 * since the last check. A process is flagged only when its count INCREASED
 * from a previously-seen positive baseline (`lastKnown > 0`) — the first
 * sighting just records the baseline, so a fresh server start never alerts.
 * Processes without a `pm2_env` are skipped (and NOT recorded), matching the
 * original inline behaviour exactly. No real collaborator → unit-tested with
 * real data arrays; the `execFile` boundary is exercised live in the
 * integration test (a real `pm2` restart between runs is not CI-inducible).
 *
 * @returns {Array<{name: string, newRestarts: number, total: number}>}
 */
function detectPm2Restarts(processes, lastCounts) {
  const restarted = [];
  for (const proc of processes) {
    if (!proc.pm2_env) continue;
    const name = proc.name;
    const restarts = proc.pm2_env.restart_time || 0;
    const lastKnown = lastCounts[name] || 0;

    if (restarts > lastKnown && lastKnown > 0) {
      restarted.push({ name, newRestarts: restarts - lastKnown, total: restarts });
    }

    lastCounts[name] = restarts;
  }
  return restarted;
}

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
            for (const { name, newRestarts, total } of detectPm2Restarts(
              processes,
              lastRestartCounts,
            )) {
              alertManager
                .createAlert(
                  'pm2_restart',
                  'warning',
                  `PM2 process restarted: ${name}`,
                  `${newRestarts} new restart(s) (total: ${total})`,
                  {
                    processName: name,
                    restartCount: total,
                    newRestarts,
                  },
                )
                .catch((alertErr) =>
                  log.error('server-health', 'Failed to create PM2 restart alert', {
                    error: alertErr.message,
                  }),
                );
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
// Exported for unit-test access — the pure restart-delta logic is tested with
// real data arrays (no execFile mock); see tests/cron/serverHealth.unit.test.js.
module.exports.detectPm2Restarts = detectPm2Restarts;
