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
 * Async stops ARE supported — the handler awaits every stop (in parallel
 * via Promise.allSettled) before calling proc.exit. Sync stops work
 * unchanged. Errors from any individual stop are caught + logged but do
 * not prevent other stops or the final exit.
 *
 * Dependencies are injected to keep this unit-testable without mocking
 * the global `process` object.
 */

function wireProcessShutdown({ proc, stopFns, log }) {
  const handler = async (signal) => {
    log.info('process-shutdown', `Received ${signal}, stopping listeners`, { signal });
    await Promise.allSettled(
      stopFns.map(async (stop) => {
        try {
          await stop();
        } catch (err) {
          log.warn('process-shutdown', 'stop function threw during shutdown', {
            error: err && err.message,
          });
        }
      }),
    );
    proc.exit(0);
  };

  proc.on('SIGTERM', handler);
  proc.on('SIGINT', handler);
}

module.exports = {
  wireProcessShutdown,
};
