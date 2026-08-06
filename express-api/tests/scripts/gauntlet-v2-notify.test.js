'use strict';

// SHY-0239 — BEHAVIOURAL (real-execution) coverage for the Gauntlet v2 self-
// notify + PIN-ready gate + status reader (gauntlet-v2.sh).
//
// gauntlet-v2.sh's library mode (GAUNTLET_V2_LIB=1) lets us source it and drive
// notify / pin_ready_gate / notify_first_fail for real against throwaway files
// and processes — no Docker, emulators, or devices. The --status reader is
// exercised through the REAL entrypoint (`bash gauntlet-v2.sh --status <dir>`).
// Mirrors SHY-0236/0238: the stubs are genuine shell processes + files the
// harness runs, never mocked collaborators. Structural pins: the companion file.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet-v2.sh');

// Run a bash body with the v2 helpers sourced (lib mode) + a fresh RUN_DIR.
function runLib(body, extraEnv = '', timeout = 20000) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0239-'));
  const script = `
    set -uo pipefail
    export GAUNTLET_V2_LIB=1
    RUN_DIR="${runDir}"
    FAILED_STEPS=()
    ${extraEnv}
    source "${SCRIPT}" 2>/dev/null
    ${body}
  `;
  const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', timeout });
  return { result, runDir };
}

// Run the REAL entrypoint (not lib mode).
const runStatus = (dir) =>
  spawnSync('/bin/bash', [SCRIPT, '--status', dir], { encoding: 'utf8', timeout: 10000 });

describe('notify / emit_event — real event trail (SHY-0239)', () => {
  test('notify appends a parseable tab-separated event AND prints [notify]', () => {
    const { result, runDir } = runLib(`
      PHASE="demo"
      notify pin-wait "devices please"
    `);
    // console
    expect(result.stdout).toMatch(/\[notify\] pin-wait/);
    // file: <iso-ts> \t <event> \t <phase> \t <detail>
    const events = fs.readFileSync(path.join(runDir, 'events.log'), 'utf8').trim();
    const cols = events.split('\t');
    expect(cols[1]).toBe('pin-wait');
    expect(cols[2]).toBe('demo');
    expect(cols[3]).toBe('devices please');
  });

  test('notify tolerates a missing detail arg without crashing', () => {
    const { result, runDir } = runLib(`
      notify start
      echo "RC=$?"
    `);
    expect(result.stdout).toMatch(/RC=0/);
    expect(result.stdout).toMatch(/\[notify\] start/);
    expect(fs.readFileSync(path.join(runDir, 'events.log'), 'utf8')).toMatch(/\tstart\t/);
  });

  test('emit_event/notify survive an unwritable RUN_DIR (guarded — safe in traps)', () => {
    // emit_event fires from on_fail/on_signal when things are already going wrong;
    // a bad RUN_DIR must NOT crash the trap. Point it at a non-writable path.
    const { result } = runLib(`
      RUN_DIR=/nonexistent/shy0239/nope
      notify complete "done anyway"
      echo "RC=$?"
    `);
    expect(result.stdout).toMatch(/RC=0/); // guarded append swallowed the failure
    expect(result.stdout).toMatch(/\[notify\] complete/); // console line still printed
  });
});

describe('on_signal — an interrupt emits an aborted event (SHY-0239)', () => {
  test('on_signal writes an aborted event before reaping + exiting 128+sig', () => {
    // on_signal is reachable in lib mode (defined above the GAUNTLET_V2_LIB
    // return). The SHY-0238 test proved reap+exit; this proves the new event.
    const { result, runDir } = runLib(`
      ( on_signal 130 ); echo "RC=$?"
    `);
    expect(result.stdout).toMatch(/RC=130/); // 128 + SIGINT
    expect(fs.readFileSync(path.join(runDir, 'events.log'), 'utf8')).toMatch(/\taborted\t/);
  });
});

