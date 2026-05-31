/**
 * env-health-check.test.js
 *
 * Tests the diagnostic `runEnvCheck` helper used by the runner's
 * `--check-env` flag (gap G3). Verifies per-check correctness +
 * the formatEnvHealthResult string shape.
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../..');
const { runEnvCheck, formatEnvHealthResult, firebaseEnvFor } = require(
  path.join(REPO_ROOT, 'scripts/env-health-check'),
);

function fakeExec(stdout, status = 0) {
  return () => ({ status, stdout });
}

function fakeExecThrowing(err) {
  return () => {
    throw err;
  };
}

// ── firebaseEnvFor — target → env-var mapping ──────────────────────

describe('firebaseEnvFor', () => {
  test('dev → FIREBASE_DEV_API_KEY', () => {
    expect(firebaseEnvFor('dev')).toBe('FIREBASE_DEV_API_KEY');
  });
  test('local → FIREBASE_LOCAL_API_KEY', () => {
    expect(firebaseEnvFor('local')).toBe('FIREBASE_LOCAL_API_KEY');
  });
  test('prod → FIREBASE_PROD_API_KEY', () => {
    expect(firebaseEnvFor('prod')).toBe('FIREBASE_PROD_API_KEY');
  });
  test('unknown target → null', () => {
    expect(firebaseEnvFor('staging')).toBeNull();
    expect(firebaseEnvFor('')).toBeNull();
    expect(firebaseEnvFor(undefined)).toBeNull();
  });
});

// ── runEnvCheck — happy paths ─────────────────────────────────────

describe('runEnvCheck — happy paths', () => {
  test('all envs set + npm available → ok=true', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  test('reports node detail = process.version', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    const nodeCheck = r.checks.find((c) => c.name === 'node');
    expect(nodeCheck.detail).toBe(process.version);
  });

  test('reports npm detail = stdout', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    const npmCheck = r.checks.find((c) => c.name === 'npm');
    expect(npmCheck.detail).toBe('11.0.0');
  });
});

// ── runEnvCheck — missing PERSONAS_PASSWORD ─────────────────────

describe('runEnvCheck — missing PERSONAS_PASSWORD', () => {
  test('PERSONAS_PASSWORD missing → ok=false + check fails with "not set"', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.ok).toBe(false);
    const personasCheck = r.checks.find((c) => c.name === 'PERSONAS_PASSWORD');
    expect(personasCheck.ok).toBe(false);
    expect(personasCheck.error).toBe('not set');
  });

  test('PERSONAS_PASSWORD empty string → still fails', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: '', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.checks.find((c) => c.name === 'PERSONAS_PASSWORD').ok).toBe(false);
  });
});

// ── runEnvCheck — per-target FIREBASE env mapping ───────────────────

describe('runEnvCheck — per-target FIREBASE env', () => {
  test('target=dev checks FIREBASE_DEV_API_KEY', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.checks.find((c) => c.name === 'FIREBASE_DEV_API_KEY').ok).toBe(true);
  });

  test('target=local checks FIREBASE_LOCAL_API_KEY', async () => {
    const r = await runEnvCheck({
      target: 'local',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_LOCAL_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.checks.find((c) => c.name === 'FIREBASE_LOCAL_API_KEY').ok).toBe(true);
  });

  test('target=prod checks FIREBASE_PROD_API_KEY', async () => {
    const r = await runEnvCheck({
      target: 'prod',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_PROD_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.checks.find((c) => c.name === 'FIREBASE_PROD_API_KEY').ok).toBe(true);
  });

  test('unknown target → error check with "no FIREBASE env mapping"', async () => {
    const r = await runEnvCheck({
      target: 'staging',
      env: { PERSONAS_PASSWORD: 'pw' },
      execImpl: fakeExec('11.0.0\n'),
    });
    const fbCheck = r.checks.find((c) => c.name.startsWith('FIREBASE_'));
    expect(fbCheck.ok).toBe(false);
    expect(fbCheck.error).toMatch(/unknown target/);
  });

  test('FIREBASE env missing → fail with target hint in error', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw' },
      execImpl: fakeExec('11.0.0\n'),
    });
    const fbCheck = r.checks.find((c) => c.name === 'FIREBASE_DEV_API_KEY');
    expect(fbCheck.ok).toBe(false);
    expect(fbCheck.error).toMatch(/required for --target dev/);
  });
});

// ── runEnvCheck — npm probe ─────────────────────────────────────

describe('runEnvCheck — npm probe', () => {
  test('npm not in PATH (status=1) → check fails', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('', 1),
    });
    const npmCheck = r.checks.find((c) => c.name === 'npm');
    expect(npmCheck.ok).toBe(false);
    expect(npmCheck.error).toMatch(/not found in PATH/);
  });

  test('execImpl throws → npm check fails with the error message', async () => {
    const r = await runEnvCheck({
      target: 'dev',
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExecThrowing(new Error('ENOENT')),
    });
    const npmCheck = r.checks.find((c) => c.name === 'npm');
    expect(npmCheck.ok).toBe(false);
    expect(npmCheck.error).toMatch(/ENOENT/);
  });
});

// ── runEnvCheck — defaults ──────────────────────────────────────

describe('runEnvCheck — defaults', () => {
  test('default target = dev (matches runner default)', async () => {
    const r = await runEnvCheck({
      env: { PERSONAS_PASSWORD: 'pw', FIREBASE_DEV_API_KEY: 'k' },
      execImpl: fakeExec('11.0.0\n'),
    });
    expect(r.checks.some((c) => c.name === 'FIREBASE_DEV_API_KEY')).toBe(true);
  });
});

// ── formatEnvHealthResult — string shape ────────────────────────

describe('formatEnvHealthResult', () => {
  test('emits header + per-check line + summary', () => {
    const result = {
      ok: true,
      checks: [
        { name: 'PERSONAS_PASSWORD', ok: true },
        { name: 'FIREBASE_DEV_API_KEY', ok: true },
      ],
    };
    const out = formatEnvHealthResult(result);
    expect(out).toMatch(/Env health check:/);
    expect(out).toMatch(/✓ PERSONAS_PASSWORD/);
    expect(out).toMatch(/✓ FIREBASE_DEV_API_KEY/);
    expect(out).toMatch(/All 2 checks passed/);
  });

  test('failing checks use ✗ + error message', () => {
    const result = {
      ok: false,
      checks: [{ name: 'PERSONAS_PASSWORD', ok: false, error: 'not set' }],
    };
    const out = formatEnvHealthResult(result);
    expect(out).toMatch(/✗ PERSONAS_PASSWORD — not set/);
    expect(out).toMatch(/0\/1 checks passed/);
  });

  test('passing check with detail uses (detail) suffix', () => {
    const result = {
      ok: true,
      checks: [{ name: 'node', ok: true, detail: 'v24.0.0' }],
    };
    expect(formatEnvHealthResult(result)).toMatch(/✓ node \(v24\.0\.0\)/);
  });

  test('mixed pass/fail counts correctly', () => {
    const result = {
      ok: false,
      checks: [
        { name: 'a', ok: true },
        { name: 'b', ok: false, error: 'x' },
        { name: 'c', ok: true },
      ],
    };
    expect(formatEnvHealthResult(result)).toMatch(/2\/3 checks passed/);
  });
});
