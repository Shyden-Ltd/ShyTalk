/**
 * matrix-cell-dispatch.test.js
 *
 * Tests createCellDispatcher — the async-spawn per-cell dispatch used by
 * the runner's `--matrix` path (SHY-0095 parallel-dispatch second half).
 * The old inline spawnSync closure blocked the event loop, so runMatrix's
 * `parallel` mode could never actually overlap cells; the dispatcher must
 * spawn asynchronously while preserving the spawnSync-era contract:
 *
 *   - resolves true/false from the cell's exit code
 *   - CELL_TIMEOUT throw (same message shape) when --cell-timeout trips
 *   - capture mode tees child output to the operator streams at cell end
 *     and writes the per-cell log via matrix-cell-logs
 *   - inherit mode stays zero-overhead (no buffering, no log)
 *
 * REAL processes only: every dispatch here spawns the real Node binary
 * running the fake-matrix-cell.js fixture (a genuine subprocess, not an
 * in-process double). Streams are real PassThrough sinks; report dirs are
 * real tmp dirs; cell logs go through the real matrix-cell-logs module.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PassThrough } = require('stream');

const { createCellDispatcher } = require('../../scripts/matrix-cell-dispatch');
const cellLogs = require('../../scripts/matrix-cell-logs');
const { runMatrix, EXIT_DRIVER_INIT_FAILED } = require('../../scripts/matrix-dispatch');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-matrix-cell.js');

jest.setTimeout(20000);

function collect(stream) {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  return () => Buffer.concat(chunks).toString('utf8');
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('createCellDispatcher — factory input rejection', () => {
  test.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s runnerPath', (_label, bad) => {
    expect(() => createCellDispatcher({ runnerPath: bad, baseArgv: [] })).toThrow(/runnerPath/);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', '--target local'],
    ['number', 42],
  ])('rejects %s baseArgv', (_label, bad) => {
    expect(() => createCellDispatcher({ runnerPath: FIXTURE, baseArgv: bad })).toThrow(/baseArgv/);
  });
});

describe('createCellDispatcher — exit-code contract', () => {
  test('resolves true when the cell process exits 0', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: { ...process.env, FAKE_CELL_EXIT: '0' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(true);
  });

  test('resolves false when the cell process exits 1', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: { ...process.env, FAKE_CELL_EXIT: '1' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(false);
  });

  test('resolves false when the cell script itself is missing (node exits nonzero)', async () => {
    // Captured streams keep node's MODULE_NOT_FOUND stderr out of the
    // test output; the contract under test is only "missing script must
    // not count as a passing cell".
    const dispatchOne = createCellDispatcher({
      runnerPath: path.join(__dirname, 'fixtures', 'no-such-cell-script.js'),
      baseArgv: [],
      captureStdio: true,
      out: new PassThrough(),
      err: new PassThrough(),
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(false);
  });

  test('rejects with ENOENT when the node binary itself is missing', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      nodePath: path.join(__dirname, 'fixtures', 'no-such-node-binary'),
    });
    await expect(dispatchOne({ browser: 'chromium' })).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createCellDispatcher — argv + env plumbing', () => {
  test('appends --browser <slug> after the base argv, in order', async () => {
    const dir = tmpDir('cell-dispatch-argv-');
    const echoFile = path.join(dir, 'argv.json');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: ['--target', 'local', '--driver', 'all'],
      env: { ...process.env, FAKE_CELL_ECHO_ARGV_FILE: echoFile },
    });
    await expect(dispatchOne({ browser: 'mobile-safari-ios' })).resolves.toBe(true);
    const echoed = JSON.parse(fs.readFileSync(echoFile, 'utf8'));
    expect(echoed.argv).toEqual([
      '--target',
      'local',
      '--driver',
      'all',
      '--browser',
      'mobile-safari-ios',
    ]);
    expect(echoed.browser).toBe('mobile-safari-ios');
  });

  test('spawns the cell with the provided env', async () => {
    const dir = tmpDir('cell-dispatch-env-');
    const echoFile = path.join(dir, 'argv.json');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: {
        ...process.env,
        FAKE_CELL_ECHO_ARGV_FILE: echoFile,
        FAKE_CELL_PROBE: 'env-plumbing-proof-91',
      },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(true);
    const echoed = JSON.parse(fs.readFileSync(echoFile, 'utf8'));
    expect(echoed.probe).toBe('env-plumbing-proof-91');
  });
});

describe('createCellDispatcher — cell timeout', () => {
  test('throws CELL_TIMEOUT with the spawnSync-era message when the cell outlives cellTimeoutMs', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      cellTimeoutMs: 1000,
      env: { ...process.env, FAKE_CELL_SLEEP_MS: '30000' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).rejects.toMatchObject({
      code: 'CELL_TIMEOUT',
      message: 'cell timed out after 1s',
    });
  });

  test('imposes no timeout when cellTimeoutMs is unset', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: { ...process.env, FAKE_CELL_SLEEP_MS: '300', FAKE_CELL_EXIT: '0' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(true);
  });
});

describe('createCellDispatcher — capture mode', () => {
  test('tees child stdout and stderr to the provided streams', async () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const readOut = collect(out);
    const readErr = collect(err);
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: true,
      out,
      err,
      env: {
        ...process.env,
        FAKE_CELL_STDOUT: 'cell says hello\n',
        FAKE_CELL_STDERR: 'cell warns loudly\n',
      },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(true);
    expect(readOut()).toBe('cell says hello\n');
    expect(readErr()).toBe('cell warns loudly\n');
  });

  test('writes the per-cell log with outcome pass and the stdout body', async () => {
    const reportDir = tmpDir('cell-dispatch-log-pass-');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: true,
      reportDir,
      cellLogs,
      out: new PassThrough(),
      err: new PassThrough(),
      env: { ...process.env, FAKE_CELL_STDOUT: 'journey OK\n' },
    });
    await expect(dispatchOne({ browser: 'firefox' })).resolves.toBe(true);
    const logPath = path.join(reportDir, 'firefox.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const log = fs.readFileSync(logPath, 'utf8');
    expect(log).toContain('browser=firefox outcome=pass');
    expect(log).toContain('journey OK');
  });

  test('writes the per-cell log with outcome fail and a ---STDERR--- separated stderr body', async () => {
    const reportDir = tmpDir('cell-dispatch-log-fail-');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: true,
      reportDir,
      cellLogs,
      out: new PassThrough(),
      err: new PassThrough(),
      env: {
        ...process.env,
        FAKE_CELL_EXIT: '1',
        FAKE_CELL_STDOUT: 'step 3 diverged\n',
        FAKE_CELL_STDERR: 'assertion detail\n',
      },
    });
    await expect(dispatchOne({ browser: 'webkit' })).resolves.toBe(false);
    const log = fs.readFileSync(path.join(reportDir, 'webkit.log'), 'utf8');
    expect(log).toContain('browser=webkit outcome=fail');
    expect(log).toContain('step 3 diverged');
    expect(log).toContain('---STDERR---');
    expect(log).toContain('assertion detail');
  });

  test('inherit mode writes no log file even when a report dir exists on disk', async () => {
    const reportDir = tmpDir('cell-dispatch-inherit-');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: false,
      env: { ...process.env, FAKE_CELL_EXIT: '0' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(true);
    expect(fs.readdirSync(reportDir)).toEqual([]);
  });
});

describe('createCellDispatcher — concurrency (the point of the async conversion)', () => {
  test('two dispatches overlap: handshake cells each see the other cell running', async () => {
    // Each cell writes its marker then polls for the OTHER cell's marker.
    // A blocking (spawnSync-style) dispatcher runs the cells one-after-
    // the-other, so the first cell exhausts its poll budget alone and
    // exits 7 → resolves false. Only genuinely concurrent spawning lets
    // BOTH cells observe each other and exit 0.
    const handshakeDir = tmpDir('cell-dispatch-handshake-');
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: {
        ...process.env,
        FAKE_CELL_HANDSHAKE_DIR: handshakeDir,
        FAKE_CELL_PEERS: 'cell-a,cell-b',
      },
    });
    const [a, b] = await Promise.all([
      dispatchOne({ browser: 'cell-a' }),
      dispatchOne({ browser: 'cell-b' }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("concurrent capture keeps each cell's tee block contiguous on the shared stream", async () => {
    const out = new PassThrough();
    const readOut = collect(out);
    const handshakeDir = tmpDir('cell-dispatch-atomic-');
    const blockA = 'A1 line\nA2 line\nA3 line\n';
    const blockB = 'B1 line\nB2 line\nB3 line\n';
    const mk = (stdout) =>
      createCellDispatcher({
        runnerPath: FIXTURE,
        baseArgv: [],
        captureStdio: true,
        out,
        err: new PassThrough(),
        env: {
          ...process.env,
          FAKE_CELL_HANDSHAKE_DIR: handshakeDir,
          FAKE_CELL_PEERS: 'cell-a,cell-b',
          FAKE_CELL_STDOUT: stdout,
        },
      });
    const [a, b] = await Promise.all([
      mk(blockA)({ browser: 'cell-a' }),
      mk(blockB)({ browser: 'cell-b' }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    const teed = readOut();
    // Buffered-at-cell-end flushing means each cell's whole output is one
    // contiguous block — interleaved lines would mean live-streaming leaked
    // through and the operator's parallel log is scrambled.
    expect(teed).toContain(blockA);
    expect(teed).toContain(blockB);
  });
});

describe('createCellDispatcher — driver-init exit code (inc-2 skip classification)', () => {
  // The single-cell runner exits with the reserved EXIT_DRIVER_INIT_FAILED
  // code when a driver cannot bootstrap (no device / missing env). The
  // dispatcher must translate that into a DRIVER_INIT_FAILED throw so
  // matrix-dispatch classifies the cell 'skip' — before inc-2, exit-2
  // init crashes collapsed into 'fail' alongside real assertion failures.

  test('a cell exiting EXIT_DRIVER_INIT_FAILED rejects with code DRIVER_INIT_FAILED naming the cell', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: { ...process.env, FAKE_CELL_EXIT: String(EXIT_DRIVER_INIT_FAILED) },
    });
    await expect(dispatchOne({ browser: 'mobile-safari-ios' })).rejects.toMatchObject({
      code: 'DRIVER_INIT_FAILED',
      message: expect.stringContaining('mobile-safari-ios'),
    });
  });

  test('exit-1 (real failure) still resolves false — reserved code does not swallow real fails', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      env: { ...process.env, FAKE_CELL_EXIT: '1' },
    });
    await expect(dispatchOne({ browser: 'chromium' })).resolves.toBe(false);
  });

  test('capture mode flushes the init-failed cell output and writes a skip log before throwing', async () => {
    const reportDir = tmpDir('cell-dispatch-init-skip-');
    const out = new PassThrough();
    const err = new PassThrough();
    const readOut = collect(out);
    const readErr = collect(err);
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: true,
      reportDir,
      cellLogs,
      out,
      err,
      env: {
        ...process.env,
        FAKE_CELL_EXIT: String(EXIT_DRIVER_INIT_FAILED),
        FAKE_CELL_STDOUT: 'booting driver...\n',
        FAKE_CELL_STDERR: 'DRIVER_INIT_FAILED no physical iPhone found\n',
      },
    });
    await expect(dispatchOne({ browser: 'mobile-safari-ios' })).rejects.toMatchObject({
      code: 'DRIVER_INIT_FAILED',
    });
    // The operator must be able to see WHY the cell skipped: output teed +
    // log written with outcome=skip (fulfils the matrix-cell-logs
    // docstring promise that device-offline skips leave a log behind).
    expect(readOut()).toContain('booting driver...');
    expect(readErr()).toContain('no physical iPhone found');
    const log = fs.readFileSync(path.join(reportDir, 'mobile-safari-ios.log'), 'utf8');
    expect(log).toContain('browser=mobile-safari-ios outcome=skip');
    expect(log).toContain('booting driver...');
    expect(log).toContain('---STDERR---');
    expect(log).toContain('no physical iPhone found');
  });

  test('end-to-end through runMatrix: init-exit cell classifies skip, healthy cell passes, matrix ok', async () => {
    const dispatchOne = createCellDispatcher({
      runnerPath: FIXTURE,
      baseArgv: [],
      captureStdio: true,
      out: new PassThrough(),
      err: new PassThrough(),
      env: { ...process.env, FAKE_CELL_EXIT_MAP: 'mobile-safari-ios=3,chromium=0' },
    });
    const result = await runMatrix({
      browsers: ['mobile-safari-ios', 'chromium'],
      dispatchOne,
    });
    expect(result.cells.map((c) => ({ browser: c.browser, outcome: c.outcome }))).toEqual([
      { browser: 'mobile-safari-ios', outcome: 'skip' },
      { browser: 'chromium', outcome: 'pass' },
    ]);
    expect(result.ok).toBe(true);
  });
});
