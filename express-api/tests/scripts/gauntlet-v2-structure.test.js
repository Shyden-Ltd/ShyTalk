'use strict';

// SHY-0238 — structural invariants for the Gauntlet v2 orchestrator
// (express-api/scripts/gauntlet/gauntlet-v2.sh).
//
// The full orchestrator can't be unit-run (Docker, emulators, real devices,
// hours-long suites). But its load-bearing control-flow — the REORDER (matrix
// before the framework suites), the OVERLAP allowlist (only the three stack-
// independent suites run concurrently with the live matrix; the Auth-wiping
// Jest + the two Playwright suites never do), the tee streaming, the reap trap,
// and the SHY-0236 sentinel/tally contract — is greppable and each invariant
// maps to a concrete requirement in the SHY-0238 spec. The behavioural helper
// tests live in gauntlet-v2-overlap.test.js.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet-v2.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');
const lines = src.split('\n');

// Index of the first line matching a regex (−1 if none).
const at = (re) => lines.findIndex((l) => re.test(l));

describe('gauntlet-v2.sh — file basics', () => {
  test('exists + executable + portable shebang', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(src.split('\n')[0]).toBe('#!/usr/bin/env bash');
  });

  test('runs under set -uo pipefail with -e armed AFTER the ERR trap (SHY-0236)', () => {
    expect(src).toMatch(/set -uo pipefail/);
    const trapIdx = at(/trap on_fail ERR/);
    const setEIdx = at(/^\s*set -e\s/);
    expect(trapIdx).toBeGreaterThan(-1);
    expect(setEIdx).toBeGreaterThan(trapIdx);
  });

  test('uses ${BASH_SOURCE[0]} for HERE so the test can source it', () => {
    expect(src).toMatch(/HERE="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)".*pwd\)"/);
  });

  test('has a library mode that returns before the orchestration', () => {
    const libIdx = at(/GAUNTLET_V2_LIB.*&&\s*return 0/);
    const dispatchIdx = at(/50-matrix\.sh" launch/);
    expect(libIdx).toBeGreaterThan(-1);
    // the lib-mode return must precede any orchestration side effect
    expect(libIdx).toBeLessThan(dispatchIdx);
  });
});

