const { createLogger } = require('../../src/utils/logger');

/** Create a mock Firestore db with a spy on set(). */
function mockDb() {
  const setSpy = jest.fn().mockResolvedValue(undefined);
  const docSpy = jest.fn().mockReturnValue({ set: setSpy });
  const collectionSpy = jest.fn().mockReturnValue({ doc: docSpy });
  return { collection: collectionSpy, _spies: { collectionSpy, docSpy, setSpy } };
}

describe('logger', () => {
  let db, logger;

  beforeEach(() => {
    db = mockDb();
    logger = createLogger(db);
  });

  test('writes INFO log to Firestore with correct schema', async () => {
    await logger.log({ level: 'INFO', source: 'test', message: 'hello world' });

    const { collectionSpy, docSpy, setSpy } = db._spies;
    expect(collectionSpy).toHaveBeenCalledWith('logs');
    expect(docSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(1);

    const doc = setSpy.mock.calls[0][0];
    expect(doc.level).toBe('INFO');
    expect(doc.source).toBe('test');
    expect(doc.message).toBe('hello world');
    expect(doc.id).toMatch(/^[0-9a-f]{32}$/);
    expect(doc.timestamp).toBeDefined();
  });

  test('rejects invalid log level', async () => {
    await logger.log({ level: 'TRACE', source: 'test', message: 'nope' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();
  });

  test('rejects missing required fields — source', async () => {
    await logger.log({ level: 'INFO', message: 'no source' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();
  });

  test('rejects missing required fields — message', async () => {
    await logger.log({ level: 'INFO', source: 'test' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();
  });

  test('never throws when Firestore errors', async () => {
    db._spies.setSpy.mockRejectedValue(new Error('Firestore down'));
    // Should not throw
    await expect(
      logger.log({ level: 'ERROR', source: 'test', message: 'boom' }),
    ).resolves.toBeUndefined();
  });

  test('throttles at hard cap — only ERROR/FATAL allowed', async () => {
    logger._setHardCap(100);
    logger._setDailyCount(100);

    // INFO should be dropped
    await logger.log({ level: 'INFO', source: 'test', message: 'dropped' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();

    // WARN should be dropped
    await logger.log({ level: 'WARN', source: 'test', message: 'dropped' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();

    // ERROR should go through
    await logger.log({ level: 'ERROR', source: 'test', message: 'important' });
    expect(db._spies.setSpy).toHaveBeenCalledTimes(1);

    // FATAL should go through
    await logger.log({ level: 'FATAL', source: 'test', message: 'critical' });
    expect(db._spies.setSpy).toHaveBeenCalledTimes(2);
  });

  test('smart throttle drops DEBUG when approaching cap (60%+)', async () => {
    logger._setHardCap(100);
    logger._setDailyCount(60); // exactly 60%

    await logger.log({ level: 'DEBUG', source: 'test', message: 'dropped' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();

    // INFO should still go through at 60%
    await logger.log({ level: 'INFO', source: 'test', message: 'kept' });
    expect(db._spies.setSpy).toHaveBeenCalledTimes(1);
  });

  test('smart throttle drops INFO when approaching cap (80%+)', async () => {
    logger._setHardCap(100);
    logger._setDailyCount(80); // exactly 80%

    await logger.log({ level: 'DEBUG', source: 'test', message: 'dropped' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();

    await logger.log({ level: 'INFO', source: 'test', message: 'also dropped' });
    expect(db._spies.setSpy).not.toHaveBeenCalled();

    // WARN should still go through at 80%
    await logger.log({ level: 'WARN', source: 'test', message: 'kept' });
    expect(db._spies.setSpy).toHaveBeenCalledTimes(1);
  });

  test('sanitizes sensitive fields from context', async () => {
    await logger.log({
      level: 'INFO',
      source: 'auth',
      message: 'login',
      context: {
        username: 'alice',
        password: 'secret123',
        token: 'abc',
        nested: {
          idToken: 'xyz',
          accessToken: 'tok',
          refreshToken: 'ref',
          secret: 's',
          credential: 'cred',
          safeField: 'kept',
        },
      },
    });

    const doc = db._spies.setSpy.mock.calls[0][0];
    expect(doc.context.username).toBe('alice');
    expect(doc.context.password).toBeUndefined();
    expect(doc.context.token).toBeUndefined();
    expect(doc.context.nested.idToken).toBeUndefined();
    expect(doc.context.nested.accessToken).toBeUndefined();
    expect(doc.context.nested.refreshToken).toBeUndefined();
    expect(doc.context.nested.secret).toBeUndefined();
    expect(doc.context.nested.credential).toBeUndefined();
    expect(doc.context.nested.safeField).toBe('kept');
  });

  test('includes timestamp and id in log entry', async () => {
    await logger.log({ level: 'WARN', source: 'test', message: 'check fields' });

    const doc = db._spies.setSpy.mock.calls[0][0];
    expect(doc.id).toBeDefined();
    expect(typeof doc.id).toBe('string');
    expect(doc.id.length).toBe(32);
    expect(doc.timestamp).toBeDefined();
    // Timestamp should be a valid ISO string
    expect(new Date(doc.timestamp).toISOString()).toBe(doc.timestamp);
  });

  test('getDailyStats returns count and cap', async () => {
    const stats = logger.getDailyStats();
    expect(stats).toEqual({ count: 0, hardCap: 15000 });

    await logger.log({ level: 'INFO', source: 'test', message: 'one' });
    await logger.log({ level: 'INFO', source: 'test', message: 'two' });

    const updated = logger.getDailyStats();
    expect(updated).toEqual({ count: 2, hardCap: 15000 });

    logger._setHardCap(500);
    expect(logger.getDailyStats().hardCap).toBe(500);
  });
});
