/**
 * Stop grinding against a surface that has died.
 *
 * THE BUG THIS EXISTS TO PREVENT (run 20260801-113726-local, live logs):
 *
 *   [mobile-safari-ios] in-page evaluate failed: no response within 30000ms
 *   from http://localhost:4723/session… — the device or its agent stopped
 *   answering
 *
 * …repeated for the rest of the run. The Appium session had been destroyed,
 * and every remaining call paid the full 30-second bound before failing. The
 * I/O timeout turned an infinite hang into a survivable crawl, which is
 * better, but a cell with hundreds of scenarios left still burns hours
 * proving the same dead surface is still dead.
 *
 * Android showed the same shape against a closed CDP connection:
 *
 *   [mobile-chrome-android] in-page evaluate failed: page.evaluate: Target
 *   page, context or browser has been closed
 *
 * A surface that has failed at the TRANSPORT level several times running is
 * not going to answer the next call either. Say so once, immediately, and let
 * the cell fail with an attributable cause instead of a thousand identical
 * timeouts.
 *
 * The discrimination that matters: a transport failure means "the surface is
 * gone"; an ordinary assertion failure means "the product did something
 * unexpected". Tripping on the second would abort a cell over a real product
 * defect it was supposed to report.
 */
const {
  createSurfaceBreaker,
  isTransportFailure,
} = require('../../scripts/drivers/surface-circuit-breaker');

describe('recognising a dead surface', () => {
  it.each([
    ['no response within 30000ms from http://localhost:4723/session…', 'the iOS symptom'],
    ['page.evaluate: Target page, context or browser has been closed', 'the Android symptom'],
    ['Error: socket hang up', 'a dropped connection'],
    ['connect ECONNREFUSED 127.0.0.1:4723', 'the agent is gone'],
    ['A session is either terminated or not started', 'Appium saying it plainly'],
    ['device or its agent stopped answering', 'our own bounded-fetch message'],
    ['adb: device offline', 'the phone went away'],
    ['did not return within 30000ms and was killed', 'a wedged exec'],
  ])('%s → transport failure (%s)', (message) => {
    expect(isTransportFailure(new Error(message))).toBe(true);
  });

  it.each([
    ['tag "main_roomsTab" not found in iOS UI dump', 'a real UI assertion'],
    ['field "shyCoins" on "users/1" was 40, expected 42', 'a real data assertion'],
    ['ctx.webDriver.webSendGift not configured', 'a harness gap'],
    ['the response status was 500, expected 200', 'a real product failure'],
    ['', 'an empty message'],
  ])('%s → NOT a transport failure (%s)', (message) => {
    // Tripping on these would abort the cell over the very defects it exists
    // to report, and blame the device for a product bug.
    expect(isTransportFailure(new Error(message))).toBe(false);
  });

  it('handles a non-Error without throwing', () => {
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure('socket hang up')).toBe(true);
  });
});

describe('the breaker trips only after repeated transport failures', () => {
  it('stays closed while failures are below the threshold', () => {
    const breaker = createSurfaceBreaker({ threshold: 3, label: 'ios' });
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(false);
  });

  it('opens on the threshold-th consecutive transport failure', () => {
    const breaker = createSurfaceBreaker({ threshold: 3, label: 'ios' });
    for (let i = 0; i < 3; i++) breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(true);
  });

  it('does NOT count ordinary assertion failures toward the threshold', () => {
    // A cell that legitimately fails ten scenarios must not be declared dead.
    const breaker = createSurfaceBreaker({ threshold: 3 });
    for (let i = 0; i < 10; i++) {
      breaker.recordFailure(new Error('tag "roomsTab" not found in UI dump'));
    }
    expect(breaker.isOpen()).toBe(false);
  });

  it('resets on any success — a blip is not a death', () => {
    // A single dropped call during a WDA restart is normal. Only a SUSTAINED
    // inability to reach the surface means it is gone.
    const breaker = createSurfaceBreaker({ threshold: 3 });
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordSuccess();
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(false);
  });

  it('an assertion failure between transport failures does not reset the count', () => {
    // The surface being unreachable and a scenario failing are independent.
    // Treating a product failure as evidence of device health would let a
    // dead surface hide behind its own broken results.
    const breaker = createSurfaceBreaker({ threshold: 3 });
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordFailure(new Error('field "x" was 1, expected 2'));
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(true);
  });
});

describe('an open breaker fails fast and says why', () => {
  it('throws immediately instead of running the call', async () => {
    const breaker = createSurfaceBreaker({ threshold: 1, label: 'mobile-safari-ios' });
    breaker.recordFailure(new Error('socket hang up'));
    let ran = false;
    await expect(
      breaker.run(async () => {
        ran = true;
      }),
    ).rejects.toThrow(/mobile-safari-ios/);
    // The whole point: the 30-second call is never made.
    expect(ran).toBe(false);
  });

  it('names the failure that killed the surface, not just "unavailable"', async () => {
    const breaker = createSurfaceBreaker({ threshold: 1, label: 'ios' });
    breaker.recordFailure(new Error('connect ECONNREFUSED 127.0.0.1:4723'));
    await expect(breaker.run(async () => 'x')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('reports how many scenarios were abandoned, so the report is honest', async () => {
    const breaker = createSurfaceBreaker({ threshold: 1, label: 'ios' });
    breaker.recordFailure(new Error('socket hang up'));
    await expect(breaker.run(async () => 'x')).rejects.toThrow(/surface is unreachable/i);
  });
});

describe('a closed breaker is transparent', () => {
  it('runs the call and returns its value', async () => {
    const breaker = createSurfaceBreaker({ threshold: 3 });
    await expect(breaker.run(async () => 'result')).resolves.toBe('result');
  });

  it('records a success automatically, clearing earlier failures', async () => {
    const breaker = createSurfaceBreaker({ threshold: 2 });
    breaker.recordFailure(new Error('socket hang up'));
    await breaker.run(async () => 'ok');
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(false);
  });

  it('records a transport failure automatically and rethrows', async () => {
    const breaker = createSurfaceBreaker({ threshold: 2 });
    const boom = new Error('socket hang up');
    await expect(
      breaker.run(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    await expect(
      breaker.run(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(breaker.isOpen()).toBe(true);
  });

  it('rethrows an assertion failure without counting it', async () => {
    const breaker = createSurfaceBreaker({ threshold: 1 });
    await expect(
      breaker.run(async () => {
        throw new Error('field "x" was 1, expected 2');
      }),
    ).rejects.toThrow(/expected 2/);
    expect(breaker.isOpen()).toBe(false);
  });
});

describe('diagnostics', () => {
  it('exposes the consecutive count for a status line', () => {
    const breaker = createSurfaceBreaker({ threshold: 5 });
    breaker.recordFailure(new Error('socket hang up'));
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.consecutiveFailures()).toBe(2);
  });

  it('defaults to a threshold above 1 so one blip cannot kill a cell', () => {
    // A single transient failure during a WDA relaunch must not abandon a run
    // that would otherwise have completed.
    const breaker = createSurfaceBreaker();
    breaker.recordFailure(new Error('socket hang up'));
    expect(breaker.isOpen()).toBe(false);
  });
});
