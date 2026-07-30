/**
 * manual-qa-runner-incomplete-exit.test.js
 *
 * Pins SHY-0255: a journey run that never happened must never look like a
 * pass.
 *
 * Gauntlet run 20260730-005554-local recorded `firefox: pass`,
 * `webkit: pass` and `edge: pass` for cells that had each printed twelve
 * FAIL scenarios and then nothing for two hours — the host had gone into
 * clamshell sleep and taken both devices with it. The runner's awaited
 * driver call never settled, the event loop drained, and Node exited 0.
 * matrix-dispatch classifies on `code === 0`, so "the process stopped
 * existing" and "every journey passed" were the same record.
 *
 * The contract this file pins:
 *
 *   exit 0 — a COMPLETED run with no findings
 *   exit 1 — a COMPLETED run with findings
 *   exit 2 — runtime error (RUNNER_CRASH)          [sibling file]
 *   exit 3 — driver init failed → cell 'skip'      [sibling file]
 *   exit 4 — RUNNER_INCOMPLETE: the run ended without finishing
 *   exit 5 — RUNNER_NO_FEATURES: nothing was there to run
 *
 * REAL processes throughout. The drained-loop tests spawn a real Node
 * child that loads the real guard and then genuinely drains its event
 * loop — the same mechanism proven to exit 0 in the wild, reproduced
 * rather than simulated. The plan-dir tests spawn the real runner
 * against real (empty / missing) paths. No doubles.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');
const DISPATCH_PATH = path.join(REPO_ROOT, 'express-api/scripts/matrix-dispatch');

const {
  EXIT_RUNNER_INCOMPLETE,
  EXIT_RUNNER_NO_FEATURES,
  EXIT_DRIVER_INIT_FAILED,
} = require('../../scripts/matrix-dispatch');

jest.setTimeout(60000);

const PASSING_ENV = {
  PERSONAS_PASSWORD: 'x'.repeat(24),
  FIREBASE_LOCAL_API_KEY: 'fake-local-key',
  FIREBASE_DATABASE_URL: 'http://localhost:9000?ns=demo-shytalk-default-rtdb',
};

function runCli(args, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.WDA_TEAM_ID;
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: 50000,
  });
}

/**
 * Spawn a real child that installs the real guard and then genuinely
 * drains its event loop by awaiting a promise nothing will ever settle.
 * This is the exact shape of the production hang (an awaited driver call
 * on a device that went away), reduced to its essence.
 */
function runDrainedChild(extra = '') {
  const script = [
    `const g = require(${JSON.stringify(DISPATCH_PATH)});`,
    `g.installIncompleteRunGuard(process);`,
    extra,
    `(async () => { await new Promise(() => {}); })();`,
  ].join('\n');
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('a run that ends without finishing is not a pass', () => {
  test('a drained event loop exits with the incomplete marker, not 0', () => {
    const r = runDrainedChild();
    // The whole defect in one assertion: this process produced no result,
    // so it must not be able to claim success.
    expect(r.status).not.toBe(0);
    expect(r.status).toBe(EXIT_RUNNER_INCOMPLETE);
  });

  test('the drained run says RUNNER_INCOMPLETE on stderr', () => {
    const r = runDrainedChild();
    expect(r.stderr).toMatch(/RUNNER_INCOMPLETE/);
  });

  test('an explicit exit still wins over the guard (a completed clean run is green)', () => {
    // Proves the seed is a FLOOR, not a ceiling: reaching a real
    // completion path must still be able to report success, otherwise the
    // fix would turn every green run red.
    const r = runDrainedChild('process.exit(0);');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/RUNNER_INCOMPLETE/);
  });

  test('an explicit failing exit is preserved, not masked by the guard', () => {
    const r = runDrainedChild('process.exit(1);');
    expect(r.status).toBe(1);
  });
});

describe('the incomplete marker is distinguishable from the other exit codes', () => {
  test('it is not 0 — otherwise the matrix records a pass', () => {
    expect(EXIT_RUNNER_INCOMPLETE).not.toBe(0);
  });

  test('it is not DRIVER_INIT_FAILED — otherwise the cell is downgraded to a tolerated skip', () => {
    expect(EXIT_RUNNER_INCOMPLETE).not.toBe(EXIT_DRIVER_INIT_FAILED);
  });

  test('no-features is its own code, so the two causes are told apart in a log', () => {
    expect(EXIT_RUNNER_NO_FEATURES).not.toBe(0);
    expect(EXIT_RUNNER_NO_FEATURES).not.toBe(EXIT_RUNNER_INCOMPLETE);
    expect(EXIT_RUNNER_NO_FEATURES).not.toBe(EXIT_DRIVER_INIT_FAILED);
  });
});

