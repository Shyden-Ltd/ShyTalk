'use strict';

// SHY-0236 — structural invariants for the cold-boot release gauntlet
// (express-api/scripts/gauntlet/gauntlet.sh).
//
// The full orchestrator cannot be unit-run: it boots Docker, the Firebase
// emulators, LiveKit, real devices and long test suites. But its critical
// control-flow invariants ARE greppable, and every one of them below maps to a
// concrete defect found while running the 2026-07-24 release gauntlet — the
// empty-array crash, the first-failure abort, and (the review-caught one) a
// mid-run `die` that writes no sentinel. This pins the WHOLE script so those
// classes can never silently regress.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');
const lines = src.split('\n');

const MATRIX = path.resolve(__dirname, '../../scripts/gauntlet/50-matrix.sh');
const matrixSrc = fs.readFileSync(MATRIX, 'utf8');

describe('gauntlet.sh cold-boot structural invariants (SHY-0236)', () => {
  test('runs under set -uo pipefail, with -e deferred until AFTER the ERR trap', () => {
    expect(src).toMatch(/set -uo pipefail/);
    const trapIdx = lines.findIndex((l) => /trap on_fail ERR/.test(l));
    const setEIdx = lines.findIndex((l) => /^\s*set -e\s*$/.test(l));
    expect(trapIdx).toBeGreaterThan(-1);
    // -e must only arm once the ERR trap can record the failure as a sentinel
    expect(setEIdx).toBeGreaterThan(trapIdx);
  });

  // Review Critical #1 — the reason this whole test file exists. An explicit
  // `die` (exit 1) bypasses the ERR trap, so any mid-run die MUST write the
  // FAIL sentinel itself. Arg-parsing dies BEFORE the trap is installed are
  // exempt (no run has started; a sentinel there is meaningless).
  test('every mid-run die (after the ERR trap) writes the FAIL sentinel first', () => {
    const trapIdx = lines.findIndex((l) => /trap on_fail ERR/.test(l));
    expect(trapIdx).toBeGreaterThan(-1);
    const offenders = [];
    lines.forEach((line, i) => {
      if (i <= trapIdx) return; // pre-trap dies are usage errors, exempt
      if (/\bdie\s+"/.test(line) && !/touch "\$RUN_DIR\/FAIL"/.test(line)) {
        offenders.push(`L${i + 1}: ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  test('run_logged is best-effort — records into FAILED_STEPS, never die', () => {
    const m = src.match(/run_logged\(\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/FAILED_STEPS\+=\(/); // records the failure
    expect(body).not.toMatch(/\bdie\b/); // must NOT abort the whole run
  });

  test('FAILED_STEPS is declared as an array before run_logged uses it', () => {
    const declIdx = src.indexOf('FAILED_STEPS=()');
    const fnIdx = src.indexOf('run_logged()');
    expect(declIdx).toBeGreaterThan(-1);
    expect(declIdx).toBeLessThan(fnIdx);
  });

  test('final tally: non-empty FAILED_STEPS → FAIL + exit 1; clean → DONE', () => {
    const failBranch = src.match(/if \[ "\$\{#FAILED_STEPS\[@\]\}" -gt 0 \]; then[\s\S]*?\nfi/);
    expect(failBranch).not.toBeNull();
    expect(failBranch[0]).toMatch(/touch "\$RUN_DIR\/FAIL"/);
    expect(failBranch[0]).toMatch(/exit 1/);
    // and the success path still writes DONE
    expect(src).toMatch(/touch "\$RUN_DIR\/DONE"/);
  });

  test('empty-array expansions are bash-3.2-safe (portable +guard, no naked [@])', () => {
    expect(src).toMatch(/\$\{ANDROID_ARGS\[@\]\+"\$\{ANDROID_ARGS\[@\]\}"\}/);
    expect(src).toMatch(/\$\{PASSTHRU\[@\]\+"\$\{PASSTHRU\[@\]\}"\}/);
    // a naked "${ARR[@]}" (not preceded by the +guard) crashes bash 3.2 + set -u
    expect(src).not.toMatch(/[^+]"\$\{ANDROID_ARGS\[@\]\}"/);
    expect(src).not.toMatch(/[^+]"\$\{PASSTHRU\[@\]\}"/);
  });

  test('both Playwright phases set API_BASE_URL for the local Express API', () => {
    const pw = lines.filter((l) => /npx playwright test/.test(l));
    expect(pw.length).toBeGreaterThanOrEqual(2);
    pw.forEach((l) => expect(l).toMatch(/API_BASE_URL=http:\/\/localhost:3000/));
  });

  test('detached child RUN_ID inheritance uses a PRIVATE marker, not a public name', () => {
    expect(src).toMatch(/RUN_ID="\$\{_GAUNTLET_CHILD_RUN_ID:-\$\(date/);
    expect(src).toMatch(/_GAUNTLET_CHILD_RUN_ID="\$RUN_ID" nohup/);
    // a public/exported name a stale interactive shell could set must NOT drive
    // RUN_DIR reuse (would race two runs into one dir)
    expect(src).not.toMatch(/\$\{GAUNTLET_RUN_ID/);
  });
});

describe('50-matrix.sh cmd_stop — orphan/thrash prevention (SHY-0236)', () => {
  // The recurring "phone opens/closes the app forever" thrash: the old stop
  // killed ONLY the parent, orphaning the --parallel cell runners which keep
  // driving the phone. These pin the permanent fix.
  const m = matrixSrc.match(/cmd_stop\(\)\s*\{[\s\S]*?\n\}/);
  const body = m ? m[0] : '';

  test('cmd_stop exists', () => {
    expect(m).not.toBeNull();
  });

  test('kills the whole process TREE, not just the parent pid', () => {
    expect(matrixSrc).toMatch(/_pid_tree\(\)/); // recursive descendant walk
    expect(matrixSrc).toMatch(/pgrep -P/);
    expect(body).toMatch(/_pid_tree/);
  });

  test('loops until quiet (a runner can respawn a child between passes)', () => {
    expect(body).toMatch(/for pass in 1 2 3/);
  });

  test('reaps the on-device uiautomator holder + force-stops the app', () => {
    expect(body).toMatch(/am force-stop/);
    expect(body).toMatch(/pkill -f uiautomator/);
  });

  test('VERIFIES quiet + never prints the bare "stopped pid N" lie', () => {
    expect(body).toMatch(/pgrep -fl manual-qa-runner/);
    expect(body).not.toMatch(/echo "stopped pid \$pid"/);
  });
});
