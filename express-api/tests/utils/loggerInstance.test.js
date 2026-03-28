/**
 * Tests for src/utils/loggerInstance.js — singleton logger wrapper.
 *
 * In non-production (test env), this uses a console-only logger that never
 * touches Firestore. We verify it exports the same interface.
 */

// No firebase mock needed — non-production logger doesn't require firebase
const logger = require('../../src/utils/loggerInstance');

describe('loggerInstance (non-production / console-only)', () => {
  test('exports an object (not null or undefined)', () => {
    expect(logger).toBeDefined();
    expect(typeof logger).toBe('object');
  });

  test('exposes log method', () => {
    expect(typeof logger.log).toBe('function');
  });

  test('exposes getDailyStats method', () => {
    expect(typeof logger.getDailyStats).toBe('function');
  });

  test('exposes _resetDailyCount test helper', () => {
    expect(typeof logger._resetDailyCount).toBe('function');
  });

  test('exposes _setDailyCount test helper', () => {
    expect(typeof logger._setDailyCount).toBe('function');
  });

  test('exposes _setHardCap test helper', () => {
    expect(typeof logger._setHardCap).toBe('function');
  });

  test('exposes _resetCircuitBreaker test helper', () => {
    expect(typeof logger._resetCircuitBreaker).toBe('function');
  });

  test('exposes _getConsecutiveFailures test helper', () => {
    expect(typeof logger._getConsecutiveFailures).toBe('function');
  });

  test('is a singleton (same reference on repeated require)', () => {
    const logger2 = require('../../src/utils/loggerInstance');
    expect(logger2).toBe(logger);
  });

  test('getDailyStats returns count and hardCap', () => {
    logger._resetDailyCount();
    const stats = logger.getDailyStats();
    expect(stats).toMatchObject({
      count: expect.any(Number),
      hardCap: expect.any(Number),
    });
  });

  test('log method can be called without throwing', async () => {
    await expect(
      logger.log({ level: 'INFO', source: 'test', message: 'singleton test' }),
    ).resolves.toBeUndefined();
  });

  test('log increments daily count', async () => {
    logger._resetDailyCount();
    await logger.log({ level: 'INFO', source: 'test', message: 'one' });
    await logger.log({ level: 'INFO', source: 'test', message: 'two' });
    expect(logger.getDailyStats().count).toBe(2);
  });

  test('log skips non-object entries without incrementing count', async () => {
    logger._resetDailyCount();
    await logger.log(null);
    await logger.log('string');
    await logger.log(42);
    expect(logger.getDailyStats().count).toBe(0);
  });

  test('_getConsecutiveFailures always returns 0 (no Firestore to fail)', () => {
    expect(logger._getConsecutiveFailures()).toBe(0);
  });

  test('getDailyStats hardCap is Infinity on dev', () => {
    expect(logger.getDailyStats().hardCap).toBe(Infinity);
  });

  test('_setDailyCount sets the daily count to the given value (line 40)', () => {
    logger._resetDailyCount();
    expect(logger.getDailyStats().count).toBe(0);

    logger._setDailyCount(42);
    expect(logger.getDailyStats().count).toBe(42);

    logger._setDailyCount(0);
    expect(logger.getDailyStats().count).toBe(0);
  });

  test('_setDailyCount value persists across getDailyStats calls', () => {
    logger._setDailyCount(100);
    expect(logger.getDailyStats().count).toBe(100);
    expect(logger.getDailyStats().count).toBe(100); // stable
  });

  test('log increments count on top of _setDailyCount value', async () => {
    logger._setDailyCount(5);
    await logger.log({ level: 'INFO', source: 'test', message: 'bump' });
    expect(logger.getDailyStats().count).toBe(6);
  });

  describe('day rollover (lines 21-22)', () => {
    let realDate;

    beforeEach(() => {
      realDate = global.Date;
    });

    afterEach(() => {
      global.Date = realDate;
      logger._resetDailyCount();
    });

    test('resetIfNewDay resets counter when day changes', async () => {
      // Set up some count on "today"
      logger._resetDailyCount();
      await logger.log({ level: 'INFO', source: 'test', message: 'day1' });
      await logger.log({ level: 'INFO', source: 'test', message: 'day1b' });
      expect(logger.getDailyStats().count).toBe(2);

      // Mock Date to return tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowISO = tomorrow.toISOString().split('T')[0];

      const OriginalDate = global.Date;
      global.Date = class extends OriginalDate {
        constructor(...args) {
          if (args.length === 0) {
            super();
            this.setDate(this.getDate() + 1);
          } else {
            super(...args);
          }
        }

        toISOString() {
          // Return tomorrow's date
          return tomorrowISO + 'T00:00:00.000Z';
        }
      };
      global.Date.now = OriginalDate.now;

      // getDailyStats should reset counter because day changed
      const stats = logger.getDailyStats();
      expect(stats.count).toBe(0);
    });

    test('resetIfNewDay does NOT reset counter on same day', async () => {
      logger._resetDailyCount();
      await logger.log({ level: 'INFO', source: 'test', message: 'same day' });
      expect(logger.getDailyStats().count).toBe(1);

      // Call getDailyStats again (triggers resetIfNewDay) — same day, no reset
      expect(logger.getDailyStats().count).toBe(1);
    });
  });
});

describe('loggerInstance (production branch, lines 10-12)', () => {
  let prodLogger;

  beforeEach(() => {
    jest.resetModules();
  });

  test('production mode loads createLogger from logger module and passes db', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const mockDb = { collection: jest.fn() };
    const mockCreateLogger = jest.fn(() => ({
      log: jest.fn(),
      getDailyStats: jest.fn(),
    }));

    jest.doMock('../../src/utils/firebase', () => ({ db: mockDb }));
    jest.doMock('../../src/utils/logger', () => ({ createLogger: mockCreateLogger }));

    prodLogger = require('../../src/utils/loggerInstance');

    expect(mockCreateLogger).toHaveBeenCalledWith(mockDb);
    expect(prodLogger).toBeDefined();
    expect(typeof prodLogger.log).toBe('function');

    process.env.NODE_ENV = originalEnv;
  });

  test('production logger is the return value of createLogger(db)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const fakeProdLogger = {
      log: jest.fn(),
      getDailyStats: jest.fn(() => ({ count: 0, hardCap: 15000 })),
      _resetDailyCount: jest.fn(),
    };

    jest.doMock('../../src/utils/firebase', () => ({ db: {} }));
    jest.doMock('../../src/utils/logger', () => ({
      createLogger: jest.fn(() => fakeProdLogger),
    }));

    prodLogger = require('../../src/utils/loggerInstance');

    // Should be the exact object returned by createLogger
    expect(prodLogger).toBe(fakeProdLogger);

    process.env.NODE_ENV = originalEnv;
  });
});
