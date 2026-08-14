/**
 * index.unit.test.js — EPIC-0003 / SHY-0120 slice 5 (RECLASSIFY, not rewrite).
 *
 * `src/cron/index.js` is the cron REGISTRY: `startCronJobs()` reads NODE_ENV
 * (prod-guard) and calls `node-cron`'s `schedule(expr, callback)` to wire each
 * job. It exercises NO real collaborator — `node-cron` is an in-process
 * scheduler (you cannot "really" wait until 03:00 UTC for a job to fire), the
 * job modules each have their OWN real-emulator tests, and alertManager's real
 * behaviour belongs in alertManager's own test. The only thing under test here
 * is the WIRING: correct schedules, the dev prod-guard, callback delegation,
 * the error-`.catch` paths, and the age-verif catastrophic-alert path.
 *
 * There is no "real" version of a scheduler-wiring test, so per the EPIC-0003
 * boundary convention (CLAUDE.md "No Stubs" + scripts/check-no-new-stubs.js
 * isUnitTestLocation) this is a genuine UNIT test: it was moved from
 * tests/cron/index.test.js to the `*.unit.test.js` location where doubles are
 * permitted — NOT rewritten against the emulator (which is impossible for a
 * scheduler). Mocking node-cron + the job modules is the correct unit
 * isolation, not migration debt.
 */
// Mock node-cron
const mockSchedule = jest.fn();
jest.mock('node-cron', () => ({
  schedule: (...args) => mockSchedule(...args),
}));

// Mock log
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock alertManagerInstance — createAlert returns a Promise so the
// catastrophic-failure path on the age-verif reconcile cron can
// chain `.catch(...)` without blowing up.
jest.mock('../../src/utils/alertManagerInstance', () => ({
  send: jest.fn(),
  createAlert: jest.fn().mockResolvedValue(undefined),
}));

// Mock all cron job modules
jest.mock('../../src/cron/archiveReports', () => jest.fn());
jest.mock('../../src/cron/subscriptions', () => jest.fn());
jest.mock('../../src/cron/backpackCleanup', () => jest.fn());
jest.mock('../../src/cron/backups', () => jest.fn());
jest.mock('../../src/cron/closedRooms', () => jest.fn());
jest.mock('../../src/cron/orphanedStorage', () => jest.fn());
jest.mock('../../src/cron/rotateLogs', () => jest.fn());
jest.mock('../../src/cron/expireTempIds', () => jest.fn());
jest.mock('../../src/cron/expireDataExports', () => jest.fn());
jest.mock('../../src/cron/ageVerificationAuditReconcile', () => jest.fn());
const { startCronJobs } = require('../../src/cron/index');
const log = require('../../src/utils/log');

const archiveReports = require('../../src/cron/archiveReports');
const subscriptions = require('../../src/cron/subscriptions');
const backpackCleanup = require('../../src/cron/backpackCleanup');
const backups = require('../../src/cron/backups');
const closedRooms = require('../../src/cron/closedRooms');
const orphanedStorage = require('../../src/cron/orphanedStorage');
const rotateLogs = require('../../src/cron/rotateLogs');
const expireTempIds = require('../../src/cron/expireTempIds');
const expireDataExports = require('../../src/cron/expireDataExports');
const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');
beforeEach(() => {
  jest.clearAllMocks();
});

