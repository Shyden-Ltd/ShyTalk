const { dumpWithRetry, resolveDumpBackoffMs } = require('../../scripts/drivers/ui-dump-retry');

const noSleep = () => Promise.resolve();
const HIER = '<?xml version="1.0"?><hierarchy rotation="0"><node/></hierarchy>';

describe('resolveDumpBackoffMs', () => {
  // Jest sets JEST_WORKER_ID per worker; the override is honored ONLY under it,
  // so a stray shell export can never reach a real device run. Tests simulate
  // that runner env explicitly rather than mutating the process's own.
  const JEST = { JEST_WORKER_ID: '1' };

  test('defaults to 800ms when ANDROID_DUMP_BACKOFF_MS is absent', () => {
    expect(resolveDumpBackoffMs({ ...JEST })).toBe(800);
  });

  test('honors ANDROID_DUMP_BACKOFF_MS=0 (under Jest) so error-path driver tests skip real backoff', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: '0' })).toBe(0);
  });

  test('honors a custom positive ANDROID_DUMP_BACKOFF_MS (under Jest)', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: '250' })).toBe(250);
  });

  test('trims a whitespace-padded numeric value', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: ' 5 ' })).toBe(5);
  });

  test('falls back to 800ms for an empty-string ANDROID_DUMP_BACKOFF_MS', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: '' })).toBe(800);
  });

  test('falls back to 800ms for a whitespace-only ANDROID_DUMP_BACKOFF_MS', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: '   ' })).toBe(800);
  });

  test('falls back to 800ms for a non-numeric ANDROID_DUMP_BACKOFF_MS', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: 'abc' })).toBe(800);
  });

  test('falls back to 800ms for a negative ANDROID_DUMP_BACKOFF_MS', () => {
    expect(resolveDumpBackoffMs({ ...JEST, ANDROID_DUMP_BACKOFF_MS: '-5' })).toBe(800);
  });

  test('IGNORES the override outside the Jest runner — a real device never gets fast backoff', () => {
    // No JEST_WORKER_ID, as in a manual-qa-runner process where a shell export leaked.
    expect(resolveDumpBackoffMs({ ANDROID_DUMP_BACKOFF_MS: '0' })).toBe(800);
  });

  test('is null-safe: a null env falls back to process.env without throwing', () => {
    const prev = process.env.ANDROID_DUMP_BACKOFF_MS;
    delete process.env.ANDROID_DUMP_BACKOFF_MS; // this file never sets it; be explicit
    try {
      // process.env under Jest carries JEST_WORKER_ID but no override → default.
      expect(resolveDumpBackoffMs(null)).toBe(800);
    } finally {
      if (prev !== undefined) process.env.ANDROID_DUMP_BACKOFF_MS = prev;
    }
  });
});

