/**
 * Every device I/O call must be BOUNDED.
 *
 * Measured 2026-08-01, gauntlet run matrix-20260801-095103-local:
 *
 *   chromium / firefox / webkit   682 scenarios in 22-24 min
 *   mobile-safari-ios             254 scenarios in 89 min, one gap of 1885s
 *   mobile-chrome-android         100 scenarios in 85 min, one gap of 2174s
 *
 * Neither device cell was using CPU. They were blocked on I/O — for THIRTY-SIX
 * MINUTES on a single scenario — because nothing bounded the call:
 *
 *   android-adb-driver  `execSync(cmd, { encoding: 'utf8' })`   no timeout
 *   ios-appium-driver   16 × `fetchImpl(...)`                    no timeout
 *   web-mobile-*-ios    `fetchImpl(...)`                         no timeout
 *
 * Node's `fetch` waits forever by default, and so does `execSync`. So a dead
 * WDA session, a USB re-enumeration, or the `uiautomator dump` wedge that
 * needs an exclusive UiAutomation connection all block the cell until the
 * two-hour `--cell-timeout` fires. That is the "they're always stalling"
 * symptom: not one bug, but the absence of any bound on device I/O.
 *
 * The browser cells never showed it because Playwright bounds every operation
 * internally — their logs are full of `Timeout 3000ms exceeded`, which is a
 * cell continuing to make progress rather than a cell hanging.
 *
 * WHY A TIMEOUT IS THE RIGHT ANSWER AND A RETRY IS NOT: a bounded call that
 * fails says WHICH operation wedged, and the scenario is recorded against that
 * step. An unbounded call says nothing at all, and the whole cell is lost —
 * along with the several hundred scenarios it never reached.
 */

/** Generous enough for a real device under load; far below a lost cell. */
const DEFAULT_ADB_TIMEOUT_MS = 30_000;
/** Appium round-trips are local HTTP; a slow one is still seconds, not minutes. */
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
/** Session creation installs and launches WDA — legitimately slow the first time. */
const SESSION_TIMEOUT_MS = 180_000;

/**
 * Wrap fetch so no call can outlive `timeoutMs`.
 *
 * The abort reason names the URL and the budget, because "fetch failed" on its
 * own sends you looking at the network when the answer is that WebDriverAgent
 * stopped answering.
 *
 * @param {Function} fetchImpl the real fetch
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.label] surface name, for the error text
 */
function boundedFetch(fetchImpl, { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, label = 'device' } = {}) {
  return async function fetchWithTimeout(url, init = {}) {
    // A caller that already supplied a signal keeps it — overriding one would
    // silently disable a deliberate, tighter bound (session creation passes
    // its own, much longer one).
    if (init.signal) return fetchImpl(url, init);

    const controller = new AbortController();
    let timer;
    /**
     * RACE, not just abort.
     *
     * An AbortController only ASKS the underlying implementation to stop.
     * Something that has stopped responding — precisely the failure this
     * exists to bound — may never honour it, and then the wrapper waits
     * forever exactly like the unbounded call it replaced. Racing guarantees
     * the CALLER stops waiting no matter what the transport does.
     *
     * The signal is still passed, so a well-behaved fetch also tears down the
     * socket instead of leaking it.
     */
    const expiry = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `[${label}] no response within ${timeoutMs}ms from ${redactUrl(url)} — the device or its agent stopped answering`,
          ),
        );
      }, timeoutMs);
      // Do not let a pending bound hold the process open on its own: the work
      // is what should keep node alive, not the watchdog watching it.
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), expiry]);
    } finally {
      // Always cleared: a lingering timer keeps the event loop alive and the
      // runner appears to hang AFTER its work is done.
      clearTimeout(timer);
    }
  };
}

/**
 * URLs carry session ids that are noise in an error message, and could carry
 * more than that in future. Keep origin + the leading path segment.
 */
function redactUrl(url) {
  const s = String(url);
  const m = /^(https?:\/\/[^/]+\/[^/?#]*)/.exec(s);
  return m ? `${m[1]}…` : s;
}

/**
 * Options for a bounded execSync/execFileSync call.
 *
 * `killSignal: 'SIGKILL'` is deliberate. A wedged `adb shell uiautomator dump`
 * holds an exclusive UiAutomation connection, and SIGTERM does not always
 * reclaim it — the next dump then fails for a reason that has nothing to do
 * with the scenario being run.
 */
function execBounds({ timeoutMs = DEFAULT_ADB_TIMEOUT_MS } = {}) {
  return { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' };
}

/**
 * Turn a timed-out exec into an error that names the operation.
 *
 * Node reports a timeout kill as `error.signal === 'SIGKILL'` with no useful
 * message, which is indistinguishable from the command having been killed by
 * something else.
 */
function describeExecFailure(error, { label = 'device', command = '', timeoutMs } = {}) {
  const killed = error && (error.killed === true || error.signal === 'SIGKILL');
  if (killed) {
    return new Error(
      `[${label}] "${command}" did not return within ${timeoutMs}ms and was killed — the device or adb is wedged`,
      { cause: error },
    );
  }
  return error;
}

module.exports = {
  boundedFetch,
  execBounds,
  describeExecFailure,
  redactUrl,
  DEFAULT_ADB_TIMEOUT_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
};
