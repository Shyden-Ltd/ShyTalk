/**
 * Phase ordering: app, then web, then cross-over.
 *
 * Operator 2026-08-01: "we should also order the testing by scenarios type.
 * because this is an app, the app testing should come first before the web. once
 * app testing is complete and successfull, move on to web only, if that comes
 * back all green, then you can perform the cross over testing."
 *
 * And on what a failure should do, when asked:
 *   "make this configurable, by default option 1 [run all phases, report gate
 *    status]. but allow us to override and hard stop on first phase failure."
 *
 * So the DEFAULT is to run everything and report which gates would have blocked
 * — an unattended overnight run that stops at phase 1 wastes the whole night,
 * and the operator wakes to one failure instead of the full picture. `stop` is
 * for when you are watching and want the first failure to end it.
 */
const { runPhases, GATES, DEFAULT_GATE } = require('../../scripts/matrix-phases');

/** A phase runner that records what it was asked to do and returns a verdict. */
function recorder(verdicts = {}) {
  const calls = [];
  return {
    calls,
    run: async (phase, cells) => {
      calls.push({ phase, cells });
      const ok = verdicts[phase] !== false;
      return { ok, cells: cells.map((c) => ({ browser: c, outcome: ok ? 'pass' : 'fail' })) };
    },
  };
}

const LOCAL = [
  'app-android',
  'app-ios',
  'chromium',
  'mobile-chrome-android',
  'cross-android',
  'cross-ios',
];

describe('ordering', () => {
  it('runs app, then web, then cross-over', async () => {
    const rec = recorder();
    await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(rec.calls.map((c) => c.phase)).toEqual(['app', 'web', 'cross']);
  });

  it('gives each phase only its own cells', async () => {
    const rec = recorder();
    await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(rec.calls[0].cells).toEqual(['app-android', 'app-ios']);
    expect(rec.calls[1].cells).toEqual(['chromium', 'mobile-chrome-android']);
    expect(rec.calls[2].cells).toEqual(['cross-android', 'cross-ios']);
  });

  it('skips a phase with no cells rather than dispatching an empty matrix', async () => {
    // prod is chromium-only. Dispatching an empty app phase would print a
    // "0 pass / 0 fail" table that reads like the app was tested and passed.
    const rec = recorder();
    const result = await runPhases({ cells: ['chromium'], runPhase: rec.run });
    expect(rec.calls.map((c) => c.phase)).toEqual(['web']);
    expect(result.phases.map((p) => p.phase)).toEqual(['web']);
  });

  it('preserves the caller cell order within a phase', async () => {
    // Cell order drives resource grouping downstream; re-sorting here would
    // change which cells contend for the same device.
    const rec = recorder();
    await runPhases({ cells: ['app-ios', 'app-android'], runPhase: rec.run });
    expect(rec.calls[0].cells).toEqual(['app-ios', 'app-android']);
  });
});

describe('the default gate: run everything, report what would have blocked', () => {
  it('runs every phase even when the app phase fails', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(rec.calls.map((c) => c.phase)).toEqual(['app', 'web', 'cross']);
    expect(result.gate).toBe('report');
  });

  it('reports the failing phase as the one that WOULD have blocked', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(result.blockedBy).toBe('app');
    expect(result.ok).toBe(false);
  });

  it('marks later phases as "ran past a red gate", not as clean passes', async () => {
    // The distinction the operator needs at 7am: web went green, but it went
    // green AFTER the app had already failed, so it is not a release signal.
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    const web = result.phases.find((p) => p.phase === 'web');
    expect(web.ok).toBe(true);
    expect(web.pastRedGate).toBe(true);
  });

  it('does not flag phases that ran before the failure', async () => {
    const rec = recorder({ web: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(result.phases.find((p) => p.phase === 'app').pastRedGate).toBe(false);
    expect(result.phases.find((p) => p.phase === 'cross').pastRedGate).toBe(true);
    expect(result.blockedBy).toBe('web');
  });

  it('blockedBy names the FIRST failure, not the last', async () => {
    const rec = recorder({ app: false, web: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(result.blockedBy).toBe('app');
  });

  it('is green end to end when nothing fails', async () => {
    const rec = recorder();
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(result.ok).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(result.phases.every((p) => p.pastRedGate === false)).toBe(true);
  });
});

describe('the stop gate: end at the first failure', () => {
  it('does not run the phases after a failure', async () => {
    const rec = recorder({ app: false });
    await runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'stop' });
    expect(rec.calls.map((c) => c.phase)).toEqual(['app']);
  });

  it('records the un-run phases as skipped, never as passed', async () => {
    // A phase that did not run must not report `ok: true`. Reporting absence of
    // work as success is the failure mode that makes a green run meaningless.
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'stop' });
    const web = result.phases.find((p) => p.phase === 'web');
    expect(web.outcome).toBe('skipped');
    expect(web.ok).toBe(false);
    expect(web.reason).toMatch(/app/);
  });

  it('still reports every phase, so the summary shape does not change', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'stop' });
    expect(result.phases.map((p) => p.phase)).toEqual(['app', 'web', 'cross']);
  });

  it('runs everything when nothing fails', async () => {
    const rec = recorder();
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'stop' });
    expect(rec.calls.map((c) => c.phase)).toEqual(['app', 'web', 'cross']);
    expect(result.ok).toBe(true);
  });
});

