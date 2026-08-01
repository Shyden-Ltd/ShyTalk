/**
 * Every device I/O call must be bounded — the stall fix.
 *
 * Measured on gauntlet run matrix-20260801-095103-local:
 *
 *   chromium / firefox / webkit   682 scenarios in 22-24 min
 *   mobile-safari-ios             254 scenarios in 89 min, one 1885s gap
 *   mobile-chrome-android         100 scenarios in 85 min, one 2174s gap
 *
 * Neither device cell used any CPU during those gaps. They were blocked on
 * I/O with nothing to say when to give up: `execSync` without `timeout`, and
 * `fetch` without a signal, both wait forever. The cell then burns the whole
 * two-hour `--cell-timeout` and every scenario it never reached is lost.
 *
 * The browser cells never showed this because Playwright bounds every
 * operation internally — a `Timeout 3000ms exceeded` in their logs is a cell
 * still making progress.
 */
const {
  boundedFetch,
  execBounds,
  describeExecFailure,
  redactUrl,
  DEFAULT_ADB_TIMEOUT_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
} = require('../../scripts/drivers/device-io-timeout');

/** A fetch that never settles — exactly the wedged-agent case. */
const neverResolves = () => new Promise(() => {});

describe('boundedFetch gives up instead of waiting forever', () => {
  it('rejects once the budget elapses', async () => {
    const fetchImpl = boundedFetch(neverResolves, { timeoutMs: 20, label: 'test-surface' });
    await expect(fetchImpl('http://localhost:4723/session/abc/source')).rejects.toThrow(
      /no response within 20ms/,
    );
  });

  it('names the surface, so the failure is attributable', async () => {
    // "fetch failed" sends you looking at the network. Naming the surface
    // points at the agent that stopped answering.
    const fetchImpl = boundedFetch(neverResolves, { timeoutMs: 20, label: 'ios-appium' });
    await expect(fetchImpl('http://localhost:4723/session')).rejects.toThrow(/\[ios-appium\]/);
  });

  it('says the device stopped answering, not that the request was malformed', async () => {
    const fetchImpl = boundedFetch(neverResolves, { timeoutMs: 20 });
    await expect(fetchImpl('http://localhost:4723/status')).rejects.toThrow(
      /device or its agent stopped answering/,
    );
  });

  it('passes a fast response straight through, untouched', async () => {
    const body = { value: 'ok' };
    const fetchImpl = boundedFetch(async () => body, { timeoutMs: 1000 });
    await expect(fetchImpl('http://localhost:4723/status')).resolves.toBe(body);
  });

  it('forwards method, headers and body unchanged', async () => {
    let seen;
    const fetchImpl = boundedFetch(async (url, init) => {
      seen = { url, init };
      return { ok: true };
    });
    await fetchImpl('http://127.0.0.1:4723/status', {
      method: 'POST',
      headers: { a: 'b' },
      body: '{}',
    });
    expect(seen.url).toBe('http://127.0.0.1:4723/status');
    expect(seen.init.method).toBe('POST');
    expect(seen.init.headers).toEqual({ a: 'b' });
    expect(seen.init.body).toBe('{}');
  });

  it('attaches an abort signal the caller did not supply', async () => {
    let seen;
    const fetchImpl = boundedFetch(async (url, init) => {
      seen = init;
      return { ok: true };
    });
    await fetchImpl('http://127.0.0.1:4723/status');
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });

  it('does NOT override a signal the caller supplied', async () => {
    // Session creation passes its own, much longer bound. Overriding it would
    // abort a WDA install that was going to succeed.
    const mine = AbortSignal.timeout(50);
    let seen;
    const fetchImpl = boundedFetch(async (url, init) => {
      seen = init;
      return { ok: true };
    });
    await fetchImpl('http://127.0.0.1:4723/status', { signal: mine });
    expect(seen.signal).toBe(mine);
  });

  it('bounds a transport that IGNORES the abort signal', async () => {
    // The guarantee that matters. AbortController only ASKS the underlying
    // implementation to stop; something that has stopped responding — the
    // exact failure being bounded — may never honour it. Without a race the
    // wrapper waits forever, just like the unbounded call it replaced. This
    // fetch deliberately ignores its signal.
    const deaf = (url, init) =>
      new Promise(() => {
        void init.signal; // received, and ignored
      });
    const fetchImpl = boundedFetch(deaf, { timeoutMs: 20, label: 'deaf-surface' });
    await expect(fetchImpl('http://127.0.0.1:4723/status')).rejects.toThrow(
      /no response within 20ms/,
    );
  });

  it('propagates a real network error unchanged rather than blaming the timeout', async () => {
    // A connection refused is a different diagnosis from a hang, and saying
    // "no response within 30000ms" for an instant ECONNREFUSED would send the
    // reader looking for a wedge that is not there.
    const boom = new Error('ECONNREFUSED');
    const fetchImpl = boundedFetch(async () => {
      throw boom;
    });
    await expect(fetchImpl('http://127.0.0.1:4723/status')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('clears its timer, so a completed call cannot hold the event loop open', async () => {
    // A lingering timer keeps node alive and the runner looks hung AFTER its
    // work is finished — a stall with no work left to do.
    const before = process._getActiveHandles ? process._getActiveHandles().length : 0;
    const fetchImpl = boundedFetch(async () => ({ ok: true }), { timeoutMs: 60_000 });
    await fetchImpl('http://127.0.0.1:4723/status');
    const after = process._getActiveHandles ? process._getActiveHandles().length : 0;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('keeps the abort reason out of the caller when the caller aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = boundedFetch(async (url, init) => {
      expect(init.signal).toBe(controller.signal);
      throw new Error('The operation was aborted');
    });
    await expect(
      fetchImpl('http://127.0.0.1:4723/status', { signal: controller.signal }),
    ).rejects.toThrow(/operation was aborted/);
  });
});

describe('redactUrl keeps the error readable', () => {
  it.each([
    ['http://localhost:4723/session/abc-123/element/9/click', 'http://localhost:4723/session…'],
    ['http://127.0.0.1:9515/status', 'http://127.0.0.1:9515/status…'],
  ])('%s → %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it('returns a non-URL unchanged rather than throwing', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('execBounds', () => {
  it('carries a timeout — the whole point', () => {
    // Without this, `adb shell uiautomator dump` blocks forever when it
    // cannot get its exclusive UiAutomation connection.
    expect(execBounds().timeout).toBe(DEFAULT_ADB_TIMEOUT_MS);
    expect(execBounds({ timeoutMs: 5000 }).timeout).toBe(5000);
  });

  it('kills with SIGKILL, not SIGTERM', () => {
    // A wedged uiautomator dump holds an exclusive UiAutomation connection
    // that SIGTERM does not reliably reclaim — the NEXT dump then fails for a
    // reason unrelated to the scenario being run.
    expect(execBounds().killSignal).toBe('SIGKILL');
  });

  it('still returns strings, not Buffers', () => {
    expect(execBounds().encoding).toBe('utf8');
  });
});

describe('describeExecFailure', () => {
  it('turns a timeout kill into a message naming the command and budget', () => {
    // Node reports a timeout kill as signal SIGKILL with no useful message,
    // which is indistinguishable from something else having killed it.
    const raw = Object.assign(new Error(''), { killed: true, signal: 'SIGKILL' });
    const described = describeExecFailure(raw, {
      label: 'android-driver 3b402284',
      command: 'adb shell uiautomator dump',
      timeoutMs: 30_000,
    });
    expect(described.message).toMatch(/uiautomator dump/);
    expect(described.message).toMatch(/30000ms/);
    expect(described.message).toMatch(/wedged/);
    expect(described.cause).toBe(raw);
  });

  it('recognises a kill reported only by signal', () => {
    const raw = Object.assign(new Error(''), { signal: 'SIGKILL' });
    expect(describeExecFailure(raw, { command: 'adb devices', timeoutMs: 1 }).message).toMatch(
      /wedged/,
    );
  });

  it('passes a NON-timeout failure through untouched', () => {
    // "device not found" is a real diagnosis. Rewriting it as a wedge would
    // send the reader looking for a hang that never happened.
    const raw = new Error('error: device 3b402284 not found');
    expect(describeExecFailure(raw, { command: 'adb shell echo' })).toBe(raw);
  });
});

describe('the budgets are sane relative to each other', () => {
  it('a session may take far longer than an ordinary call', () => {
    // WDA install/sign/launch is minutes on a cold device; a source dump is
    // seconds. One budget for both would either abort real sessions or let
    // ordinary calls hang.
    expect(SESSION_TIMEOUT_MS).toBeGreaterThan(DEFAULT_HTTP_TIMEOUT_MS * 4);
  });

  it('every budget is far below the two-hour cell timeout it exists to pre-empt', () => {
    const CELL_TIMEOUT_MS = 7200 * 1000;
    for (const ms of [DEFAULT_ADB_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS, SESSION_TIMEOUT_MS]) {
      expect(ms).toBeLessThan(CELL_TIMEOUT_MS / 10);
    }
  });
});
