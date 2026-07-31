/**
 * Per-scenario live progress stream.
 *
 * Operator 2026-07-31: "the scenarios should also include the name, so we can
 * see exactly which scenario was tested. the expandable list should show ALL
 * scenarios, with icons to represent all the different cells and devices,
 * icons should be red for fail, green for pass or gray for pending."
 *
 * Why the runner had to change (it had been deliberately left alone):
 *
 *   1. `matrix-cell-logs.js` writes each cell's log with writeFileSync — ONCE,
 *      at cell end. Nothing per-scenario is observable mid-cell.
 *   2. Screenshot artifacts only exist when a webDriver does
 *      (manual-qa-runner.js:16341), so NATIVE device cells produce no
 *      artifacts at all. The artifact-based progress I built first was
 *      therefore blind to exactly the cells the operator cares most about,
 *      and reported them "stalled" whether or not they were.
 *
 * An append-only JSONL line per scenario is observable live, works for every
 * cell type, and cannot alter cell behaviour.
 */
const { formatProgressLine, parseProgressStream } = require('../../scripts/scenario-progress');

describe('formatProgressLine', () => {
  const line = formatProgressLine({
    browser: 'mobile-safari-ios',
    file: 'j04-report-and-moderate.feature',
    scenario: 'A user reports a message and a moderator actions it',
    status: 'pass',
    durationMs: 4210,
    at: 1700000000000,
  });

  it('emits one self-contained JSON object per line', () => {
    expect(line.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it('carries the scenario NAME, not just an index', () => {
    // The whole point: "see exactly which scenario was tested".
    expect(JSON.parse(line).scenario).toBe('A user reports a message and a moderator actions it');
  });

  it('carries the cell it ran against', () => {
    expect(JSON.parse(line).browser).toBe('mobile-safari-ios');
  });

  it('never emits a raw newline inside the payload, which would split the record', () => {
    const nasty = formatProgressLine({
      browser: 'chromium',
      file: 'x.feature',
      scenario: 'a scenario\nwith a newline',
      status: 'fail',
    });
    expect(nasty.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(nasty).scenario).toBe('a scenario\nwith a newline');
  });
});

describe('parseProgressStream', () => {
  const stream = [
    formatProgressLine({
      browser: 'chromium',
      file: 'a.feature',
      scenario: 'S one',
      status: 'pass',
    }),
    formatProgressLine({
      browser: 'chromium',
      file: 'a.feature',
      scenario: 'S two',
      status: 'fail',
    }),
    formatProgressLine({
      browser: 'mobile-safari-ios',
      file: 'a.feature',
      scenario: 'S one',
      status: 'pass',
    }),
  ].join('');

  it('reads every record back', () => {
    expect(parseProgressStream(stream)).toHaveLength(3);
  });

  it('survives a torn final line — the file is read while being appended to', () => {
    // A reader polling every 3s WILL catch a half-written line eventually.
    // Dropping the whole stream on one torn record would blank the dashboard.
    const torn = stream + '{"browser":"chromium","scen';
    expect(parseProgressStream(torn)).toHaveLength(3);
  });

  it('ignores blank lines and junk rather than throwing', () => {
    expect(parseProgressStream(`\n\nnot json\n${stream}`)).toHaveLength(3);
  });

  it('returns an empty list for an empty or missing stream', () => {
    expect(parseProgressStream('')).toEqual([]);
    expect(parseProgressStream(null)).toEqual([]);
  });
});

describe('buildScenarioMatrix', () => {
  const { buildScenarioMatrix } = require('../../scripts/scenario-progress');

  const corpus = [
    { file: 'a.feature', scenario: 'S one' },
    { file: 'a.feature', scenario: 'S two' },
    { file: 'b.feature', scenario: 'S three' },
  ];
  const cells = ['chromium', 'mobile-safari-ios'];

  it('lists ALL corpus scenarios, not only the ones that have run', () => {
    // "the expandable list should show ALL scenarios".
    const grid = buildScenarioMatrix({ corpus, cells, records: [] });
    expect(grid).toHaveLength(3);
    expect(grid.map((r) => r.scenario)).toEqual(['S one', 'S two', 'S three']);
  });

  it('marks every untouched cell pending, so nothing looks passed by omission', () => {
    const grid = buildScenarioMatrix({ corpus, cells, records: [] });
    expect(grid[0].results).toEqual({ chromium: 'pending', 'mobile-safari-ios': 'pending' });
  });

  it('records pass and fail per cell independently', () => {
    const records = [
      { browser: 'chromium', file: 'a.feature', scenario: 'S one', status: 'pass' },
      { browser: 'mobile-safari-ios', file: 'a.feature', scenario: 'S one', status: 'fail' },
    ];
    const grid = buildScenarioMatrix({ corpus, cells, records });
    expect(grid[0].results).toEqual({ chromium: 'pass', 'mobile-safari-ios': 'fail' });
  });

  it('keeps the LAST result for a scenario, so a retry supersedes its failure', () => {
    const records = [
      { browser: 'chromium', file: 'a.feature', scenario: 'S one', status: 'fail', at: 1 },
      { browser: 'chromium', file: 'a.feature', scenario: 'S one', status: 'pass', at: 2 },
    ];
    expect(buildScenarioMatrix({ corpus, cells, records })[0].results.chromium).toBe('pass');
  });

  it('distinguishes scenarios that share a name across different feature files', () => {
    // 'S one' exists in a.feature; a same-named scenario in b.feature must not
    // inherit its result.
    const corpus2 = [
      { file: 'a.feature', scenario: 'S one' },
      { file: 'b.feature', scenario: 'S one' },
    ];
    const records = [{ browser: 'chromium', file: 'a.feature', scenario: 'S one', status: 'pass' }];
    const grid = buildScenarioMatrix({ corpus: corpus2, cells, records });
    expect(grid[0].results.chromium).toBe('pass');
    expect(grid[1].results.chromium).toBe('pending');
  });

  it('summarises each row so a fully-passed scenario is obvious at a glance', () => {
    const records = cells.map((b) => ({
      browser: b,
      file: 'a.feature',
      scenario: 'S one',
      status: 'pass',
    }));
    const grid = buildScenarioMatrix({ corpus, cells, records });
    expect(grid[0].summary).toEqual({ pass: 2, fail: 0, skipped: 0, pending: 0 });
  });

  it('treats an unknown status as skipped rather than inventing a colour', () => {
    const records = [
      { browser: 'chromium', file: 'a.feature', scenario: 'S one', status: 'weird' },
    ];
    expect(buildScenarioMatrix({ corpus, cells, records })[0].results.chromium).toBe('skipped');
  });
});

/**
 * Cell activity must come from EVERY signal a cell can emit.
 *
 * Operator 2026-07-31 23:1x: "also, it's showing as stalled on the dashboard."
 * It was a false alarm, and the second time the same root cause bit:
 * mobile-chrome-android had written 42 JSONL records (last 439s earlier) while
 * the dashboard reported "0 scenarios, 1136s idle, STALLED" — because stall
 * detection still read the SCREENSHOT signal, which mobile/native cells never
 * write.
 *
 * Counts come from the JSONL (authoritative for all cell types); recency is the
 * most recent of either signal, because screenshots are fine-grained for web
 * cells while the JSONL lands in per-feature-file bursts.
 */
describe('mergeCellActivity', () => {
  const { mergeCellActivity } = require('../../scripts/scenario-progress');

  it('counts scenarios from the JSONL, which every cell writes', () => {
    const merged = mergeCellActivity({
      records: [
        {
          browser: 'mobile-safari-ios',
          file: 'a.feature',
          scenario: 'one',
          status: 'pass',
          at: 10,
        },
        {
          browser: 'mobile-safari-ios',
          file: 'a.feature',
          scenario: 'two',
          status: 'fail',
          at: 20,
        },
      ],
      artifactStats: {},
    });
    expect(merged['mobile-safari-ios'].scenarios).toBe(2);
  });

  it('takes the MOST RECENT activity across both signals', () => {
    // Screenshots tick per scenario; JSONL arrives per feature file. Using
    // either alone under-reports how recently the cell did something.
    const merged = mergeCellActivity({
      records: [
        { browser: 'chromium', file: 'a.feature', scenario: 'one', status: 'pass', at: 100 },
      ],
      artifactStats: { chromium: { scenarios: 9, lastActivityMs: 900 } },
    });
    expect(merged.chromium.lastActivityMs).toBe(900);
  });

  it('still reports a native cell that has no artifacts at all', () => {
    // The exact false alarm: 42 records, zero screenshots, reported as 0/idle.
    const merged = mergeCellActivity({
      records: Array.from({ length: 42 }, (_, i) => ({
        browser: 'mobile-chrome-android',
        file: 'a.feature',
        scenario: `s${i}`,
        status: 'pass',
        at: 5000 + i,
      })),
      artifactStats: {},
    });
    expect(merged['mobile-chrome-android'].scenarios).toBe(42);
    expect(merged['mobile-chrome-android'].lastActivityMs).toBe(5041);
  });

  it('keeps a web cell that has artifacts but no JSONL yet', () => {
    const merged = mergeCellActivity({
      records: [],
      artifactStats: { chromium: { scenarios: 3, lastActivityMs: 700 } },
    });
    expect(merged.chromium.scenarios).toBe(3);
    expect(merged.chromium.lastActivityMs).toBe(700);
  });

  it('prefers the JSONL count when both signals disagree', () => {
    // Screenshots can be written per persona, so the artifact count is not a
    // scenario count. The JSONL is one record per scenario, by construction.
    const merged = mergeCellActivity({
      records: [{ browser: 'chromium', file: 'a.feature', scenario: 'one', status: 'pass', at: 1 }],
      artifactStats: { chromium: { scenarios: 99, lastActivityMs: 1 } },
    });
    expect(merged.chromium.scenarios).toBe(1);
  });
});

/**
 * A failure must carry its REASON, or a finished run cannot be diagnosed.
 *
 * Operator 2026-08-01: "fix the failure reasons not being saved."
 *
 * Two defects made a completed matrix undiagnosable:
 *   1. the JSONL carried status only, so `fail` meant "something went wrong"
 *      and nothing more;
 *   2. every cell wrote its findings report to the SAME path,
 *      /tmp/manual-qa-cycle-<cycle>.md, so twelve concurrent cells raced on
 *      one filename and only the last writer's reasons survived.
 *
 * After a run, chromium reported 106 failures and the record of WHY was gone.
 * The only way to see a reason was to re-run a feature file by hand — which is
 * how three separate wrong conclusions got drawn in one night.
 */
describe('progress records carry the failure reason', () => {
  const { formatProgressLine, parseProgressStream } = require('../../scripts/scenario-progress');

  it('round-trips an error message', () => {
    const line = formatProgressLine({
      browser: 'chromium',
      file: 'j06.feature',
      scenario: 'Receipt replay attack',
      status: 'fail',
      error: 'response status was 400, expected 409',
      failedStep: 'Then the second call returns 409',
    });
    const [rec] = parseProgressStream(line);
    expect(rec.error).toBe('response status was 400, expected 409');
    expect(rec.failedStep).toBe('Then the second call returns 409');
  });

  it('keeps a multi-line error on ONE JSONL line', () => {
    // A stack trace in an error would otherwise split the record and corrupt
    // every reader downstream.
    const line = formatProgressLine({
      browser: 'chromium',
      file: 'a.feature',
      scenario: 's',
      status: 'fail',
      error: 'first line\nsecond line',
    });
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(parseProgressStream(line)[0].error).toBe('first line\nsecond line');
  });

  it('carries a skip REASON too, so a skip is never mysterious', () => {
    const line = formatProgressLine({
      browser: 'chromium',
      file: 'a.feature',
      scenario: 's',
      status: 'skipped',
      reason: 'surface not available on this cell — needs android',
    });
    expect(parseProgressStream(line)[0].reason).toMatch(/needs android/);
  });

  it('a passing record needs no reason and carries none', () => {
    const rec = parseProgressStream(
      formatProgressLine({ browser: 'chromium', file: 'a.feature', scenario: 's', status: 'pass' }),
    )[0];
    expect(rec.error).toBeUndefined();
    expect(rec.reason).toBeUndefined();
  });
});
