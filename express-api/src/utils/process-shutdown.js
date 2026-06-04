/**
 * Wire process-level SIGTERM/SIGINT to a shared shutdown handler that
 * invokes every supplied `stop` function (e.g. event-listener detach
 * functions) before calling `process.exit(0)`.
 *
 * Without this wiring, PM2's graceful-restart SIGTERM kills the Node
 * process mid-RTDB-listener-processing, leaving signal entries in RTDB
 * in an ambiguous "did the Firestore txn commit?" state. With it, the
 * listener detaches cleanly so in-flight signals either complete or are
 * left for the next process boot to pick up via the startup-scan.
 *
 * Dependencies are injected to keep this unit-testable without mocking
 * the global `process` object.
 */

function wireProcessShutdown({ proc, stopFns, log }) {
  const handler = (signal) => {
    log.info('process-shutdown', `Received ${signal}, stopping listeners`, { signal });
    for (const stop of stopFns) {
      try {
        stop();
      } catch (err) {
        log.warn('process-shutdown', 'stop function threw during shutdown', {
          error: err && err.message,
        });
      }
    }
    proc.exit(0);
  };

  proc.on('SIGTERM', handler);
  proc.on('SIGINT', handler);
}

module.exports = {
  wireProcessShutdown,
};
