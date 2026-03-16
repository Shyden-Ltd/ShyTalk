/**
 * Tests for src/utils/loggerInstance.js — singleton logger wrapper.
 *
 * This module requires firebase (db) and passes it to createLogger().
 * We mock the dependencies and verify it exports the correct interface.
 */

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        set: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

const logger = require('../../src/utils/loggerInstance');

describe('loggerInstance', () => {
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

  test('is a singleton (same reference on repeated require)', () => {
    const logger2 = require('../../src/utils/loggerInstance');
    expect(logger2).toBe(logger);
  });

  test('getDailyStats returns count and hardCap', () => {
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
});
