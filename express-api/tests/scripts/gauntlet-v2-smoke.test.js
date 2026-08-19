'use strict';

// SHY-0240 — BEHAVIOURAL (real-execution) coverage for the Gauntlet v2 pre-flight
// smoke (express-api/scripts/gauntlet/25-smoke.sh).
//
// Two kinds of real-execution proof, no live stack + no fakes:
//   (a) the leg PREDICATES driven directly in library mode (GAUNTLET_SMOKE_LIB)
//       with literal JSON fixtures — so the round-trip / write / sign-in decision
//       logic is mutation-provable (an inverted check goes red), not merely
//       string-present in the source;
//   (b) the ABORT paths via the real entrypoint — the smoke's reason to exist is
//       that it fails fast + non-zero (→ caller ERR trap → FAIL) when the plumbing
//       is dead/misconfigured.
// The happy path itself needs a live seeded stack (proven by a real run, recorded
// in the story). Structural pins: the companion file.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SMOKE = path.resolve(__dirname, '../../scripts/gauntlet/25-smoke.sh');

// Drive the smoke's predicates in library mode (define helpers, skip the round-trip).
function lib(body) {
  const script = `
    set -uo pipefail
    export GAUNTLET_SMOKE_LIB=1
    source "${SMOKE}" 2>/dev/null
    ${body}
  `;
  return spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', timeout: 15000 });
}
// Run the real entrypoint (not lib mode).
const run = (args, env = {}) =>
  spawnSync('/bin/bash', [SMOKE, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...env },
  });

describe('25-smoke.sh predicates — mutation-provable leg logic (SHY-0240)', () => {
  test('smoke_roundtrip_ok bites: the SAME nonce → 0, a different value → non-zero', () => {
    // THE headline AC — the read-back must contain the exact nonce written, not
    // just be a 200. An inverted check would make this test go red.
    const r = lib(`
      smoke_roundtrip_ok '{"lastRoomName":"smoke-1-2","x":1}' 'smoke-1-2'; echo "same=$?"
      smoke_roundtrip_ok '{"lastRoomName":"other-room"}' 'smoke-1-2'; echo "diff=$?"
    `);
    expect(r.stdout).toMatch(/same=0/);
    expect(r.stdout).toMatch(/diff=[1-9]/);
  });

  test('smoke_write_ok bites: success:true → 0, an error body → non-zero', () => {
    const r = lib(`
      smoke_write_ok '{"success":true}'; echo "ok=$?"
      smoke_write_ok '{"error":"Cannot modify another user"}'; echo "err=$?"
    `);
    expect(r.stdout).toMatch(/ok=0/);
    expect(r.stdout).toMatch(/err=[1-9]/);
  });

  test('smoke_invalid_password bites: INVALID_PASSWORD → 0, a good token → non-zero', () => {
    const r = lib(`
      smoke_invalid_password '{"error":{"message":"INVALID_PASSWORD"}}'; echo "bad=$?"
      smoke_invalid_password '{"idToken":"eyJ..."}'; echo "good=$?"
    `);
    expect(r.stdout).toMatch(/bad=0/);
    expect(r.stdout).toMatch(/good=[1-9]/);
  });

  test('smoke_json_field extracts a present field + is empty for missing/garbage', () => {
    const r = lib(`
      echo "tok=[$(smoke_json_field '{"idToken":"eyJabc"}' idToken)]"
      echo "missing=[$(smoke_json_field '{"other":1}' idToken)]"
      echo "garbage=[$(smoke_json_field 'not json' idToken)]"
    `);
    expect(r.stdout).toMatch(/tok=\[eyJabc\]/);
    expect(r.stdout).toMatch(/missing=\[\]/);
    expect(r.stdout).toMatch(/garbage=\[\]/);
  });

  test('smoke_signin_body escapes a quote in the value into valid JSON (I3 false-abort fix)', () => {
    // A raw interpolation of an email/secret containing a quote would malform the
    // body and false-abort a healthy stack; the node-built body must round-trip it.
    const r = lib(`
      body="$(smoke_signin_body 'a"b@z.dev' 'p"w')"
      printf '%s' "$body" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.email+"|"+o.password+"|"+o.returnSecureToken)})'
    `);
    expect(r.status).toBe(0); // JSON.parse did not throw → the body is valid JSON
    expect(r.stdout).toContain('a"b@z.dev|p"w|true');
  });
});

describe('25-smoke.sh — fails fast + non-zero when the plumbing is bad (SHY-0240)', () => {
  test('an unknown target dies with a clear message (never proceeds)', () => {
    const r = run(['prod']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown target: prod/);
  });

  test('a dead API aborts at the health leg within the bound (not after the matrix)', () => {
    const r = run(['local'], { LOCAL_API_BASE: 'http://127.0.0.1:9', SMOKE_HEALTH_TIMEOUT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/API health check failed/);
    expect(r.stdout).not.toMatch(/persona sign-in/); // never reached sign-in/write
  });

  test('--target dev with BOTH credentials missing dies before any network call', () => {
    const env = { ...process.env };
    delete env.FIREBASE_DEV_API_KEY;
    delete env.PERSONAS_PASSWORD;
    const r = spawnSync('/bin/bash', [SMOKE, 'dev'], { encoding: 'utf8', timeout: 15000, env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/FIREBASE_DEV_API_KEY/); // the first :? guard fires
  });

  test('--target dev with only PERSONAS_PASSWORD missing dies naming that var (M1)', () => {
    // The api-key guard is assigned first; with it satisfied, the password guard
    // is the one that must fire — its own message, its own path.
    const env = { ...process.env, FIREBASE_DEV_API_KEY: 'dummy-key' };
    delete env.PERSONAS_PASSWORD;
    const r = spawnSync('/bin/bash', [SMOKE, 'dev'], { encoding: 'utf8', timeout: 15000, env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PERSONAS_PASSWORD/);
  });
});
