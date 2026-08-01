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
 * Raw TCP connect — "is anything listening on the port?"
 *
 * Cheap and unambiguous when the stack is simply down. NOT sufficient on its
 * own: see `assertEmulatorReachable` for the state where this succeeds and
 * every Admin SDK call still hangs for 60s.
 */
function assertPortOpen({ timeoutMs = 5000 } = {}) {
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
 * Has the gRPC round-trip already been proven in this process?
 *
 * Only a SUCCESS is cached. Caching a failure would keep a suite red after the
 * operator restarted the stack, which is how a guard earns a reputation for
 * lying and gets disabled.
 */
let grpcProven = false;

/** Test seam — forget the cached success. */
function resetLivenessCache() {
  grpcProven = false;
}

/**
 * A Firestore client the probe OWNS, rather than borrowing the product's.
 *
 * The first version lazily did `require('../../src/utils/firebase')`. That
 * module calls `process.exit(1)` when `FIREBASE_DATABASE_URL` is unset outside
 * NODE_ENV=local — so the moment a suite that does NOT configure it called this
 * guard, the guard killed the worker. Six suites (`firestore-rules/*`,
 * `migrate-participant-ids`, `backfill-cross-cohort-flag`) went from passing to
 * "Test suite failed to run: process.exit called with 1".
 *
 * A guard must not be able to take down the thing it guards. A separately-named
 * Admin app depends on nothing but the emulator env, so the probe answers
 * "can a gRPC client reach this emulator?" without asking whether the PRODUCT is
 * configured — which was never the question.
 */
let probeApp = null;
function probeDb() {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const NAME = 'emulator-liveness-probe';
  if (!probeApp) {
    probeApp =
      getApps().find((a) => a.name === NAME) ||
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-shytalk' }, NAME);
  }
  return getFirestore(probeApp);
}

/**
 * Prove the emulator can actually serve the Admin SDK, then let tests run.
 *
 * TWO CHECKS, BECAUSE THE FIRST ONE IS NOT ENOUGH.
 *
 * This used to be a raw TCP connect alone, with a docstring promising it would
 * "fail FAST with an actionable message rather than letting the Admin SDK hang
 * on a gRPC deadline". A TCP connect cannot deliver that promise. Measured
 * 2026-08-01, after the emulator had been up ~22 hours across two full suite
 * runs:
 *
 *   TCP connect        instant
 *   REST write         403 in 0.048s   (rules rejected it — but it ANSWERED)
 *   Admin SDK write    DEADLINE_EXCEEDED after 60.004s, "Waiting for LB pick"
 *
 * The port was open, HTTP was healthy, and the gRPC listener was dead. The probe
 * said "reachable"; eleven suites then failed on `Exceeded timeout of 10000 ms
 * for a hook` — 36 failures and ~20 minutes of wall clock, behind a message that
 * named neither the emulator nor the fix. Restarting the stack took the same
 * call from 60,000ms to 223ms.
 *
 * So the probe now performs the round-trip the tests themselves depend on, and
 * bounds it with `Promise.race`: the gRPC deadline is 60s and belongs to the
 * transport, so only racing guarantees the CALLER stops waiting.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=5000]    TCP connect bound
 * @param {number} [opts.roundTripMs=8000]  gRPC round-trip bound
 * @param {object} [opts.dbImpl]            injected Firestore (tests only)
 * @param {boolean} [opts.skipTcp]          skip the port probe (tests only)
 * @returns {Promise<void>}
 */
async function assertEmulatorReachable({
  timeoutMs = 5000,
  roundTripMs = 8000,
  dbImpl,
  skipTcp = false,
} = {}) {
  if (!skipTcp) await assertPortOpen({ timeoutMs });
  // Hundreds of files call this in beforeAll; the round-trip is paid once.
  // `resetLivenessCache()` is the seam for tests that need a fresh probe —
  // exempting an injected db here instead would mean the cache was never
  // exercised by the tests that claim to cover it.
  if (grpcProven) return;

  // NO ADMIN SDK CONFIGURED, NO ROUND-TRIP — and that is not a weakening.
  //
  // `FIRESTORE_EMULATOR_HOST` is what tells the Admin SDK to talk to the
  // emulator instead of real Google Cloud; `src/utils/firebase` sets it at
  // require time under NODE_ENV=local. A suite where it is unset is not using
  // the Admin gRPC channel at all — the `firestore-rules/*` suites drive the
  // emulator through `@firebase/rules-unit-testing`, which speaks WebChannel
  // over HTTP. Sure enough, when the gRPC listener wedged on 2026-08-01 those
  // suites were unaffected while every Admin-SDK suite died. Probing gRPC on
  // their behalf would test something they do not depend on — and, worse,
  // without the env var the Admin SDK would reach for REAL Firestore.
  if (!dbImpl && !process.env.FIRESTORE_EMULATOR_HOST) return;

  const db = dbImpl || probeDb();
  const { host, port } = firestoreHostPort();
  // NOT `__emulator_liveness_probe__`: Firestore reserves every identifier
  // matching `__.*__` and rejects it with INVALID_ARGUMENT. The unit tests use
  // an injected db and could not see that — the real emulator caught it on the
  // first run, which is the argument for this probe existing at all.
  const ref = db
    .collection('emulator-liveness-probe')
    .doc(`p-${process.pid}-${Date.now().toString(36)}`);

  let timer;
  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Firestore emulator at ${host}:${port} is ACCEPTING CONNECTIONS but not ` +
              `answering Admin SDK calls — no round-trip within ${roundTripMs}ms. ` +
              `The port is open and REST may well be healthy; it is the gRPC listener ` +
              `that is wedged, which every test in this repo depends on. Seen after the ` +
              `emulator has been up for many hours or several full suite runs. ` +
              `Restart the stack: \`bash local/stop.sh && bash local/start.sh\` ` +
              `(free port 3000 first if the pre-flight refuses). Without this check the ` +
              `symptom is dozens of "Exceeded timeout of 10000 ms for a hook" failures ` +
              `that name neither the emulator nor the fix.`,
          ),
        ),
      roundTripMs,
    );
    // Never hold the process open for the sake of the bound itself.
    if (typeof timer.unref === 'function') timer.unref();
  });

  try {
    // Write, read, delete: a wedged channel fails the write, and a read-only
    // check would pass against a stale cache.
    await Promise.race([
      (async () => {
        await ref.set({ at: Date.now() });
        await ref.get();
        await ref.delete();
      })(),
      expiry,
    ]);
    grpcProven = true;
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Like `clearCollection`, but drains a Firestore COLLECTION GROUP (every
 * subcollection named `groupName` under any parent). Needed to isolate
 * tests for crons that query globally via `collectionGroup(...)` — the
 * cron operates on the whole group, so surgical per-id cleanup cannot
 * give a clean slate. The unfiltered group query needs no composite
 * index. Returns the count deleted.
 */
async function clearCollectionGroup(db, groupName, batchSize = 500) {
  let total = 0;
  for (;;) {
    const snap = await db.collectionGroup(groupName).limit(batchSize).get();
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

/**
 * Delete only the documents whose id starts with `prefix`.
 *
 * Jest runs test FILES in parallel workers against ONE emulator project, so a
 * `clearCollection(db, 'deviceBindings')` in worker A deletes documents worker
 * B seeded moments earlier. The symptom is a suite that passes serially
 * (`--runInBand`) and fails only under parallel load — and it gets likelier as
 * files grow. Per-worker projectId namespacing (this file's original
 * suggestion) does NOT work here: the Auth emulator resolves tokens against
 * the project it was started with, so a per-worker project makes every minted
 * ID token 401.
 *
 * The workable isolation is per-FILE document namespacing: give each file a
 * distinct id prefix and clear only that. (SHY-0149)
 */
async function clearPrefixed(db, collectionPath, prefix, batchSize = 500) {
  const { FieldPath } = require('firebase-admin/firestore');
  for (;;) {
    const snap = await db
      .collection(collectionPath)
      .orderBy(FieldPath.documentId())
      .startAt(prefix)
      .endAt(prefix + '\uf8ff') // \uf8ff sorts after every normal character
      .limit(batchSize)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < batchSize) break;
  }
}

module.exports = {
  assertEmulatorReachable,
  assertPortOpen,
  resetLivenessCache,
  clearCollection,
  clearCollectionGroup,
  clearPrefixed,
  firestoreHostPort,
};
