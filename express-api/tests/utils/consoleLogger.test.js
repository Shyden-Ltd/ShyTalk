/* eslint-disable no-console */
const mockLog = jest.fn();

jest.mock('../../src/utils/loggerInstance', () => ({
  log: mockLog,
}));

// Save originals before patching
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const { patchConsole } = require('../../src/utils/consoleLogger');

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  // Restore originals
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
});

describe('patchConsole', () => {
  beforeAll(() => {
    patchConsole();
  });

  test('console.error sends ERROR level to logger', () => {
    console.error('Something failed:', 'details');
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'ERROR',
        source: 'express-api',
        message: expect.stringContaining('Something failed:'),
      }),
    );
  });

  test('console.log sends INFO level to logger', () => {
    console.log('[CRON] archiveReports');
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        source: 'cron',
        message: expect.stringContaining('[CRON] archiveReports'),
      }),
    );
  });

  test('console.warn sends WARN level to logger', () => {
    console.warn('Warning message');
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        source: 'express-api',
      }),
    );
  });

  test('detects AUTO-BAN source', () => {
    console.log('[AUTO-BAN] User u1: 2 device bans');
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'admin',
      }),
    );
  });

  test('never throws even if logger fails', () => {
    mockLog.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => console.error('test')).not.toThrow();
  });

  test('truncates long messages to 2000 chars', () => {
    const longMsg = 'x'.repeat(3000);
    console.log(longMsg);
    const call = mockLog.mock.calls[mockLog.mock.calls.length - 1][0];
    expect(call.message.length).toBe(2000);
  });
});
