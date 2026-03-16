const os = require('os');

// Must mock firebase before any require chain touches it
jest.mock('../../src/utils/firebase', () => ({
  db: {},
  admin: { firestore: () => ({}) },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const serverHealth = require('../../src/cron/serverHealth');

describe('serverHealth', () => {
  test('creates alert on high memory usage', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 50, // Low threshold to trigger
        pm2RestartAlert: false,
      }),
    };

    // Mock process.memoryUsage and os.totalmem for controlled RSS percentage
    const originalMemUsage = process.memoryUsage;
    const originalTotalMem = os.totalmem;
    process.memoryUsage = () => ({
      heapUsed: 900 * 1024 * 1024,
      heapTotal: 1000 * 1024 * 1024,
      rss: 1100 * 1024 * 1024, // 1100MB RSS
      external: 0,
      arrayBuffers: 0,
    });
    os.totalmem = () => 2000 * 1024 * 1024; // 2000MB total → 55% RSS usage

    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledWith(
      'high_memory',
      'warning',
      'High server memory usage',
      expect.stringContaining('55.0%'),
      expect.objectContaining({
        rssMB: 1100,
        systemTotalMB: 2000,
      }),
    );

    process.memoryUsage = originalMemUsage;
    os.totalmem = originalTotalMem;
  });

  test('does nothing when memory is normal', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 85,
        pm2RestartAlert: false,
      }),
    };

    // Mock low memory usage
    const originalMemUsage = process.memoryUsage;
    const originalTotalMem = os.totalmem;
    process.memoryUsage = () => ({
      heapUsed: 100 * 1024 * 1024,
      heapTotal: 500 * 1024 * 1024,
      rss: 200 * 1024 * 1024, // 200MB RSS
      external: 0,
      arrayBuffers: 0,
    });
    os.totalmem = () => 8000 * 1024 * 1024; // 8000MB total → 2.5% RSS usage

    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();

    process.memoryUsage = originalMemUsage;
    os.totalmem = originalTotalMem;
  });
});