describe('pin_ready_gate — real pause/confirm (SHY-0239)', () => {
  test('non-TTY: blocks with PIN_WAIT, releases when PIN_READY appears', () => {
    // spawnSync gives no controlling TTY ⇒ the non-TTY (token-file) path.
    const { result, runDir } = runLib(
      `
      ( pin_ready_gate ) &
      gate=$!
      for _ in $(seq 1 100); do [ -e "$RUN_DIR/PIN_WAIT" ] && break; sleep 0.05; done
      [ -e "$RUN_DIR/PIN_WAIT" ] && echo "WAIT=PRESENT" || echo "WAIT=MISSING"
      touch "$RUN_DIR/PIN_READY"
      wait "$gate"; echo "GATE_RC=$?"
      [ -e "$RUN_DIR/PIN_WAIT" ] && echo "WAIT=STILL" || echo "WAIT=CLEARED"
    `,
      'PIN_GATE=1 MATRIX=1 PIN_GATE_TIMEOUT=30',
    );
    expect(result.stdout).toMatch(/WAIT=PRESENT/); // really blocked on the marker
    expect(result.stdout).toMatch(/GATE_RC=0/); // released cleanly
    expect(result.stdout).toMatch(/WAIT=CLEARED/); // marker removed on release
    const events = fs.readFileSync(path.join(runDir, 'events.log'), 'utf8');
    expect(events).toMatch(/\tpin-wait\t/);
    expect(events).toMatch(/\tpin-ready\t/);
    // …and in that ORDER — wait announced before the release (not just both present)
    expect(events.indexOf('\tpin-wait\t')).toBeLessThan(events.indexOf('\tpin-ready\t'));
  });

  test('non-TTY: the gate refuses to hang forever (bounded timeout ⇒ aborted + FAIL + non-zero)', () => {
    // PIN_GATE_TIMEOUT=1, no confirm ⇒ the gate must clear PIN_WAIT, write FAIL,
    // and return non-zero. Subshell so the failure doesn't kill the harness shell.
    const { result, runDir } = runLib(
      `
      ( pin_ready_gate ); echo "GATE_RC=$?"
      [ -e "$RUN_DIR/PIN_WAIT" ] && echo "WAIT=STILL" || echo "WAIT=CLEARED"
      [ -e "$RUN_DIR/FAIL" ] && echo "FAIL=WRITTEN" || echo "FAIL=MISSING"
    `,
      'PIN_GATE=1 MATRIX=1 PIN_GATE_TIMEOUT=1',
    );
    expect(result.stdout).toMatch(/GATE_RC=[1-9]/); // non-zero
    expect(result.stdout).toMatch(/WAIT=CLEARED/);
    // the sentinel is written EXPLICITLY (proven even in lib mode with no ERR trap)
    expect(result.stdout).toMatch(/FAIL=WRITTEN/);
    const events = fs.readFileSync(path.join(runDir, 'events.log'), 'utf8');
    expect(events).toMatch(/\taborted\t/);
  });

  test('a non-integer PIN_GATE_TIMEOUT is clamped, not left to hang', () => {
    // Garbage timeout ⇒ warn + clamp to 1800 (would otherwise loop forever on the
    // failing numeric compare). Prove no-hang by releasing via PIN_READY at once.
    const { result } = runLib(
      `
      ( pin_ready_gate ) &
      gate=$!
      for _ in $(seq 1 100); do [ -e "$RUN_DIR/PIN_WAIT" ] && break; sleep 0.05; done
      touch "$RUN_DIR/PIN_READY"
      wait "$gate"; echo "GATE_RC=$?"
    `,
      'PIN_GATE=1 MATRIX=1 PIN_GATE_TIMEOUT=abc',
    );
    expect(result.stdout).toMatch(/GATE_RC=0/); // released — did not hang or abort
    expect(result.stderr).toMatch(/not a non-negative integer/); // clamp warned loudly
  });

  test('skippable: --no-pin-gate (PIN_GATE=0) returns immediately, writes no PIN_WAIT', () => {
    const { result, runDir } = runLib(
      `
      pin_ready_gate; echo "GATE_RC=$?"
      [ -e "$RUN_DIR/PIN_WAIT" ] && echo "WAIT=PRESENT" || echo "WAIT=NONE"
    `,
      'PIN_GATE=0 MATRIX=1 PIN_GATE_TIMEOUT=30',
    );
    expect(result.stdout).toMatch(/GATE_RC=0/);
    expect(result.stdout).toMatch(/WAIT=NONE/);
    expect(fs.existsSync(path.join(runDir, 'events.log'))).toBe(false);
  });

  test('skippable: a no-matrix run (MATRIX=0) also skips the gate (2nd AC condition)', () => {
    const { result } = runLib(
      `
      pin_ready_gate; echo "GATE_RC=$?"
      [ -e "$RUN_DIR/PIN_WAIT" ] && echo "WAIT=PRESENT" || echo "WAIT=NONE"
    `,
      'PIN_GATE=1 MATRIX=0 PIN_GATE_TIMEOUT=30',
    );
    expect(result.stdout).toMatch(/GATE_RC=0/);
    expect(result.stdout).toMatch(/WAIT=NONE/);
  });
});