describe('gate selection', () => {
  it('defaults to report', () => {
    expect(DEFAULT_GATE).toBe('report');
  });

  it('offers exactly the two documented gates', () => {
    expect(GATES).toEqual(['report', 'stop']);
  });

  it('reads GAUNTLET_PHASE_GATE from the environment', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({
      cells: LOCAL,
      runPhase: rec.run,
      env: { GAUNTLET_PHASE_GATE: 'stop' },
    });
    expect(result.gate).toBe('stop');
    expect(rec.calls.map((c) => c.phase)).toEqual(['app']);
  });

  it('an explicit gate argument beats the environment', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({
      cells: LOCAL,
      runPhase: rec.run,
      gate: 'report',
      env: { GAUNTLET_PHASE_GATE: 'stop' },
    });
    expect(result.gate).toBe('report');
    expect(rec.calls).toHaveLength(3);
  });

  it('throws on an unrecognised gate rather than silently defaulting', async () => {
    // Silently falling back to `report` when the operator asked for `stop`
    // would run the whole night after a failure they wanted to catch early.
    const rec = recorder();
    await expect(runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'halt' })).rejects.toThrow(
      /halt/,
    );
  });

  it('throws on an unrecognised gate in the environment too', async () => {
    const rec = recorder();
    await expect(
      runPhases({ cells: LOCAL, runPhase: rec.run, env: { GAUNTLET_PHASE_GATE: 'nope' } }),
    ).rejects.toThrow(/nope/);
  });
});

describe('a phase runner that throws', () => {
  it('is recorded as a failure of that phase, not a crash of the run', async () => {
    // A phase whose dispatch explodes must still leave a report — otherwise a
    // multi-hour run ends with a stack trace and no verdict for what did pass.
    const boom = async (phase) => {
      if (phase === 'app') throw new Error('adb went away');
      return { ok: true, cells: [] };
    };
    const result = await runPhases({ cells: LOCAL, runPhase: boom });
    const app = result.phases.find((p) => p.phase === 'app');
    expect(app.ok).toBe(false);
    expect(app.outcome).toBe('error');
    expect(app.reason).toMatch(/adb went away/);
    expect(result.blockedBy).toBe('app');
  });

  it('honours the stop gate when a phase throws', async () => {
    const calls = [];
    const boom = async (phase) => {
      calls.push(phase);
      if (phase === 'app') throw new Error('adb went away');
      return { ok: true, cells: [] };
    };
    await runPhases({ cells: LOCAL, runPhase: boom, gate: 'stop' });
    expect(calls).toEqual(['app']);
  });
});

