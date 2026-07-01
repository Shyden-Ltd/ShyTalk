/**
 * Run a single UI-hierarchy dump, retrying if it THROWS, until it returns or
 * the attempt budget is spent.
 *
 * `uiautomator dump` exits non-zero (so `execSync` throws) while the UI is
 * non-idle — most notably the app's ~4s cold-start, but also mid-animation.
 * A single un-retried attempt then propagates the failure and the caller's
 * element search silently misses (it cannot tell "the dump command failed"
 * from "the element is absent"). This helper retries on a THROW with a short
 * backoff so a settling screen is dumped once it stabilises, while returning
 * immediately on the first successful (non-throwing) attempt — including an
 * empty/partial result, which the caller's matcher interprets exactly as
 * before. The retry deliberately targets the real failure mode (a thrown
 * command error), not the dump's content, so it neither slows nor alters the
 * success path.
 *
 * Pure + injectable (`dumpOnce`, `sleep`) so the retry policy is unit-testable
 * with no device.
 *
 * @param {() => (string|Promise<string>)} dumpOnce performs one dump; returns
 *   the hierarchy XML, or THROWS when the dump command fails (non-idle UI).
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=8] total attempts before giving up.
 * @param {number} [opts.backoffMs=800] delay between attempts (~7×800ms ≈ 5.6s
 *   budget covers the observed ~4s app cold-start settle).
 * @param {(ms:number)=>Promise<void>} [opts.sleep] injectable delay (tests pass a no-op).
 * @returns {Promise<{ok:boolean, xml:string, attempts:number, lastErr:string}>}
 *   `{ok:true, xml, attempts}` from the first non-throwing attempt; `{ok:false,
 *   xml:'', attempts:maxAttempts, lastErr}` if every attempt threw.
 */
async function dumpWithRetry(
  dumpOnce,
  { maxAttempts = 8, backoffMs = 800, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const xml = await dumpOnce();
      return { ok: true, xml, attempts: attempt, lastErr: '' };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
    if (attempt < maxAttempts) {
      await sleep(backoffMs);
    }
  }
  return { ok: false, xml: '', attempts: maxAttempts, lastErr };
}

module.exports = { dumpWithRetry };