describe('fail-fast — the first failure pings once (SHY-0239)', () => {
  test('two failures ⇒ exactly one suite-fail event', () => {
    const { runDir } = runLib(`
      notify_first_fail alpha
      notify_first_fail beta
    `);
    const events = fs.readFileSync(path.join(runDir, 'events.log'), 'utf8').trim().split('\n');
    const fails = events.filter((l) => l.split('\t')[1] === 'suite-fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/alpha/); // the FIRST one
    expect(fails[0]).not.toMatch(/beta/);
  });
});

describe('--status — single-shot run-state reader (SHY-0239)', () => {
  const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shy0239-st-'));

  test('DONE ⇒ complete (and wins over a co-existing FAIL/PIN_WAIT)', () => {
    const dir = freshDir();
    fs.writeFileSync(path.join(dir, 'FAIL'), '');
    fs.writeFileSync(path.join(dir, 'PIN_WAIT'), 'x');
    fs.writeFileSync(path.join(dir, 'DONE'), '');
    expect(runStatus(dir).stdout.trim()).toBe('complete');
  });

  test('FAIL only ⇒ failed', () => {
    const dir = freshDir();
    fs.writeFileSync(path.join(dir, 'FAIL'), '');
    expect(runStatus(dir).stdout.trim()).toBe('failed');
  });

  test('PIN_WAIT only ⇒ pin-wait (with the reason)', () => {
    const dir = freshDir();
    fs.writeFileSync(path.join(dir, 'PIN_WAIT'), 'unlock the devices\n');
    const r = runStatus(dir);
    expect(r.stdout).toMatch(/^pin-wait\t/);
    expect(r.stdout).toMatch(/unlock the devices/);
  });

  test('live pid + no sentinel ⇒ running; dead pid + no sentinel ⇒ died', () => {
    // Arrange the pid file + call the real entrypoint in ONE bash script so the
    // liveness read happens while the process is genuinely alive / already dead.
    const dir = freshDir();
    const running = spawnSync(
      '/bin/bash',
      [
        '-c',
        `
      sleep 5 & p=$!
      echo "$p" > "${dir}/pid"
      bash "${SCRIPT}" --status "${dir}"
      kill "$p" 2>/dev/null || true
    `,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(running.stdout.trim()).toBe('running');

    const dir2 = freshDir();
    const died = spawnSync(
      '/bin/bash',
      [
        '-c',
        `
      bash -c 'exit 0' & p=$!; wait "$p"   # p is now reaped/dead
      echo "$p" > "${dir2}/pid"
      bash "${SCRIPT}" --status "${dir2}"
    `,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(died.stdout.trim()).toBe('died');
  });

  test('a run dir with nothing ⇒ died (pid file absent) and a missing dir ⇒ unknown', () => {
    const dir = freshDir(); // exists but empty, no pid
    expect(runStatus(dir).stdout.trim()).toBe('died');
    expect(runStatus('/nonexistent/shy0239/nope').stdout.trim()).toBe('unknown');
  });

  test('--status with NO dir resolves the latest-v2 run (AC default)', () => {
    // Point GAUNTLET_TMP at a scratch root with a latest-v2 symlink, then call
    // --status with no arg → it must resolve + report that run.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0239-gt-'));
    const run = path.join(tmp, '20260101-000000-v2');
    fs.mkdirSync(run);
    fs.writeFileSync(path.join(run, 'DONE'), '');
    fs.symlinkSync(run, path.join(tmp, 'latest-v2'));
    const r = spawnSync('/bin/bash', [SCRIPT, '--status'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, GAUNTLET_TMP: tmp },
    });
    expect(r.stdout.trim()).toBe('complete');
  });
});

describe('gauntlet-v2.sh --help — no code leaks into the usage (SHY-0239)', () => {
  test('-h prints the comment header only, never raw shell', () => {
    const r = spawnSync('/bin/bash', [SCRIPT, '-h'], { encoding: 'utf8', timeout: 10000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--frameworks/); // real usage content
    expect(r.stdout).toMatch(/--status/); // the new flag is documented
    // the range-robust `sed …/^set -uo/…` must stop before the code — a naive
    // fixed line range previously leaked `set -uo pipefail` + `HERE=` into help.
    expect(r.stdout).not.toMatch(/set -uo pipefail/);
    expect(r.stdout).not.toMatch(/HERE=/);
  });
});
