'use strict';

/**
 * SHY-0328 — the local journey matrix must SEED and SIGN IN with the same
 * persona password.
 *
 * This is the test that should have existed since 2026-07-22. Without it the
 * two sides drifted silently and the LOCAL matrix could not pass on any branch:
 * `20-reseed.sh` FORCES local personas to `localdev123` (the `.local` app
 * flavour bakes `DEV_QA_PERSONAS_PASSWORD`), while `50-matrix.sh` sources
 * `~/.shytalk/dev-personas.env` and exported the 32-character DEV password to
 * the runner. Every persona sign-in failed, so every journey died at its first
 * gate: `0 pass / 5 fail`, and per cell exactly `OK=2 / FAIL=224`.
 *
 * The uniformity is what identifies it. Real product debt does not fail every
 * scenario of every feature on every browser — including desktop `chromium`,
 * which touches no device at all.
 *
 * Note the asymmetry that hid it for so long: the SEED side has been guarded
 * since 2026-07-11 (`20-reseed.sh` dies on `INVALID_PASSWORD` with "a dev
 * PERSONAS_PASSWORD leaked into the seed"). Nobody guarded the RUNNER side.
 *
 * These assertions deliberately DERIVE the expected value from `20-reseed.sh`
 * rather than hard-coding it. A test that hard-codes `localdev123` in both
 * places passes happily on the day someone changes the seed — which is exactly
 * the drift it is supposed to prevent.
 */

const fs = require('fs');
const path = require('path');

const GAUNTLET = path.resolve(__dirname, '../../../scripts/gauntlet');
const reseed = fs.readFileSync(path.join(GAUNTLET, '20-reseed.sh'), 'utf8');
const matrix = fs.readFileSync(path.join(GAUNTLET, '50-matrix.sh'), 'utf8');

/** The password 20-reseed.sh actually seeds local personas with. */
function seededPassword() {
  // The forcing assignment, not a mention in a comment: it sits on a command
  // line as `PERSONAS_PASSWORD=<value> \` ahead of the seeding node call.
  const m = reseed.match(/^\s*&&\s*NODE_PATH=\S+\s+PERSONAS_PASSWORD=(\S+)/m);
  return m ? m[1] : null;
}

/** The password 50-matrix.sh hands the runner for a given target. */
function runnerPassword(target) {
  const line = matrix
    .split('\n')
    .find((l) => l.includes(`[ "$target" = "${target}" ]`) && l.includes('env_prefix='));
  if (!line) return { found: false, value: null };
  const m = line.match(/PERSONAS_PASSWORD=(\S+?)[\s"]/);
  return { found: true, value: m ? m[1] : null };
}

describe('SHY-0328: the local matrix seeds and signs in with the same password', () => {
  it('20-reseed.sh forces an explicit local persona password', () => {
    // If this fails the seeding contract moved and everything below is moot.
    expect(seededPassword()).toBeTruthy();
  });

  it('50-matrix.sh has a local env_prefix at all', () => {
    expect(runnerPassword('local').found).toBe(true);
  });

  it('the runner password for local EQUALS the seeded password', () => {
    // The whole defect in one assertion. Before the fix the runner had no
    // PERSONAS_PASSWORD at all, so this read null against 'localdev123'.
    expect(runnerPassword('local').value).toBe(seededPassword());
  });

  it('does NOT override the password for dev — dev personas use the real secret', () => {
    // The mirror-image mistake: pinning localdev123 for dev would break every
    // dev-target run, and would do it just as uniformly.
    expect(runnerPassword('dev').value).toBeNull();
  });

  it('the seeded password is not the 32-char dev secret', () => {
    // Cheap sanity check that a dev secret has not leaked into the seed line —
    // the failure 20-reseed.sh:63 already guards at runtime, pinned here too.
    const seeded = seededPassword();
    expect(seeded).not.toBeNull();
    expect(seeded.length).toBeLessThan(32);
  });
});

/**
 * The SECOND missing local variable, found the same night and by the same shape.
 *
 * `20-reseed.sh:32` sets FIREBASE_AUTH_EMULATOR_HOST for seeding; `50-matrix.sh`
 * never set it for the runner; and `manual-qa-runner.js` resolved the Identity
 * Toolkit base as `local && HOST ? emulator : PRODUCTION`. Unset, every local
 * matrix run signed personas in against REAL Google auth with a
 * `fake-local-key` API key — failing silently, visible only as `UID: —` in a
 * watermark and 224 failures per cell.
 *
 * Pinning the password alone did NOT fix the matrix. This is what did.
 */

/** The emulator host 20-reseed.sh seeds against. */
function seededAuthHost() {
  const m = reseed.match(/^\s*FIREBASE_AUTH_EMULATOR_HOST=(\S+)/m);
  return m ? m[1] : null;
}

/** The emulator host 50-matrix.sh hands the runner for a target. */
function runnerAuthHost(target) {
  const line = matrix
    .split('\n')
    .find((l) => l.includes(`[ "$target" = "${target}" ]`) && l.includes('env_prefix='));
  if (!line) return { found: false, value: null };
  const m = line.match(/FIREBASE_AUTH_EMULATOR_HOST=(\S+?)[\s"]/);
  return { found: true, value: m ? m[1] : null };
}

describe('SHY-0328: a local run must reach the auth EMULATOR, never production', () => {
  it('20-reseed.sh names an explicit emulator host', () => {
    expect(seededAuthHost()).toBeTruthy();
  });

  it('the runner auth host for local EQUALS the one used for seeding', () => {
    // Seeding into one auth instance and signing in against another is the same
    // class of bug as the password mismatch, and just as silent.
    expect(runnerAuthHost('local').value).toBe(seededAuthHost());
  });

  it('does NOT pin an emulator host for dev', () => {
    expect(runnerAuthHost('dev').value).toBeNull();
  });
});

describe('SHY-0328: resolveAuthBase refuses to fall back to production on local', () => {
  const { resolveAuthBase } = require('../../../scripts/manual-qa-runner');
  const saved = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  afterEach(() => {
    if (saved === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = saved;
  });

  it('REFUSES on a local target when the emulator host is unset', () => {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const r = resolveAuthBase({ target: 'local' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/FIREBASE_AUTH_EMULATOR_HOST/);
    // The point is that it does not quietly hand back a production URL.
    expect(r.base).toBeUndefined();
  });

  it('resolves to the emulator on a local target when the host IS set', () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    const r = resolveAuthBase({ target: 'local' });
    expect(r.ok).toBe(true);
    expect(r.base).toBe('http://localhost:9099/identitytoolkit.googleapis.com');
  });

  it('uses production for a dev target, and does not require the emulator host', () => {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const r = resolveAuthBase({ target: 'dev' });
    expect(r.ok).toBe(true);
    expect(r.base).toBe('https://identitytoolkit.googleapis.com');
  });

  it('ignores a stray emulator host on a dev target', () => {
    // A leftover export in the operator's shell must not silently redirect a
    // dev run at localhost.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    expect(resolveAuthBase({ target: 'dev' }).base).toBe('https://identitytoolkit.googleapis.com');
  });
});
