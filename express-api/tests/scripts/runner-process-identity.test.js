'use strict';

// SHY-0304 — the gauntlet must identify a QA-runner process by WHAT IT IS, not
// by whether the string "manual-qa-runner" appears somewhere on its command
// line. Three real defects came out of that substring test:
//
//   1. `50-matrix.sh` cmd_stop verified machine-wide, so `stop A` reported
//      failure because run B was alive — and because Jest, npm and the
//      invoking shell all carry the runner's name when they run its tests.
//   2. `qa-cleanup-orphans.sh` KILLS on the same predicate, in its DEFAULT
//      mode, so sweeping for orphans while the runner's own suite is running
//      kills that suite.
//   3. cmd_stop's run-scoped kill set matched anything carrying the run id,
//      including an operator's `tail -f` on that run's own log.
//
// Everything here spawns REAL processes and runs the REAL shell. The defect
// exists only in the relationship between a real process table and a real
// pgrep, so a double could not express it. No mocks.
//
// ISOLATION: every assertion is either scoped to a run id this file invented,
// or is a UNIVERSAL property ("everything reported is a genuine runner").
// Nothing asserts on the absence of runners machine-wide — `qa-cleanup-orphans`
// is machine-wide BY DESIGN, so such an assertion could never be hermetic, and
// writing one would reintroduce the very cross-suite leak this story fixes.
//
// Device safety: cmd_stop shells out to `adb`. PATH is restricted to
// /usr/bin:/bin so `adb` is absent and the device loop takes its graceful
// no-adb branch — guaranteeing these tests can never force-stop the app on a
// real connected phone.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MATRIX = path.join(REPO_ROOT, 'express-api/scripts/gauntlet/50-matrix.sh');
const CLEANUP = path.join(REPO_ROOT, 'express-api/scripts/qa-cleanup-orphans.sh');
const RUNNER = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');
const NO_ADB_PATH = '/usr/bin:/bin';

