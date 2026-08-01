/**
 * Every scoping variable must survive the detach boundary.
 *
 * THE BUG THIS EXISTS TO PREVENT (caught 2026-08-01 before it ran, but only by
 * reading the script — nothing would have failed):
 *
 * `50-matrix.sh` forks the runner detached:
 *
 *     nohup bash -c "${env_prefix}node scripts/manual-qa-runner.js --matrix …"
 *
 * The child's environment is whatever `env_prefix` names, and nothing else. When
 * `GAUNTLET_DEVICES` was added to the runner, the prefix still listed only
 * `GAUNTLET_BROWSERS` — so `GAUNTLET_DEVICES=mac,android bash gauntlet.sh` would
 * have exited 0, printed nothing unusual, and run the iPhone cells anyway.
 *
 * That is the worst shape of failure: a scope the operator asked for, silently
 * ignored, on a multi-hour unattended run. It cannot be caught by running the
 * gauntlet either — the run "works", it just tests the wrong set.
 *
 * So the guard is structural: every `GAUNTLET_*` variable the RUNNER reads must
 * appear in the script that forwards them. It discovers the list from source
 * rather than restating it, because a hand-maintained list is exactly what went
 * stale here.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const MATRIX_SH = path.join(REPO, 'express-api/scripts/gauntlet/50-matrix.sh');

/** Source with comments stripped — a mention in prose is not a forward. */
function stripShellComments(src) {
  return src.replace(/^[ \t]*#[^\n]*$/gm, '');
}

/** Files the runner reads scoping variables from. */
const RUNNER_SOURCES = [
  'express-api/scripts/matrix-cells.js',
  'express-api/scripts/matrix-phases.js',
  'express-api/scripts/browser-allowlist.js',
];

/**
 * Every GAUNTLET_* variable the runner actually reads, discovered from source.
 *
 * `GAUNTLET_TARGET` and `GAUNTLET_TMP` are excluded: they are read by the
 * dashboard and the scripts themselves, not passed through this fork.
 */
function scopeVarsTheRunnerReads() {
  const found = new Set();
  for (const rel of RUNNER_SOURCES) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    for (const m of src.matchAll(/\b(?:process\.)?env\.(GAUNTLET_[A-Z_]+)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe('the scan is real', () => {
  it('finds the fork script', () => {
    expect(fs.existsSync(MATRIX_SH)).toBe(true);
  });

  it('finds scoping variables in the runner source', () => {
    // A vacuous discovery would make the forwarding assertion meaningless.
    const vars = scopeVarsTheRunnerReads();
    expect(vars.length).toBeGreaterThan(0);
    expect(vars).toContain('GAUNTLET_DEVICES');
  });

  it('the script really does fork detached, which is why this matters', () => {
    const src = fs.readFileSync(MATRIX_SH, 'utf8');
    expect(src).toMatch(/nohup bash -c/);
    expect(src).toMatch(/env_prefix/);
  });
});

describe('every scoping variable the runner reads is forwarded', () => {
  const src = stripShellComments(fs.readFileSync(MATRIX_SH, 'utf8'));

  it.each(scopeVarsTheRunnerReads().map((v) => [v]))('%s reaches the detached child', (name) => {
    // Comments stripped first: the script DOCUMENTS each variable, and matching
    // the documentation would let a forwarding regression pass while the prose
    // still described it.
    expect(src).toContain(name);
  });

  it('lists them for forwarding, not merely mentions them somewhere', () => {
    // The forwarding loop is the mechanism. Asserting on it directly means a
    // refactor that drops the loop cannot pass by leaving the names in place.
    expect(src).toMatch(/for scope_var in [^\n]*GAUNTLET_DEVICES/);
    expect(src).toMatch(/env_prefix="\$\{env_prefix\}\$\{scope_var\}=/);
  });

  it('forwards the phase gate too', () => {
    // Not a hardware scope, but the same failure mode: `stop` silently becoming
    // `report` means an unattended run keeps going after the failure the
    // operator wanted it to stop on.
    expect(src).toContain('GAUNTLET_PHASE_GATE');
  });
});

describe('the guard can fail', () => {
  it('a prefix missing a variable is detected', () => {
    // Mutation in miniature. Without this, a matcher that matched anything
    // would make every assertion above vacuous.
    const pretendScript = `env_prefix="\${env_prefix}GAUNTLET_BROWSERS='x' "`;
    expect(pretendScript).not.toContain('GAUNTLET_DEVICES');
  });

  it('comment stripping does not hide a real forward', () => {
    const withCode = stripShellComments(
      ['# GAUNTLET_DEVICES explained here', 'env_prefix="GAUNTLET_DEVICES=\'x\' "'].join('\n'),
    );
    expect(withCode).toContain('GAUNTLET_DEVICES');
  });

  it('comment stripping DOES hide a mention that is only prose', () => {
    const commentOnly = stripShellComments('# GAUNTLET_DEVICES scopes the matrix\n');
    expect(commentOnly).not.toContain('GAUNTLET_DEVICES');
  });
});
