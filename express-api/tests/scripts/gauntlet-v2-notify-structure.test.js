'use strict';

// SHY-0239 — structural invariants for the Gauntlet v2 self-notify + PIN-ready
// gate + status reader added to express-api/scripts/gauntlet/gauntlet-v2.sh.
//
// As with SHY-0238, the full orchestrator can't be unit-run (Docker, emulators,
// devices, hours-long suites), but its load-bearing control-flow IS greppable:
// the gate lands BEFORE any device dispatch, is guarded + bounded, the notify
// hooks attach to the right lifecycle points, and the helpers stay in the
// library-mode section so the behavioural file can drive them for real. The
// behavioural pins live in gauntlet-v2-notify.test.js.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../scripts/gauntlet/gauntlet-v2.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');
const lines = src.split('\n');

const at = (re) => lines.findIndex((l) => re.test(l));
// Extract a shell function body ("name() { … \n}") for site-scoped assertions.
const bodyOf = (name) => {
  const m = src.match(new RegExp(`${name}\\(\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : null;
};

describe('gauntlet-v2.sh — helpers stay library-testable (SHY-0239)', () => {
  const libIdx = at(/GAUNTLET_V2_LIB.*&&\s*return 0/);

  test('the new helpers are defined ABOVE the lib-mode early-return', () => {
    // The behavioural tests source the script in lib mode and call these — so
    // each MUST be defined before the GAUNTLET_V2_LIB return, like the SHY-0238
    // overlap helpers.
    for (const fn of [
      'emit_event',
      'notify',
      'notify_first_fail',
      'pin_ready_gate',
      'cmd_status',
    ]) {
      const defIdx = at(new RegExp(`^${fn}\\(\\)`));
      expect(defIdx).toBeGreaterThan(-1);
      expect(defIdx).toBeLessThan(libIdx);
    }
  });

  test('phase() is defined above the lib-return so the gate can set its phase in lib mode', () => {
    const phaseIdx = at(/^phase\(\)\s*\{/);
    expect(phaseIdx).toBeGreaterThan(-1);
    expect(phaseIdx).toBeLessThan(libIdx);
  });
});

describe('gauntlet-v2.sh — the PIN-ready START gate (SHY-0239)', () => {
  test('the gate is invoked BEFORE android-prep, matrix-dispatch, and the first overlap', () => {
    // The gate must pause before ANY device is touched. Pin the CALL site
    // (bare `pin_ready_gate` at column 0), not the function definition.
    const callIdx = at(/^pin_ready_gate$/);
    const servicesIdx = at(/phase "services"/);
    const dispatchIdx = at(/50-matrix\.sh" launch/);
    const overlapIdx = at(/start_overlapped /);
    expect(callIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(servicesIdx); // after the stack is up
    expect(callIdx).toBeLessThan(dispatchIdx); // before the devices run
    expect(callIdx).toBeLessThan(overlapIdx);
  });

  test('the gate is guarded (skippable) and writes the PIN_WAIT marker', () => {
    const body = bodyOf('pin_ready_gate');
    expect(body).not.toBeNull();
    expect(body).toMatch(/PIN_GATE/); // --no-pin-gate escape
    expect(body).toMatch(/MATRIX/); // no devices ⇒ no gate
    expect(body).toMatch(/> "\$RUN_DIR\/PIN_WAIT"/); // writes the marker
    expect(body).toMatch(/rm -f "\$RUN_DIR\/PIN_WAIT"/); // clears it on release
    expect(body).toMatch(/notify pin-wait/);
    expect(body).toMatch(/notify pin-ready/);
  });

  test('the gate is BOUNDED (no infinite hang) with both a TTY and a non-TTY path', () => {
    // A release gate that never returns is worse than a FAIL — the SHY-0238
    // matrix-wait liveness discipline. TTY ⇒ `read -t <timeout>`; non-TTY ⇒
    // wait for the PIN_READY token, also bounded.
    const body = bodyOf('pin_ready_gate');
    expect(body).toMatch(/PIN_GATE_TIMEOUT/);
    expect(body).toMatch(/\[ -t 0 \]/); // TTY branch
    expect(body).toMatch(/read -t "\$timeout"/); // bounded interactive read
    expect(body).toMatch(/PIN_READY/); // non-TTY confirm token
    expect(body).toMatch(/notify aborted/); // timeout ⇒ aborted
    // On timeout it writes FAIL EXPLICITLY (belt) + `return 1` (suspenders:
    // ERR→on_fail). NOT die/exit, which would skip the sentinel and leave
    // cmd_status reporting "died". BOTH timeout branches must do this.
    expect(body).toMatch(/touch "\$RUN_DIR\/FAIL"; return 1/);
    expect(body).not.toMatch(/\bdie\b/); // die/exit would bypass the sentinel
    // a non-integer PIN_GATE_TIMEOUT is clamped (not left to hang forever)
    expect(body).toMatch(/not a non-negative integer/);
  });
});

describe('gauntlet-v2.sh — event-driven self-notify (SHY-0239)', () => {
  test('emit_event appends to events.log; notify also prints a [notify] console line', () => {
    const emit = bodyOf('emit_event');
    expect(emit).not.toBeNull();
    expect(emit).toMatch(/>> "\$RUN_DIR\/events\.log"/);
    // pure-append + guarded so it is safe to call from the ERR/signal traps
    expect(emit).toMatch(/2>\/dev\/null \|\| true/);

    const notify = bodyOf('notify');
    expect(notify).not.toBeNull();
    expect(notify).toMatch(/emit_event/);
    expect(notify).toMatch(/\[notify\]/);
  });

  test('fail-fast: every failure-recording site routes through the once-only notify', () => {
    // The FIRST failure pings; later ones are console WARNs only.
    const guard = bodyOf('notify_first_fail');
    expect(guard).not.toBeNull();
    expect(guard).toMatch(/NOTIFIED_FIRST_FAIL/);
    expect(guard).toMatch(/notify suite-fail/);

    for (const fn of ['wait_overlapped', 'run_logged']) {
      expect(bodyOf(fn)).toMatch(/notify_first_fail/);
    }
    // the matrix-wait FAIL branch too
    const waitBlock = src.match(/phase "matrix-wait"[\s\S]*?\n {2}done/);
    expect(waitBlock).not.toBeNull();
    // the journey-matrix failure is recorded just after the block; assert the
    // notify sits with the FAILED_STEPS+=("journey-matrix") record.
    const matrixFail = src.match(/FAILED_STEPS\+=\("journey-matrix"\)[\s\S]{0,120}/);
    expect(matrixFail[0]).toMatch(/notify_first_fail/);
  });

  test('terminal notify is wired into the tally, the signal trap, and the ERR trap', () => {
    // complete / failed on the tally
    const failBranch = src.match(/if \[ "\$\{#FAILED_STEPS\[@\]\}" -gt 0 \]; then[\s\S]*?\nfi/);
    expect(failBranch[0]).toMatch(/notify failed/);
    expect(src).toMatch(/notify complete/);
    // aborted from on_signal (pure emit_event — safe inside a trap)
    expect(bodyOf('on_signal')).toMatch(/emit_event aborted/);
    // failed event from the ERR trap (pure emit_event) — and it writes the FAIL
    // sentinel the gate's `return 1` relies on (remove it and the gate-timeout
    // path would silently stop failing the run).
    expect(bodyOf('on_fail')).toMatch(/emit_event failed/);
    expect(bodyOf('on_fail')).toMatch(/touch "\$RUN_DIR\/FAIL"/);
  });

  test('a run start marker + a pid file are written for the status reader', () => {
    expect(src).toMatch(/echo \$\$ > "\$RUN_DIR\/pid"/);
    expect(src).toMatch(/notify start/);
  });
});

describe('gauntlet-v2.sh — the --status reader (SHY-0239)', () => {
  test('--status short-circuits BEFORE the orchestration (never brings a stack up)', () => {
    const statusIdx = at(/--status".*cmd_status|cmd_status "\$\{2/);
    const runIdIdx = at(/^RUN_ID=/);
    expect(statusIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(runIdIdx); // resolves + exits before any side effect
  });

  test('cmd_status encodes the DONE > FAIL > PIN_WAIT > running/died precedence', () => {
    const body = bodyOf('cmd_status');
    expect(body).not.toBeNull();
    // ordering of the branches is the precedence — assert DONE precedes FAIL
    // precedes PIN_WAIT precedes the pid-liveness split.
    const iDone = body.indexOf('DONE');
    const iFail = body.indexOf('FAIL');
    const iPin = body.indexOf('PIN_WAIT');
    const iPid = body.indexOf('kill -0');
    expect(iDone).toBeGreaterThan(-1);
    expect(iDone).toBeLessThan(iFail);
    expect(iFail).toBeLessThan(iPin);
    expect(iPin).toBeLessThan(iPid);
    expect(body).toMatch(/complete/);
    expect(body).toMatch(/failed/);
    expect(body).toMatch(/pin-wait/);
    expect(body).toMatch(/running/);
    expect(body).toMatch(/died/);
  });

  test('--no-pin-gate is a parsed flag', () => {
    expect(src).toMatch(/--no-pin-gate\)/);
  });
});
