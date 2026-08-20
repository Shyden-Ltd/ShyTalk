/**
 * SHY-0371 — importing the App Check middleware must not configure Firebase.
 *
 * `index.js` pulls middleware in before the Admin SDK is configured on some
 * entry paths, which is why the verifier in middleware/app-check.js is built
 * lazily inside `getVerifier()` rather than at module scope. SHY-0371 replaced
 * `admin.appCheck()` (undefined on firebase-admin 14) with `getAppCheck()` from
 * the modular entry point, and moved that import to the top of the file — safe,
 * because `getAppCheck()` resolves the default app when CALLED, not when
 * imported.
 *
 * Nothing pinned that. Every test in app-check.unit.test.js immediately swaps in
 * `__setVerifierForTests`, so the real body of `getVerifier()` never runs there
 * and a refactor hoisting `getAppCheck()` to module scope would reintroduce
 * exactly the class of startup crash SHY-0371 fixes — silently, and only in
 * production.
 *
 * Runs in child processes: the assertion is about a pristine module registry
 * and a Firebase SDK with no app initialised, neither of which survives inside a
 * Jest worker that other suites have already touched.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const API_ROOT = path.resolve(__dirname, '../..');

function runProbe(script) {
  const env = { ...process.env };
  env.NODE_ENV = 'test';
  // The middleware must be importable on a box where Firebase is not configured
  // at all — that is the entry path the lazy binding exists for.
  delete env.FIREBASE_SERVICE_ACCOUNT_PATH;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: API_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('SHY-0371 importing middleware/app-check is inert', () => {
  test('requiring it does not throw and does not initialise Firebase', () => {
    const r = runProbe(`
      const { getApps } = require('firebase-admin/app');
      if (getApps().length !== 0) { console.error('PRECONDITION_FAILED'); process.exit(2); }
      try {
        require('./src/middleware/app-check');
      } catch (e) {
        console.error('IMPORT_THREW:' + e.message);
        process.exit(1);
      }
      if (getApps().length !== 0) { console.error('EAGER_INIT'); process.exit(1); }
      process.exit(0);
    `);

    expect(r.stderr || '').toBe('');
    expect(r.status).toBe(0);
  });

  test('the probe can actually SEE an eager initialisation', () => {
    // Without this, a green result above could mean "getApps() never reports
    // anything" — the same absence-of-evidence trap that let the original bug
    // through. utils/firebase DOES initialise at module load, so it must trip.
    const r = runProbe(`
      process.env.FIREBASE_DATABASE_URL = 'https://shytalk-probe.firebaseio.com';
      const { getApps } = require('firebase-admin/app');
      require('./src/utils/firebase');
      if (getApps().length === 0) { console.error('PROBE_BLIND'); process.exit(1); }
      process.exit(0);
    `);

    expect(r.status).toBe(0);
  });
});
