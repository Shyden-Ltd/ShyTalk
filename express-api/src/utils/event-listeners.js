/**
 * Event-listener wiring — boots all event-driven listeners that should run
 * for the lifetime of the Express process. Today: the owner-left RTDB
 * listener. Future event-driven additions plug in here so src/index.js
 * stays a thin call-site.
 *
 * Architectural notes:
 *  - The presence checker is constructed here (not inside the listener) so
 *    the listener's contract stays platform-neutral and the path is
 *    centralised. The checker PROPAGATES errors (unlike the route-handler
 *    `isUserPresent` which fail-safes to "present") because the listener
 *    relies on errors to preserve the signal entry for retry.
 *  - Returns a stop() that detaches all listeners — used by tests and
 *    process shutdown hooks (`wireProcessShutdown` in process-shutdown.js).
 *  - INTENTIONALLY unconditional (not gated on NODE_ENV === 'production')
 *    despite `startCronJobs` being prod-only: event-driven RTDB listeners
 *    cost no Firestore quota (no polling), and they MUST run in local/dev
 *    so journey tests can exercise the full owner-disconnect flow against
 *    Firebase emulators. The asymmetry with crons is deliberate.
 */

const { registerOwnerLeftListener } = require('./owner-left-listener');

/**
 * Build a presence checker that reads `rooms/{roomId}/presence/{userId}` and
 * THROWS on RTDB read errors. The owner-left orchestrator catches the throw
 * and rejects up to the listener, which leaves the signal entry in place
 * for retry on next signal-fire or restart-scan.
 */
function buildPresenceChecker(rtdb) {
  return async function presenceChecker(roomId, userId) {
    const snap = await rtdb.ref(`rooms/${roomId}/presence/${userId}`).get();
    return snap.exists();
  };
}

/**
 * Start all event listeners. Returns a stop() that detaches each.
 *
 * @param {object} args
 * @param {object} args.db - firebase-admin Firestore
 * @param {object} args.rtdb - firebase-admin Realtime Database
 * @param {object} args.log - logger
 * @returns {() => void}
 */
function startEventListeners({ db, rtdb, log }) {
  const detachOwnerLeft = registerOwnerLeftListener({
    db,
    rtdb,
    log,
    presenceChecker: buildPresenceChecker(rtdb),
  });

  return function stop() {
    detachOwnerLeft();
  };
}

module.exports = {
  startEventListeners,
  // Exported for direct testing.
  buildPresenceChecker,
};
