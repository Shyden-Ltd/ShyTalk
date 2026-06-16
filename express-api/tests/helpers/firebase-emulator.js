/**
 * firebase-emulator.js — EPIC-0003 Phase 3 shared test helper (SHY-0109).
 *
 * The reusable pattern for migrating express-api Jest tests OFF mocking
 * `src/utils/firebase` and ONTO the REAL Firebase Emulator stack
 * (Auth/Firestore/RTDB under projectId `demo-shytalk` —
 * no credentials, $0, CI-safe). Copy this shape for the remaining
 * Phase-3 migrations.
 *
 * Usage (top of a migrated test file — set NODE_ENV BEFORE any require
 * that pulls in src/utils/firebase, because firebase.js reads NODE_ENV
 * at module-load time to point the Admin SDK at the emulator):
 *
 *   const PRIOR = process.env.NODE_ENV;
 *   process.env.NODE_ENV = 'local';
 *   const { db } = require('../../src/utils/firebase');
 *   const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');
 *
 *   beforeAll(() => assertEmulatorReachable());
 *   afterAll(() => { process.env.NODE_ENV = PRIOR; });
 *
 * Two cleanup patterns (pick by collection):
 *   - DEDICATED/throwaway collection → `clearCollection(db, name)` wipes it.
 *   - A SHARED real collection like `users` (also populated by
 *     local/seed.js) → seed docs with KNOWN ids and delete only those ids
 *     in afterEach, so you neither wipe local seed data nor fight another
 *     worker. The emulator is shared mutable state across parallel Jest
 *     workers; for now distinct collections / surgical cleanup keep the
 *     PoC isolated. Per-worker projectId namespacing (JEST_WORKER_ID) is
 *     the scaling answer when many files share one collection — out of
 *     scope for the keystone (see SHY-0109).
 *
 * If the emulator isn't running, `assertEmulatorReachable()` fails FAST
 * with an actionable message rather than letting the Admin SDK hang on a
 * gRPC deadline — and it never silently skips (a skip would be a soft
 * mock, the exact false confidence EPIC-0003 bans).
 *
 * NOTE for migration authors copying this file: use the project logger
 * (`require('../../src/utils/log')`), never `console.*` — eslint runs
 * `--max-warnings=0` and `no-console` is a warning, so a stray
 * `console.log` is a hard build failure.
 */
const net = require('net');

const FIRESTORE_EMULATOR_DEFAULT = 'localhost:8080';

/**
 * Parse the Firestore emulator `host:port` from FIRESTORE_EMULATOR_HOST
 * (set by src/utils/firebase.js under NODE_ENV=local) or a default.
 * @returns {{ host: string, port: number }}
 */
function firestoreHostPort() {
  const hostPort = process.env.FIRESTORE_EMULATOR_HOST || FIRESTORE_EMULATOR_DEFAULT;
  const sep = hostPort.lastIndexOf(':');
  return { host: hostPort.slice(0, sep), port: Number(hostPort.slice(sep + 1)) };
}

/**
 * Fast, bounded reachability probe for the Firestore emulator. Resolves
 * if something is listening; rejects within `timeoutMs` with an
 * actionable message otherwise. A raw TCP connect (no HTTP semantics) is
 * the most reliable "is it up" signal and needs no clear-text URL.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
function assertEmulatorReachable({ timeoutMs = 5000 } = {}) {
  const { host, port } = firestoreHostPort();
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    // Guard against a double settle (e.g. a destroy-induced error after a
    // timeout). Defensive — this helper is the copy-paste template for the
    // remaining Phase-3 migrations, and a caller may wrap it in Promise.race.
    let settled = false;
    const fail = (why) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(
        new Error(
          `Firebase Firestore emulator not reachable at ${host}:${port} (${why}). ` +
            'Start the local stack first: `bash local/start.sh`. ' +
            'EPIC-0003 tests run against the REAL emulator — they never mock firebase.',
        ),
      );
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.end();
      resolve();
    });
    socket.once('timeout', () => fail(`no response within ${timeoutMs}ms`));
    socket.once('error', (err) => fail(err.code || err.message));
  });
}

/**
 * Delete every document in `collectionPath` via batched Admin-SDK writes
 * (for test isolation on a DEDICATED collection). Paginates at
 * `batchSize` so it drains collections larger than one batch.
 * @returns {Promise<number>} count of documents deleted
 */
async function clearCollection(db, collectionPath, batchSize = 500) {
  let total = 0;
  // Drain in batches. `break` on empty handles an empty collection AND a
  // doc count that is an exact multiple of batchSize; a short final batch
  // (size < batchSize) means there is nothing more, so we skip the extra
  // empty round-trip.
  for (;;) {
    const snap = await db.collection(collectionPath).limit(batchSize).get();
    if (snap.empty) {
      break;
    }
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    total += snap.size;
    if (snap.size < batchSize) {
      break;
    }
  }
  return total;
}

module.exports = { assertEmulatorReachable, clearCollection, firestoreHostPort };
