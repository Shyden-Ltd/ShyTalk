'use strict';

/**
 * SHY-0500 / SHY-0245 — `pollUntil` is the one way a driver or the runner
 * waits: on a CONDITION, never on the clock.
 *
 * The iOS driver had grown a `sleep(ms)` helper with three call sites and the
 * runner three more `sleep` calls. The SHY-0245 ratchet saw only the helper's
 * definition, so the waits themselves went uncounted (PR #2129's lint job,
 * 2026-09-05). Every wait now states what it is waiting FOR and how long it is
 * prepared to look, and the pause between looks is derived, not chosen.
 *
 * Real execution: the helper runs with real timers. Intervals are single-digit
 * milliseconds so the suite stays fast without a mocked clock, and the timing
 * assertions only claim what holds on any machine (a cap engaged, a look
 * happened) — the pause arithmetic itself is a pure function, tested exactly.
 */

const { pollUntil, pauseBetweenLooks } = require('../../../scripts/drivers/poll-until');

/** A probe answering `answers[i]` on its i-th call, then the last answer forever. */
function scripted(answers) {
  const probe = async () => {
    const i = Math.min(probe.calls, answers.length - 1);
    probe.calls += 1;
    return answers[i];
  };
  probe.calls = 0;
  return probe;
}

describe('pollUntil — stops the instant the condition holds', () => {
  test('returns the first accepted value and probes no further', async () => {
    const probe = scripted(['blank', 'blank', 'main', 'sign-in']);
    const value = await pollUntil(probe, (kind) => kind !== 'blank', {
      intervalMs: 1,
      deadlineMs: 1000,
    });
    expect(value).toBe('main');
    expect(probe.calls).toBe(3);
  });

  test('an accepted first look returns without pausing at all', async () => {
    const probe = scripted([true]);
    const started = Date.now();
    await expect(pollUntil(probe, Boolean, { intervalMs: 500, deadlineMs: 5000 })).resolves.toBe(
      true,
    );
    expect(probe.calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("a probe that throws propagates at once — what 'not yet' looks like is the caller's call", async () => {
    const boom = new Error('POST /element -> 500: session gone');
    const probe = async () => {
      throw boom;
    };
    await expect(pollUntil(probe, Boolean, { intervalMs: 1, deadlineMs: 1000 })).rejects.toBe(boom);
  });
});

describe('pollUntil — a spent bound hands back the last value probed', () => {
  test('a deadline returns the last value, wanted or not, and the caller decides what that means', async () => {
    const probe = scripted([false]);
    const started = Date.now();
    const value = await pollUntil(probe, Boolean, { intervalMs: 5, deadlineMs: 40 });
    expect(value).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(probe.calls).toBeGreaterThanOrEqual(2);
  });

  test('an interval longer than the window is capped by it — the poll never overshoots', async () => {
    const probe = scripted(['still off']);
    const started = Date.now();
    await pollUntil(probe, (v) => v === 'on', { intervalMs: 5000, deadlineMs: 40 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(probe.calls).toBeGreaterThanOrEqual(2);
  });

  test('a zero deadline looks exactly once and answers with what it saw', async () => {
    const probe = scripted([null]);
    await expect(pollUntil(probe, Boolean, { intervalMs: 250, deadlineMs: 0 })).resolves.toBeNull();
    expect(probe.calls).toBe(1);
  });

  test('a maxLooks bound probes exactly that many times, even with a zero interval', async () => {
    const probe = scripted([null]);
    await expect(pollUntil(probe, Boolean, { intervalMs: 0, maxLooks: 3 })).resolves.toBeNull();
    expect(probe.calls).toBe(3);
  });

  test('with both bounds, whichever is spent first ends the poll', async () => {
    const byLooks = scripted([null]);
    await pollUntil(byLooks, Boolean, { intervalMs: 1, deadlineMs: 60000, maxLooks: 2 });
    expect(byLooks.calls).toBe(2);

    const byClock = scripted([null]);
    const started = Date.now();
    await pollUntil(byClock, Boolean, { intervalMs: 1, deadlineMs: 20, maxLooks: 1e6 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(byClock.calls).toBeLessThan(1e6);
  });
});

describe('pauseBetweenLooks — the shortest of the interval, a quarter of the window, and the time left', () => {
  test.each([
    ['the interval wins inside a long window', 250, 3000, 0, 250],
    ['a quarter of a short window wins, so it gets four looks', 250, 40, 0, 10],
    ['the time left wins at the end, so the deadline is not overshot', 250, 3000, 2900, 100],
    ['a zero interval only yields to the event loop', 0, 3000, 0, 0],
    ['with no deadline the interval stands alone', 2000, Infinity, 500, 2000],
  ])('%s', (_name, intervalMs, deadlineMs, elapsedMs, want) => {
    expect(pauseBetweenLooks(intervalMs, deadlineMs, elapsedMs)).toBe(want);
  });
});

describe('pollUntil — refuses a poll that cannot end or cannot be reasoned about', () => {
  test.each([
    ['no bound at all', { intervalMs: 10 }, /deadlineMs or maxLooks/],
    ['a negative deadline', { intervalMs: 10, deadlineMs: -1 }, /deadlineMs/],
    ['a NaN deadline', { intervalMs: 10, deadlineMs: NaN }, /deadlineMs/],
    ['a zero maxLooks', { intervalMs: 10, maxLooks: 0 }, /maxLooks/],
    ['a fractional maxLooks', { intervalMs: 10, maxLooks: 1.5 }, /maxLooks/],
    ['a missing interval', { deadlineMs: 10 }, /intervalMs/],
    ['a negative interval', { intervalMs: -5, deadlineMs: 10 }, /intervalMs/],
    ['an infinite interval', { intervalMs: Infinity, deadlineMs: 10 }, /intervalMs/],
  ])('%s is a TypeError before the first look', async (_name, options, message) => {
    const probe = scripted([true]);
    await expect(pollUntil(probe, Boolean, options)).rejects.toThrow(TypeError);
    await expect(pollUntil(probe, Boolean, options)).rejects.toThrow(message);
    expect(probe.calls).toBe(0);
  });

  test('a probe or an accept that is not a function is a TypeError', async () => {
    const options = { intervalMs: 1, deadlineMs: 10 };
    await expect(pollUntil('not a function', Boolean, options)).rejects.toThrow(/probe/);
    await expect(pollUntil(scripted([1]), null, options)).rejects.toThrow(/accept/);
  });
});