describe('dumpWithRetry', () => {
  test('returns the dump on the first attempt when it succeeds', async () => {
    let calls = 0;
    const r = await dumpWithRetry(
      () => {
        calls += 1;
        return HIER;
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.xml).toBe(HIER);
    expect(r.lastErr).toBe('');
    expect(calls).toBe(1);
  });

  test('returns any non-throwing result immediately, including empty (no retry)', async () => {
    // An empty/partial dump that did not throw is the caller's matcher to
    // interpret — dumpWithRetry must NOT retry it (that would slow/hang the
    // ~1,300 driver-suite mocks that return partial XML on purpose).
    let calls = 0;
    const r = await dumpWithRetry(
      () => {
        calls += 1;
        return '';
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    expect(r.xml).toBe('');
    expect(r.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  test('retries a throwing dump and returns once it succeeds (4th attempt)', async () => {
    let calls = 0;
    const dumpOnce = () => {
      calls += 1;
      if (calls < 4) throw new Error('could not get idle state');
      return HIER;
    };
    const r = await dumpWithRetry(dumpOnce, { sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(4);
    expect(r.xml).toBe(HIER);
    expect(r.lastErr).toBe(''); // a successful attempt clears the prior error text
    expect(calls).toBe(4);
  });

  test('returns ok:false with an empty xml after every attempt throws', async () => {
    let calls = 0;
    const r = await dumpWithRetry(
      () => {
        calls += 1;
        throw new Error('always fails');
      },
      { maxAttempts: 5, sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    expect(r.xml).toBe('');
    expect(r.attempts).toBe(5);
    expect(r.lastErr).toBe('always fails');
    expect(calls).toBe(5);
  });

  test('sleeps between attempts but not after the final one', async () => {
    let sleeps = 0;
    const countSleep = () => {
      sleeps += 1;
      return Promise.resolve();
    };
    await dumpWithRetry(
      () => {
        throw new Error('x');
      },
      { maxAttempts: 3, sleep: countSleep },
    );
    expect(sleeps).toBe(2); // N-1 gaps for N attempts
  });

  test('passes backoffMs to each sleep call', async () => {
    const waited = [];
    const spySleep = (ms) => {
      waited.push(ms);
      return Promise.resolve();
    };
    await dumpWithRetry(
      () => {
        throw new Error('x');
      },
      { maxAttempts: 3, backoffMs: 500, sleep: spySleep },
    );
    expect(waited).toEqual([500, 500]);
  });

  test('surfaces the last thrown error message on exhaustion', async () => {
    const r = await dumpWithRetry(
      () => {
        throw new Error('uiautomator dump failed');
      },
      { maxAttempts: 2, sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    expect(r.lastErr).toBe('uiautomator dump failed');
    expect(r.attempts).toBe(2);
  });

  test('falls back to String(e) when the thrown error has no message', async () => {
    const r = await dumpWithRetry(
      () => {
        throw new Error(); // empty message → exercises the helper's String(e) fallback
      },
      { maxAttempts: 1, sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    expect(r.lastErr).toBe('Error'); // String(new Error()) === 'Error'
  });
});

describe('the retry budget is TIME, not just attempts', () => {
  /**
   * The attempt count was sized for Android, where a failed dump exits
   * immediately: "7×800ms ≈ 5.6s covers the observed ~4s cold-start settle".
   * That assumption holds only while an ATTEMPT is cheap.
   *
   * On iOS an attempt is an HTTP call to WebDriverAgent, bounded at 20s. Eight
   * of those is 166 seconds for one dump — which is what a ~312 SECOND stall in
   * `signOutFlow` turned out to be, striking roughly once per matrix and landing
   * on a different journey each run.
   *
   * A count cannot express "stop after this long", so the budget says so
   * directly.
   */
  const { dumpWithRetry } = require('../../scripts/drivers/ui-dump-retry');

  /** A clock the test controls, so no real time passes. */
  function fakeClock() {
    let now = 0;
    return {
      now: () => now,
      advance: (ms) => {
        now += ms;
      },
    };
  }

  test('stops once the deadline is spent, even with attempts left', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await dumpWithRetry(
      () => {
        attempts += 1;
        clock.advance(20000); // an attempt that times out
        throw new Error('WDA did not answer');
      },
      {
        maxAttempts: 8,
        backoffMs: 0,
        deadlineMs: 30000,
        sleep: async () => {},
        now: clock.now,
      },
    );

    expect(result.ok).toBe(false);
    // Two 20s attempts already exceed 30s; a third would be 60s of stalling.
    expect(attempts).toBe(2);
  });

  test('cheap failures still get the full attempt budget', async () => {
    // Android's case is unchanged: eight fast attempts inside the deadline.
    const clock = fakeClock();
    let attempts = 0;
    const result = await dumpWithRetry(
      () => {
        attempts += 1;
        clock.advance(5);
        throw new Error('uiautomator busy');
      },
      { maxAttempts: 8, backoffMs: 0, deadlineMs: 30000, sleep: async () => {}, now: clock.now },
    );

    expect(result.ok).toBe(false);
    expect(attempts).toBe(8);
  });

  test('a success still returns immediately', async () => {
    const clock = fakeClock();
    const result = await dumpWithRetry(() => '<hierarchy/>', {
      deadlineMs: 30000,
      sleep: async () => {},
      now: clock.now,
    });
    expect(result).toMatchObject({ ok: true, xml: '<hierarchy/>', attempts: 1 });
  });

  test('a late success inside the deadline is still taken', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await dumpWithRetry(
      () => {
        attempts += 1;
        clock.advance(1000);
        if (attempts < 3) throw new Error('busy');
        return '<hierarchy/>';
      },
      { maxAttempts: 8, backoffMs: 0, deadlineMs: 30000, sleep: async () => {}, now: clock.now },
    );
    expect(result).toMatchObject({ ok: true, attempts: 3 });
  });

  test('without a deadline it behaves exactly as before', async () => {
    // The default must not change what any existing caller gets.
    let attempts = 0;
    const result = await dumpWithRetry(
      () => {
        attempts += 1;
        throw new Error('busy');
      },
      { maxAttempts: 4, backoffMs: 0, sleep: async () => {} },
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(4);
  });
});
