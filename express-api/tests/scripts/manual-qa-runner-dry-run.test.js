/**
 * manual-qa-runner-dry-run.test.js
 *
 * Pins `--dry-run` flag behavior. Operators use this to preview which
 * cells WOULD dispatch given the current opts, without invoking any
 * driver — useful for verifying --browser overrides, --target policy,
 * and (future) --filter behavior before paying for a real matrix run.
 *
 * Distinction from --list:
 *   - --list shows the static allowlist (POLICY): "what's allowed for
 *     target X regardless of other flags".
 *   - --dry-run shows the actual dispatch EFFECT given opts: "what
 *     would run right now with this exact command line".
 *
 * Like --help/--version/--list, --dry-run MUST exit before env
 * validation — operators must be able to preview without setting
 * PERSONAS_PASSWORD or any FIREBASE_*_API_KEY.
 *
 * Two layers:
 *   1. Unit — pure helper `formatDryRunJson(opts)`.
 *   2. Integration — spawn the runner with each flag combination.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

const { formatDryRunJson } = require(RUNNER_PATH);

// ── formatDryRunJson — pure helper ────────────────────────────────

describe('formatDryRunJson — output shape', () => {
  test('returns a JSON string', () => {
    expect(typeof formatDryRunJson({})).toBe('string');
    expect(() => JSON.parse(formatDryRunJson({}))).not.toThrow();
  });

  test('top-level shape is { target, cells }', () => {
    const parsed = JSON.parse(formatDryRunJson({}));
    expect(Object.keys(parsed).sort()).toEqual(['cells', 'target']);
  });

  test('cells is an array of strings', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'dev' }));
    expect(Array.isArray(parsed.cells)).toBe(true);
    for (const c of parsed.cells) expect(typeof c).toBe('string');
  });
});

describe('formatDryRunJson — target resolution', () => {
  test('no target opts → defaults to "local"', () => {
    const parsed = JSON.parse(formatDryRunJson({}));
    expect(parsed.target).toBe('local');
  });

  test('opts.target = "dev" → target reflected, cells = dev allowlist', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'dev' }));
    expect(parsed.target).toBe('dev');
    expect(parsed.cells).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('opts.target = "prod" → cells = ["chromium"]', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'prod' }));
    expect(parsed.target).toBe('prod');
    expect(parsed.cells).toEqual(['chromium']);
  });

  test('opts.target = "local" → cells = full 12-cell matrix', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'local' }));
    expect(parsed.target).toBe('local');
    expect(parsed.cells.length).toBe(12);
  });

  test('unknown target → cells = []', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'staging' }));
    expect(parsed.target).toBe('staging');
    expect(parsed.cells).toEqual([]);
  });
});

describe('formatDryRunJson — --browser override', () => {
  test('opts.browser set → cells = [opts.browser] (overrides target allowlist)', () => {
    const parsed = JSON.parse(formatDryRunJson({ target: 'prod', browser: 'firefox' }));
    expect(parsed.target).toBe('prod');
    // --browser overrides allowlist — the operator is explicit about
    // which single cell to dispatch.
    expect(parsed.cells).toEqual(['firefox']);
  });

  test('opts.browser without target → defaults target to local', () => {
    const parsed = JSON.parse(formatDryRunJson({ browser: 'webkit' }));
    expect(parsed.target).toBe('local');
    expect(parsed.cells).toEqual(['webkit']);
  });
});

describe('formatDryRunJson — --matrix flag', () => {
  test('opts.matrix = true → cells = full target allowlist (same as no-matrix default)', () => {
    const parsed = JSON.parse(formatDryRunJson({ matrix: true, target: 'dev' }));
    expect(parsed.cells).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('opts.matrix + opts.browser → --browser still overrides (single-cell)', () => {
    const parsed = JSON.parse(
      formatDryRunJson({ matrix: true, target: 'dev', browser: 'firefox' }),
    );
    expect(parsed.cells).toEqual(['firefox']);
  });
});

// ── CLI integration — exit code + stdout shape ─────────────────────

function runCli(args, env = {}) {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.PERSONAS_PASSWORD;
  delete cleanEnv.FIREBASE_DEV_API_KEY;
  delete cleanEnv.FIREBASE_LOCAL_API_KEY;
  delete cleanEnv.FIREBASE_PROD_API_KEY;
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 10000,
  });
}

describe('CLI integration — --dry-run', () => {
  test('--dry-run exits 0 without any env vars set', () => {
    const r = runCli(['--dry-run']);
    expect(r.status).toBe(0);
  });

  test('--dry-run does not require PERSONAS_PASSWORD', () => {
    const r = runCli(['--dry-run']);
    expect(r.stderr).not.toMatch(/MISSING_ENV/);
  });

  test('--dry-run prints valid JSON to stdout', () => {
    const r = runCli(['--dry-run']);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('--dry-run output has { target, cells } shape', () => {
    const r = runCli(['--dry-run']);
    const parsed = JSON.parse(r.stdout);
    expect(Object.keys(parsed).sort()).toEqual(['cells', 'target']);
  });

  test('--dry-run is documented in formatUsage()', () => {
    const { formatUsage } = require(RUNNER_PATH);
    expect(formatUsage()).toMatch(/--dry-run\b/);
  });
});

describe('CLI integration — --dry-run with --target', () => {
  test('--dry-run --target dev returns dev allowlist as cells', () => {
    const r = runCli(['--dry-run', '--target', 'dev']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.target).toBe('dev');
    expect(parsed.cells).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('--dry-run --target prod returns prod allowlist', () => {
    const r = runCli(['--dry-run', '--target', 'prod']);
    expect(JSON.parse(r.stdout)).toEqual({ target: 'prod', cells: ['chromium'] });
  });

  test('--dry-run --target=dev (= form) parity with space form', () => {
    const r = runCli(['--dry-run', '--target=dev']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).target).toBe('dev');
  });
});

describe('CLI integration — --dry-run with --browser', () => {
  test('--dry-run --browser firefox returns single-cell array', () => {
    const r = runCli(['--dry-run', '--browser', 'firefox']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).cells).toEqual(['firefox']);
  });

  test('--dry-run --target prod --browser webkit → --browser overrides allowlist', () => {
    const r = runCli(['--dry-run', '--target', 'prod', '--browser', 'webkit']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ target: 'prod', cells: ['webkit'] });
  });
});

describe('CLI integration — --dry-run flag-combination precedence', () => {
  test('--help wins over --dry-run', () => {
    const r = runCli(['--help', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).not.toMatch(/"cells"/);
  });

  test('--version wins over --dry-run', () => {
    const r = runCli(['--version', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/manual-qa-runner /);
    expect(r.stdout).not.toMatch(/"cells"/);
  });

  test('--list wins over --dry-run', () => {
    const r = runCli(['--list', '--dry-run']);
    expect(r.status).toBe(0);
    // --list output has "supported" top-level key; --dry-run does not.
    expect(r.stdout).toMatch(/"supported"/);
  });
});

describe('CLI integration — regression: --dry-run does not break existing exits', () => {
  test('no args + no env vars still exits 2 with MISSING_ENV', () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/MISSING_ENV: PERSONAS_PASSWORD/);
  });
});
