/**
 * The emulator probe must test the channel the tests actually use.
 *
 * THE BUG THIS EXISTS TO PREVENT (measured 2026-08-01):
 *
 * `assertEmulatorReachable()` opened a raw TCP socket to the Firestore
 * emulator's port and resolved when it connected. Its own docstring stated the
 * intent correctly — "fails FAST with an actionable message rather than letting
 * the Admin SDK hang on a gRPC deadline" — but a TCP connect is not that check.
 *
 * After ~22 hours up and two full suite runs, the emulator reached a state where
 * it accepted TCP and answered REST in 10ms while its gRPC listener never
 * completed a handshake. Every Admin SDK call then waited the full 60s deadline:
 *
 *   REST write            403 in 0.048s   (rules rejected it — but it ANSWERED)
 *   TCP connect           instant
 *   Admin SDK write       DEADLINE_EXCEEDED after 60.004s, "Waiting for LB pick"
 *
 * The probe said "reachable" and eleven suites then died on hook timeouts — 36
 * failures, ~20 minutes of wall clock, and a failure message
 * ("Exceeded timeout of 10000 ms for a hook") that names neither the emulator
 * nor the fix. Restarting the stack took the same call from 60,000ms to 223ms.
 *
 * A probe that verifies a WEAKER property than the one that matters reports
 * success while the thing it guards is dead. The fix is to make the probe
 * perform a real round-trip over the real channel, bounded, and to say what to
 * do when it fails.
 */
const path = require('path');

const HELPER = path.join(__dirname, '../helpers/firebase-emulator');

/** A db whose round-trip never settles — the wedged-gRPC condition, exactly. */
function deafDb() {
  const never = () => new Promise(() => {});
  const doc = { set: never, get: never, delete: never };
  return { collection: () => ({ doc: () => doc }) };
}

/** A db that answers immediately — a healthy emulator. */
function liveDb(calls = []) {
  const doc = {
    set: async (v) => calls.push(['set', v]),
    get: async () => ({ exists: true, data: () => ({ ok: true }) }),
    delete: async () => calls.push(['delete']),
  };
  return { collection: (name) => (calls.push(['collection', name]), { doc: () => doc }) };
}

/** A db that rejects loudly — a different failure from a hang. */
function throwingDb(message) {
  const boom = () => Promise.reject(new Error(message));
  const doc = { set: boom, get: boom, delete: boom };
  return { collection: () => ({ doc: () => doc }) };
}

describe('the probe exercises the gRPC path, not just the port', () => {
  let assertEmulatorReachable;
  beforeEach(() => {
    jest.resetModules();
    ({ assertEmulatorReachable } = require(HELPER));
  });

  it('performs a real round-trip when the socket is open', async () => {
    const calls = [];
    await assertEmulatorReachable({ dbImpl: liveDb(calls), skipTcp: true });
    // A probe that connects and returns without writing anything is the bug.
    expect(calls.some(([verb]) => verb === 'set')).toBe(true);
  });

  it('cleans up after itself — the probe document is deleted', async () => {
    const calls = [];
    await assertEmulatorReachable({ dbImpl: liveDb(calls), skipTcp: true });
    expect(calls.some(([verb]) => verb === 'delete')).toBe(true);
  });

  it('writes to a clearly-named probe collection, not a product one', async () => {
    // A probe that scribbles into `users` would be indistinguishable from test
    // data and would trip the per-file isolation prefixes.
    const calls = [];
    await assertEmulatorReachable({ dbImpl: liveDb(calls), skipTcp: true });
    const [, name] = calls.find(([verb]) => verb === 'collection');
    expect(name).toMatch(/probe/i);
  });
});

