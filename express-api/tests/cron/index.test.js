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

// Mock alertManagerInstance
jest.mock('../../src/utils/alertManagerInstance', () => ({
  send: jest.fn(),
}));

// Mock all cron job modules
jest.mock('../../src/cron/archiveReports', () => jest.fn());
jest.mock('../../src/cron/subscriptions', () => jest.fn());
jest.mock('../../src/cron/staleRooms', () => jest.fn());
jest.mock('../../src/cron/backpackCleanup', () => jest.fn());
jest.mock('../../src/cron/backups', () => jest.fn());
jest.mock('../../src/cron/closedRooms', () => jest.fn());
jest.mock('../../src/cron/orphanedStorage', () => jest.fn());
jest.mock('../../src/cron/rotateLogs', () => jest.fn());
jest.mock('../../src/cron/expireBans', () => jest.fn());
jest.mock('../../src/cron/expireTempIds', () => jest.fn());
jest.mock('../../src/cron/serverHealth', () => jest.fn());
jest.mock('../../src/cron/testDataCleanup', () => jest.fn());

const { startCronJobs } = require('../../src/cron/index');
const log = require('../../src/utils/log');

const archiveReports = require('../../src/cron/archiveReports');
const subscriptions = require('../../src/cron/subscriptions');
const staleRooms = require('../../src/cron/staleRooms');
const backpackCleanup = require('../../src/cron/backpackCleanup');
const backups = require('../../src/cron/backups');
const closedRooms = require('../../src/cron/closedRooms');
const orphanedStorage = require('../../src/cron/orphanedStorage');
const rotateLogs = require('../../src/cron/rotateLogs');
const expireBans = require('../../src/cron/expireBans');
const expireTempIds = require('../../src/cron/expireTempIds');
const serverHealth = require('../../src/cron/serverHealth');
const testDataCleanup = require('../../src/cron/testDataCleanup');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startCronJobs', () => {
  test('registers all cron jobs with correct schedules in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    startCronJobs();

    const schedules = mockSchedule.mock.calls.map((call) => call[0]);

    // archiveReports — Sunday 03:00 UTC
    expect(schedules).toContain('0 3 * * 0');
    // subscriptions + backpackCleanup + expireTempIds — daily midnight
    expect(schedules).toContain('0 0 * * *');
    // staleRooms — every 5 minutes
    expect(schedules).toContain('*/5 * * * *');
    // backups + closedRooms — daily 02:00 UTC
    expect(schedules).toContain('0 2 * * *');
    // orphanedStorage — daily 04:00 UTC
    expect(schedules).toContain('0 4 * * *');
    // rotateLogs — every hour
    expect(schedules).toContain('0 * * * *');
    // expireBans — every 15 minutes
    expect(schedules).toContain('*/15 * * * *');
    // testDataCleanup — every 30 minutes (dev only)
    expect(schedules).toContain('*/30 * * * *');

    // Total: 9 schedules (staleRooms and serverHealth share */5, so count unique calls)
    expect(mockSchedule).toHaveBeenCalledTimes(9);

    process.env.NODE_ENV = originalEnv;
  });

  test('does not register testDataCleanup in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    startCronJobs();

    const schedules = mockSchedule.mock.calls.map((call) => call[0]);
    // testDataCleanup schedule should not be present as an extra
    // In production we should have 8 schedules instead of 9
    expect(mockSchedule).toHaveBeenCalledTimes(8);

    // The */30 schedule (testDataCleanup) should NOT be present
    expect(schedules).not.toContain('*/30 * * * *');

    process.env.NODE_ENV = originalEnv;
  });

  test('logs that cron jobs are scheduled', () => {
    startCronJobs();
    expect(log.info).toHaveBeenCalledWith('cron', 'Cron jobs scheduled');
  });

  test('archiveReports callback invokes the job and catches errors', async () => {
    archiveReports.mockResolvedValue(undefined);
    startCronJobs();

    // Find the archiveReports schedule callback (schedule '0 3 * * 0')
    const archiveCall = mockSchedule.mock.calls.find((c) => c[0] === '0 3 * * 0');
    expect(archiveCall).toBeDefined();

    const callback = archiveCall[1];
    callback();

    expect(archiveReports).toHaveBeenCalled();
  });

  test('archiveReports error is caught and logged', async () => {
    const error = new Error('archive failed');
    archiveReports.mockRejectedValue(error);
    startCronJobs();

    const archiveCall = mockSchedule.mock.calls.find((c) => c[0] === '0 3 * * 0');
    const callback = archiveCall[1];
    callback();

    // Wait for the promise rejection to be caught
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

  test('staleRooms callback invokes the job', () => {
    staleRooms.mockResolvedValue(undefined);
    startCronJobs();

    // */5 is used by both staleRooms and serverHealth — staleRooms is first
    const fiveMinCalls = mockSchedule.mock.calls.filter((c) => c[0] === '*/5 * * * *');
    expect(fiveMinCalls.length).toBe(2);

    fiveMinCalls[0][1]();
    expect(staleRooms).toHaveBeenCalled();
  });

  test('orphanedStorage callback invokes the job', () => {
    orphanedStorage.mockResolvedValue(undefined);
    startCronJobs();

    const orphanCall = mockSchedule.mock.calls.find((c) => c[0] === '0 4 * * *');
    expect(orphanCall).toBeDefined();

    orphanCall[1]();

    expect(orphanedStorage).toHaveBeenCalled();
  });

  test('rotateLogs callback invokes the job', () => {
    rotateLogs.mockResolvedValue(undefined);
    startCronJobs();

    const rotateCall = mockSchedule.mock.calls.find((c) => c[0] === '0 * * * *');
    expect(rotateCall).toBeDefined();

    rotateCall[1]();

    expect(rotateLogs).toHaveBeenCalled();
  });

  test('expireBans callback invokes the job', () => {
    expireBans.mockResolvedValue(undefined);
    startCronJobs();

    const expireCall = mockSchedule.mock.calls.find((c) => c[0] === '*/15 * * * *');
    expect(expireCall).toBeDefined();

    expireCall[1]();

    expect(expireBans).toHaveBeenCalled();
  });

  test('serverHealth callback invokes the job with alertManager', () => {
    serverHealth.mockResolvedValue(undefined);
    startCronJobs();

    const fiveMinCalls = mockSchedule.mock.calls.filter((c) => c[0] === '*/5 * * * *');
    // serverHealth is the second */5 schedule
    fiveMinCalls[1][1]();

    expect(serverHealth).toHaveBeenCalled();
    // Verify alertManager is passed as argument
    const alertManager = require('../../src/utils/alertManagerInstance');
    expect(serverHealth).toHaveBeenCalledWith(alertManager);
  });

  test('testDataCleanup callback invokes the job in dev', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    testDataCleanup.mockResolvedValue(undefined);

    startCronJobs();

    const cleanupCall = mockSchedule.mock.calls.find((c) => c[0] === '*/30 * * * *');
    expect(cleanupCall).toBeDefined();

    cleanupCall[1]();

    expect(testDataCleanup).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
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

  test('staleRooms error is caught and logged', async () => {
    const error = new Error('stale error');
    staleRooms.mockRejectedValue(error);
    startCronJobs();

    const fiveMinCalls = mockSchedule.mock.calls.filter((c) => c[0] === '*/5 * * * *');
    fiveMinCalls[0][1]();

    await new Promise((r) => setTimeout(r, 10));

    expect(log.error).toHaveBeenCalledWith('cron', 'staleRooms failed', {
      error: 'stale error',
    });
  });
});
