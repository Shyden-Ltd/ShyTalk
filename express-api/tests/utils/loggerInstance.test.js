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
});