describe('aggregatePhaseResults — one matrix-shaped result from many phases', () => {
  const { aggregatePhaseResults } = require('../../scripts/matrix-phases');

  const phaseResult = (cells) => ({
    cells,
    totals: {
      pass: cells.filter((c) => c.outcome === 'pass').length,
      fail: cells.filter((c) => c.outcome === 'fail').length,
      skip: cells.filter((c) => c.outcome === 'skip').length,
    },
    ok: cells.every((c) => c.outcome !== 'fail'),
  });

  it('keeps the shape every downstream consumer already understands', () => {
    const agg = aggregatePhaseResults({
      ok: true,
      phases: [
        {
          phase: 'app',
          ok: true,
          result: phaseResult([{ browser: 'app-android', outcome: 'pass' }]),
        },
        { phase: 'web', ok: true, result: phaseResult([{ browser: 'chromium', outcome: 'pass' }]) },
      ],
    });
    expect(Object.keys(agg).sort()).toEqual(['cells', 'ok', 'phases', 'summary', 'totals']);
  });

  it('sums the totals across phases', () => {
    const agg = aggregatePhaseResults({
      ok: false,
      phases: [
        {
          phase: 'app',
          ok: false,
          result: phaseResult([
            { browser: 'app-android', outcome: 'fail' },
            { browser: 'app-ios', outcome: 'skip' },
          ]),
        },
        { phase: 'web', ok: true, result: phaseResult([{ browser: 'chromium', outcome: 'pass' }]) },
      ],
    });
    expect(agg.totals).toEqual({ pass: 1, fail: 1, skip: 1 });
    expect(agg.summary).toBe('1 pass / 1 fail / 1 skip');
    expect(agg.ok).toBe(false);
  });

  it('concatenates cells in phase order', () => {
    const agg = aggregatePhaseResults({
      ok: true,
      phases: [
        {
          phase: 'app',
          ok: true,
          result: phaseResult([{ browser: 'app-android', outcome: 'pass' }]),
        },
        { phase: 'web', ok: true, result: phaseResult([{ browser: 'chromium', outcome: 'pass' }]) },
      ],
    });
    expect(agg.cells.map((c) => c.browser)).toEqual(['app-android', 'chromium']);
  });

  it('tags each cell with the phase it ran in', () => {
    // The report is the only record of WHY a cell ran when it did; without the
    // tag a reader cannot tell a cross-over failure from a web one.
    const agg = aggregatePhaseResults({
      ok: true,
      phases: [
        {
          phase: 'app',
          ok: true,
          result: phaseResult([{ browser: 'app-android', outcome: 'pass' }]),
        },
      ],
    });
    expect(agg.cells[0].phase).toBe('app');
  });

  it('a phase that never ran contributes no fake passes', () => {
    // `result: null` is a phase that was skipped by the stop gate. Counting it
    // as anything but absent would report untested work as tested.
    const agg = aggregatePhaseResults({
      ok: false,
      phases: [
        {
          phase: 'app',
          ok: false,
          result: phaseResult([{ browser: 'app-android', outcome: 'fail' }]),
        },
        { phase: 'web', ok: false, outcome: 'skipped', result: null },
      ],
    });
    expect(agg.totals).toEqual({ pass: 0, fail: 1, skip: 0 });
    expect(agg.cells.map((c) => c.browser)).toEqual(['app-android']);
  });

  it('carries the phase verdicts through for the report and the dashboard', () => {
    const agg = aggregatePhaseResults({
      ok: false,
      blockedBy: 'app',
      phases: [
        {
          phase: 'app',
          ok: false,
          result: phaseResult([{ browser: 'app-android', outcome: 'fail' }]),
        },
      ],
    });
    expect(agg.phases[0]).toMatchObject({ phase: 'app', ok: false });
  });

  it('is ok only when every phase is ok', () => {
    const agg = aggregatePhaseResults({
      ok: true,
      phases: [
        {
          phase: 'app',
          ok: true,
          result: phaseResult([{ browser: 'app-android', outcome: 'pass' }]),
        },
      ],
    });
    expect(agg.ok).toBe(true);
  });
});

describe('aggregate cell results', () => {
  it('collects every cell result across phases, in phase order', async () => {
    const rec = recorder();
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run });
    expect(result.cells.map((c) => c.browser)).toEqual(LOCAL);
  });

  it('omits cells from phases that never ran', async () => {
    const rec = recorder({ app: false });
    const result = await runPhases({ cells: LOCAL, runPhase: rec.run, gate: 'stop' });
    expect(result.cells.map((c) => c.browser)).toEqual(['app-android', 'app-ios']);
  });
});
