/**
 * Server-Sent Events — the push transport for API-only backend access.
 *
 * Ratified by the operator on 2026-08-25 (SHY-0169). The clients hold ~48 live
 * Firestore and RTDB listeners between them, which is precisely how
 * authorization ended up being decided on the phone rather than on the server
 * (EPIC-0006). A request/response endpoint cannot replace a listener, so the
 * server holds it with the Admin SDK and fans out to authorised subscribers
 * over `text/event-stream`.
 *
 * SSE rather than WebSocket because every client→server action in this app is
 * already a mutation, and mutations are ordinary POST/PATCH routes. Nothing
 * needs a duplex channel, and one-way over plain HTTP costs no new
 * infrastructure — it is an ordinary authed route, so it inherits the same
 * server-side authorization as everything else.
 *
 * This module is the transport ONLY. It knows nothing about conversations,
 * rooms or presence, so each migration reuses it instead of inventing its own
 * framing.
 */

const log = require('./log');

/** Long enough to be cheap, short enough to beat idle proxy timeouts. */
const DEFAULT_HEARTBEAT_MS = 25_000;

/**
 * Begin an SSE response.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ heartbeatMs?: number }} [options]
 * @returns {{
 *   send: (event: string, data: unknown) => boolean,
 *   onClose: (fn: () => void) => void,
 *   close: () => void,
 *   readonly isOpen: boolean,
 * }}
 */
function openStream(req, res, { heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // The one people forget. A buffering proxy in front of Express holds every
  // event until the response ends — and a stream never ends, so the client sees
  // nothing at all and the connection merely looks idle.
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let open = true;
  /** @type {Array<() => void>} */
  const cleanups = [];

  /**
   * Run every registered cleanup, even if one throws.
   *
   * The expensive half of a stream is the Firestore listener behind it. If the
   * first cleanup throws — a listener already detached, say — the rest must
   * still run, or a dropped phone leaks a live query for the life of the
   * process.
   */
  function runCleanups() {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (err) {
        log.error('sse', 'Stream cleanup failed', { error: err.message });
      }
    }
  }

  function shutdown(endResponse) {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
    runCleanups();
    if (endResponse) {
      try {
        res.end();
      } catch (err) {
        log.error('sse', 'Failed to end stream', { error: err.message });
      }
    }
  }

  const heartbeat = setInterval(() => {
    if (!open) return;
    try {
      // A comment line: clients ignore it, but proxies and load balancers see
      // traffic and leave the connection alone.
      res.write(': ping\n\n');
    } catch (err) {
      log.info('sse', 'Heartbeat failed; closing stream', { error: err.message });
      shutdown(false);
    }
  }, heartbeatMs);

  req.on('close', () => shutdown(false));

  return {
    send(event, data) {
      // Never write to a closed stream. Writing to a dead socket throws
      // asynchronously, which takes the process down — and a fan-out racing a
      // disconnect is the normal case, not an edge case.
      if (!open) return false;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch (err) {
        log.info('sse', 'Write failed; closing stream', { error: err.message });
        shutdown(false);
        return false;
      }
    },

    onClose(fn) {
      // Registering after the stream has already gone runs immediately, so a
      // late registration cannot leak the thing it was meant to release.
      if (!open) {
        try {
          fn();
        } catch (err) {
          log.error('sse', 'Late cleanup failed', { error: err.message });
        }
        return;
      }
      cleanups.push(fn);
    },

    close() {
      shutdown(true);
    },

    get isOpen() {
      return open;
    },
  };
}

module.exports = { openStream, DEFAULT_HEARTBEAT_MS };
