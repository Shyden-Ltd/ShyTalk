const cron = require('node-cron');
const log = require('../utils/log');

const archiveReports = require('./archiveReports');
const subscriptions = require('./subscriptions');
const staleRooms = require('./staleRooms');
const backpackCleanup = require('./backpackCleanup');
const backups = require('./backups');
const closedRooms = require('./closedRooms');
const orphanedStorage = require('./orphanedStorage');
const rotateLogs = require('./rotateLogs');
const expireBans = require('./expireBans');
const expireTempIds = require('./expireTempIds');
const serverHealth = require('./serverHealth');
const testDataCleanup = require('./testDataCleanup');
const alertManager = require('../utils/alertManagerInstance');

function startCronJobs() {
  const isProd = process.env.NODE_ENV === 'production';

  // Archive old reports — Sunday 03:00 UTC
  cron.schedule('0 3 * * 0', () => {
    log.info('cron', 'Running archiveReports');
    archiveReports().catch((err) =>
      log.error('cron', 'archiveReports failed', { error: err.message }),
    );
  });

  // Check expired subscriptions + clean expired backpack items + expire temp IDs — daily midnight UTC
  cron.schedule('0 0 * * *', () => {
    log.info('cron', 'Running subscriptions + backpackCleanup + expireTempIds');
    subscriptions().catch((err) =>
      log.error('cron', 'subscriptions failed', { error: err.message }),
    );
    backpackCleanup().catch((err) =>
      log.error('cron', 'backpackCleanup failed', { error: err.message }),
    );
    expireTempIds().catch((err) =>
      log.error('cron', 'expireTempIds failed', { error: err.message }),
    );
  });

  // Close stale OWNER_AWAY rooms — every 5 minutes (prod only, no real rooms on dev)
  if (isProd) {
    cron.schedule('*/5 * * * *', () => {
      staleRooms().catch((err) => log.error('cron', 'staleRooms failed', { error: err.message }));
    });
  }

  // Backup user profiles + cleanup old closed rooms — daily 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    log.info('cron', 'Running backups + closedRooms');
    backups().catch((err) => log.error('cron', 'backups failed', { error: err.message }));
    closedRooms().catch((err) => log.error('cron', 'closedRooms failed', { error: err.message }));
  });

  // Cleanup orphaned storage — daily 04:00 UTC
  cron.schedule('0 4 * * *', () => {
    log.info('cron', 'Running orphanedStorage');
    orphanedStorage().catch((err) =>
      log.error('cron', 'orphanedStorage failed', { error: err.message }),
    );
  });

  // Rotate logs — every hour on prod, once per day on dev (04:30 UTC)
  cron.schedule(isProd ? '0 * * * *' : '30 4 * * *', () => {
    log.info('cron', 'Running rotateLogs');
    rotateLogs().catch((err) => log.error('cron', 'rotateLogs failed', { error: err.message }));
  });

  // Expire bans — every 15 minutes (prod only, dev has no real bans)
  if (isProd) {
    cron.schedule('*/15 * * * *', () => {
      log.info('cron', 'Running expireBans');
      expireBans().catch((err) => log.error('cron', 'expireBans failed', { error: err.message }));
    });
  }

  // Server health check — every 5 minutes (prod only)
  if (isProd) {
    cron.schedule('*/5 * * * *', () => {
      serverHealth(alertManager).catch((err) =>
        log.error('cron', 'serverHealth failed', { error: err.message }),
      );
    });
  }

  // Test data cleanup — every 30 minutes (dev only)
  if (!isProd) {
    cron.schedule('*/30 * * * *', () => {
      log.info('cron', 'Running testDataCleanup');
      testDataCleanup().catch((err) =>
        log.error('cron', 'testDataCleanup failed', { error: err.message }),
      );
    });
  }

  log.info('cron', 'Cron jobs scheduled');
}

module.exports = { startCronJobs };
