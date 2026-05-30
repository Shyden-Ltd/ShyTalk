/**
 * manual-qa-runner-help-version.test.js
 *
 * Pins `--help` / `-h` / `--version` / `-v` behavior for the manual QA
 * runner. These flags MUST exit before any env-var validation so operators
 * can discover the runner's surface without setting PERSONAS_PASSWORD or
 * any FIREBASE_*_API_KEY.
 *
 * Two layers:
 *   1. Unit — pure helpers `formatUsage()` and `formatVersion(version)`
 *      return strings; tested directly with no subprocess.
 *   2. Integration — spawn the runner with each flag and assert exit code
 *      + stdout shape. Confirms the wiring inside `main()` (parser
 *      recognition + early exit before env-validation).
 *
 * Drift-catch meta-test: reads the runner source, extracts every
 * `flat[i] === '--xxx'` flag-recognition line, and asserts each flag
 * appears in `formatUsage()`. Future PRs adding a flag without
 * documenting it go RED here.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'express-api/package.json');

const { formatUsage, formatVersion } = require(RUNNER_PATH);

// ── formatUsage — content + drift-catch ────────────────────────────

describe('formatUsage', () => {
  test('returns a non-empty string', () => {
    const text = formatUsage();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  test('includes the runner name', () => {
    expect(formatUsage()).toMatch(/manual-qa-runner/);
  });

  test('includes a Usage: line', () => {
    expect(formatUsage()).toMatch(/Usage:/);
  });

  test('lists every --flag recognized by the parser (drift-catch)', () => {
    // Read the runner source, grep for every `flat[i] === '--xxx'`
    // pattern in the CLI arg-parse loop, and assert each flag is named
    // in formatUsage(). This is the regression that catches "added a
    // flag but forgot to document it" without anyone having to remember.
    const source = fs.readFileSync(RUNNER_PATH, 'utf8');
    const flagPattern = /flat\[i\]\s*===\s*'(--[a-z][a-z-]*)'/g;
    const flags = new Set();
    let m;
    while ((m = flagPattern.exec(source)) !== null) {
      flags.add(m[1]);
    }
    expect(flags.size).toBeGreaterThan(5); // sanity: parser has many flags
    const usage = formatUsage();
    const missing = [];
    for (const flag of flags) {
      if (!usage.includes(flag)) missing.push(flag);
    }
    expect(missing).toEqual([]);
  });

  test('lists every supported target environment', () => {
    const usage = formatUsage();
    expect(usage).toMatch(/local/);
    expect(usage).toMatch(/\bdev\b/);
    expect(usage).toMatch(/prod/);
  });

  test('includes at least one example invocation', () => {
    const usage = formatUsage();
    // Look for "Example" header followed by a line starting with `node`
    // or `PERSONAS_PASSWORD=` — operators report the lack of a copy-
    // pasteable example as the #1 friction point.
    expect(usage).toMatch(/Examples?:/i);
    expect(usage).toMatch(/node .*manual-qa-runner/);
  });

  test('documents both --help and --version', () => {
    const usage = formatUsage();
    expect(usage).toMatch(/--help/);
    expect(usage).toMatch(/--version/);
  });

  test('mentions the -h and -v short aliases', () => {
    const usage = formatUsage();
    expect(usage).toMatch(/-h\b/);
    expect(usage).toMatch(/-v\b/);
  });
});

// ── formatVersion — pure helper ────────────────────────────────────

describe('formatVersion', () => {
  test('returns a string containing the version', () => {
    expect(formatVersion('1.2.3')).toMatch(/1\.2\.3/);
  });

  test('includes the runner name for operator clarity', () => {
    expect(formatVersion('1.2.3')).toMatch(/manual-qa-runner/);
  });

  test('handles 0.x versions', () => {
    expect(formatVersion('0.0.1')).toMatch(/0\.0\.1/);
  });

  test('returns a single line (no trailing noise)', () => {
    const out = formatVersion('1.0.0');
    expect(out.split('\n').filter((l) => l.trim().length > 0).length).toBe(1);
  });

  test('does not throw on unusual but valid semver', () => {
    expect(() => formatVersion('1.0.0-beta.1+build.42')).not.toThrow();
    expect(formatVersion('1.0.0-beta.1+build.42')).toMatch(/1\.0\.0-beta\.1\+build\.42/);
  });
});

// ── CLI integration — exit code + stdout shape ─────────────────────

function runCli(args, env = {}) {
  // Strip PERSONAS_PASSWORD + FIREBASE_*_API_KEY to prove --help / --version
  // exit BEFORE env validation. Operators currently cannot discover the
  // flag surface without setting these — that's the bug being fixed.
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.PERSONAS_PASSWORD;
  delete cleanEnv.FIREBASE_DEV_API_KEY;
  delete cleanEnv.FIREBASE_LOCAL_API_KEY;
  delete cleanEnv.FIREBASE_PROD_API_KEY;
  // process.execPath is the absolute path to the node binary running this
  // test — guarantees we use the same Node version as Jest and silences
  // sonarjs/no-os-command-from-path (which would otherwise warn about
  // PATH-relative 'node').
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 10000,
  });
}

describe('CLI integration — --help / -h', () => {
  test('--help exits 0 without any env vars set', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
  });

  test('--help prints usage text to stdout (not stderr)', () => {
    const r = runCli(['--help']);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).toMatch(/manual-qa-runner/);
  });

  test('-h is an alias for --help', () => {
    const r = runCli(['-h']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('--help wins when combined with other flags', () => {
    const r = runCli(['--help', '--target', 'local']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    // Crucially: must NOT have hit env validation
    expect(r.stderr).not.toMatch(/MISSING_ENV/);
  });

  test('--help wins when --version also passed', () => {
    const r = runCli(['--help', '--version']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('--help does not require PERSONAS_PASSWORD', () => {
    const r = runCli(['--help']);
    expect(r.stderr).not.toMatch(/MISSING_ENV/);
    expect(r.stderr).not.toMatch(/PERSONAS_PASSWORD/);
  });
});

describe('CLI integration — --version / -v', () => {
  test('--version exits 0 without any env vars set', () => {
    const r = runCli(['--version']);
    expect(r.status).toBe(0);
  });

  test('--version prints the version from express-api/package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const r = runCli(['--version']);
    expect(r.stdout).toContain(pkg.version);
  });

  test('-v is an alias for --version', () => {
    const r = runCli(['-v']);
    expect(r.status).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    expect(r.stdout).toContain(pkg.version);
  });

  test('--version does not require PERSONAS_PASSWORD', () => {
    const r = runCli(['--version']);
    expect(r.stderr).not.toMatch(/MISSING_ENV/);
  });
});

describe('CLI integration — regression: no-arg invocation still fails fast', () => {
  test('no args + no env vars still exits 2 with MISSING_ENV', () => {
    // Pin existing behavior — adding --help/--version must NOT silently
    // change the "operator forgot to set PERSONAS_PASSWORD" exit path.
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/MISSING_ENV: PERSONAS_PASSWORD/);
  });
});
