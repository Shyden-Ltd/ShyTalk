/**
 * SHY-0370 — the server entry must load under production env.
 *
 * This is the guard the 2026-08-19 dev outage actually needed. Two modules
 * validated configuration with a `throw` at MODULE SCOPE:
 *
 *   utils/mfa-remember.js   MFA_REMEMBER_SECRET     (SHY-0369)
 *   routes/data-export.js   EXPORT_DOWNLOAD_SECRET  (SHY-0370)
 *
 * `index.js` requires both transitively, so each throw ran DURING STARTUP: the
 * process exited, pm2 crash-looped, and every endpoint returned 502 — including
 * every endpoint unrelated to those features.
 *
 * A regex for "module-level throw" was tried first and abandoned: it reported
 * NONE while a second instance was live, and a brace-counting variant gave 30
 * false positives on `throw err;` inside `catch`. Both were guessing at the
 * question. This test does not guess — it REQUIRES THE REAL ENTRY POINT with
 * production env and no secrets, which is exactly what the VM does.
 *
 * Runs in a child process: requiring the entry binds a port and mutates env, so
 * it must not happen inside the Jest worker.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const API_ROOT = path.resolve(__dirname, '../..');

/** Load `src/index.js` in a clean child with production env and NO app secrets. */
function loadEntry() {
  const env = { ...process.env };
  // Strip every secret the app might validate, so this asserts the real
  // "unconfigured production box" case rather than passing on a developer's
  // populated .env.
  for (const key of Object.keys(env)) {
    if (/SECRET|_KEY$|PASSWORD/i.test(key)) delete env[key];
  }
  env.NODE_ENV = 'production';
  env.FIREBASE_DATABASE_URL = env.FIREBASE_DATABASE_URL || 'https://example.firebaseio.com';

  return spawnSync(
    process.execPath,
    [
      '-e',
      "try { require('./src/index.js'); } catch (e) { console.error('LOAD_ERROR:' + e.message); process.exit(1); } process.exit(0);",
    ],
    { cwd: API_ROOT, env, encoding: 'utf8', timeout: 120_000 },
  );
}

describe('SHY-0370 the server entry loads under production env', () => {
  test('requiring src/index.js with NODE_ENV=production and no secrets does not crash', () => {
    const r = loadEntry();
    const why = (r.stderr || '').split('\n').find((l) => l.startsWith('LOAD_ERROR:')) || '';
    // Surface the reason in the failure message rather than a bare exit code.
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
