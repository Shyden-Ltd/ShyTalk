'use strict';

// SHY-0240 — structural invariants for the Gauntlet v2 pre-flight smoke
// (express-api/scripts/gauntlet/25-smoke.sh) + its wiring into gauntlet-v2.sh.
//
// The smoke's happy path is proven against a live seeded stack (a real run,
// recorded in the story). What IS greppable — and load-bearing — is the round-
// trip legs, the die-on-every-leg abort contract, the local↔dev credential
// branch (the INVALID_PASSWORD trap), the idempotent capture+restore, and that
// the orchestrator runs the smoke BEFORE the matrix (gated on a matrix). The leg
// PREDICATES are execution-tested in gauntlet-v2-smoke.test.js.

const fs = require('node:fs');
const path = require('node:path');

const SMOKE = path.resolve(__dirname, '../../scripts/gauntlet/25-smoke.sh');
const ORCH = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet-v2.sh');
const smoke = fs.readFileSync(SMOKE, 'utf8');
const orch = fs.readFileSync(ORCH, 'utf8');
const smokeLines = smoke.split('\n');
const orchLines = orch.split('\n');
const at = (lines, re) => lines.findIndex((l) => re.test(l));

describe('25-smoke.sh — file basics + library mode (SHY-0240)', () => {
  test('exists, executable, portable shebang, sources lib.sh, set -uo pipefail', () => {
    expect(fs.existsSync(SMOKE)).toBe(true);
    expect(fs.statSync(SMOKE).mode & 0o111).not.toBe(0);
    expect(smoke.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(smoke).toMatch(/source "\$\(dirname "\$0"\)\/lib\.sh"/);
    expect(smoke).toMatch(/set -uo pipefail/);
  });

  test('the leg predicates are defined ABOVE a lib-mode early-return (unit-testable)', () => {
    const libIdx = at(smokeLines, /GAUNTLET_SMOKE_LIB.*&&\s*return 0/);
    expect(libIdx).toBeGreaterThan(-1);
    for (const fn of [
      'smoke_json_field',
      'smoke_signin_body',
      'smoke_lastroom_body',
      'smoke_invalid_password',
      'smoke_write_ok',
      'smoke_roundtrip_ok',
    ]) {
      const defIdx = at(smokeLines, new RegExp(`^${fn}\\(\\)`));
      expect(defIdx).toBeGreaterThan(-1);
      expect(defIdx).toBeLessThan(libIdx);
    }
  });

  test('JSON bodies are built via node (proper escaping — no raw interpolation)', () => {
    // Raw string interpolation of an email/secret with a quote/backslash would
    // malform the body and FALSE-ABORT a healthy stack. Both bodies use stringify.
    expect(smoke).toMatch(/smoke_signin_body\(\)[\s\S]*?JSON\.stringify/);
    expect(smoke).toMatch(/smoke_lastroom_body\(\)[\s\S]*?JSON\.stringify/);
    // …and the sign-in call uses the helper, not a hand-built body.
    expect(smoke).toMatch(/-d "\$\(smoke_signin_body "\$PERSONA_EMAIL" "\$PERSONA_PW"\)"/);
  });
});

describe('25-smoke.sh — the data-plane round-trip legs (SHY-0240)', () => {
  test('leg 1: unauthenticated API health via wait_http', () => {
    expect(smoke).toMatch(/wait_http "\$API_BASE\/api\/health"/);
  });
  test('leg 2: persona sign-in via signInWithPassword → idToken (extracted)', () => {
    expect(smoke).toMatch(/accounts:signInWithPassword\?key=\$API_KEY/);
    expect(smoke).toMatch(/IDTOKEN="\$\(smoke_json_field "\$SIGNIN" idToken\)"/);
  });
  test('leg 3+4: authenticated read (capture) + owner-gated PATCH write', () => {
    expect(smoke).toMatch(/USER_URL="\$API_BASE\/api\/users\/\$PERSONA_UNIQUEID"/);
    expect(smoke).toMatch(/Authorization: Bearer \$IDTOKEN/);
    expect(smoke).toMatch(/OLD_LASTROOM="\$\(smoke_json_field "\$BEFORE" lastRoomName\)"/);
    expect(smoke).toMatch(/-X PATCH "\$USER_URL"[\s\S]*?smoke_lastroom_body "\$NONCE"/);
  });
  test('leg 5: read-back must round-trip the written NONCE (not any 200)', () => {
    expect(smoke).toMatch(/NONCE="smoke-/); // a unique per-run nonce is minted
    expect(smoke).toMatch(/smoke_roundtrip_ok "\$AFTER" "\$NONCE"/); // the SAME nonce
  });
  test('leg 6: idempotent restore of the prior value (best-effort, not fatal)', () => {
    // The reseed merge-write never clears lastRoomName, so the smoke restores it
    // to leave a shared journey persona as found — best-effort (|| warn), since
    // liveness is already proven by leg 5.
    expect(smoke).toMatch(/smoke_lastroom_body "\$OLD_LASTROOM"/);
    expect(smoke).toMatch(/\|\| warn "could not restore lastRoomName/);
  });
});

describe('25-smoke.sh — abort contract + credential branch (SHY-0240)', () => {
  test('every leg dies on failure (health, sign-in, write, read) + unknown target', () => {
    // die → exit 1 → caller ERR trap → FAIL sentinel. One die per failure mode.
    expect((smoke.match(/\bdie\b/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(smoke).toMatch(/die "API health check failed/);
    expect(smoke).toMatch(/die "persona sign-in failed/);
    expect(smoke).toMatch(/die "authenticated write failed/);
    expect(smoke).toMatch(/die "data-plane round-trip FAILED/);
    expect(smoke).toMatch(/die "unknown target/);
  });

  test('local↔dev password + api-key branch (the INVALID_PASSWORD trap)', () => {
    expect(smoke).toMatch(/localdev123/); // local persona password
    expect(smoke).toMatch(/FIREBASE_LOCAL_API_KEY/);
    expect(smoke).toMatch(/PERSONAS_PASSWORD/); // dev persona password
    expect(smoke).toMatch(/FIREBASE_DEV_API_KEY/);
    expect(smoke).toMatch(/smoke_invalid_password/); // explicit actionable branch
  });

  test('a stable, existing seeded persona is the default (verified real id)', () => {
    // adult-power@shytalk.dev ↔ uniqueId 50000010 is an adjacent registry pair
    // whose API-resolved id matches (the token uniqueId claim does NOT — proven
    // by real probe), and it is overridable for other targets.
    expect(smoke).toMatch(/SMOKE_PERSONA_EMAIL:-adult-power@shytalk\.dev/);
    expect(smoke).toMatch(/SMOKE_PERSONA_UNIQUEID:-50000010/);
  });
});

describe('gauntlet-v2.sh — the smoke is wired BEFORE the matrix (SHY-0240)', () => {
  test('the smoke runs after the PIN gate and before matrix-dispatch', () => {
    const gateIdx = at(orchLines, /^pin_ready_gate$/);
    const smokeIdx = at(orchLines, /phase "smoke"; bash "\$HERE\/25-smoke\.sh"/);
    const dispatchIdx = at(orchLines, /50-matrix\.sh" launch/);
    // guard the reference points (house style: -1 means the regex stopped matching)
    expect(gateIdx).toBeGreaterThan(-1);
    expect(smokeIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(smokeIdx).toBeGreaterThan(gateIdx);
    expect(smokeIdx).toBeLessThan(dispatchIdx);
  });

  test('the smoke only runs when a matrix is dispatched (--no-matrix skips it)', () => {
    const block = orch.match(/^pin_ready_gate$[\s\S]*?Optional APK/m);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/if \[ "\$MATRIX" = "1" \]; then/);
    expect(block[0]).toMatch(/25-smoke\.sh" "\$TARGET"/);
  });

  test('local reseeds before the smoke (persona must exist); dev is pre-seeded', () => {
    const block = orch.match(/^pin_ready_gate$[\s\S]*?Optional APK/m);
    expect(block[0]).toMatch(/\[ "\$TARGET" = "local" \]; then phase "reseed-pre-smoke"/);
  });
});
