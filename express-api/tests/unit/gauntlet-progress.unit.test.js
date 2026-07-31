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