describe('a run with nothing to run is not a pass', () => {
  test('an empty plan dir exits non-zero with RUNNER_NO_FEATURES', () => {
    const dir = tmpDir('shy0255-empty-');
    const r = runCli(
      ['--target', 'local', '--driver', 'playwright', '--browser', 'chromium', '--plan-dir', dir],
      PASSING_ENV,
    );
    expect(r.stderr).toMatch(/RUNNER_NO_FEATURES/);
    expect(r.status).toBe(EXIT_RUNNER_NO_FEATURES);
  });

  test('the no-features diagnostic names the plan dir it searched', () => {
    const dir = tmpDir('shy0255-named-');
    const r = runCli(
      ['--target', 'local', '--driver', 'playwright', '--browser', 'chromium', '--plan-dir', dir],
      PASSING_ENV,
    );
    // Without the path the operator cannot tell a mistyped --plan-dir from
    // a corpus that really is empty.
    expect(r.stderr).toContain(dir);
  });

  test('a --journey naming a file that does not exist exits non-zero', () => {
    const dir = tmpDir('shy0255-journey-');
    const r = runCli(
      [
        '--target',
        'local',
        '--driver',
        'playwright',
        '--browser',
        'chromium',
        '--plan-dir',
        dir,
        '--journey',
        'j99-does-not-exist.feature',
      ],
      PASSING_ENV,
    );
    expect(r.status).toBe(EXIT_RUNNER_NO_FEATURES);
    expect(r.stderr).toMatch(/RUNNER_NO_FEATURES/);
  });

  test('it does not emit a clean report for a run that never happened', () => {
    // The old behaviour printed `Findings: 0` and wrote a report file — a
    // green artifact describing nothing. An operator (or a script) reading
    // that report has no way to tell it apart from a real clean sweep.
    const dir = tmpDir('shy0255-report-');
    const r = runCli(
      ['--target', 'local', '--driver', 'playwright', '--browser', 'chromium', '--plan-dir', dir],
      PASSING_ENV,
    );
    expect(r.stdout).not.toMatch(/Findings: 0/);
    expect(r.stdout).not.toMatch(/Running 0 feature file\(s\)/);
  });
});

describe('the runner actually arms the guard, not merely exports it', () => {
  // The drained-loop tests above prove the GUARD works. They would stay
  // green if someone deleted the runner's call to it, because they spawn
  // their own child. These pin the wiring — anchored on the whole
  // entrypoint block so a mention in a comment or an unrelated branch
  // cannot satisfy them.
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  const blockStart = src.indexOf('if (require.main === module)');
  const entrypoint = blockStart === -1 ? '' : src.slice(blockStart);
  // Line comments are stripped before the ordering check: the explanatory
  // comment above the call legitimately contains the words `main()`.
  const code = entrypoint.replace(/\/\/[^\n]*/g, '');

  test('the entrypoint block is findable (guards the two tests below)', () => {
    expect(blockStart).toBeGreaterThan(-1);
  });

  test('the entrypoint installs the incomplete-run guard', () => {
    expect(code).toContain('installIncompleteRunGuard(process)');
  });

  test('it is armed before main() runs — a guard installed after the hang is no guard', () => {
    const armedAt = code.indexOf('installIncompleteRunGuard(process)');
    const mainAt = code.indexOf('main().catch');
    expect(armedAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(-1);
    expect(armedAt).toBeLessThan(mainAt);
  });
});

describe('non-journey modes are complete runs, not incomplete ones', () => {
  test('--list still exits 0', () => {
    const r = runCli(['--target', 'local', '--list'], PASSING_ENV);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/RUNNER_INCOMPLETE|RUNNER_NO_FEATURES/);
  });

  test('--dry-run still exits 0', () => {
    const r = runCli(['--target', 'local', '--dry-run'], PASSING_ENV);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/RUNNER_INCOMPLETE|RUNNER_NO_FEATURES/);
  });

  test('--help still exits 0', () => {
    const r = runCli(['--help'], PASSING_ENV);
    expect(r.status).toBe(0);
  });

  test('--version still exits 0', () => {
    const r = runCli(['--version'], PASSING_ENV);
    expect(r.status).toBe(0);
  });
});