/** A pid that is certainly dead: a subshell that prints its own pid and exits. */
function deadPid() {
  return parseInt(
    spawnSync('/bin/bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim(),
    10,
  );
}

/** What `pgrep -f` sees — the substring predicate the defective code used. */
function pgrepFull(needle) {
  return spawnSync('/usr/bin/pgrep', ['-f', needle], { encoding: 'utf8' }).stdout.trim();
}

/** The full command line of a pid, or '' if it is gone. */
function commandOf(pid) {
  return spawnSync('/bin/ps', ['-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
  }).stdout.trim();
}

const spawned = [];
function track(child) {
  spawned.push(child);
  return child;
}

/**
 * Spawn a fixture with a chosen command line and block until pgrep can see it.
 *
 * Spawning is asynchronous with respect to the process table: `spawn` returns
 * once the fork succeeds, but `exec -a` has not necessarily replaced the image
 * yet. Every assertion here concerns what a pgrep-based script can see, so a
 * test that raced the process table would fail for a reason unrelated to the
 * code under test. Condition-based, never a sleep.
 */
function spawnVisible(argv0, needle) {
  // `argv0` is passed as a positional parameter, never interpolated into the
  // script text: it contains spaces (it is a whole command line), and inline
  // interpolation made bash read the second word as the command to exec —
  // which silently produced no fixture at all rather than a wrong one.
  const child = track(
    spawn('/bin/bash', ['-c', 'exec -a "$1" sleep 45', 'bash', argv0], { stdio: 'ignore' }),
  );
  const start = Date.now();
  while (!pgrepFull(needle) && Date.now() - start < 5000) spawnSync('/bin/sleep', ['0.05']);
  if (!pgrepFull(needle)) throw new Error(`fixture never became pgrep-visible: ${argv0}`);
  return child;
}

function why(r) {
  const trim = (t) => (t || '').trim().slice(0, 2000) || '(empty)';
  return [
    `exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}`,
    `--- stdout ---\n${trim(r.stdout)}`,
    `--- stderr ---\n${trim(r.stderr)}`,
  ].join('\n');
}

/** Jest's two-argument `expect` hint form is Vitest's — passing a message
 *  there silently breaks the assertion. Throw instead. */
function expectStatus(r, expected) {
  if (r.status !== expected) throw new Error(why(r));
  expect(r.status).toBe(expected);
}

describe('SHY-0304 — a runner is identified by what it is, not what it mentions', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0304-'));
  });

  afterAll(() => {
    for (const c of spawned) {
      try {
        process.kill(-c.pid, 'SIGKILL'); // group first: supervisors have children
      } catch {
        /* not a group leader */
      }
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
      timeout: 40000,
      env: { ...process.env, GAUNTLET_TMP: tmpRoot, PATH: NO_ADB_PATH },
    });
  }

  /** The pids qa-cleanup-orphans.sh reports it would kill. */
  function cleanupTargets(stdout) {
    const m = stdout.match(/found runner PIDs:([\s\S]*?)(?=\n\[qa-cleanup\]|$)/);
    if (!m) return [];
    return m[1]
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  }

  function runCleanup() {
    const r = spawnSync('/bin/bash', [CLEANUP, '--dry-run'], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: NO_ADB_PATH },
    });
    return { r, targets: cleanupTargets(r.stdout) };
  }

  // ---------------------------------------------------------------- 50-matrix

  describe('50-matrix.sh stop', () => {
    test('a runner belonging to ANOTHER run does not fail this run’s stop', () => {
      // The exact shape of the cross-suite leak: a genuine runner, correctly
      // NOT killed by this run's scoped kill, must not be reported as this
      // run's leftover. Today the machine-wide pgrep reports it and exits 1.
      const otherRun = `matrix-other-${process.pid}`;
      spawnVisible(`node ${RUNNER} --matrix --report-dir=/tmp/${otherRun}/report`, otherRun);

      makeRun('mine-a', deadPid());
      const r = runStop('mine-a');

      expectStatus(r, 0);
      expect(r.stdout).toMatch(/0 runners remain/);
    });

    test('a runner from another run is still surfaced, attributed, not silently dropped', () => {
      // Scoping must not become "stop stopped telling me things". The other
      // run is reported — just not as THIS run's failure.
      const otherRun = `matrix-noted-${process.pid}`;
      spawnVisible(`node ${RUNNER} --matrix --report-dir=/tmp/${otherRun}/report`, otherRun);

      makeRun('mine-b', deadPid());
      const r = runStop('mine-b');

      expectStatus(r, 0);
      expect(`${r.stdout}${r.stderr}`).toMatch(/other run/i);
    });

    test('a process that only NAMES the runner is not a leftover', () => {
      // Mirrors the real offenders caught by sampling pgrep during a test run:
      // jest, npm and the invoking shell, all carrying a *.test.js filename.
      const decoy = `shy0304-decoy-${process.pid}`;
      spawnVisible(`node jest tests/scripts/manual-qa-runner.test.js ${decoy}`, decoy);

      makeRun('mine-c', deadPid());
      const r = runStop('mine-c');

      expectStatus(r, 0);
      expect(r.stdout).toMatch(/0 runners remain/);
    });

    // The honest-failure contract — "a survivor of THIS run still exits 1" —
    // is the concern SHY-0236 introduced and lives with its siblings in
    // `50-matrix-cmd-stop.test.js`, which SHY-0304 rewrote to provoke a
    // survivor of the RIGHT run. It is the control against the obvious wrong
    // fix here (a `runner_pids` that always returns nothing); the local
    // control for that in this file is `still targets a genuine orphaned
    // runner` below, which fails if the predicate ever goes vacuous.

    test('does not kill an operator’s tail -f on the run’s own log', () => {
      // The run id is in the log PATH, so a substring kill set includes the
      // reader. An observer is not a participant.
      const id = `tailed-${process.pid}`;
      const dir = makeRun(id, deadPid());
      const logPath = path.join(dir, 'log');
      fs.writeFileSync(logPath, 'watching\n');

      const tail = track(spawn('/usr/bin/tail', ['-f', logPath], { stdio: 'ignore' }));
      const start = Date.now();
      while (!commandOf(tail.pid) && Date.now() - start < 5000) spawnSync('/bin/sleep', ['0.05']);
      expect(commandOf(tail.pid)).toContain(`matrix-${id}`); // it IS in the substring kill set

      const r = runStop(id);

      expectStatus(r, 0);
      // Still running WITH its argv. A killed child would zombie (argv gone)
      // and `kill(pid, 0)` would falsely report it alive, so read the command.
      expect(commandOf(tail.pid)).toContain(`matrix-${id}`);
    });
  });

  // ------------------------------------------------------- qa-cleanup-orphans

  describe('qa-cleanup-orphans.sh', () => {
    test('does not target a process that only NAMES the runner', () => {
      // `clean` is the DEFAULT mode, so a false positive here is a kill.
      const decoy = `shy0304-clean-decoy-${process.pid}`;
      const child = spawnVisible(
        `node jest tests/scripts/manual-qa-runner.test.js ${decoy}`,
        decoy,
      );

      const { r, targets } = runCleanup();

      expectStatus(r, 0);
      expect(targets).not.toContain(String(child.pid));
    });

    test('does not target its own ancestors', () => {
      // The wrapper's argv carries a genuine `node …/manual-qa-runner.js`
      // token, so identity matching alone would select it — only ancestor
      // exclusion can spare it. This is the shape the script's own comment
      // worries about ("launched via npm/node ancestry") and half-defends.
      const marker = `shy0304-ancestor-${process.pid}`;
      const r = spawnSync(
        '/bin/bash',
        ['-c', `echo "wrapper $$"; bash ${CLEANUP} --dry-run; : ${marker} node ${RUNNER} --matrix`],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, PATH: NO_ADB_PATH } },
      );

      expectStatus(r, 0);
      const wrapperPid = (r.stdout.match(/^wrapper (\d+)/m) || [])[1];
      expect(wrapperPid).toMatch(/^\d+$/);
      expect(cleanupTargets(r.stdout)).not.toContain(wrapperPid);
    });

    test('still targets a genuine orphaned runner', () => {
      // The capability the script exists for. Without this, "target nothing"
      // would pass every other case in this describe.
      const marker = `shy0304-genuine-${process.pid}`;
      const child = spawnVisible(`node ${RUNNER} --matrix --target local ${marker}`, marker);

      const { r, targets } = runCleanup();

      expectStatus(r, 0);
      expect(targets).toContain(String(child.pid));
    });

    test('everything it targets is genuinely running the runner script', () => {
      // A universal property, so it holds no matter what else is on the
      // machine — the isolation-safe form of "no impostors". Any process the
      // script would kill must actually be executing manual-qa-runner.js.
      const decoy = `shy0304-universal-${process.pid}`;
      spawnVisible(`node jest tests/scripts/manual-qa-runner-shard-flag.test.js ${decoy}`, decoy);

      const { r, targets } = runCleanup();

      expectStatus(r, 0);
      const impostors = targets
        .map((pid) => ({ pid, cmd: commandOf(pid) }))
        .filter(({ cmd }) => cmd !== '' && !/[\s/]manual-qa-runner\.js(\s|$)/.test(cmd));
      expect(impostors).toEqual([]);
    });
  });
});