describe('a wedged emulator is caught in seconds, not sixty', () => {
  let assertEmulatorReachable;
  beforeEach(() => {
    jest.resetModules();
    ({ assertEmulatorReachable } = require(HELPER));
  });

  it('rejects rather than hanging when the round-trip never settles', async () => {
    // The deaf db models the measured condition: the call is accepted and
    // simply never answers. `Promise.race` is what guarantees the CALLER stops
    // waiting — an AbortController only ASKS a transport to stop, and gRPC's
    // 60s deadline is the transport here.
    const started = Date.now();
    await expect(
      assertEmulatorReachable({ dbImpl: deafDb(), skipTcp: true, roundTripMs: 300 }),
    ).rejects.toThrow(/not answering|wedged/i);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('names the fix, not just the symptom', async () => {
    // "Exceeded timeout of 10000 ms for a hook" cost twenty minutes because it
    // named neither the emulator nor what to do. The message must carry both.
    const err = await assertEmulatorReachable({
      dbImpl: deafDb(),
      skipTcp: true,
      roundTripMs: 200,
    }).catch((e) => e);
    expect(err.message).toMatch(/local\/stop\.sh|local\/start\.sh|restart/i);
  });

  it('states the DISTINGUISHING evidence: the port is open but gRPC is dead', async () => {
    // Without this, the message reads like "emulator not running" and the
    // operator wastes time checking a stack that is demonstrably up.
    const err = await assertEmulatorReachable({
      dbImpl: deafDb(),
      skipTcp: true,
      roundTripMs: 200,
    }).catch((e) => e);
    expect(err.message).toMatch(/accept|listen|port/i);
  });

  it('surfaces a rejection verbatim rather than calling it a hang', async () => {
    // A wedged channel and a permission error need different responses; a probe
    // that reports both as "not answering" sends people to the wrong fix.
    const err = await assertEmulatorReachable({
      dbImpl: throwingDb('7 PERMISSION_DENIED: rules rejected the write'),
      skipTcp: true,
      roundTripMs: 200,
    }).catch((e) => e);
    expect(err.message).toMatch(/PERMISSION_DENIED/);
  });
});

describe('cost control — the probe runs once per process', () => {
  let helper;
  beforeEach(() => {
    jest.resetModules();
    helper = require(HELPER);
  });

  it('does not re-probe on every call', async () => {
    // Hundreds of test files call this in beforeAll. Paying a round-trip each
    // time would add real wall clock to every run.
    const calls = [];
    const db = liveDb(calls);
    await helper.assertEmulatorReachable({ dbImpl: db, skipTcp: true });
    const afterFirst = calls.length;
    await helper.assertEmulatorReachable({ dbImpl: db, skipTcp: true });
    expect(calls.length).toBe(afterFirst);
  });

  it('does NOT cache a failure — a restarted stack must be usable', async () => {
    // Caching the failure would mean a suite that fails once keeps failing even
    // after the operator fixes the emulator, which teaches people to distrust
    // the probe and disable it.
    await expect(
      helper.assertEmulatorReachable({ dbImpl: deafDb(), skipTcp: true, roundTripMs: 150 }),
    ).rejects.toThrow();
    const calls = [];
    await helper.assertEmulatorReachable({ dbImpl: liveDb(calls), skipTcp: true });
    expect(calls.some(([verb]) => verb === 'set')).toBe(true);
  });
});

describe('the guard cannot take down the thing it guards', () => {
  /**
   * THE SECOND BUG, caught by the full suite rather than by these tests.
   *
   * The probe's first version lazily did `require('../../src/utils/firebase')`
   * to borrow the product's Firestore client. That module calls
   * `process.exit(1)` when `FIREBASE_DATABASE_URL` is unset outside
   * NODE_ENV=local. Six suites that legitimately never configure it —
   * `firestore-rules/*` (which drive the emulator through
   * `@firebase/rules-unit-testing`, not the Admin SDK),
   * `migrate-participant-ids`, `backfill-cross-cohort-flag` — went from passing
   * to "Test suite failed to run: process.exit called with 1".
   *
   * A guard that can kill the worker is worse than no guard.
   */
  let assertEmulatorReachable;
  const PRIOR = {};
  beforeEach(() => {
    jest.resetModules();
    ({ assertEmulatorReachable } = require(HELPER));
    PRIOR.node = process.env.NODE_ENV;
    PRIOR.host = process.env.FIRESTORE_EMULATOR_HOST;
    PRIOR.dbUrl = process.env.FIREBASE_DATABASE_URL;
  });
  afterEach(() => {
    for (const [k, v] of [
      ['NODE_ENV', PRIOR.node],
      ['FIRESTORE_EMULATOR_HOST', PRIOR.host],
      ['FIREBASE_DATABASE_URL', PRIOR.dbUrl],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('does not require the product firebase module', () => {
    // Asserted at the source, because the consequence — process.exit — cannot
    // be observed from inside the process it terminates.
    //
    // Comments stripped FIRST. The helper documents the removed call in its own
    // docstring, and the first version of this assertion flagged that prose as
    // the bug — which would have pushed someone to delete the explanation to
    // get green. Exactly the trap `tests-must-not-reimplement-helpers` and the
    // exec-detector both hit: a mention is not a call site.
    const src = require('fs')
      .readFileSync(require.resolve(HELPER), 'utf8')
      .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '')
      .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
    expect(src).not.toMatch(/require\(['"]\.\.\/\.\.\/src\/utils\/firebase['"]\)/);
  });

  it('…and the guard can still fail — the pattern matches a real call', () => {
    // Without this, a regex that matched nothing would make the check vacuous.
    const sample = `const { db } = require('../../src/utils/firebase');`;
    expect(sample).toMatch(/require\(['"]\.\.\/\.\.\/src\/utils\/firebase['"]\)/);
  });

  it('returns quietly for a suite with no Admin SDK pointed at the emulator', async () => {
    // The rules-unit-testing shape: no NODE_ENV=local, no
    // FIRESTORE_EMULATOR_HOST, and no dependence on the Admin gRPC channel.
    // Those suites were unaffected when gRPC wedged, so probing it for them
    // would test something they do not use — and without the env var the Admin
    // SDK would reach for REAL Firestore.
    delete process.env.NODE_ENV;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_DATABASE_URL;
    await expect(assertEmulatorReachable({ skipTcp: true })).resolves.toBeUndefined();
  });

  it('still runs the round-trip when an emulator IS configured', async () => {
    // The other half: skipping must be driven by "no Admin SDK here", never by
    // "the probe was inconvenient".
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const calls = [];
    await assertEmulatorReachable({ dbImpl: liveDb(calls), skipTcp: true });
    expect(calls.some(([verb]) => verb === 'set')).toBe(true);
  });
});

describe('the TCP probe still catches a stack that is simply down', () => {
  let assertEmulatorReachable;
  beforeEach(() => {
    jest.resetModules();
    ({ assertEmulatorReachable } = require(HELPER));
  });

  it('fails fast on a closed port, before attempting any round-trip', async () => {
    // Port 1 is reserved and never listening. The round-trip must not even be
    // attempted — connecting is the cheaper, clearer signal when nothing is up.
    const calls = [];
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
    try {
      await expect(
        assertEmulatorReachable({ dbImpl: liveDb(calls), timeoutMs: 1000 }),
      ).rejects.toThrow(/not reachable/);
      expect(calls).toEqual([]);
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });
});
