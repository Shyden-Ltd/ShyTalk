'use strict';

/**
 * poll-until.js — the one place a driver or the runner waits on the clock.
 *
 * SHY-0245 forbids fixed-duration waits: `sleep(600)` is a guess about how
 * fast someone else's machine is, so it is wrong somewhere and fails silently.
 * What the code wants is a CONDITION — "the switch reads on", "a crash report
 * has been filed", "the first frame is drawn" — so `pollUntil` asks `probe`
 * again and again until `accept` says yes, and stops when the caller's bound
 * is spent.
 *
 * Bound the poll with `deadlineMs` (a wall-clock window), `maxLooks` (a fixed
 * number of probes, for retry-shaped polls whose tests count the attempts) or
 * both — whichever is spent first ends it. An unbounded poll is refused: it
 * would be a hang. The pause between looks is `pauseBetweenLooks`: the
 * shortest of `intervalMs`, a quarter of the window (so a coarse interval
 * still gets four looks inside a short window) and the time left (so the poll
 * never overshoots its deadline).
 *
 * Returns the first accepted value, or the LAST value probed once the bound is
 * spent — only the caller knows whether that is a failure and how to describe
 * it. A probe that throws propagates at once: deciding which failures mean
 * "not yet" (a 404 from `/element`, say) is the caller's business too.
 *
 * SHY-0500, 2026-09-05: the iOS driver had grown its own `sleep` helper and
 * the runner three more `sleep` calls; the ratchet counted only the helper's
 * definition. This module carries the single, reasoned `sleep-ok` among the
 * drivers, and the ratchet now counts helper CALLS as well.
 */

/**
 * How long to pause before the next look.
 * @param {number} intervalMs the caller's preferred spacing between looks
 * @param {number} deadlineMs the whole window (Infinity when bounded by looks alone)
 * @param {number} elapsedMs how much of the window is already spent
 * @returns {number} milliseconds, never negative
 */
function pauseBetweenLooks(intervalMs, deadlineMs, elapsedMs) {
  return Math.max(0, Math.min(intervalMs, deadlineMs / 4, deadlineMs - elapsedMs));
}

const isSpan = (n) => Number.isFinite(n) && n >= 0;
const isCount = (n) => Number.isInteger(n) && n >= 1;

/**
 * @template T
 * @param {() => T | Promise<T>} probe reads the current state
 * @param {(value: T) => boolean} accept true when `value` is what was waited for
 * @param {{ intervalMs: number, deadlineMs?: number, maxLooks?: number }} options
 * @returns {Promise<T>} the first accepted value, or the last one probed when the bound is spent
 */
async function pollUntil(probe, accept, options = {}) {
  if (typeof probe !== 'function') throw new TypeError('pollUntil: probe must be a function');
  if (typeof accept !== 'function') throw new TypeError('pollUntil: accept must be a function');
  const { intervalMs, deadlineMs = Infinity, maxLooks = Infinity } = options;
  if (!isSpan(intervalMs)) {
    throw new TypeError(
      `pollUntil: intervalMs must be a finite number of milliseconds >= 0, got ${intervalMs}`,
    );
  }
  if (deadlineMs !== Infinity && !isSpan(deadlineMs)) {
    throw new TypeError(
      `pollUntil: deadlineMs must be a finite number of milliseconds >= 0, got ${deadlineMs}`,
    );
  }
  if (maxLooks !== Infinity && !isCount(maxLooks)) {
    throw new TypeError(`pollUntil: maxLooks must be a whole number >= 1, got ${maxLooks}`);
  }
  if (deadlineMs === Infinity && maxLooks === Infinity) {
    throw new TypeError(
      'pollUntil: bound the poll with deadlineMs or maxLooks — unbounded, it is a hang',
    );
  }
  const started = Date.now();
  for (let looks = 1; ; looks += 1) {
    const value = await probe();
    if (accept(value)) return value;
    const elapsed = Date.now() - started;
    if (looks >= maxLooks || elapsed >= deadlineMs) return value;
    const pauseMs = pauseBetweenLooks(intervalMs, deadlineMs, elapsed);
    await new Promise((resolve) => setTimeout(resolve, pauseMs)); // sleep-ok: the poll interval — the loop above exits the instant accept() holds
  }
}

module.exports = { pollUntil, pauseBetweenLooks };
