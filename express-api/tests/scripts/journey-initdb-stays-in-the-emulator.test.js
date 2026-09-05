'use strict';

/**
 * SHY-0500 (2026-09-05) — Android run 5's log still opened with
 * "MetadataLookupWarning: received unexpected error = All promises were
 * rejected" right after "State assertions: ON (via the Firestore emulator)".
 * localAdminAuth had been taught to switch the GCE metadata probe off, but the
 * runner has a SECOND firebase-admin initialisation — initDb, behind the
 * DB-state assertions — and that one had not. Same class of fix, same
 * contract: the emulator host is pinned, the probe is off, an operator's own
 * value wins, and nothing at all happens for a non-local target.
 */

const { initDb } = require('../../scripts/device-journey-runner');

function harness(env, apps = []) {
  const calls = { initializeApp: [], getFirestore: 0 };
  const deps = {
    env,
    getApps: () => apps,
    initializeApp: (options) => {
      calls.initializeApp.push(options);
      apps.push({ name: '[DEFAULT]', options });
    },
    getFirestore: () => {
      calls.getFirestore += 1;
      return { emulatorDb: true };
    },
  };
  return { deps, calls };
}

describe('the journey runner reads DB state only from the Firestore emulator', () => {
  test('pins the emulator host, switches the metadata probe off and initialises the default demo app', () => {
    const { deps, calls } = harness({});
    const db = initDb('local', deps);
    expect(deps.env.FIRESTORE_EMULATOR_HOST).toBe('localhost:8080');
    expect(deps.env.METADATA_SERVER_DETECTION).toBe('none');
    expect(calls.initializeApp).toEqual([{ projectId: 'demo-shytalk' }]);
    expect(calls.getFirestore).toBe(1);
    expect(db).toEqual({ emulatorDb: true });
  });

  test('keeps an operator-set emulator host, metadata setting and project id', () => {
    const { deps, calls } = harness({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081',
      METADATA_SERVER_DETECTION: 'ping-only',
      GCLOUD_PROJECT: 'demo-other',
    });
    initDb('local', deps);
    expect(deps.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8081');
    expect(deps.env.METADATA_SERVER_DETECTION).toBe('ping-only');
    expect(calls.initializeApp).toEqual([{ projectId: 'demo-other' }]);
  });

  test('reuses an existing default app, but a named app does not count as one', () => {
    const named = harness({}, [{ name: 'auth-emulator' }]);
    initDb('local', named.deps);
    expect(named.calls.initializeApp).toHaveLength(1);

    const existing = harness({}, [{ name: '[DEFAULT]' }]);
    initDb('local', existing.deps);
    expect(existing.calls.initializeApp).toHaveLength(0);
    expect(existing.calls.getFirestore).toBe(1);
  });

  test('does nothing for a non-local target', () => {
    for (const target of ['dev', 'prod', undefined]) {
      const { deps, calls } = harness({});
      expect(initDb(target, deps)).toBeNull();
      expect(deps.env).toEqual({});
      expect(calls.initializeApp).toHaveLength(0);
      expect(calls.getFirestore).toBe(0);
    }
  });
});
