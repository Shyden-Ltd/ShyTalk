/**
 * qa-cleanup-orphans-pin.test.js
 *
 * Pins the structure of `express-api/scripts/qa-cleanup-orphans.sh`.
 * Closes gap G2 from the QA-runner framework tracker — without this
 * pin, a future PR could silently break:
 *   - the dry-run mode (operators rely on it to preview kills)
 *   - the per-section coverage (Appium / adb / forwards / runners /
 *     Playwright temp dirs) that the troubleshooting doc cross-refs
 *   - the safe defaults (don't touch dirs <1h old; --dry-run works
 *     without any tools installed)
 *
 * Read-only test — runs the script with `--dry-run` and asserts the
 * sentinel strings + exit codes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'express-api/scripts/qa-cleanup-orphans.sh');

// ── File-level invariants ──────────────────────────────────────────

describe('qa-cleanup-orphans.sh — file invariants', () => {
  test('script exists at the expected path', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  test('script is executable', () => {
    const mode = fs.statSync(SCRIPT_PATH).mode;
    // bit-and with 0o111 — any of owner/group/other execute set.
    expect(mode & 0o111).not.toBe(0);
  });

  test('script uses /usr/bin/env bash (portable shebang)', () => {
    const head = fs.readFileSync(SCRIPT_PATH, 'utf8').split('\n')[0];
    expect(head).toBe('#!/usr/bin/env bash');
  });

  test('script sets safe shell options (set -euo pipefail)', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toMatch(/^set -euo pipefail\b/m);
  });
});

// ── --dry-run mode ─────────────────────────────────────────────────

describe('qa-cleanup-orphans.sh — --dry-run', () => {
  let result;
  beforeAll(() => {
    // process.execPath isn't relevant here — this is a shell script.
    // Use the absolute path + the shell directly to silence
    // sonarjs/no-os-command-from-path.
    result = spawnSync('/bin/bash', [SCRIPT_PATH, '--dry-run'], {
      encoding: 'utf8',
      timeout: 30000,
    });
  });

  test('exits 0', () => {
    expect(result.status).toBe(0);
  });

  test('emits dry-run completion sentinel', () => {
    expect(result.stdout).toMatch(/dry-run complete — no processes killed/);
  });

  test('covers Appium processes section', () => {
    expect(result.stdout).toMatch(/checking Appium processes/);
  });

  test('covers adb daemon state section', () => {
    expect(result.stdout).toMatch(/checking adb daemon state/);
  });

  test('covers adb forward ports section', () => {
    expect(result.stdout).toMatch(/checking adb forward ports|adb not installed/);
  });

  test('covers manual-qa-runner orphans section', () => {
    expect(result.stdout).toMatch(/checking manual-qa-runner orphans/);
  });

  test('covers Playwright temp dirs section', () => {
    expect(result.stdout).toMatch(/checking Playwright temp dirs/);
  });
});

// ── arg handling ───────────────────────────────────────────────────

describe('qa-cleanup-orphans.sh — arg handling', () => {
  test('rejects unknown args with exit 2', () => {
    const r = spawnSync('/bin/bash', [SCRIPT_PATH, '--bogus-flag'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Unknown arg/);
  });

  test('--help exits 0 with usage text', () => {
    const r = spawnSync('/bin/bash', [SCRIPT_PATH, '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('-h is an alias for --help', () => {
    const r = spawnSync('/bin/bash', [SCRIPT_PATH, '-h'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });
});

// ── safety guardrails encoded in the script ────────────────────────

describe('qa-cleanup-orphans.sh — safety invariants', () => {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

  test('Playwright cleanup only deletes dirs > 1h old (no race with in-flight runs)', () => {
    // The find expression must include `-mmin +60` so an in-flight
    // matrix run's freshly-created tmpdir isn't reaped underneath it.
    expect(src).toMatch(/find\s+\/tmp\s+[^\n]{0,200}-mmin\s+\+60/);
  });

  test('selects orphan runners by identity, never by a bare name match', () => {
    // SHY-0304 replaced `pgrep -f "manual-qa-runner"` + a `$$`-only exclusion.
    // That predicate matched any process whose command line merely NAMED the
    // runner — Jest running its test files, the npm wrapper, the invoking
    // shell — and `clean` is the DEFAULT mode, so each match was a real kill
    // (50 innocent processes in one measured sweep). The old exclusion could
    // not help: it covered `$$` alone, while the hazard is the ANCESTRY, and
    // BSD pgrep hides ancestors for free so the guard was a no-op on macOS and
    // absent on Linux.
    //
    // Structural pins are weak on their own — this one only checks the bare
    // name match is gone and the shared helper is in use. The behaviour is
    // covered for real, against real processes, in
    // `runner-process-identity.test.js`.
    // Asserted over CODE lines only. The first draft of this pin failed
    // against its own comment, which quotes the very call it forbids — the
    // repeat of a trap already recorded in `.claude_learnings.md` ("a
    // source-reading pin must read CODE, not text").
    const code = src
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

    expect(code).toMatch(/source\s+"\$HERE\/lib\/runner-pids\.sh"/);
    expect(code).toMatch(/RUNNER_PIDS=\$\(runner_pids\)/);
    expect(code).not.toMatch(/pgrep\s+-f\s+"?manual-qa-runner/);
  });

  test('clean mode kills exactly the set it reported — it computes nothing of its own', () => {
    // Review finding. Every executing test of this script runs `--dry-run`,
    // so the KILLING branch — the highest-consequence path in SHY-0304, the
    // one that selected 50 innocent processes — is never executed against a
    // real target anywhere in the suite.
    //
    // It is deliberately NOT executed here either, and that is a considered
    // choice rather than an omission: this script is machine-wide BY DESIGN,
    // Jest runs ~150 suites in parallel workers, and five sibling suites spawn
    // real `manual-qa-runner.js` processes. A clean-mode run inside the suite
    // would kill THEIR runners — which is precisely the cross-suite
    // interference this story exists to remove. Buying coverage by
    // reintroducing the defect is a bad trade.
    //
    // What IS enforceable statically is the property that makes dry-run a
    // faithful preview: the clean branch must kill the SAME variable the
    // report printed, never re-derive its own set. That is the regression the
    // reviewer named — a future machine-wide fallback added to the kill branch
    // alone, invisible to every --dry-run assertion.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

    const section = code.slice(code.indexOf('RUNNER_PIDS='), code.indexOf('Playwright temp dirs'));
    expect(section).toMatch(/RUNNER_PIDS=\$\(runner_pids\)/);
    expect(section).toMatch(/say "\s*found runner PIDs: \$RUNNER_PIDS"/);
    expect(section).toMatch(/echo "\$RUNNER_PIDS" \| xargs -r kill/);
    // exactly one assignment: the kill branch cannot be fed a different set
    expect(section.match(/RUNNER_PIDS=/g)).toHaveLength(1);
    expect(section).not.toMatch(/pgrep/);
  });

  test('uses SIGTERM first, SIGKILL only as fallback (graceful shutdown)', () => {
    // kill (SIGTERM default) appears before kill -9 in the Appium section.
    expect(src).toMatch(/xargs -r kill 2>\/dev\/null/);
    expect(src).toMatch(/kill -9/);
  });
});
