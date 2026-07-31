/**
 * Gauntlet progress parsing — the data behind the desktop dashboard.
 *
 * Operator 2026-07-31: "right now i have no visibility of what it's done and
 * still to do." Today the only progress surface is `tail -f gauntlet.log`.
 *
 * Deliberately a PARSER over signals the runner already emits
 * (`[matrix] → dispatching X` / `[matrix] ← X: outcome (Nms)`), not a change to
 * the runner. A multi-hour gauntlet must not gain a new way to fail just so it
 * can be watched.
 *
 * Pure logic over log text — no processes, no filesystem, no network.
 */
const {
  parseMatrixLog,
  buildProgress,
  formatElapsed,
} = require('../../scripts/gauntlet/progress-model');

const PLANNED = ['chromium', 'firefox', 'webkit', 'mobile-chrome-android', 'mobile-safari-ios'];

const log = (...lines) => lines.join('\n');

describe('parseMatrixLog', () => {
  it('reports nothing started from an empty log rather than guessing', () => {
    expect(parseMatrixLog('')).toEqual({ started: [], finished: [] });
  });

  it('picks up a dispatched cell before it has finished', () => {
    const parsed = parseMatrixLog(log('[matrix] → dispatching chromium'));
    expect(parsed.started).toEqual(['chromium']);
    expect(parsed.finished).toEqual([]);
  });

  it('records outcome and duration when a cell completes', () => {
    const parsed = parseMatrixLog(
      log('[matrix] → dispatching chromium', '[matrix] ← chromium: passed (48210ms)'),
    );
    expect(parsed.finished).toEqual([
      { browser: 'chromium', outcome: 'passed', durationMs: 48210 },
    ]);
  });

  it('handles the interleaving a parallel run produces', () => {
    // Cells do not finish in dispatch order. A parser that pairs by position
    // would attribute the wrong outcome to the wrong browser.
    const parsed = parseMatrixLog(
      log(
        '[matrix] → dispatching chromium',
        '[matrix] → dispatching firefox',
        '[matrix] ← firefox: failed (12000ms)',
        '[matrix] ← chromium: passed (48210ms)',
      ),
    );
    expect(parsed.finished).toEqual([
      { browser: 'firefox', outcome: 'failed', durationMs: 12000 },
      { browser: 'chromium', outcome: 'passed', durationMs: 48210 },
    ]);
  });

  it('ignores unrelated log noise', () => {
    const parsed = parseMatrixLog(
      log(
        'watchman warning: Recrawled this watch 135 times',
        '[gauntlet] Docker Desktop up',
        '[matrix] → dispatching webkit',
        '[matrix] per-cell logs written to /tmp/x',
      ),
    );
    expect(parsed.started).toEqual(['webkit']);
    expect(parsed.finished).toEqual([]);
  });

  it('also understands the single-surface tag the runner uses', () => {
    // The runner emits `[<tag>] → <browser>` for non-matrix dispatches.
    const parsed = parseMatrixLog(log('[web] → chromium', '[web] ← chromium: passed (900ms)'));
    expect(parsed.started).toEqual(['chromium']);
    expect(parsed.finished[0].outcome).toBe('passed');
  });
});

