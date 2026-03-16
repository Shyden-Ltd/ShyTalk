const mockLog = jest.fn();

jest.mock('../../src/utils/loggerInstance', () => ({
  log: mockLog,
}));

const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('log utility', () => {
  test('log.info calls logger with INFO level', () => {
    log.info('economy', 'Reward claimed', { userId: 'u1' });
    expect(mockLog).toHaveBeenCalledWith({
      level: 'INFO',
      source: 'economy',
      message: 'Reward claimed',
      context: { userId: 'u1' },
    });
  });

  test('log.error calls logger with ERROR level', () => {
    log.error('rooms', 'Failed to close', { roomId: 'r1' });
    expect(mockLog).toHaveBeenCalledWith({
      level: 'ERROR',
      source: 'rooms',
      message: 'Failed to close',
      context: { roomId: 'r1' },
    });
  });

  test('log.warn calls logger with WARN level', () => {
    log.warn('auth', 'Rate limited');
    expect(mockLog).toHaveBeenCalledWith({
      level: 'WARN',
      source: 'auth',
      message: 'Rate limited',
      context: undefined,
    });
  });

  test('log.debug calls logger with DEBUG level', () => {
    log.debug('test', 'Debug msg', { key: 'val' });
    expect(mockLog).toHaveBeenCalledWith({
      level: 'DEBUG',
      source: 'test',
      message: 'Debug msg',
      context: { key: 'val' },
    });
  });

  test('log.fatal calls logger with FATAL level', () => {
    log.fatal('system', 'Critical failure');
    expect(mockLog).toHaveBeenCalledWith({
      level: 'FATAL',
      source: 'system',
      message: 'Critical failure',
      context: undefined,
    });
  });

  test('never throws even if logger throws', () => {
    mockLog.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => log.info('test', 'msg')).not.toThrow();
  });
});
