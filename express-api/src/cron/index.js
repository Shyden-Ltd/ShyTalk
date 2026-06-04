const cron = require('node-cron');
const log = require('../utils/log');

const archiveReports = require('./archiveReports');
const subscriptions = require('./subscriptions');
const backpackCleanup = require('./backpackCleanup');
const backups = require('./backups');
const closedRooms = require('./closedRooms');
const orphanedStorage = require('./orphanedStorage');
const rotateLogs = require('./rotateLogs');
const expireTempIds = require('./expireTempIds');
// staleRooms moved to .github/workflows/cron-stale-rooms.yml — function
// kept in src/cron/staleRooms.js, invoked via POST /api/system/sweep-stale-rooms.
const expireDataExports = require('./expireDataExports');
const alertManager = require('../utils/alertManagerInstance');
const ageVerificationAuditReconcile = require('./ageVerificationAuditReconcile');

function startCronJobs() {
  const isProd = process.env.NODE_ENV === 'production';

  // All cron jobs are prod-only. Dev testing happens against local emulators
  // which have no quota limits, so cron cleanup is unnecessary. Running cron
  // on dev was burning ~4k Firestore deletes/day for no benefit.
  if (!isProd) {
    log.info('cron', 'Cron jobs disabled (non-production environment)');
    return;
  }

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

  // staleRooms migrated to GitHub Actions scheduled workflow
  // (.github/workflows/cron-stale-rooms.yml) which POSTs to
  // /api/system/sweep-stale-rooms every 5 minutes. The function itself
  // still lives in src/cron/staleRooms.js — only the schedule moved
  // out of the in-process node-cron list. Voice-room presence-based
  // event-driven design (RTDB onDisconnect, multi-platform client
  // changes) deferred to a follow-up where operator can validate the
  // presence semantics interactively.

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

  // Rotate logs — every hour
  cron.schedule('0 * * * *', () => {
    log.info('cron', 'Running rotateLogs');
    rotateLogs().catch((err) => log.error('cron', 'rotateLogs failed', { error: err.message }));
  });

  // accountDeletion migrated to a GitHub Actions scheduled workflow:
  //   - .github/workflows/cron-account-deletion.yml      0 3 * * *
  // POSTs to /api/system/sweep-account-deletions; the underlying
  // function lives in src/cron/accountDeletion.js.
  //
  // expireBans ELIMINATED — ban expiry is enforced at query time in
  // routes/device-info.js via a Firestore Filter.or() that returns
  // only currently-active bans (expiresAt == null OR > now). No sweep,
  // no GH Actions workflow, no system endpoint needed.

  // Expire data exports — daily 04:00 UTC
  cron.schedule('0 4 * * *', () => {
    log.info('cron', 'Running expireDataExports');
    expireDataExports().catch((err) =>
      log.error('cron', 'expireDataExports failed', { error: err.message }),
    );
  });

  // dispatchNotifications ELIMINATED — roadmap notifications now
  // fan out INLINE via `dispatchNotificationInline` in
  // utils/notification-channels.js, called from utils/roadmap-notify.js
  // with Promise.allSettled per subscriber. Fire-and-forget at the
  // route layer (suggestions.js routes use `.catch(...)`), so the
  // admin HTTP response returns immediately. No queue, no cron, no
  // workflow, no system endpoint.

  // Age-verification audit-log reconciliation — daily 05:00 UTC.
  // Back-fills missing audit entries for decisions whose post-commit
  // audit write failed (compliance gap fix). 7-day scan window so a
  // multi-day Firestore outage is fully covered. Idempotent on
  // re-runs via `details.fromSubmissionId` markers.
  //
  // Per-doc failures are isolated inside the job (see `failed`
  // counter); only a catastrophic crash (Firestore unreachable,
  // permission revoked, code bug) reaches this `.catch`. That kind
  // of failure leaves the OSA/GDPR remediation gap unresolved for
  // 24+ h, so route it through alertManager instead of relying on
  // log-grep.
  cron.schedule('0 5 * * *', () => {
    log.info('cron', 'Running ageVerificationAuditReconcile');
    ageVerificationAuditReconcile().catch((err) => {
      log.error('cron', 'ageVerificationAuditReconcile failed', { error: err.message });
      alertManager
        .createAlert(
          'compliance_cron_failed',
          'critical',
          'Age-verification audit reconcile cron crashed',
          'Daily back-fill of missing age-verification audit-log entries did not complete. OSA/GDPR remediation paused until the next successful run. Investigate immediately.',
          { error: err.message, cron: 'ageVerificationAuditReconcile' },
        )
        .catch((alertErr) =>
          log.error('cron', 'alertManager.createAlert failed', { error: alertErr.message }),
        );
    });
  });

  log.info('cron', 'Cron jobs scheduled');
}

module.exports = { startCronJobs };
