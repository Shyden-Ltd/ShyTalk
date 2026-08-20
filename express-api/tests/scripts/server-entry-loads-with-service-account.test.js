/**
 * SHY-0371 — the server entry must load on a CONFIGURED box.
 *
 * The dev VM crash-looped 37,572 times on:
 *
 *   TypeError: Cannot read properties of undefined (reading 'cert')
 *       at src/utils/firebase.js:71:49        <- admin.credential.cert(...)
 *       at src/middleware/auth.js:8:22        <- required during startup
 *
 * firebase-admin 14 deleted the namespaced root surface, so `admin.credential`
 * is `undefined`. Line 71 lives inside `if (serviceAccountPath)`, and
 * FIREBASE_SERVICE_ACCOUNT_PATH is set on the VM but NOT in CI — so in every
 * test environment that line was dead code and every suite stayed green while
 * dev returned 502 on every endpoint.
 *
 * The sibling guard (server-entry-loads-in-production.test.js, SHY-0370) covers
 * the opposite shape: an UNCONFIGURED production box, with secrets stripped. It
 * cannot reach this line, by construction. Both shapes are real; both are
 * asserted.
 *
 * Env here mirrors the VM exactly, including NODE_ENV=development — the VM has
 * run `development` since 2026-05-16, which is why the production-gated throws
 * of SHY-0369/SHY-0370 never fired there.
 *
 * No mocks: the real entry point, the real Admin SDK, and a real (throwaway)
 * RSA key generated per run into a temp dir. It is valid for no project and is
 * never written into the repo.
 *
 * Runs in a child process: requiring the entry calls app.listen and mutates
 * env, so it must not happen inside the Jest worker.
 */
const { spawnSync } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const API_ROOT = path.resolve(__dirname, '../..');

/** A structurally real service-account JSON with a freshly generated key. */
function writeThrowawayServiceAccount() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0371-sa-'));
  const file = path.join(dir, 'service-account.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'service_account',
      project_id: 'shytalk-startup-probe',
      private_key_id: 'startup-probe',
      private_key: privateKey,
      client_email: 'startup-probe@shytalk-startup-probe.iam.gserviceaccount.com',
      client_id: '000000000000000000000',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  );
  return { dir, file };
}

/** Load `src/index.js` in a clean child with the dev VM's environment. */
function loadEntryWithServiceAccount(serviceAccountPath) {
  const env = { ...process.env };
  // Jest and local shells both leak NODE_ENV; pin every variable the startup
  // branch reads so this asserts the VM's shape and not the runner's.
  env.NODE_ENV = 'development';
  env.FIREBASE_SERVICE_ACCOUNT_PATH = serviceAccountPath;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  env.FIREBASE_DATABASE_URL = 'https://shytalk-startup-probe.firebaseio.com';
  // Ephemeral port: the entry calls app.listen unconditionally, and a fixed
  // port would collide with a running local stack or a parallel worker.
  env.PORT = '0';

  return spawnSync(
    process.execPath,
    [
      '-e',
      "try { require('./src/index.js'); } catch (e) { console.error('LOAD_ERROR:' + e.message); process.exit(1); } process.exit(0);",
    ],
    { cwd: API_ROOT, env, encoding: 'utf8', timeout: 120_000 },
  );
}

describe('SHY-0371 the server entry loads with a service account configured', () => {
  let fixture;

  beforeAll(() => {
    fixture = writeThrowawayServiceAccount();
  });

  afterAll(() => {
    if (fixture) fs.rmSync(fixture.dir, { recursive: true, force: true });
  });

  test('requiring src/index.js with FIREBASE_SERVICE_ACCOUNT_PATH set does not crash', () => {
    const r = loadEntryWithServiceAccount(fixture.file);
    const why = (r.stderr || '').split('\n').find((l) => l.startsWith('LOAD_ERROR:')) || '';
    // Surface the reason rather than a bare exit code — the original failure
    // was "Cannot read properties of undefined (reading 'cert')".
    expect(why).toBe('');
    expect(r.status).toBe(0);
  });

  test('the harness itself works — a deliberately broken entry IS caught', () => {
    // Without this, a green result above could mean "spawn silently failed".
    const r = spawnSync(process.execPath, ['-e', "throw new Error('deliberate');"], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(r.status).not.toBe(0);
  });
});

describe('SHY-0371 a bad service account fails as CONFIGURATION, not as a TypeError', () => {
  /**
   * The distinction this pins is the whole story. Before the fix, a perfectly
   * valid service account still died with
   * "Cannot read properties of undefined (reading 'cert')" — an SDK-API failure
   * wearing the costume of a config failure, which is why three sessions read
   * the outage as a missing secret. A genuine config problem must be
   * unmistakably a config problem.
   */
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0371-bad-sa-'));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a MISSING service-account file names the file it could not read', () => {
    const missing = path.join(dir, 'does-not-exist.json');
    const r = loadEntryWithServiceAccount(missing);
    const why = (r.stderr || '').split('\n').find((l) => l.startsWith('LOAD_ERROR:')) || '';

    expect(r.status).not.toBe(0);
    expect(why).toContain('Cannot find module');
    expect(why).toContain(missing);
    // The regression that matters: never again a bare undefined-property read.
    expect(why).not.toContain('Cannot read properties of undefined');
  });

  test('a MALFORMED service-account file fails on the file, not on the SDK', () => {
    const malformed = path.join(dir, 'malformed.json');
    fs.writeFileSync(malformed, '{ "type": "service_account", ');

    const r = loadEntryWithServiceAccount(malformed);
    const why = (r.stderr || '').split('\n').find((l) => l.startsWith('LOAD_ERROR:')) || '';

    expect(r.status).not.toBe(0);
    expect(why).toContain(malformed);
    expect(why).not.toContain('Cannot read properties of undefined');
  });
});
