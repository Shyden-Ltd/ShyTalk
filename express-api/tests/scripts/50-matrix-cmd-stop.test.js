'use strict';

// SHY-0236 — BEHAVIORAL (real-execution) coverage for the cold-boot gauntlet's
// process-reaping stop path in `express-api/scripts/gauntlet/50-matrix.sh`.
//
// The sibling file `gauntlet-cold-boot-structure.test.js` pins `_pid_tree` and
// `cmd_stop` STRUCTURALLY (regex over the shell source). That is necessary but
// NOT sufficient: a source-text regex stays green even if the recursion stopped
// descending, the self-exclusion were dropped, the run-id scoping inverted, or
// the honest `return 1` became a reassuring `echo "stopped"`. This file EXECUTES
// the real shell (the house pattern from qa-cleanup-orphans-pin.test.js) against
// throwaway `sleep` fixtures we spawn and reap — so a behavioral regression in
// the kill/verify logic actually fails a test. No mocks: real processes, real
// pgrep, real kills.
//
// Device safety + hermeticity: cmd_stop's device-cleanup loop shells out to
// `adb` (which lives in /opt/homebrew/bin). We run cmd_stop with PATH restricted
// to /usr/bin:/bin so `adb` is absent and the loop takes its graceful no-adb
// branch — that "no adb installed" degradation is itself worth pinning, and it
// guarantees the test never force-stops the app on a real connected phone.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const MATRIX = path.resolve(__dirname, '../../scripts/gauntlet/50-matrix.sh');
const NO_ADB_PATH = '/usr/bin:/bin'; // excludes /opt/homebrew/bin/adb — see header

/**
 * A PID the OS can never allocate.
 *
 * This used to spawn a subshell, take its pid and let it exit — a pid that is
 * dead *at that instant*. A pid is a reusable integer, not a durable identity:
 * macOS wraps at 99999 and this machine sits near 97000 during a full run, so a
 * just-freed number gets handed back out within seconds. cmd_stop's run_id
 * scoping means a recycled pid does not actually break these tests (verified by
 * mutation — forcing a live pid here still passes), so this is hygiene rather
 * than a fix: the helper's name promises "dead" and should not depend on the
 * kernel's allocation pointer to keep that promise.
 *
 * A value above the platform ceiling is never issued: `pid_max` on Linux is
 * exclusive, and macOS never goes above 99999.
 */
function unallocatablePid() {
  let pid = 100_000; // macOS PID_MAX is 99999
  try {
    const max = parseInt(fs.readFileSync('/proc/sys/kernel/pid_max', 'utf8').trim(), 10);
    if (Number.isFinite(max)) pid = max;
  } catch {
    /* not Linux — the macOS ceiling above applies */
  }
  // Fail loudly rather than silently reverting to a racy pid: a helper that
  // quietly stops guaranteeing its one property is worse than no helper.
  const probe = spawnSync('/bin/bash', ['-c', `kill -0 ${pid} 2>/dev/null`], { encoding: 'utf8' });
  if (probe.status === 0) {
    throw new Error(
      `unallocatablePid picked ${pid}, which is live — the ceiling assumption is wrong`,
    );
  }
  return pid;
}

