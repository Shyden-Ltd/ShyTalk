'use strict';

// SHY-0238 — BEHAVIOURAL (real-execution) coverage for the Gauntlet v2
// orchestrator's overlap helpers (`start_overlapped` / `wait_overlapped` /
// `reap_overlapped` in gauntlet-v2.sh).
//
// gauntlet-v2.sh exposes a library mode (GAUNTLET_V2_LIB=1 → define the helpers,
// return before the orchestration) so this test can SOURCE it and drive those
// helpers for real against throwaway stub commands — no Docker, emulators, or
// devices. Mirrors the SHY-0236 real-execution discipline: the stub "suites" are
// genuine shell processes the harness runs, not mocked collaborators. The
// companion file gauntlet-v2-structure.test.js pins the orchestration ordering.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet-v2.sh');

// Run a bash body with the v2 helpers sourced (lib mode) + a fresh RUN_DIR.
function runLib(body, timeout = 20000) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0238-'));
  const script = `
    set -uo pipefail
    export GAUNTLET_V2_LIB=1
    RUN_DIR="${runDir}"
    FAILED_STEPS=()
    source "${SCRIPT}" 2>/dev/null
    ${body}
  `;
  const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', timeout });
  return { result, runDir };
}

describe('start_overlapped / wait_overlapped — real execution (SHY-0238)', () => {
  test('suites run CONCURRENTLY, not serially', () => {
    // Two 1s stubs: concurrent ⇒ ~1s wall; serial ⇒ ~2s. `date +%s` (integer)
    // reads 1 for concurrent, 2 for serial — assert strictly < 2.
    const { result } = runLib(`
      s=$(date +%s)
      start_overlapped a bash -c 'sleep 1'
      start_overlapped b bash -c 'sleep 1'
      wait_overlapped
      e=$(date +%s)
      echo "ELAPSED=$(( e - s ))"
    `);
    const m = result.stdout.match(/ELAPSED=(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeLessThan(2);
  });

  test("a suite's REAL exit code is recorded (PIPESTATUS survives the awk|tee pipe)", () => {
    // The suite pipes through awk + tee; a naive `wait` would see tee's 0 and
    // miss the failure. Only the exit-3 stub must land in FAILED_STEPS.
    const { result } = runLib(`
      start_overlapped passer bash -c 'echo ok; exit 0'
      start_overlapped failer bash -c 'echo boom; exit 3'
      wait_overlapped
      echo "FAILED=[\${FAILED_STEPS[*]}]"
    `);
    expect(result.stdout).toMatch(/FAILED=\[failer\]/);
    expect(result.stdout).not.toMatch(/FAILED=\[.*passer/);
  });

  test('output streams to BOTH the console and the per-suite log file', () => {
    const { result, runDir } = runLib(`
      start_overlapped demo bash -c 'echo MARKER_XYZ'
      wait_overlapped
    `);
    // console (this process captured stdout)
    expect(result.stdout).toMatch(/\[demo\] MARKER_XYZ/);
    // file
    const logf = path.join(runDir, 'demo.log');
    expect(fs.readFileSync(logf, 'utf8')).toMatch(/\[demo\] MARKER_XYZ/);
  });
});

describe('reap_overlapped — real teardown (SHY-0238)', () => {
  test('kills the whole overlapped-suite tree (zombie-safe pgrep proof)', () => {
    // Start a long stub, wait until pgrep can see it, reap, then assert it is
    // gone via `pgrep` — NOT kill(pid,0): a killed child would zombie and
    // kill(pid,0) would falsely report it alive (reference-node-spawn-zombie-...).
    const tag = `shy0238-reap-${process.pid}`;
    const { result } = runLib(`
      start_overlapped longrun bash -c 'exec -a ${tag} sleep 30'
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 && break; sleep 0.05; done
      pgrep -f ${tag} >/dev/null 2>&1 && echo "PRE=ALIVE" || echo "PRE=MISSING"
      reap_overlapped
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 || break; sleep 0.05; done
      pgrep -f ${tag} >/dev/null 2>&1 && echo "POST=ALIVE" || echo "POST=DEAD"
      pkill -f ${tag} 2>/dev/null || true
    `);
    expect(result.stdout).toMatch(/PRE=ALIVE/); // fixture really started
    expect(result.stdout).toMatch(/POST=DEAD/); // reap actually killed the tree
  });

  test('also kills the matrix-tail TREE, not just the TAIL_PID subshell', () => {
    // The real tail is `( tail -F | awk ) &`, so TAIL_PID is the subshell — a
    // bare `kill $TAIL_PID` orphans the inner `tail -F` (runs forever). The
    // fixture mirrors that shape (long stub is a GRANDCHILD of TAIL_PID).
    const tag = `shy0238-tail-${process.pid}`;
    const { result } = runLib(`
      ( bash -c 'exec -a ${tag} sleep 30' | cat ) &
      TAIL_PID=$!
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 && break; sleep 0.05; done
      pgrep -f ${tag} >/dev/null 2>&1 && echo "PRE=ALIVE" || echo "PRE=MISSING"
      reap_overlapped
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 || break; sleep 0.05; done
      pgrep -f ${tag} >/dev/null 2>&1 && echo "TAIL=ALIVE" || echo "TAIL=DEAD"
      pkill -f ${tag} 2>/dev/null || true
    `);
    expect(result.stdout).toMatch(/PRE=ALIVE/);
    expect(result.stdout).toMatch(/TAIL=DEAD/);
  });
});

describe('on_signal — a signal actually ABORTS the run (SHY-0238)', () => {
  test('reaps the overlapped suites AND exits with the given code', () => {
    // A bare INT/TERM trap that only reaps would RESUME the run; on_signal must
    // exit. Run it in a subshell so its exit doesn't kill the test harness.
    const tag = `shy0238-sig-${process.pid}`;
    const { result } = runLib(`
      start_overlapped longrun bash -c 'exec -a ${tag} sleep 30'
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 && break; sleep 0.05; done
      ( on_signal 130 ); echo "RC=$?"
      for _ in $(seq 1 60); do pgrep -f ${tag} >/dev/null 2>&1 || break; sleep 0.05; done
      pgrep -f ${tag} >/dev/null 2>&1 && echo "SUITE=ALIVE" || echo "SUITE=DEAD"
      pkill -f ${tag} 2>/dev/null || true
    `);
    expect(result.stdout).toMatch(/RC=130/); // exited with 128+SIGINT
    expect(result.stdout).toMatch(/SUITE=DEAD/); // and reaped
  });
});

describe('wait_overlapped — empty-array safety (SHY-0238)', () => {
  test('a call with zero pending suites returns cleanly under set -u (bash-3.2)', () => {
    const { result } = runLib(`
      set -u
      wait_overlapped
      echo "RC=$?"
    `);
    expect(result.stdout).toMatch(/RC=0/); // no "unbound variable" abort
  });
});

describe('gauntlet-v2.sh — CLI flag parsing (real entrypoint, SHY-0238)', () => {
  const run = (...args) =>
    spawnSync('/bin/bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });

  test('-h prints usage and exits 0', () => {
    const r = run('-h');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--frameworks/);
  });
  test('an unknown flag dies non-zero with a clear message', () => {
    const r = run('--bogus-flag');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown flag/);
  });
  test('an invalid --target value is rejected', () => {
    const r = run('--target', 'prod');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must be local or dev/);
  });
  test('a missing --target value is rejected', () => {
    const r = run('--target');
    expect(r.status).not.toBe(0);
  });
});
