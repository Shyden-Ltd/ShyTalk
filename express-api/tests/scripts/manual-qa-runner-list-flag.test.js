/**
 * manual-qa-runner-list-flag.test.js
 *
 * Pins `--list` flag behavior. Operators use this to enumerate the
 * cells the runner will dispatch for a given target without actually
 * running anything — primary use case is `--list | jq` scripting and
 * dry-survey of the matrix. JSON-by-default makes both human-readable
 * and pipeable.
 *
 * Two layers:
 *   1. Unit — pure helper `formatListJson(target?)` returns a JSON
 *      string. With no target, full structure {supported, targets}.
 *      With a target, just the allowed-browsers array for that target.
 *      Unknown target → [] (mirrors allowedBrowsersFor semantics).
 *   2. Integration — spawn the runner; assert exit code, stdout shape,
 *      JSON parseability, and that no env vars are required.
 *
 * Like --help/--version, --list MUST exit before env validation —
 * operators must be able to discover the matrix surface without
 * setting PERSONAS_PASSWORD.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

const { formatListJson } = require(RUNNER_PATH);
const { SUPPORTED_BROWSERS, TARGET_BROWSER_ALLOWLIST } = require(
  path.join(REPO_ROOT, 'express-api/scripts/browser-allowlist'),
);

// ── formatListJson — pure helper ──────────────────────────────────

describe('formatListJson — full structure (no target)', () => {
  test('returns a string', () => {
    expect(typeof formatListJson()).toBe('string');
  });

  test('output is valid JSON (round-trips through JSON.parse)', () => {
    expect(() => JSON.parse(formatListJson())).not.toThrow();
  });

  test('top-level shape is { supported, targets }', () => {
    const parsed = JSON.parse(formatListJson());
    expect(Object.keys(parsed).sort()).toEqual(['supported', 'targets']);
  });

  test('supported list matches SUPPORTED_BROWSERS exactly + in source order', () => {
    const parsed = JSON.parse(formatListJson());
    expect(parsed.supported).toEqual(SUPPORTED_BROWSERS);
  });

  test('targets object contains every target in TARGET_BROWSER_ALLOWLIST', () => {
    const parsed = JSON.parse(formatListJson());
    expect(Object.keys(parsed.targets).sort()).toEqual(
      Object.keys(TARGET_BROWSER_ALLOWLIST).sort(),
    );
  });

  test('each target maps to the exact allowed-browsers array', () => {
    const parsed = JSON.parse(formatListJson());
    for (const target of Object.keys(TARGET_BROWSER_ALLOWLIST)) {
      expect(parsed.targets[target]).toEqual(TARGET_BROWSER_ALLOWLIST[target]);
    }
  });

  test('local target includes the full 12-cell matrix', () => {
    const parsed = JSON.parse(formatListJson());
    expect(parsed.targets.local.length).toBe(12);
  });
});

describe('formatListJson — single target', () => {
  test('with "dev" returns the dev allowlist as a JSON array', () => {
    const out = formatListJson('dev');
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('with "prod" returns the prod allowlist', () => {
    expect(JSON.parse(formatListJson('prod'))).toEqual(['chromium']);
  });

  test('with "local" returns the full 12-cell matrix array', () => {
    const parsed = JSON.parse(formatListJson('local'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(12);
  });

  test('with unknown target returns an empty array (mirrors allowedBrowsersFor)', () => {
    expect(JSON.parse(formatListJson('staging'))).toEqual([]);
    expect(JSON.parse(formatListJson('not-a-target'))).toEqual([]);
  });

  test('with empty string returns empty array (treated as unknown)', () => {
    expect(JSON.parse(formatListJson(''))).toEqual([]);
  });
});

// ── CLI integration — exit code + stdout shape ─────────────────────

function runCli(args, env = {}) {
  // Strip credentials to prove --list exits BEFORE env validation.
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.PERSONAS_PASSWORD;
  delete cleanEnv.FIREBASE_DEV_API_KEY;
  delete cleanEnv.FIREBASE_LOCAL_API_KEY;
  delete cleanEnv.FIREBASE_PROD_API_KEY;
  // process.execPath = same node binary running this test; silences
  // sonarjs/no-os-command-from-path.
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 10000,
  });
}

describe('CLI integration — --list', () => {
  test('--list exits 0 without any env vars set', () => {
    const r = runCli(['--list']);
    expect(r.status).toBe(0);
  });

  test('--list does not require PERSONAS_PASSWORD', () => {
    const r = runCli(['--list']);
    expect(r.stderr).not.toMatch(/MISSING_ENV/);
  });

  test('--list prints valid JSON to stdout', () => {
    const r = runCli(['--list']);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('--list output shape is { supported, targets }', () => {
    const r = runCli(['--list']);
    const parsed = JSON.parse(r.stdout);
    expect(Object.keys(parsed).sort()).toEqual(['supported', 'targets']);
  });

  test('--list output is documented in formatUsage()', () => {
    // Drift-catch coverage: the help-version test asserts every parser
    // flag is in formatUsage(). This explicitly pins it for --list so a
    // mistaken removal from usage docs fails here too (defense in depth).
    const { formatUsage } = require(RUNNER_PATH);
    expect(formatUsage()).toMatch(/--list\b/);
  });
});

describe('CLI integration — --list --target', () => {
  test('--list --target dev returns the dev allowlist array', () => {
    const r = runCli(['--list', '--target', 'dev']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('--list --target prod returns the prod allowlist array', () => {
    const r = runCli(['--list', '--target', 'prod']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['chromium']);
  });

  test('--list --target local returns the full 12-cell array', () => {
    const r = runCli(['--list', '--target', 'local']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(12);
  });

  test('--list --target unknown returns empty array (exit 0, not error)', () => {
    const r = runCli(['--list', '--target', 'staging']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  test('--list --target=dev (= form) works same as space form', () => {
    // The existing parser normalises --flag=value to --flag value.
    // Confirm --list --target=dev produces the same output as the
    // space form — operator pain point: silent fall-through to default
    // target when using the = form (see runner line ~15497 comment).
    const r = runCli(['--list', '--target=dev']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['chromium', 'mobile-chrome-android']);
  });
});

describe('CLI integration — --list ordering by flag combinations', () => {
  test('--help wins when --list also passed (--help has priority)', () => {
    const r = runCli(['--help', '--list']);
    expect(r.status).toBe(0);
    // --help output starts with the runner name + Usage:
    expect(r.stdout).toMatch(/Usage:/);
    // Should NOT contain the {"supported": ...} JSON from --list
    expect(r.stdout).not.toMatch(/"supported"/);
  });

  test('--version wins over --list (consistency with --help precedence)', () => {
    const r = runCli(['--version', '--list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/manual-qa-runner /);
    expect(r.stdout).not.toMatch(/"supported"/);
  });
});

describe('CLI integration — regression: --list does not break existing exits', () => {
  test('no args + no env vars still exits 2 with MISSING_ENV', () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/MISSING_ENV: PERSONAS_PASSWORD/);
  });
});
