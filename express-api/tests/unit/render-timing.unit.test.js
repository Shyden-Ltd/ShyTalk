/**
 * The submit→render clock, SHY-0259.
 *
 * The corpus asserts "the time from submit to X rendering is less than Nms".
 * The matcher compares the driver's answer against the budget with `>=`, so
 * ANY number below the budget is a pass — which makes the failure mode here
 * unusually sharp: a clock that returns 0 when nothing was ever submitted
 * turns every performance assertion into an unconditional green.
 *
 * Time is injected. A test that waited for real milliseconds would be
 * measuring the machine it runs on, and a slow CI box would redden it for
 * reasons that have nothing to do with the code.
 */
const { createSubmitClock } = require('../../scripts/drivers/render-timing');

/** A controllable clock — the test decides what "now" means. */
function fakeTime(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    /** Stands in for the poll delay, advancing time instead of waiting. */
    sleep: async (ms) => {
      t += ms;
    },
  };
}

describe('a clock with no recorded submit refuses to answer', () => {
  it('throws rather than returning a number', async () => {
    const clock = createSubmitClock();
    await expect(clock.measureUntil(async () => true)).rejects.toThrow(
      /no submit has been recorded/,
    );
  });

  it('names the method and says what the scenario must do', async () => {
    // The error is read by whoever sees the red step, so it has to point at
    // the fix rather than merely stating the fault.
    const clock = createSubmitClock();
    await expect(clock.measureUntil(async () => true)).rejects.toThrow(
      /measureRenderingTimeFromSubmit/,
    );
    await expect(clock.measureUntil(async () => true)).rejects.toThrow(/perform a submit step/);
  });

  it('never returns 0 — the value that would satisfy every budget', async () => {
    // The specific catastrophe. If this ever returns instead of throwing,
    // every "renders in under Nms" assertion in the corpus passes for free.
    const clock = createSubmitClock();
    let returned;
    try {
      returned = await clock.measureUntil(async () => true);
    } catch {
      returned = 'threw';
    }
    expect(returned).toBe('threw');
  });

  it('reports no submit timestamp before one is marked', () => {
    expect(createSubmitClock().submittedAt()).toBeNull();
  });
});

describe('measuring a real interval', () => {
  it('returns the elapsed time when the target is already rendered', async () => {
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    time.advance(37);
    await expect(clock.measureUntil(async () => true, { sleep: time.sleep })).resolves.toBe(37);
  });

  it('polls until the target appears and counts the whole wait', async () => {
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    let reads = 0;
    const elapsed = await clock.measureUntil(
      async () => {
        reads += 1;
        return reads === 4; // appears on the fourth read
      },
      { pollMs: 25, timeoutMs: 5000, sleep: time.sleep },
    );
    expect(reads).toBe(4);
    // Three poll gaps elapsed between the four reads.
    expect(elapsed).toBe(75);
  });

  it('measures from the LAST submit, not the first', async () => {
    // A scenario that submits twice must be judged on the second one —
    // measuring from the first would report an interval that includes
    // whatever the user did in between and fail an innocent budget.
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    time.advance(900);
    clock.markSubmit();
    time.advance(20);
    await expect(clock.measureUntil(async () => true, { sleep: time.sleep })).resolves.toBe(20);
  });

  it('reads the probe at least once even when the timeout is zero', async () => {
    // An already-rendered target must not be reported as a timeout just
    // because the budget is tight.
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    let reads = 0;
    await clock.measureUntil(
      async () => {
        reads += 1;
        return true;
      },
      { timeoutMs: 0, sleep: time.sleep },
    );
    expect(reads).toBe(1);
  });
});

describe('when the target never renders', () => {
  /**
   * A probe that never succeeds, and that BOUNDS ITSELF.
   *
   * The obvious version — `async () => false` — detects a broken deadline
   * only by spinning until Jest's per-test timeout fires, which reports as
   * "test exceeded 10000ms" and names neither the method nor the reason.
   * With time injected the loop burns no wall-clock either, so the spin is
   * pure CPU for the full timeout.
   *
   * Verified by mutation on 2026-08-01: replacing the deadline check with
   * `if (false)` fails here in milliseconds with "measureUntil did not
   * honour its deadline — probed 51 times".
   */
  const boundedNeverRenders = (cap = 50) => {
    let reads = 0;
    const probe = async () => {
      reads += 1;
      if (reads > cap) {
        throw new Error(`measureUntil did not honour its deadline — probed ${reads} times`);
      }
      return false;
    };
    probe.reads = () => reads;
    return probe;
  };

  it('returns the elapsed time rather than throwing', async () => {
    // Deliberate: the matcher turns a too-large number into "N >= budget",
    // which is the true statement. Throwing would read as a harness fault and
    // hide a genuine performance regression behind an infrastructure excuse.
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    const elapsed = await clock.measureUntil(boundedNeverRenders(), {
      timeoutMs: 300,
      pollMs: 100,
      sleep: time.sleep,
    });
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  it('gives up at the deadline instead of polling forever', async () => {
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    const probe = boundedNeverRenders();
    await clock.measureUntil(probe, { timeoutMs: 250, pollMs: 100, sleep: time.sleep });
    // Bounded: reads at 0, 100, 200, then 300 > 250 stops it.
    expect(probe.reads()).toBeLessThanOrEqual(4);
    expect(probe.reads()).toBeGreaterThan(1);
  });

  it('propagates a probe that throws instead of scoring it as slow', async () => {
    // A device that has gone away is not a performance result. Swallowing the
    // error would report a huge-but-finite time and read as a regression.
    const time = fakeTime();
    const clock = createSubmitClock({ now: time.now });
    clock.markSubmit();
    await expect(
      clock.measureUntil(
        async () => {
          throw new Error('device disconnected');
        },
        { sleep: time.sleep },
      ),
    ).rejects.toThrow(/device disconnected/);
  });
});

describe('markSubmit', () => {
  it('returns the timestamp it recorded', () => {
    const time = fakeTime(500);
    const clock = createSubmitClock({ now: time.now });
    expect(clock.markSubmit()).toBe(500);
    expect(clock.submittedAt()).toBe(500);
  });

  it('defaults to real wall-clock time when none is injected', () => {
    // The production path takes no clock. Pinning the SHAPE (a plausible
    // epoch millisecond) rather than a value keeps this independent of when
    // it runs.
    const at = createSubmitClock().markSubmit();
    expect(typeof at).toBe('number');
    expect(at).toBeGreaterThan(1_600_000_000_000);
  });
});
