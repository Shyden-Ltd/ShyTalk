/**
 * The dashboard finds a run WHEREVER the runner put it.
 *
 * There are two launchers and they write to different places:
 *
 *   gauntlet.sh              /tmp/shytalk-gauntlet/<name>
 *   /run-journeys skill      /tmp/run-journeys-<runId>
 *
 * `latestRunDir()` only ever looked in the first, so a dashboard started with no
 * arguments during a `/run-journeys` matrix showed an empty shell — a live
 * multi-hour run with a viewer that said nothing was happening. The operator has
 * to know to pass `--run-dir`, which is exactly the kind of knowledge a default
 * should carry instead.
 *
 * A run directory is identified by CONTAINING A `log` FILE rather than by its
 * path shape. Both launchers write one, and keying on the name would mean this
 * breaks again the next time something writes a run somewhere new.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('latestRunDir finds runs from either launcher', () => {
  let sandbox;
  let priorGauntletTmp;
  let priorJourneyGlob;

  /**
   * A directory that looks like a run: it has a `log`.
   *
   * Returns the REAL path, because that is what `latestRunDir` reports. On
   * macOS the tmp dir is itself a symlink (`/var` → `/private/var`), so the
   * canonical form is the only stable identity for a run — and canonical is the
   * right contract: one run, one path, however it was reached.
   */
  function makeRun(dir, { ageMs = 0, withLog = true } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    if (withLog) fs.writeFileSync(path.join(dir, 'log'), 'started\n');
    if (ageMs) {
      const when = new Date(Date.now() - ageMs);
      fs.utimesSync(dir, when, when);
    }
    return fs.realpathSync(dir);
  }

  /**
   * Re-require with the env the test just set — the module reads it at load.
   *
   * `jest.resetModules()`, NOT `delete require.cache[id]`. Jest keeps its own
   * module registry, so deleting from require.cache returns the STALE module
   * with the previous test's env baked in. The first version of this helper did
   * exactly that: it silently handed back the same instance every time, which
   * would have made every assertion below pass against a single fixed
   * environment — green, and testing one case nine times.
   */
  function load() {
    jest.resetModules();
    return require('../../scripts/gauntlet/progress-server');
  }

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'run-discovery-'));
    priorGauntletTmp = process.env.GAUNTLET_TMP;
    priorJourneyGlob = process.env.RUN_JOURNEYS_TMP;
    process.env.GAUNTLET_TMP = path.join(sandbox, 'shytalk-gauntlet');
    process.env.RUN_JOURNEYS_TMP = sandbox;
    fs.mkdirSync(process.env.GAUNTLET_TMP, { recursive: true });
  });

  afterEach(() => {
    if (priorGauntletTmp === undefined) delete process.env.GAUNTLET_TMP;
    else process.env.GAUNTLET_TMP = priorGauntletTmp;
    if (priorJourneyGlob === undefined) delete process.env.RUN_JOURNEYS_TMP;
    else process.env.RUN_JOURNEYS_TMP = priorJourneyGlob;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('finds a gauntlet.sh run, as it always did', () => {
    const run = makeRun(path.join(process.env.GAUNTLET_TMP, '20260802-a'));
    expect(load().latestRunDir()).toBe(run);
  });

  it('finds a /run-journeys run — the case that showed an empty dashboard', () => {
    const run = makeRun(path.join(sandbox, 'run-journeys-20260802-112750-local'));
    expect(load().latestRunDir()).toBe(run);
  });

  it('picks the NEWEST across both sources, not whichever source is checked first', () => {
    // The real situation: a gauntlet.sh run from yesterday still on disk while a
    // /run-journeys matrix is live. Preferring one source by position would show
    // the operator a finished run while the current one scrolled past unseen.
    makeRun(path.join(process.env.GAUNTLET_TMP, '20260801-old'), { ageMs: 86_400_000 });
    const fresh = makeRun(path.join(sandbox, 'run-journeys-20260802-live'));
    expect(load().latestRunDir()).toBe(fresh);
  });

  it('prefers a newer gauntlet.sh run over an older /run-journeys one', () => {
    // Symmetric. Neither launcher wins by being special — only by being newer.
    makeRun(path.join(sandbox, 'run-journeys-20260801-old'), { ageMs: 86_400_000 });
    const fresh = makeRun(path.join(process.env.GAUNTLET_TMP, '20260802-live'));
    expect(load().latestRunDir()).toBe(fresh);
  });

  it('ignores a directory with no log — it is not a run', () => {
    // /tmp is full of other people's directories. Returning one would make the
    // dashboard render a confident view of something unrelated.
    makeRun(path.join(sandbox, 'run-journeys-not-a-run'), { withLog: false });
    expect(load().latestRunDir()).toBeNull();
  });

  it('ignores unrelated directories that merely sit in the same tmp', () => {
    fs.mkdirSync(path.join(sandbox, 'some-other-tool'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'some-other-tool', 'log'), 'not ours\n');
    expect(load().latestRunDir()).toBeNull();
  });

  it('returns null when there is nothing, rather than throwing', () => {
    // A dashboard started before any run must show "no run yet", not a stack
    // trace — it is the first thing an operator opens.
    expect(load().latestRunDir()).toBeNull();
  });

  it('survives a missing gauntlet tmp directory entirely', () => {
    fs.rmSync(process.env.GAUNTLET_TMP, { recursive: true, force: true });
    const run = makeRun(path.join(sandbox, 'run-journeys-20260802-only'));
    expect(load().latestRunDir()).toBe(run);
  });

  it('ranks by the LOG mtime, not the directory mtime', () => {
    // A live run appends to `log` but writes per-cell output into `report/`, and
    // a child write does not touch the parent's mtime — so the directory looks
    // frozen at creation for the whole run. Ranking by it put a FINISHED run
    // from the previous day ahead of the matrix running right now, which is the
    // exact opposite of what a progress dashboard is for.
    const stale = makeRun(path.join(process.env.GAUNTLET_TMP, '20260801-finished'));
    const live = makeRun(path.join(sandbox, 'run-journeys-20260802-live'));

    // Make the LIVE run's directory look older than the finished one, and its
    // log newer — the real shape of the situation.
    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(live, old, old);
    fs.utimesSync(path.join(stale, 'log'), old, old);

    expect(load().latestRunDir()).toBe(live);
    expect(load().latestRunDir()).not.toBe(stale);
  });

  it('defaults to /tmp, where run.sh actually writes', () => {
    // `os.tmpdir()` on macOS is the per-user `/var/folders/**/T`, but run.sh
    // hard-codes `/tmp/run-journeys-<id>`. Defaulting to os.tmpdir() looked in
    // the wrong place entirely and silently fell back to whatever gauntlet.sh
    // had left behind — a dashboard confidently showing yesterday's run.
    delete process.env.RUN_JOURNEYS_TMP;
    const src = fs.readFileSync(
      path.join(__dirname, '../../scripts/gauntlet/progress-server.js'),
      'utf8',
    );
    expect(src).toMatch(/RUN_JOURNEYS_TMP\s*\|\|\s*'\/tmp'/);
    expect(src).not.toMatch(/RUN_JOURNEYS_TMP\s*\|\|\s*os\.tmpdir\(\)/);
  });

  it('skips the `latest` symlink so the run is reported by its real path', () => {
    // /run-journeys maintains `run-journeys-latest -> run-journeys-<id>`.
    // Returning the symlink would make two names for one run, and the dashboard
    // would show the run id as "latest".
    const run = makeRun(path.join(sandbox, 'run-journeys-20260802-real'));
    fs.symlinkSync(run, path.join(sandbox, 'run-journeys-latest'));
    expect(load().latestRunDir()).toBe(run);
  });
});
