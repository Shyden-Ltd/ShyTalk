/**
 * env-health-check.js
 *
 * Diagnostic helper backing the runner's `--check-env` flag. Verifies
 * the operator's local env has the credentials + toolchain needed for
 * a journey-test run, BEFORE the matrix dispatches. Mirrors the shape
 * of `driver-health-check.js` (which verifies driver bootstrap):
 *
 *   const result = await runEnvCheck({ target: 'dev' });
 *   // result.ok === true|false
 *   // result.checks === [{ name, ok, error? }, ...]
 *   console.log(formatEnvHealthResult(result));
 *
 * Closes gap G3 from the QA-runner framework tracker — the existing
 * env-validation block fires AFTER several minutes of driver setup
 * + matrix dispatch overhead, so operators learn about a missing
 * env var late. `--check-env` surfaces all problems up-front in
 * a single diagnostic pass.
 */

const { spawnSync } = require('child_process');

/**
 * Returns the FIREBASE env-var name expected for the given target.
 * Mirrors the runner's existing per-target env-var lookup logic.
 */
function firebaseEnvFor(target) {
  if (target === 'dev') return 'FIREBASE_DEV_API_KEY';
  if (target === 'local') return 'FIREBASE_LOCAL_API_KEY';
  if (target === 'prod') return 'FIREBASE_PROD_API_KEY';
  return null;
}

/**
 * Run every env check, return the structured result.
 *
 * Args:
 *   target — one of 'local'|'dev'|'prod' (default 'dev', matching
 *     the runner's default).
 *   env — process.env-shaped object (test injection).
 *   execImpl — spawnSync-shaped function (test injection).
 */
async function runEnvCheck({ target = 'dev', env = process.env, execImpl = spawnSync } = {}) {
  const checks = [];

  // 1. PERSONAS_PASSWORD — required for every journey run.
  checks.push({
    name: 'PERSONAS_PASSWORD',
    ok: Boolean(env.PERSONAS_PASSWORD && env.PERSONAS_PASSWORD.length > 0),
    error: env.PERSONAS_PASSWORD ? undefined : 'not set',
  });

  // 2. FIREBASE_<TARGET>_API_KEY — required per resolved target.
  const fbName = firebaseEnvFor(target);
  if (fbName) {
    checks.push({
      name: fbName,
      ok: Boolean(env[fbName] && env[fbName].length > 0),
      error: env[fbName] ? undefined : `not set (required for --target ${target})`,
    });
  } else {
    checks.push({
      name: `FIREBASE_<TARGET>_API_KEY`,
      ok: false,
      error: `unknown target "${target}" — no FIREBASE env mapping`,
    });
  }

  // 3. node + npm in PATH — necessary for the matrix dispatcher to
  // spawn per-cell subprocesses. Use process.execPath for node (we're
  // running under it). npm we probe via `--version`.
  checks.push({
    name: 'node',
    ok: true,
    error: undefined,
    detail: process.version,
  });

  try {
    const r = execImpl('npm', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (r && r.status === 0 && r.stdout) {
      checks.push({ name: 'npm', ok: true, detail: r.stdout.trim() });
    } else {
      checks.push({
        name: 'npm',
        ok: false,
        error: `not found in PATH (exit=${r ? r.status : '?'})`,
      });
    }
  } catch (e) {
    checks.push({ name: 'npm', ok: false, error: e.message });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
  };
}

/**
 * Format the result for human reading. Symbol prefix (✓/✗) + name +
 * detail or error. Operator-friendly summary line at the bottom.
 */
function formatEnvHealthResult(result) {
  const lines = ['Env health check:'];
  for (const c of result.checks) {
    const mark = c.ok ? '✓' : '✗';
    const tail = c.ok ? (c.detail ? ` (${c.detail})` : '') : c.error ? ` — ${c.error}` : '';
    lines.push(`  ${mark} ${c.name}${tail}`);
  }
  lines.push('');
  const passed = result.checks.filter((c) => c.ok).length;
  const total = result.checks.length;
  lines.push(result.ok ? `All ${total} checks passed.` : `${passed}/${total} checks passed.`);
  return lines.join('\n');
}

module.exports = {
  runEnvCheck,
  formatEnvHealthResult,
  firebaseEnvFor,
};
