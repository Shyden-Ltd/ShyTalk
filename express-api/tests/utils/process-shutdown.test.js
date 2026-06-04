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
    fire: (signal) => {
      const h = handlers.get(signal);
      if (!h) throw new Error(`No handler registered for ${signal}`);
      h(signal);
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

  test('SIGTERM invokes every stop function in order', () => {
    const calls = [];
    const stopA = jest.fn(() => calls.push('A'));
    const stopB = jest.fn(() => calls.push('B'));
    const stopC = jest.fn(() => calls.push('C'));
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB, stopC], log: makeLog() });
    fire('SIGTERM');
    expect(calls).toEqual(['A', 'B', 'C']);
  });

  test('SIGTERM calls proc.exit(0) after stops complete', () => {
    const stopA = jest.fn();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA], log: makeLog() });
    fire('SIGTERM');
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
    // exit must come AFTER stops finish — assert call order via mock call counts.
    expect(stopA.mock.invocationCallOrder[0]).toBeLessThan(proc.exit.mock.invocationCallOrder[0]);
  });

  test('error in a stop function does not prevent subsequent stops or exit', () => {
    const stopA = jest.fn(() => {
      throw new Error('boom');
    });
    const stopB = jest.fn();
    const log = makeLog();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB], log });
    fire('SIGTERM');
    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(0);
    expect(log.warn).toHaveBeenCalledWith(
      'process-shutdown',
      expect.stringMatching(/threw|fail/i),
      expect.objectContaining({ error: 'boom' }),
    );
  });

  test('logs an info entry on signal receipt with the signal name', () => {
    const log = makeLog();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log });
    fire('SIGTERM');
    const firstCall = log.info.mock.calls.find((c) =>
      c.some((arg) => String(arg).includes('SIGTERM')),
    );
    expect(firstCall).toBeDefined();
  });

  test('all stops fail → proc.exit is STILL called', () => {
    const stopA = jest.fn(() => {
      throw new Error('boom A');
    });
    const stopB = jest.fn(() => {
      throw new Error('boom B');
    });
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA, stopB], log: makeLog() });
    fire('SIGTERM');
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  test('stopFns empty array works (no-op then exit)', () => {
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [], log: makeLog() });
    fire('SIGTERM');
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  test('SIGINT fires the same shutdown flow', () => {
    const stopA = jest.fn();
    const { proc, fire } = makeMockProcess();
    wireProcessShutdown({ proc, stopFns: [stopA], log: makeLog() });
    fire('SIGINT');
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });
});
