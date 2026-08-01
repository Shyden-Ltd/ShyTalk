/**
 * Stop grinding against a surface that has died.
 *
 * Bounding each device call (device-io-timeout.js) turned an infinite hang
 * into a survivable crawl. It did not stop the crawl. Measured on run
 * 20260801-113726-local, after the Appium session was destroyed:
 *
 *   [mobile-safari-ios] in-page evaluate failed: no response within 30000ms
 *   from http://localhost:4723/session… — the device or its agent stopped
 *   answering
 *
 * …for every remaining call, at thirty seconds each. Android showed the same
 * shape against a closed CDP connection ("Target page, context or browser has
 * been closed"). A cell with hundreds of scenarios left burns hours proving
 * repeatedly that a dead surface is still dead.
 *
 * A surface that has failed at the TRANSPORT level several times running will
 * not answer the next call either. Say so once, fail fast, and let the cell
 * report an attributable cause.
 *
 * THE DISCRIMINATION THAT MATTERS. A transport failure means "the surface is
 * gone". An assertion failure means "the product did something unexpected" —
 * which is the entire output this harness exists to produce. Tripping on the
 * second would abandon a cell over the very defects it was meant to report,
 * and blame the device for a product bug.
 */

/**
 * Symptoms of the CONNECTION being gone, not of the product misbehaving.
 *
 * Deliberately specific. A loose match like /failed/ or /error/ would catch
 * ordinary assertion text and trip the breaker on real findings.
 */
const TRANSPORT_SYMPTOMS = [
  /no response within \d+ms/i, // our own bounded-fetch message
  /device or its agent stopped answering/i, // ditto, the explanatory half
  /did not return within \d+ms and was killed/i, // a wedged exec
  /target page, context or browser has been closed/i, // Playwright/CDP
  /socket hang up/i,
  /ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND/,
  /session is either terminated or not started/i, // Appium, plainly
  /invalid session id/i,
  /device offline|device .* not found|no devices\/emulators found/i, // adb
  /websocket.*closed|browser has disconnected/i,
];

/** True iff this failure means the surface is unreachable. */
function isTransportFailure(error) {
  if (!error) return false;
  const message = typeof error === 'string' ? error : String(error.message || error);
  if (!message) return false;
  return TRANSPORT_SYMPTOMS.some((rx) => rx.test(message));
}

/**
 * @param {object} [opts]
 * @param {number} [opts.threshold] consecutive transport failures before opening
 * @param {string} [opts.label] surface name, for the error text
 */
function createSurfaceBreaker({ threshold = 3, label = 'device' } = {}) {
  let consecutive = 0;
  let cause = null;

  const breaker = {
    isOpen: () => consecutive >= threshold,
    consecutiveFailures: () => consecutive,

    /** A success proves the surface is alive; a blip is not a death. */
    recordSuccess() {
      consecutive = 0;
      cause = null;
    },

    /**
     * Count a failure — but ONLY if it is a transport failure.
     *
     * An assertion failure neither increments nor resets: whether the product
     * behaved is independent of whether the device is reachable, and treating
     * a product failure as evidence of device health would let a dead surface
     * hide behind its own broken results.
     */
    recordFailure(error) {
      if (!isTransportFailure(error)) return;
      consecutive += 1;
      cause = error;
    },

    /** Run one call through the breaker. */
    async run(fn) {
      if (breaker.isOpen()) {
        throw new Error(
          `[${label}] surface is unreachable — ${consecutive} consecutive transport failures, ` +
            `last: ${cause && cause.message ? cause.message : String(cause)}. ` +
            `Remaining work on this cell is abandoned rather than retried against a dead surface.`,
        );
      }
      try {
        const value = await fn();
        breaker.recordSuccess();
        return value;
      } catch (e) {
        breaker.recordFailure(e);
        throw e;
      }
    },
  };

  return breaker;
}

module.exports = { createSurfaceBreaker, isTransportFailure, TRANSPORT_SYMPTOMS };
