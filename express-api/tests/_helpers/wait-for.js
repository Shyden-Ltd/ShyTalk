'use strict';

/**
 * wait-for — the ONE sanctioned polling primitive for the Jest suites
 * (SHY-0245).
 *
 * Tests must never sleep: a fixed delay is a hard-coded guess about how fast
 * the machine is, so it is always wrong somewhere — too short and it flakes on
 * a slow/contended runner (telling you about the machine, not the product),
 * too long and every run pays it forever.
 *
 * The correct shape is "poll until the condition holds, bounded by a deadline".
 * That needs an interval between attempts, which is the ONLY legitimate use of
 * a timer in a test — and it is fundamentally different from sleep-and-hope:
 * this returns the INSTANT the condition is true, so it is correct at any
 * machine speed, and the timeout only bounds the failure.
 *
 * Because that distinction cannot be made syntactically, the sleep ratchet
 * (scripts/check-no-test-sleeps.sh) excludes this one file by name. Keeping a
 * single reviewed implementation here is what lets the ban stay absolute
 * everywhere else — copy this helper, never the timer.
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 10;

/**
 * Resolves once `predicate` neither throws nor returns false. Rejects with the
 * predicate's own last error once the deadline passes, so the failure message
 * names the assertion that never held — not a bare "timed out".
 *
 * @param {() => unknown | Promise<unknown>} predicate assertion(s) to retry
 * @param {{timeout?: number, interval?: number, message?: string}} [opts]
 */
async function waitFor(predicate, opts = {}) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const interval = opts.interval ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  let lastError;

  for (;;) {
    try {
      const result = await predicate();
      if (result !== false) return result;
      lastError = new Error(opts.message || 'waitFor: predicate returned false');
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      if (opts.message && lastError) lastError.message = `${opts.message}: ${lastError.message}`;
      throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Resolves once `mockFn` has been called at least `times` times. */
async function waitForCall(mockFn, times = 1, opts = {}) {
  return waitFor(() => {
    if (mockFn.mock.calls.length < times) {
      throw new Error(`expected at least ${times} call(s), saw ${mockFn.mock.calls.length}`);
    }
  }, opts);
}

module.exports = { waitFor, waitForCall };