describe('50-matrix.sh _pid_tree — real recursive descendant walk (SHY-0236)', () => {
  // Build a real 3-level process tree (ROOT bash → CHILD bash → GRANDCHILD sleep)
  // plus an unrelated sibling, extract the ACTUAL _pid_tree function from the
  // script, run it for real, and assert the returned PID set + ordering. A
  // reverted recursion (dropping the `pgrep -P` descent) would return only ROOT
  // and fail here — a regression the structural regex pin cannot see.
  let out;
  let ROOT;
  let CHILD;
  let GRANDCHILD;
  let UNREL;

  beforeAll(() => {
    const script = `
      set -uo pipefail
      eval "$(sed -n '/^_pid_tree()/,/^}/p' "${MATRIX}")"
      cleanup() { kill "$ROOT" "$CHILD" "$GRANDCHILD" "$UNREL" 2>/dev/null || true; }
      trap cleanup EXIT
      sleep 30 & UNREL=$!
      # '& wait' at each level forces a real fork (defeats bash's single-command
      # exec optimisation), giving a genuine 3-deep tree, not a flattened one.
      bash -c 'bash -c "sleep 30 & wait" & wait' & ROOT=$!
      CHILD=""; GRANDCHILD=""; i=0
      while [ $i -lt 50 ]; do
        CHILD="$(pgrep -P "$ROOT" 2>/dev/null | head -1)"
        [ -n "$CHILD" ] && GRANDCHILD="$(pgrep -P "$CHILD" 2>/dev/null | head -1)"
        [ -n "$GRANDCHILD" ] && break
        sleep 0.1; i=$((i+1))
      done
      echo "ROOT=$ROOT"; echo "CHILD=$CHILD"; echo "GRANDCHILD=$GRANDCHILD"; echo "UNREL=$UNREL"
      echo "TREE_BEGIN"; _pid_tree "$ROOT"; echo "TREE_END"
      echo "EMPTY_BEGIN"; _pid_tree ""; echo "EMPTY_END"
    `;
    out = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: NO_ADB_PATH },
    });
    const field = (name) => {
      const m = out.stdout.match(new RegExp(`^${name}=(\\d*)$`, 'm'));
      return m ? m[1] : '';
    };
    ROOT = field('ROOT');
    CHILD = field('CHILD');
    GRANDCHILD = field('GRANDCHILD');
    UNREL = field('UNREL');
  });

  const section = (begin, end) => {
    const s = out.stdout.indexOf(begin);
    const e = out.stdout.indexOf(end);
    return out.stdout
      .slice(s + begin.length, e)
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  };

  test('the synthetic 3-level tree materialised (fixture sanity)', () => {
    expect(out.status).toBe(0);
    expect(ROOT).toMatch(/^\d+$/);
    expect(CHILD).toMatch(/^\d+$/);
    expect(GRANDCHILD).toMatch(/^\d+$/);
    // three distinct pids at three distinct depths
    expect(new Set([ROOT, CHILD, GRANDCHILD]).size).toBe(3);
  });

  test('returns the root AND every descendant (recursion actually descends)', () => {
    const tree = section('TREE_BEGIN', 'TREE_END');
    expect([...tree].sort()).toEqual([ROOT, CHILD, GRANDCHILD].sort());
  });

  test('excludes an unrelated sibling process (scoped to the subtree)', () => {
    expect(section('TREE_BEGIN', 'TREE_END')).not.toContain(UNREL);
  });

  test('emits deepest-first: grandchild before child before root (children die first)', () => {
    const tree = section('TREE_BEGIN', 'TREE_END');
    expect(tree.indexOf(GRANDCHILD)).toBeLessThan(tree.indexOf(CHILD));
    expect(tree.indexOf(CHILD)).toBeLessThan(tree.indexOf(ROOT));
  });

  test('an empty pid arg yields no output (the [ -n "$p" ] guard, no crash)', () => {
    expect(section('EMPTY_BEGIN', 'EMPTY_END')).toEqual([]);
  });
});

