const os = require('os');
const { execFile } = require('child_process');

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

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const serverHealth = require('../../src/cron/serverHealth');
const log = require('../../src/utils/log');

// Store originals for memory mocking
let originalMemUsage;
let originalTotalMem;

beforeEach(() => {
  jest.clearAllMocks();
  originalMemUsage = process.memoryUsage;
  originalTotalMem = os.totalmem;
});

afterEach(() => {
  process.memoryUsage = originalMemUsage;
  os.totalmem = originalTotalMem;
});

function mockMemory(rssMB, systemTotalMB) {
  process.memoryUsage = () => ({
    heapUsed: 100 * 1024 * 1024,
    heapTotal: 500 * 1024 * 1024,
    rss: rssMB * 1024 * 1024,
    external: 0,
    arrayBuffers: 0,
  });
  os.totalmem = () => systemTotalMB * 1024 * 1024;
}

describe('serverHealth', () => {
  // --- Memory checks ---

  test('creates alert on high memory usage', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 50,
        pm2RestartAlert: false,
      }),
    };

    mockMemory(1100, 2000); // 55% RSS usage

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

    mockMemory(200, 8000); // 2.5% RSS usage

    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();
  });

  test('uses default threshold of 30% when config is missing', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        pm2RestartAlert: false,
      }),
    };

    mockMemory(500, 1000); // 50% > 30% default

    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledWith(
      'high_memory',
      'warning',
      'High server memory usage',
      expect.stringContaining('threshold: 30%'),
      expect.any(Object),
    );
  });

  test('does not alert when memory is exactly at threshold', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 50,
        pm2RestartAlert: false,
      }),
    };

    mockMemory(500, 1000); // Exactly 50%, not above

    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();
  });

  test('includes rssMB and systemTotalMB in alert details', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 10,
        pm2RestartAlert: false,
      }),
    };

    mockMemory(300, 1024); // ~29.3%

    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalledWith(
      'high_memory',
      'warning',
      'High server memory usage',
      expect.stringContaining('300MB'),
      expect.objectContaining({
        rssMB: 300,
        systemTotalMB: 1024,
        rssPercent: expect.any(Number),
      }),
    );
  });

  test('logs debug after check completes', async () => {
    const mockManager = {
      createAlert: jest.fn().mockResolvedValue(undefined),
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: false,
      }),
    };

    mockMemory(100, 8000);

    await serverHealth(mockManager);

    expect(log.debug).toHaveBeenCalledWith(
      'cron',
      'serverHealth: check completed',
      expect.objectContaining({
        rssMB: 100,
        rssPercent: expect.any(Number),
      }),
    );
  });

  // --- PM2 restart checks (lines 41-88) ---

  test('skips PM2 check when pm2RestartAlert is false', async () => {
    const mockManager = {
      createAlert: jest.fn().mockResolvedValue(undefined),
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: false,
      }),
    };

    mockMemory(100, 8000);

    await serverHealth(mockManager);

    expect(execFile).not.toHaveBeenCalled();
  });

  test('runs PM2 check when pm2RestartAlert is true', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // Mock execFile to call the callback with valid JSON
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          {
            name: 'shytalk-api',
            pm2_env: { restart_time: 0 },
          },
        ]),
      );
    });

    await serverHealth(mockManager);

    expect(execFile).toHaveBeenCalledWith(
      'pm2',
      ['jlist'],
      { timeout: 10000 },
      expect.any(Function),
    );
  });

  test('creates alert on new PM2 restarts (not first run)', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // First run: establish baseline (restart_time = 3)
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          {
            name: 'shytalk-api',
            pm2_env: { restart_time: 3 },
          },
        ]),
      );
    });

    await serverHealth(mockManager);

    // First run should NOT create an alert (lastKnown was 0, needs > 0)
    // Actually it should: restarts (3) > lastKnown (0) AND lastKnown > 0 is false
    // So first run just sets the baseline
    expect(createAlert).not.toHaveBeenCalled();

    // Second run: restart_time increased from 3 to 5
    jest.clearAllMocks();
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          {
            name: 'shytalk-api',
            pm2_env: { restart_time: 5 },
          },
        ]),
      );
    });

    await serverHealth(mockManager);

    // Now lastKnown is 3, restarts is 5 -> 2 new restarts -> should alert
    expect(createAlert).toHaveBeenCalledWith(
      'pm2_restart',
      'warning',
      'PM2 process restarted: shytalk-api',
      '2 new restart(s) (total: 5)',
      expect.objectContaining({
        processName: 'shytalk-api',
        restartCount: 5,
        newRestarts: 2,
      }),
    );
  });

  test('does not alert when PM2 restart count has not changed', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // First run: baseline
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 2 } }]));
    });
    await serverHealth(mockManager);

    // Second run: same restart count
    jest.clearAllMocks();
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 2 } }]));
    });
    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles execFile error gracefully', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('pm2 not found'), null);
    });

    // Should not throw
    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles empty stdout from execFile', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '');
    });

    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles invalid JSON from PM2', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, 'not valid json{{{');
    });

    await serverHealth(mockManager);

    expect(log.warn).toHaveBeenCalledWith('cron', 'serverHealth: failed to parse PM2 output');
    expect(createAlert).not.toHaveBeenCalled();
  });

  test('skips processes without pm2_env', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          { name: 'proc-no-env' }, // No pm2_env
          { name: 'proc-with-env', pm2_env: { restart_time: 0 } },
        ]),
      );
    });

    await serverHealth(mockManager);

    // No crash, no alert
    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles multiple PM2 processes independently', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // First run: establish baselines
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          { name: 'api-prod', pm2_env: { restart_time: 5 } },
          { name: 'api-dev', pm2_env: { restart_time: 2 } },
        ]),
      );
    });
    await serverHealth(mockManager);

    // Second run: only one process restarted
    jest.clearAllMocks();
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        null,
        JSON.stringify([
          { name: 'api-prod', pm2_env: { restart_time: 7 } }, // 2 new
          { name: 'api-dev', pm2_env: { restart_time: 2 } }, // Same
        ]),
      );
    });
    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledWith(
      'pm2_restart',
      'warning',
      'PM2 process restarted: api-prod',
      '2 new restart(s) (total: 7)',
      expect.objectContaining({
        processName: 'api-prod',
        restartCount: 7,
        newRestarts: 2,
      }),
    );
  });

  test('handles PM2 process with restart_time of 0 (default)', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'fresh-proc', pm2_env: { restart_time: 0 } }]));
    });

    await serverHealth(mockManager);

    // restart_time 0, lastKnown 0 -> no alert
    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles PM2 process with missing restart_time', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'no-restart', pm2_env: {} }]));
    });

    await serverHealth(mockManager);

    // restart_time defaults to 0
    expect(createAlert).not.toHaveBeenCalled();
  });

  test('handles execFile throwing synchronously', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // Make execFile throw synchronously (e.g., if module is corrupted)
    execFile.mockImplementation(() => {
      throw new Error('execFile crashed');
    });

    // Should not throw - outer catch handles it
    await serverHealth(mockManager);

    expect(log.warn).toHaveBeenCalledWith(
      'cron',
      'serverHealth: PM2 check failed',
      expect.objectContaining({ error: 'execFile crashed' }),
    );
  });

  test('logs error when createAlert fails for PM2 restart', async () => {
    const createAlert = jest.fn().mockRejectedValue(new Error('Alert DB down'));
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 99,
        pm2RestartAlert: true,
      }),
    };

    mockMemory(100, 8000);

    // First run: establish baseline with restarts > 0
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 1 } }]));
    });
    await serverHealth(mockManager);

    // Second run: more restarts, but createAlert rejects
    jest.clearAllMocks();
    createAlert.mockRejectedValue(new Error('Alert DB down'));
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 3 } }]));
    });

    // Should not throw
    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalled();
    // Wait for the .catch to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(log.error).toHaveBeenCalledWith(
      'server-health',
      'Failed to create PM2 restart alert',
      expect.objectContaining({ error: 'Alert DB down' }),
    );
  });

  test('in-flight guard: concurrent invocations do not double-fire the metrics check', async () => {
    // Heartbeat-class endpoint can be hit multiple times during a slow
    // PM2 jlist (10s timeout). The module-level inFlight guard ensures
    // only one run reaches createAlert per overlap window — otherwise
    // duplicate PM2-restart alerts emit because alertManager has no
    // dedup. Restarts (1) crossing the threshold (0) would create one
    // alert per concurrent caller without the guard.
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      getConfig: () => ({
        serverMemoryWarningPercent: 30,
        pm2RestartAlert: true,
      }),
      createAlert,
    };

    mockMemory(100, 8000);

    // Hold the PM2 jlist callback so the first invocation stays
    // in-flight while the second starts.
    let releasePm2;
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      releasePm2 = () => {
        callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 5 } }]));
      };
    });

    // Prime baseline with a synchronous run (sets lastRestartCounts).
    execFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 1 } }]));
    });
    await serverHealth(mockManager);
    jest.clearAllMocks();

    // Re-establish the held mock for the overlap test.
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      releasePm2 = () => {
        callback(null, JSON.stringify([{ name: 'api', pm2_env: { restart_time: 5 } }]));
      };
    });

    // Start TWO concurrent invocations. The second sees inFlight === true
    // and returns immediately without entering the body.
    const first = serverHealth(mockManager);
    const second = serverHealth(mockManager);

    // Second invocation resolves immediately (guard hit) while the
    // first is still awaiting the PM2 callback.
    await second;
    expect(createAlert).not.toHaveBeenCalled();

    // Release PM2 so the first invocation completes.
    releasePm2();
    await first;

    // Only one alert was created across both invocations.
    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledWith(
      'pm2_restart',
      'warning',
      expect.stringContaining('api'),
      expect.any(String),
      expect.objectContaining({ processName: 'api' }),
    );
  });
});