describe('buildProgress', () => {
  const at = (over) => buildProgress({ planned: PLANNED, logText: '', ...over });

  it('shows everything as pending before the run starts', () => {
    const p = at({});
    expect(p.counts).toMatchObject({ total: 5, passed: 0, failed: 0, running: 0, pending: 5 });
    expect(p.percent).toBe(0);
  });

  it('separates what is running from what has not started — the actual ask', () => {
    const p = at({
      logText: log('[matrix] → dispatching chromium', '[matrix] → dispatching firefox'),
    });
    expect(p.counts).toMatchObject({ running: 2, pending: 3, passed: 0 });
    expect(p.cells.find((c) => c.browser === 'webkit').state).toBe('pending');
    expect(p.cells.find((c) => c.browser === 'chromium').state).toBe('running');
  });

  it('counts passes and failures separately, never as one "done" number', () => {
    const p = at({
      logText: log(
        '[matrix] → dispatching chromium',
        '[matrix] ← chromium: passed (100ms)',
        '[matrix] → dispatching firefox',
        '[matrix] ← firefox: failed (200ms)',
      ),
    });
    expect(p.counts).toMatchObject({ passed: 1, failed: 1, running: 0, pending: 3 });
  });

  it('lists every planned cell even when the log never mentions it', () => {
    // "Still to do" is the half that a log tail cannot show.
    expect(at({}).cells.map((c) => c.browser)).toEqual(PLANNED);
  });

  it('surfaces a cell the log reports but the plan did not contain', () => {
    // Never silently drop it: an unplanned cell means the plan is wrong, and
    // hiding it would make the dashboard disagree with reality.
    const p = at({ logText: log('[matrix] ← opera: passed (5ms)') });
    const opera = p.cells.find((c) => c.browser === 'opera');
    expect(opera).toMatchObject({ state: 'passed', unplanned: true });
  });

  it('computes percent from finished cells only, so running is not counted as done', () => {
    const p = at({
      logText: log(
        '[matrix] ← chromium: passed (1ms)',
        '[matrix] ← firefox: passed (1ms)',
        '[matrix] → dispatching webkit',
      ),
    });
    expect(p.percent).toBe(40); // 2 of 5, NOT 3 of 5
  });

  it('treats an unrecognised non-passed outcome as failed rather than inventing a category', () => {
    const p = at({ logText: log('[matrix] ← chromium: timedout (1ms)') });
    expect(p.counts.failed).toBe(1);
    expect(p.cells.find((c) => c.browser === 'chromium').outcome).toBe('timedout');
  });

  it('does NOT count a skipped cell as a failure', () => {
    // Found on the first real run, 2026-07-31: three Android browser cells
    // reported `skip` and the dashboard showed them as FAILED. A skip means
    // "did not run" — counting it as a failure inflates the failure number,
    // which is the exact opposite of the honest visibility this exists for.
    const p = at({ logText: log('[matrix] ← mobile-chrome-android: skip (12ms)') });
    expect(p.counts.failed).toBe(0);
    expect(p.counts.skipped).toBe(1);
    expect(p.cells.find((c) => c.browser === 'mobile-chrome-android').state).toBe('skipped');
  });

  it('counts a skipped cell as resolved, not as still-to-do', () => {
    // It will never run, so leaving it "pending" would mean the dashboard
    // never reaches 100% and the operator waits for something that is over.
    const skips = PLANNED.map((b) => `[matrix] ← ${b}: skip (1ms)`).join('\n');
    const p = at({ logText: skips });
    expect(p.counts.pending).toBe(0);
    expect(p.percent).toBe(100);
  });

  it('reports overall state as running while cells remain', () => {
    expect(at({ logText: log('[matrix] ← chromium: passed (1ms)') }).state).toBe('running');
  });

  it('reports done only when the sentinel says so, not when counts happen to line up', () => {
    // A run can look complete mid-flight if the remaining cells have not
    // dispatched yet. The sentinel file is the authority.
    const allPassed = PLANNED.map((b) => `[matrix] ← ${b}: passed (1ms)`).join('\n');
    expect(at({ logText: allPassed }).state).toBe('running');
    expect(at({ logText: allPassed, sentinel: 'DONE' }).state).toBe('done');
  });

  it('reports failure when the run failed, even if every parsed cell passed', () => {
    const allPassed = PLANNED.map((b) => `[matrix] ← ${b}: passed (1ms)`).join('\n');
    expect(at({ logText: allPassed, sentinel: 'FAIL' }).state).toBe('failed');
  });

  it('marks the run dead when the process is gone without a sentinel', () => {
    // The honest state: not done, not running. Silence here is what let a
    // dead run look alive.
    expect(at({ pidAlive: false, started: true }).state).toBe('died');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0s'],
    [45_000, '45s'],
    [90_000, '1m 30s'],
    [3_725_000, '1h 2m 5s'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('never renders a negative elapsed from clock skew', () => {
    expect(formatElapsed(-5000)).toBe('0s');
  });
});

/**
 * Scenario-level progress + staleness.
 *
 * Operator 2026-07-31 18:00, watching the first real run: "i can see both
 * devices are connected but no evidence of what they're actually doing... the
 * android device seems to be thrashing on the persona picker, closing the app,
 * and repeating. and the iphone isn't doing anything at all."
 *
 * They were right and the dashboard was wrong: all three "running" cells sat at
 * 0.0% CPU for 35 minutes, and chromium's last artifact was 10 minutes old. A
 * dispatched-but-idle cell is STALLED, and calling it "running" is the exact
 * false reassurance this dashboard exists to remove.
 */
describe('attributeScenarios', () => {
  const { attributeScenarios } = require('../../scripts/gauntlet/progress-model');

  it('counts scenarios per browser from the artifact filenames', () => {
    // The runner writes scenario-N/screenshot-<browser>-<persona>.png as each
    // scenario runs, so the browser is recoverable without touching the runner.
    const artifacts = [
      { dir: 'scenario-0', file: 'screenshot-chromium-default.png', mtimeMs: 10 },
      { dir: 'scenario-0', file: 'screenshot-chromium-Lena.png', mtimeMs: 11 },
      { dir: 'scenario-1', file: 'screenshot-chromium-default.png', mtimeMs: 20 },
      { dir: 'scenario-2', file: 'screenshot-mobile-safari-ios-default.png', mtimeMs: 30 },
    ];
    const byBrowser = attributeScenarios(artifacts);
    // scenario-0 has two shots but is ONE scenario — count distinct dirs.
    expect(byBrowser.chromium.scenarios).toBe(2);
    expect(byBrowser['mobile-safari-ios'].scenarios).toBe(1);
  });

  it('records the most recent activity per browser, for staleness', () => {
    const artifacts = [
      { dir: 'scenario-0', file: 'screenshot-chromium-a.png', mtimeMs: 100 },
      { dir: 'scenario-1', file: 'screenshot-chromium-b.png', mtimeMs: 900 },
    ];
    expect(attributeScenarios(artifacts).chromium.lastActivityMs).toBe(900);
  });

  it('handles hyphenated browser slugs without truncating them', () => {
    // `mobile-firefox-android` must not be read as `mobile`.
    const artifacts = [
      { dir: 'scenario-0', file: 'screenshot-mobile-firefox-android-Lena.png', mtimeMs: 1 },
    ];
    expect(Object.keys(attributeScenarios(artifacts))).toEqual(['mobile-firefox-android']);
  });

  it('ignores files that are not scenario screenshots', () => {
    const artifacts = [
      { dir: 'scenario-0', file: 'trace.zip', mtimeMs: 1 },
      { dir: 'scenario-0', file: 'screenshot-chromium-a.png', mtimeMs: 2 },
    ];
    expect(attributeScenarios(artifacts).chromium.scenarios).toBe(1);
  });
});

describe('buildProgress — stalled cells', () => {
  const PLAN = ['chromium', 'mobile-safari-ios'];
  const dispatched = PLAN.map((b) => `[matrix] → dispatching ${b}`).join('\n');

  const at = (over) =>
    buildProgress({
      planned: PLAN,
      logText: dispatched,
      now: 1_000_000,
      stalledAfterMs: 300_000,
      ...over,
    });

  it('marks a dispatched cell with NO activity at all as stalled', () => {
    // mobile-safari-ios, 2026-07-31: dispatched, no Appium session ever created,
    // no artifact ever written, iPhone untouched for 35 minutes.
    const p = at({ scenarioStats: {}, dispatchedAtMs: 1_000_000 - 600_000 });
    expect(p.cells.find((c) => c.browser === 'mobile-safari-ios').state).toBe('stalled');
  });

  it('marks a cell whose last artifact is older than the threshold as stalled', () => {
    // chromium, same run: 18 scenarios then nothing for 10 minutes.
    const p = at({
      scenarioStats: { chromium: { scenarios: 18, lastActivityMs: 1_000_000 - 600_000 } },
      dispatchedAtMs: 1_000_000 - 2_000_000,
    });
    const cell = p.cells.find((c) => c.browser === 'chromium');
    expect(cell.state).toBe('stalled');
    expect(cell.scenarios).toBe(18);
  });

  it('leaves a genuinely active cell running', () => {
    const p = at({
      scenarioStats: { chromium: { scenarios: 4, lastActivityMs: 1_000_000 - 5_000 } },
      dispatchedAtMs: 1_000_000 - 60_000,
    });
    expect(p.cells.find((c) => c.browser === 'chromium').state).toBe('running');
  });

  it('gives a freshly dispatched cell grace before calling it stalled', () => {
    // Driver init legitimately takes time; flagging instantly would cry wolf.
    const p = at({ scenarioStats: {}, dispatchedAtMs: 1_000_000 - 10_000 });
    expect(p.cells.find((c) => c.browser === 'chromium').state).toBe('running');
  });

  it('counts stalled cells separately so they cannot hide inside "running"', () => {
    const p = at({ scenarioStats: {}, dispatchedAtMs: 1_000_000 - 600_000 });
    expect(p.counts.stalled).toBe(2);
    expect(p.counts.running).toBe(0);
  });

  it('never marks a FINISHED cell stalled, however old its artifacts are', () => {
    const finished = `${dispatched}\n[matrix] ← chromium: passed (100ms)`;
    const p = at({
      logText: finished,
      scenarioStats: { chromium: { scenarios: 20, lastActivityMs: 0 } },
      dispatchedAtMs: 1_000_000 - 9_000_000,
    });
    expect(p.cells.find((c) => c.browser === 'chromium').state).toBe('passed');
  });
});

/**
 * Self-repair.
 *
 * Operator 2026-07-31 22:2x, seeing the dashboard's own failure text:
 * "'progress server unreachable — the gauntlet itself is unaffected'. During
 * this situation, you must keep retrying, and the service must try to repair
 * itself."
 *
 * Correct. "The gauntlet is unaffected" is true and useless — it reassures
 * while showing nothing. A viewer that gives up the moment its server blips is
 * not a viewer.
 */
describe('retryDelayMs', () => {
  const { retryDelayMs } = require('../../scripts/gauntlet/progress-model');

  it('retries almost immediately on the first failure', () => {
    expect(retryDelayMs(1)).toBeLessThanOrEqual(1000);
  });

  it('backs off as failures accumulate, so a dead server is not hammered', () => {
    expect(retryDelayMs(5)).toBeGreaterThan(retryDelayMs(1));
  });

  it('CAPS the backoff — it must never stop trying or wait minutes', () => {
    // Unbounded exponential backoff is indistinguishable from giving up: after
    // a few minutes down, the reconnect would land long after the operator
    // needed it.
    for (const n of [10, 50, 1000, 100000]) {
      expect(retryDelayMs(n)).toBeLessThanOrEqual(10000);
    }
  });

  it('never returns zero or a negative delay', () => {
    for (const n of [0, 1, 7, 99]) expect(retryDelayMs(n)).toBeGreaterThan(0);
  });
});