describe('gauntlet-v2.sh — the REORDER (devices before the Mac suites)', () => {
  test('the device matrix is dispatched BEFORE the first overlapped suite', () => {
    const dispatchIdx = at(/50-matrix\.sh" launch/);
    const firstOverlapIdx = at(/start_overlapped /);
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(firstOverlapIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeLessThan(firstOverlapIdx);
  });

  test('the Auth-wiping Jest runs only AFTER the matrix-wait (never mid-matrix)', () => {
    const matrixWaitIdx = at(/while \[ ! -e "\$MATRIX_DIR\/DONE" \]/);
    const jestIdx = at(/run_logged express-jest/);
    expect(matrixWaitIdx).toBeGreaterThan(-1);
    expect(jestIdx).toBeGreaterThan(-1);
    expect(jestIdx).toBeGreaterThan(matrixWaitIdx);
  });

  test('a fresh reseed runs immediately before express-jest (clean baseline, matching v1)', () => {
    // The reorder must NOT drop v1's guarantee that Jest sees a reseeded baseline
    // — the matrix leaves the emulator mutated, so reseed-pre-jest is required.
    const reseedIdx = at(/phase "reseed-pre-jest"/);
    const jestIdx = at(/run_logged express-jest/);
    expect(reseedIdx).toBeGreaterThan(-1);
    expect(reseedIdx).toBeLessThan(jestIdx);
  });
});

describe('gauntlet-v2.sh — the OVERLAP allowlist (only stack-independent suites)', () => {
  // Everything start_overlapped runs concurrently with the LIVE device matrix,
  // so it must never touch the emulator stack. This pins the exact set.
  const overlapCalls = lines
    .filter((l) => /^\s*start_overlapped /.test(l))
    .map((l) => l.trim().split(/\s+/)[1]);

  test('exactly the three stack-independent suites are overlapped', () => {
    expect(overlapCalls.sort()).toEqual(['eslint', 'gradle-unit-detekt', 'ktlint']);
  });

  test('the stack-coupled suites are NEVER overlapped', () => {
    for (const banned of ['express-jest', 'playwright-e2e', 'playwright-integration']) {
      expect(overlapCalls).not.toContain(banned);
    }
  });

  test('the stack-coupled suites run serially via run_logged (post-matrix)', () => {
    expect(src).toMatch(/run_logged express-jest\b/);
    expect(src).toMatch(/run_logged playwright-e2e\b/);
    expect(src).toMatch(/run_logged playwright-integration\b/);
  });

  test('the post-jest reseed heals the Auth-wipe before the web suites', () => {
    const jestIdx = at(/run_logged express-jest/);
    const reseedIdx = at(/phase "reseed-post-jest"/);
    const pwIdx = at(/run_logged playwright-e2e/);
    expect(jestIdx).toBeLessThan(reseedIdx);
    expect(reseedIdx).toBeLessThan(pwIdx);
  });
});

describe('gauntlet-v2.sh — streaming, reaping, sentinel (SHY-0236 contract)', () => {
  test('BOTH start_overlapped AND run_logged stream to console+file (tee, per site)', () => {
    // Assert each function body independently — a combined `toMatch` would pass
    // if only ONE of the two near-duplicate sites still teed (Finding I6).
    for (const fn of ['start_overlapped', 'run_logged']) {
      const body = src.match(new RegExp(`${fn}\\(\\)\\s*\\{[\\s\\S]*?\\n\\}`));
      expect(body).not.toBeNull();
      expect(body[0]).toMatch(/awk -v p="\[\$name\] ".*fflush\(\).*\|\s*tee "\$logf"/);
      expect(body[0]).not.toMatch(/"\$@"\s*>\s*"\$logf"/); // no file-only redirect
    }
  });

  test('the matrix log is streamed live to the console', () => {
    expect(src).toMatch(/tail -n \+1 -F "\$MATRIX_LOG".*awk.*\[matrix\]/);
  });

  test('reap trap tears down overlapped suites + the tail (via the _pid_tree idiom)', () => {
    expect(src).toMatch(/trap reap_overlapped EXIT\b/);
    // reap kills the whole process tree (SHY-0236 _pid_tree idiom), never a bare pid
    expect(src).toMatch(/_pid_tree\(\)/);
    const reap = src.match(/reap_overlapped\(\)\s*\{[\s\S]*?\n\}/);
    expect(reap).not.toBeNull();
    expect(reap[0]).toMatch(/_pid_tree/);
    expect(reap[0]).toMatch(/TAIL_PID/);
  });

  test('INT/TERM abort the run (reap + exit), EXIT only reaps — a resume-not-abort bug', () => {
    // A bare INT/TERM trap that only reaps RESUMES after the handler; the run
    // must actually terminate. INT/TERM route to on_signal (which exits); EXIT
    // must NOT be bundled with them.
    expect(src).toMatch(/trap 'on_signal 130' INT/);
    expect(src).toMatch(/trap 'on_signal 143' TERM/);
    expect(src).not.toMatch(/trap reap_overlapped EXIT INT TERM/);
    const sig = src.match(/on_signal\(\)\s*\{[\s\S]*?\n\}/);
    expect(sig).not.toBeNull();
    expect(sig[0]).toMatch(/reap_overlapped/);
    expect(sig[0]).toMatch(/\bexit\b/);
  });

  test('final tally: any failed step → FAIL + exit 1; clean → DONE (SHY-0236)', () => {
    const failBranch = src.match(/if \[ "\$\{#FAILED_STEPS\[@\]\}" -gt 0 \]; then[\s\S]*?\nfi/);
    expect(failBranch).not.toBeNull();
    expect(failBranch[0]).toMatch(/touch "\$RUN_DIR\/FAIL"/);
    expect(failBranch[0]).toMatch(/exit 1/);
    expect(src).toMatch(/touch "\$RUN_DIR\/DONE"/);
  });

  test('a matrix FAIL sentinel is folded into the tally', () => {
    expect(src).toMatch(/-e "\$MATRIX_DIR\/FAIL"/);
    expect(src).toMatch(/FAILED_STEPS\+=\("journey-matrix"\)/);
  });

  test('matrix-wait has a liveness escape (no infinite hang if the runner is killed)', () => {
    // If the detached runner dies without a sentinel, the poll loop must break +
    // synthesize a FAIL — a release gate that never returns is worse than a FAIL.
    const waitBlock = src.match(/phase "matrix-wait"[\s\S]*?\n {2}done/);
    expect(waitBlock).not.toBeNull();
    expect(waitBlock[0]).toMatch(/kill -0 "\$MATRIX_PID"/);
    expect(waitBlock[0]).toMatch(/touch "\$MATRIX_DIR\/FAIL"/);
    expect(waitBlock[0]).toMatch(/\bbreak\b/);
  });
});
