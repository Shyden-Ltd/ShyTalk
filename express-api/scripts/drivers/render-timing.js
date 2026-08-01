/**
 * Render-budget timing, shared by the Android and iOS device drivers.
 *
 * The corpus asserts "the time from submit to X rendering is less than Nms".
 * Answering that honestly needs two things the drivers must agree on:
 *
 *   1. WHEN the submit happened — recorded at the moment the driver performs
 *      one, not guessed afterwards.
 *   2. WHEN the target appeared — measured by polling the REAL device dump
 *      until it does, not by sleeping a fixed amount and declaring victory.
 *
 * Both platforms live here rather than in each driver because the two must
 * measure the same interval. Two copies would drift, and a performance budget
 * that means different things on Android and iOS is worse than no budget: it
 * would report a regression on one platform that the other cannot reproduce.
 *
 * THE DANGEROUS DEFAULT this module exists to refuse: with no recorded submit,
 * an elapsed time of 0 satisfies every budget. A scenario that never submitted
 * anything would pass its performance assertion. So an unmarked clock throws
 * by name instead of returning a number.
 */

/** Wall-clock injected so tests measure without waiting. */
function createSubmitClock({ now = () => Date.now() } = {}) {
  let submittedAt = null;

  return {
    /** Called by the driver at the instant a submit action is performed. */
    markSubmit() {
      submittedAt = now();
      return submittedAt;
    },

    /** Test/diagnostic read — null until a submit is marked. */
    submittedAt: () => submittedAt,

    /**
     * Milliseconds from the last submit until `probe()` first returns true.
     *
     * @param {() => Promise<boolean>} probe reads the real device dump
     * @param {object} opts
     * @param {number} opts.timeoutMs give up after this long
     * @param {number} opts.pollMs gap between reads
     * @returns {Promise<number>} elapsed ms, or the timeout when it never appeared
     */
    async measureUntil(probe, { timeoutMs = 10000, pollMs = 100, sleep } = {}) {
      if (submittedAt === null) {
        throw new Error(
          'measureRenderingTimeFromSubmit: no submit has been recorded on this driver — the scenario must perform a submit step before asserting its render budget',
        );
      }
      const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms))); // sleep-ok: poll interval between real device dumps, bounded by timeoutMs
      const started = submittedAt;
      const deadline = started + timeoutMs;
      for (;;) {
        if (await probe()) return now() - started;
        if (now() >= deadline) {
          // Returning the elapsed time rather than throwing lets the matcher
          // report "N >= budget", which is the true statement: it did not
          // render within the budget. Throwing here would read as a harness
          // fault and hide a genuine performance regression.
          return now() - started;
        }
        await wait(pollMs);
      }
    },
  };
}

module.exports = { createSubmitClock };
