const { wireProcessShutdown } = require('../../src/utils/process-shutdown');

// `wireProcessShutdown` registers SIGTERM + SIGINT handlers that call every
// supplied stop function (event listeners, cron loops, etc.) in order, then
// call process.exit(0). Designed for testability: the `proc` and `log` are
// injected so jest can mock both.

function makeMockProcess() {
  const handlers = new Map(); // signal → handler fn
  const proc = {
    on: jest.fn((signal, handler) => {
      handlers.set(signal, handler);
    }),
    exit: jest.fn(),
  };
  return {
    proc,
    // Returns the handler's promise so tests can await async cleanup chains
    // without race conditions. Sync tests can ignore the return value.
    fire: (signal) => {
      const h = handlers.get(signal);
      if (!h) throw new Error(`No handler registered for ${signal}`);
      return h(signal);
    },
    getHandler: (signal) => handlers.get(signal),
  };
}

const makeLog = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('wireProcessShutdown', () => {
  test('registers a SIGTERM handler', () => {
    const { proc } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
    expect(proc.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  test('registers a SIGINT handler', () => {
    const { proc } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
    expect(proc.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  test('SIGTERM + SIGINT handlers are the same function (one shared shutdown path)', () => {
    const { proc, getHandler } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
    expect(getHandler('SIGTERM')).toBe(getHandler('SIGINT'));
  });

  test('SIGTERM invokes EVERY stop function', async () => {
    // The handler runs all stops via Promise.allSettled, which provides
    // NO completion-order guarantee for async stops. This test only
    // asserts each stop was called exactly once.
    const stopA = jest.fn();
    const stopB = jest.fn();
    const stopC = jest.fn();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB, stopC], log: makeLog() });
    await fire('SIGTERM');
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(stopC).toHaveBeenCalledTimes(1);
  });

  test('SIGTERM sync stops run in stopFns iteration order (specifically for sync)', async () => {
    // R3 I3 clarification: ONLY for synchronous stop functions, the
    // invocation order matches the stopFns array order. This is because
    // `stopFns.map(async (stop) => { await stop(); ... })` calls the
    // synchronous body of `stop()` before yielding at the await. For
    // ASYNC stops, completion order depends on each stop's resolution
    // time — see the async-parallel test below for that semantic.
    const calls = [];
    const stopA = jest.fn(() => calls.push('A'));
    const stopB = jest.fn(() => calls.push('B'));
    const stopC = jest.fn(() => calls.push('C'));
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB, stopC], log: makeLog() });
    await fire('SIGTERM');
    expect(calls).toEqual(['A', 'B', 'C']);
  });

  test('SIGTERM calls proc.exit(0) after stops complete', async () => {
    const stopA = jest.fn();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA], log: makeLog() });
    await fire('SIGTERM');
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
    // exit must come AFTER stops finish — assert call order via mock call counts.
    expect(stopA.mock.invocationCallOrder[0]).toBeLessThan(proc.exit.mock.invocationCallOrder[0]);
  });

  test('error in a sync stop function does not prevent subsequent stops or exit', async () => {
    const stopA = jest.fn(() => {
      throw new Error('boom');
    });
    const stopB = jest.fn();
    const log = makeLog();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB], log });
    await fire('SIGTERM');
    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(0);
    expect(log.warn).toHaveBeenCalledWith(
      'process-shutdown',
      expect.stringMatching(/threw|fail/i),
      expect.objectContaining({ error: 'boom' }),
    );
  });

  test('logs an info entry on signal receipt with the signal name', async () => {
    const log = makeLog();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log });
    await fire('SIGTERM');
    const firstCall = log.info.mock.calls.find((c) =>
      c.some((arg) => String(arg).includes('SIGTERM')),
    );
    expect(firstCall).toBeDefined();
  });

  test('all stops fail → proc.exit is STILL called', async () => {
    const stopA = jest.fn(() => {
      throw new Error('boom A');
    });
    const stopB = jest.fn(() => {
      throw new Error('boom B');
    });
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB], log: makeLog() });
    await fire('SIGTERM');
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  test('stopFns empty array works (no-op then exit)', async () => {
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
    await fire('SIGTERM');
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  test('SIGINT fires the same shutdown flow', async () => {
    const stopA = jest.fn();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA], log: makeLog() });
    await fire('SIGINT');
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  describe('async stop functions (R2 I2)', () => {
    // Sync stops are the common case (e.g. detaching an RTDB listener is
    // immediate). But the contract must support async stops too — a future
    // queue drainer, pending Firestore txn awaiter, etc. — without losing
    // the cleanup.
    test('awaits an async stop function before calling proc.exit', async () => {
      const cleanupOrder = [];
      const asyncStop = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        cleanupOrder.push('async-done');
      });
      const { proc, fire } = makeMockProcess();
      wireProcessShutdown({ proc, stopFns: [asyncStop], log: makeLog() });
      proc.exit.mockImplementation(() => cleanupOrder.push('exit'));
      await fire('SIGTERM');
      // Async stop completed BEFORE exit was called.
      expect(cleanupOrder).toEqual(['async-done', 'exit']);
    });

    test('awaits all async stops in parallel (Promise.allSettled semantics)', async () => {
      const done = [];
      const stopA = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 30));
        done.push('A');
      });
      const stopB = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        done.push('B');
      });
      const stopC = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        done.push('C');
      });
      const { proc, fire } = makeMockProcess();
      wireProcessShutdown({ proc, stopFns: [stopA, stopB, stopC], log: makeLog() });
      await fire('SIGTERM');
      // All three completed before exit — Promise.allSettled ordering means
      // the actual completion order is by their delay (B, C, A).
      expect(done.sort()).toEqual(['A', 'B', 'C']);
      expect(proc.exit).toHaveBeenCalledWith(0);
    });

    test('async stop that throws does not prevent other stops or exit', async () => {
      const stopA = jest.fn().mockRejectedValue(new Error('boom-A'));
      const stopB = jest.fn().mockResolvedValue(undefined);
      const log = makeLog();
      const { proc, fire } = makeMockProcess();
      wireProcessShutdown({ proc, stopFns: [stopA, stopB], log });
      await fire('SIGTERM');
      expect(stopA).toHaveBeenCalled();
      expect(stopB).toHaveBeenCalled();
      expect(proc.exit).toHaveBeenCalledWith(0);
      expect(log.warn).toHaveBeenCalledWith(
        'process-shutdown',
        expect.stringMatching(/threw|fail/i),
        expect.objectContaining({ error: 'boom-A' }),
      );
    });

    test('mixed sync + async stops both complete before exit', async () => {
      const done = [];
      const syncStop = jest.fn(() => done.push('sync'));
      const asyncStop = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
        done.push('async');
      });
      const { proc, fire } = makeMockProcess();
      proc.exit.mockImplementation(() => done.push('exit'));
      wireProcessShutdown({ proc, stopFns: [syncStop, asyncStop], log: makeLog() });
      await fire('SIGTERM');
      // Sync completes first (synchronous push), async after the await,
      // exit last.
      expect(done).toEqual(['sync', 'async', 'exit']);
    });
  });

  describe('multiple calls (R2 I2 follow-on)', () => {
    // Documents the current behaviour: multiple wireProcessShutdown calls
    // on the same proc register multiple handlers. This is intentional —
    // each subsystem can register its own shutdown hook independently.
    test('two wireProcessShutdown calls register two handlers on the same proc', () => {
      const { proc } = makeMockProcess();
      wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
      wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
      // 2 calls × 2 signals = 4 registrations.
      const sigtermCount = proc.on.mock.calls.filter((c) => c[0] === 'SIGTERM').length;
      const sigintCount = proc.on.mock.calls.filter((c) => c[0] === 'SIGINT').length;
      expect(sigtermCount).toBe(2);
      expect(sigintCount).toBe(2);
    });
  });
});