describe('startCronJobs', () => {
  describe('non-production (dev)', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('does not register any cron jobs in non-production', () => {
      startCronJobs();

      // All cron jobs are prod-only to avoid burning Firestore quota on dev
      expect(mockSchedule).not.toHaveBeenCalled();
    });

    test('logs that cron jobs are disabled', () => {
      startCronJobs();

      expect(log.info).toHaveBeenCalledWith(
        'cron',
        'Cron jobs disabled (non-production environment)',
      );
    });
  });

  describe('production', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('registers all prod cron jobs with correct schedules', () => {
      startCronJobs();

      const schedules = mockSchedule.mock.calls.map((call) => call[0]);

      // archiveReports — Sunday 03:00 UTC
      expect(schedules).toContain('0 3 * * 0');
      // subscriptions + backpackCleanup + expireTempIds — daily midnight
      expect(schedules).toContain('0 0 * * *');
      // staleRooms ELIMINATED — voice rooms now close event-driven via
      // the RTDB ownerLeft signal (PRs A0-A2), so the every-5-min
      // schedule must not exist in the node-cron list.
      expect(schedules).not.toContain('*/5 * * * *');
      // backups + closedRooms — daily 02:00 UTC
      expect(schedules).toContain('0 2 * * *');
      // orphanedStorage — daily 04:00 UTC
      expect(schedules).toContain('0 4 * * *');
      // rotateLogs — every hour
      expect(schedules).toContain('0 * * * *');
      // expireBans eliminated — checkBans filters expired bans inline
      // via Firestore OR query, so no sweep is needed.
      expect(schedules).not.toContain('*/15 * * * *');

      // Should NOT have dev-only jobs
      expect(schedules).not.toContain('*/30 * * * *'); // testDataCleanup

      // ageVerificationAuditReconcile — daily 05:00 UTC
      expect(schedules).toContain('0 5 * * *');

      // Total: 7 schedules in production. serverHealth → Better Stack
      // monitor; accountDeletion → GH Actions scheduled workflow;
      // expireBans + dispatchNotifications + staleRooms → eliminated
      // entirely (server-side filter in checkBans for the first,
      // inline fan-out via dispatchNotificationInline for the second,
      // RTDB ownerLeft signal for the third — see PRs A0-A4).
      expect(mockSchedule).toHaveBeenCalledTimes(7);
    });

    test('does not register testDataCleanup in production', () => {
      startCronJobs();

      const schedules = mockSchedule.mock.calls.map((call) => call[0]);
      expect(schedules).not.toContain('*/30 * * * *');
    });

    // staleRooms ELIMINATED — no node-cron schedule, no system endpoint,
    // no workflow. Voice rooms now close event-driven via the RTDB
    // `ownerLeft/{roomId}` signal (PRs A0-A4 of the cron-elim cluster).
    // The lazy-reap path in src/utils/stale-room-reap.js remains as
    // defense-in-depth on inRoomTransaction (PR #996).

    // expireBans is gone entirely — no node-cron schedule, no system
    // endpoint, no workflow. Ban expiry is enforced at query time via
    // the Firestore composite OR filter in routes/device-info.js
    // (`where(or(expiresAt == null, expiresAt > now))`), which returns
    // only currently-active bans. Tests for that path live in
    // tests/routes/device-info.test.js.

    test('rotateLogs uses hourly schedule in production', () => {
      rotateLogs.mockResolvedValue(undefined);
      startCronJobs();

      const rotateCall = mockSchedule.mock.calls.find((c) => c[0] === '0 * * * *');
      expect(rotateCall).toBeDefined();

      rotateCall[1]();
      expect(rotateLogs).toHaveBeenCalled();
    });

    test('logs that cron jobs are scheduled', () => {
      startCronJobs();
      expect(log.info).toHaveBeenCalledWith('cron', 'Cron jobs scheduled');
    });

    test('archiveReports callback invokes the job and catches errors', async () => {
      archiveReports.mockResolvedValue(undefined);
      startCronJobs();

      const archiveCall = mockSchedule.mock.calls.find((c) => c[0] === '0 3 * * 0');
      expect(archiveCall).toBeDefined();

      const callback = archiveCall[1];
      callback();

      expect(archiveReports).toHaveBeenCalled();
    });

    test('expireDataExports callback invokes the job', () => {
      expireDataExports.mockResolvedValue(undefined);
      startCronJobs();

      // The 0 4 * * * schedule is shared by orphanedStorage and
      // expireDataExports. Both schedules have separate callbacks, so
      // we look for the one specifically tied to expireDataExports by
      // matching the index after orphanedStorage's schedule.
      const fourAmCalls = mockSchedule.mock.calls.filter((c) => c[0] === '0 4 * * *');
      expect(fourAmCalls.length).toBe(2);

      // Invoke each callback at the 0 4 schedule; expireDataExports
      // should be hit by exactly one of them.
      fourAmCalls.forEach((c) => c[1]());

      expect(expireDataExports).toHaveBeenCalled();
    });

    // dispatchNotifications is gone entirely — no node-cron schedule,
    // no system endpoint, no workflow. Roadmap notifications now fan
    // out inline via dispatchNotificationInline (utils/notification-
    // channels.js), called from utils/roadmap-notify.js with
    // Promise.allSettled per subscriber. Tests for that path live in
    // tests/utils/roadmap-notify.test.js +
    // tests/utils/notification-channels.test.js.

    test('ageVerificationAuditReconcile callback invokes the job', () => {
      ageVerificationAuditReconcile.mockResolvedValue(undefined);
      startCronJobs();

      const fiveAmCall = mockSchedule.mock.calls.find((c) => c[0] === '0 5 * * *');
      expect(fiveAmCall).toBeDefined();

      fiveAmCall[1]();
      expect(ageVerificationAuditReconcile).toHaveBeenCalled();
    });

    test('archiveReports error is caught and logged', async () => {
      const error = new Error('archive failed');
      archiveReports.mockRejectedValue(error);
      startCronJobs();

      const archiveCall = mockSchedule.mock.calls.find((c) => c[0] === '0 3 * * 0');
      const callback = archiveCall[1];
      callback();

      await new Promise((r) => setTimeout(r, 10));

      expect(log.error).toHaveBeenCalledWith('cron', 'archiveReports failed', {
        error: 'archive failed',
      });
    });

    test('midnight callback invokes subscriptions, backpackCleanup, and expireTempIds', () => {
      subscriptions.mockResolvedValue(undefined);
      backpackCleanup.mockResolvedValue(undefined);
      expireTempIds.mockResolvedValue(undefined);
      startCronJobs();

      const midnightCall = mockSchedule.mock.calls.find((c) => c[0] === '0 0 * * *');
      expect(midnightCall).toBeDefined();

      midnightCall[1]();

      expect(subscriptions).toHaveBeenCalled();
      expect(backpackCleanup).toHaveBeenCalled();
      expect(expireTempIds).toHaveBeenCalled();
    });

    test('02:00 callback invokes backups and closedRooms', () => {
      backups.mockResolvedValue(undefined);
      closedRooms.mockResolvedValue(undefined);
      startCronJobs();

      const twoAmCall = mockSchedule.mock.calls.find((c) => c[0] === '0 2 * * *');
      expect(twoAmCall).toBeDefined();

      twoAmCall[1]();

      expect(backups).toHaveBeenCalled();
      expect(closedRooms).toHaveBeenCalled();
    });

    test('orphanedStorage callback invokes the job', () => {
      orphanedStorage.mockResolvedValue(undefined);
      startCronJobs();

      const orphanCall = mockSchedule.mock.calls.find((c) => c[0] === '0 4 * * *');
      expect(orphanCall).toBeDefined();

      orphanCall[1]();

      expect(orphanedStorage).toHaveBeenCalled();
    });

    test('subscriptions error is caught and logged', async () => {
      const error = new Error('sub error');
      subscriptions.mockRejectedValue(error);
      backpackCleanup.mockResolvedValue(undefined);
      expireTempIds.mockResolvedValue(undefined);
      startCronJobs();

      const midnightCall = mockSchedule.mock.calls.find((c) => c[0] === '0 0 * * *');
      midnightCall[1]();

      await new Promise((r) => setTimeout(r, 10));

      expect(log.error).toHaveBeenCalledWith('cron', 'subscriptions failed', {
        error: 'sub error',
      });
    });

    // staleRooms error-catch test removed — function ELIMINATED with
    // the entire cron path. Voice room closure is event-driven via the
    // RTDB ownerLeft signal (PRs A0-A4); no cron-side error path exists
    // to test on the closure path anymore.

    test('ageVerificationAuditReconcile callback invokes the job', async () => {
      const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');
      ageVerificationAuditReconcile.mockResolvedValue({ scanned: 0, reconciled: 0 });
      startCronJobs();

      const reconcileCall = mockSchedule.mock.calls.find((c) => c[0] === '0 5 * * *');
      expect(reconcileCall).toBeDefined();

      reconcileCall[1]();

      expect(ageVerificationAuditReconcile).toHaveBeenCalled();
    });

    test('ageVerificationAuditReconcile catastrophic crash logs AND fires a critical alert', async () => {
      const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');
      const alertManager = require('../../src/utils/alertManagerInstance');
      const error = new Error('Firestore unavailable');
      ageVerificationAuditReconcile.mockRejectedValue(error);
      startCronJobs();

      const reconcileCall = mockSchedule.mock.calls.find((c) => c[0] === '0 5 * * *');
      expect(reconcileCall).toBeDefined();

      reconcileCall[1]();

      // Wait for the .catch chain to settle (log.error then createAlert).
      await new Promise((r) => setTimeout(r, 10));

      expect(log.error).toHaveBeenCalledWith('cron', 'ageVerificationAuditReconcile failed', {
        error: 'Firestore unavailable',
      });
      // Critical alert MUST fire — compliance back-fill is OSA/GDPR
      // remediation; a multi-day gap can't rely on log-grep.
      expect(alertManager.createAlert).toHaveBeenCalledWith(
        'compliance_cron_failed',
        'critical',
        expect.stringMatching(/age-verification audit reconcile/i),
        expect.any(String),
        expect.objectContaining({
          error: 'Firestore unavailable',
          cron: 'ageVerificationAuditReconcile',
        }),
      );
    });

    test('ageVerificationAuditReconcile alert failure is logged but does not crash the cron', async () => {
      const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');
      const alertManager = require('../../src/utils/alertManagerInstance');
      ageVerificationAuditReconcile.mockRejectedValue(new Error('Firestore unavailable'));
      alertManager.createAlert.mockRejectedValueOnce(new Error('alert pipe down'));
      startCronJobs();

      const reconcileCall = mockSchedule.mock.calls.find((c) => c[0] === '0 5 * * *');
      reconcileCall[1]();

      await new Promise((r) => setTimeout(r, 10));

      expect(log.error).toHaveBeenCalledWith('cron', 'alertManager.createAlert failed', {
        error: 'alert pipe down',
      });
    });
  });
});