describe('50-matrix.sh cmd_stop — honest stop + verification (SHY-0236)', () => {
  let tmpRoot;
  const spawned = [];

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0236-stop-'));
  });
  afterAll(() => {
    for (const c of spawned) {
      try {
        process.kill(c.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  function makeRun(id, pidValue) {
    const dir = path.join(tmpRoot, `matrix-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    if (pidValue !== undefined) fs.writeFileSync(path.join(dir, 'pid'), `${pidValue}\n`);
    return dir;
  }
  function runStop(id) {
    return spawnSync('/bin/bash', [MATRIX, 'stop', id], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GAUNTLET_TMP: tmpRoot, PATH: NO_ADB_PATH },
    });
  }

  /**
   * `manual-qa-runner` processes on this machine that are not ours.
   *
   * cmd_stop verifies its own honesty with a MACHINE-WIDE
   * `pgrep -fl manual-qa-runner` — correct for the real gauntlet, where any
   * surviving runner means the stop lied. Under `npm test` it is also a shared
   * resource: four sibling files (manual-qa-runner-dry-run, -help-version,
   * -list-flag, and manual-qa-runner.test.js) spawn real runner processes in
   * parallel Jest workers. This file then asks a global question and gets a
   * truthful answer about somebody else's process, so "0 runners remain" fails
   * — only ever inside the full run, never in isolation, because in isolation
   * there are no siblings.
   */
  function foreignRunners() {
    const r = spawnSync('/bin/bash', ['-c', 'pgrep -fl manual-qa-runner 2>/dev/null || true'], {
      encoding: 'utf8',
    });
    return (r.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.includes(' grep') && !l.includes(String(process.pid)));
  }

  /**
   * Wait for the machine to be quiet enough for a global assertion to mean
   * something. Bounded, and it FAILS with the offending pids named rather than
   * skipping — "Expected 0, Received 1" told us nothing about why for two full
   * suite runs.
   */
  function awaitQuiescence(budgetMs = 20_000) {
    const deadline = Date.now() + budgetMs;
    let seen = foreignRunners();
    while (seen.length > 0 && Date.now() < deadline) {
      spawnSync('/bin/bash', ['-c', 'sleep 0.25']);
      seen = foreignRunners();
    }
    if (seen.length > 0) {
      throw new Error(
        'Another test file still has manual-qa-runner processes alive, so the ' +
          'machine-wide "0 runners remain" check cannot be trusted:\n  ' +
          seen.join('\n  '),
      );
    }
  }

  test('clean run (dead pid, no live runners) → exit 0 and reports "0 runners remain"', () => {
    // The only assertion here that reaches outside this test's own fixtures.
    awaitQuiescence();
    makeRun('clean-xyz', unallocatablePid());
    const r = runStop('clean-xyz');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 runners remain/);
  });

  test('missing pid file → dies with a clear message (exit 1)', () => {
    makeRun('nopid'); // dir but no pid file
    const r = runStop('nopid');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no pid file/);
  });

  test('reaps a process tagged with THIS run_id (the orphaned-cell-runner kill) → exit 0', () => {
    // A process whose argv carries the run_id IS an orphaned cell runner; the
    // run-scoped `pgrep -f "$run_id"` must find and kill it. Tagged WITHOUT the
    // "manual-qa-runner" token so it can't collide with the leftover fixture
    // below (and so a kill race can't falsely trip that run's verification).
    const id = `killme-${process.pid}`;
    const runId = `matrix-${id}`; // == basename(run dir) == cmd_stop's $run_id
    const child = spawn('/bin/bash', ['-c', `exec -a shy0236-${runId}-cell sleep 30`], {
      stdio: 'ignore',
    });
    spawned.push(child);
    const seen = () =>
      spawnSync('/usr/bin/pgrep', ['-f', runId], { encoding: 'utf8' }).stdout.trim();
    let start = Date.now();
    while (!seen() && Date.now() - start < 3000) spawnSync('/bin/sleep', ['0.05']);
    expect(seen()).not.toBe(''); // fixture live + run-id-visible

    makeRun(id, unallocatablePid());
    const r = runStop(id);

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0 runners remain/);
    // Liveness via pgrep, NOT process.kill(pid,0): cmd_stop kills the fixture,
    // but Node (its parent) can't reap the zombie while our synchronous calls
    // block the event loop, so kill(pid,0) would still report "alive". A killed
    // process loses its argv, so `pgrep -f runId` going empty is the correct
    // zombie-safe proof that the run-scoped process is genuinely no longer running.
    expect(seen()).toBe('');
  });

  test('a surviving manual-qa-runner-tagged process → honest exit 1 (never a false "stopped")', () => {
    // Spawn a process that `pgrep -fl manual-qa-runner` matches, but whose argv
    // does NOT carry the run_id — so cmd_stop's run-scoped kill passes correctly
    // leave it alone, and the honest verification MUST catch it and return
    // non-zero instead of printing the old reassuring "stopped pid N" lie.
    const tag = `manual-qa-runner-shy0236-fixture-${process.pid}`;
    const child = spawn('/bin/bash', ['-c', `exec -a ${tag} sleep 30`], { stdio: 'ignore' });
    spawned.push(child);
    const seen = () => spawnSync('/usr/bin/pgrep', ['-f', tag], { encoding: 'utf8' }).stdout.trim();
    const start = Date.now();
    while (!seen() && Date.now() - start < 3000) spawnSync('/bin/sleep', ['0.05']);
    expect(seen()).not.toBe(''); // fixture is live + pgrep-visible

    makeRun('leftover-xyz', unallocatablePid());
    const r = runStop('leftover-xyz');

    expect(r.status).not.toBe(0); // honest failure, not a false success
    expect(r.stderr).toMatch(/STILL alive/);
    expect(r.stderr).toContain(String(child.pid)); // it flagged OUR survivor
    // Still running with its argv intact (pgrep-visible) — proving cmd_stop did
    // NOT kill it (it isn't run-scoped). pgrep, not kill(pid,0): a killed child
    // would zombie (unreaped, argv gone) and kill(pid,0) would falsely say alive.
    expect(seen()).not.toBe('');
  });
});
