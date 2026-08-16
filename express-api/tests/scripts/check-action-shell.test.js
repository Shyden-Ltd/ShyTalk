/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to run the repo's own
 * checker against fixtures under a temp dir. No user input reaches the shell. */
/**
 * `scripts/check-action-shell.sh` — shellcheck for composite actions.
 *
 * SHY-0298 R1/I3. `actionlint` embeds shellcheck, but with no path arguments
 * it lints `.github/workflows/**` ONLY — composite action metadata files are
 * not workflow files. Every line of shell under `.github/actions/**` was
 * therefore unlinted, and SHY-0298 moved ~65 new lines onto that surface.
 *
 * Verified by mutation before the script was written: a valid-YAML
 * `rm -rf "$UNSET/"` injected into a composite action leaves bare `actionlint`
 * exiting 0 with the file unmentioned.
 *
 * These tests run the REAL script against fixture actions, so a checker that
 * silently stops checking fails here rather than in six months.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-action-shell.sh');

/** Builds a throwaway repo root containing only `.github/actions` fixtures. */
function withActions(actions, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-shell-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts/check-action-shell.sh'));
  for (const [name, body] of Object.entries(actions)) {
    // `name` may carry an explicit filename: 'bad/action.yaml'.
    const [dirName, file = 'action.yml'] = name.split('/');
    const adir = path.join(dir, '.github/actions', dirName);
    fs.mkdirSync(adir, { recursive: true });
    fs.writeFileSync(path.join(adir, file), body);
  }
  const run = spawnSync('bash', [path.join(dir, 'scripts/check-action-shell.sh')], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    status: run.status,
    out: String(run.stdout || '') + String(run.stderr || ''),
  };
}

const action = (steps) => `name: fixture
description: fixture
runs:
  using: composite
  steps:
${steps}
`;

const shellStep = (body) => `    - shell: bash
      run: |
${body
  .split('\n')
  .map((l) => `        ${l}`)
  .join('\n')}`;

describe('it catches what actionlint cannot see', () => {
  test('SC2115 — rm -rf on a possibly-empty variable', () => {
    const { status, out } = withActions({
      bad: action(shellStep('set -euo pipefail\nrm -rf "$MAYBE_EMPTY/"')),
    });
    expect(status).toBe(1);
    expect(out).toContain('SC2115');
  });

  test('SC2045 — iterating the output of ls', () => {
    const { status, out } = withActions({
      bad: action(shellStep('set -euo pipefail\nfor f in $(ls); do echo "$f"; done')),
    });
    expect(status).toBe(1);
    expect(out).toContain('SC2045');
  });

  test('the finding names the action it came from', () => {
    // A checker that reports "something is wrong somewhere" costs more time
    // than it saves.
    const { out } = withActions({
      'my-action': action(shellStep('set -euo pipefail\nrm -rf "$X/"')),
    });
    expect(out).toContain('.github/actions/my-action/action.yml');
  });
});

describe('it does not cry wolf', () => {
  test('clean shell passes', () => {
    const { status, out } = withActions({
      good: action(shellStep('set -euo pipefail\necho "hello"\nrm -rf "${X:?}/y"')),
    });
    expect(status).toBe(0);
    expect(out).toContain('clean');
  });

  test('a GitHub ${{ }} expression is not mistaken for shell', () => {
    // Actions expands these before bash ever sees them, and the syntax is not
    // shell. Without the placeholder substitution every action with an input
    // would report a parse error.
    const { status } = withActions({
      good: action(shellStep('set -euo pipefail\necho "${{ inputs.name }}"')),
    });
    expect(status).toBe(0);
  });

  test('a non-bash step is left alone', () => {
    const { status } = withActions({
      pwsh: action('    - shell: pwsh\n      run: Write-Host "hi"'),
    });
    expect(status).toBe(0);
  });
});

describe('it refuses to pass vacuously', () => {
  test('an action with no bash steps says so, rather than reporting "clean"', () => {
    // The failure mode that matters most: an extractor that silently stops
    // finding shell reports "clean" forever. So zero blocks is reported in its
    // own words — never as a clean run — and the guard that catches a genuinely
    // broken extractor compares against how many bash blocks EXIST, not
    // against zero. An action with only pwsh steps legitimately has none.
    const { status, out } = withActions({
      none: 'name: fixture\ndescription: fixture\nruns:\n  using: composite\n  steps: []\n',
    });
    expect(status).toBe(0);
    expect(out).toContain('no bash run-blocks');
    expect(out).not.toContain('clean —');
  });

  test('a bash step is COUNTED, so a silent extraction failure cannot look clean', () => {
    // The other half: an action that does have shell must report a non-zero
    // block count. Together these mean "clean" can only be printed after
    // something was actually checked.
    const { status, out } = withActions({
      good: action(shellStep('set -euo pipefail\necho "hi"')),
    });
    expect(status).toBe(0);
    expect(out).toMatch(/clean — [1-9]\d* shell block\(s\)/);
  });

  test('the real repo is checked and reports a non-zero block count', () => {
    // Guards against the script passing because it found nothing HERE.
    const run = spawnSync('bash', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    const out = String(run.stdout || '') + String(run.stderr || '');
    expect(run.status).toBe(0);
    expect(out).toMatch(/clean — [1-9]\d* shell block\(s\)/);
  });
});

describe('it cannot be silenced or side-stepped', () => {
  test('an inherited SHELLCHECK_OPTS cannot downgrade the check', () => {
    // shellcheck reads SHELLCHECK_OPTS natively, so passing it through meant
    // anything in the environment won: `--severity=error` silenced the check
    // while it still printed "clean".
    const { status, out } = withActions(
      { bad: action(shellStep('set -euo pipefail\nrm -rf "$MAYBE_EMPTY/"')) },
      { SHELLCHECK_OPTS: '--severity=error' },
    );
    expect(status).toBe(1);
    expect(out).toContain('SC2115');
  });

  test('an action defined in action.YAML is checked too', () => {
    // GitHub accepts both filenames. `find -name action.yml` missed the other
    // one entirely — and because it contributed 0 to both the found and the
    // expected counts, the anti-vacuity guard stayed satisfied. The same hole
    // this script was written to close, one letter over.
    const { status, out } = withActions({
      'bad/action.yaml': action(shellStep('set -euo pipefail\nrm -rf "$MAYBE_EMPTY/"')),
    });
    expect(status).toBe(1);
    expect(out).toContain('SC2115');
  });

  test('--help prints the header and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-shell-help-'));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts/check-action-shell.sh'));
    const run = spawnSync('bash', [path.join(dir, 'scripts/check-action-shell.sh'), '--help'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Usage:');
    // It used to run past the header into the source.
    expect(run.stdout).not.toContain('set -euo pipefail');
  });
});
