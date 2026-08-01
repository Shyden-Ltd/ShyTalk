/**
 * Run the matrix in phases: the app, then the web, then the seam between them.
 *
 * Operator 2026-08-01: "we should also order the testing by scenarios type.
 * because this is an app, the app testing should come first before the web. once
 * app testing is complete and successfull, move on to web only, if that comes
 * back all green, then you can perform the cross over testing."
 *
 * The ordering is a statement about what this product IS. ShyTalk is an app with
 * a website attached, so a red app phase makes a green web phase uninteresting —
 * and the cross-over phase, which needs BOTH surfaces working, is meaningless
 * until each half is known good. Running them in that order means the first
 * thing you read in the morning is the thing that matters most.
 *
 * THE GATE IS CONFIGURABLE, and the default is deliberate. Asked what a failing
 * phase should do, the operator chose: "make this configurable, by default
 * option 1 [run all phases, report gate status]. but allow us to override and
 * hard stop on first phase failure."
 *
 *   report  (default) — run every phase; report which gate WOULD have blocked.
 *                       An unattended overnight run that halts at phase one
 *                       wastes the night and yields a single failure instead of
 *                       the whole picture. Later phases are marked `pastRedGate`
 *                       so a green web phase after a red app phase is never
 *                       mistaken for a release signal.
 *   stop              — end at the first failing phase. For when someone is
 *                       watching and wants the first failure to end it.
 *
 * A phase that did not run reports `ok: false` and `outcome: 'skipped'`, never a
 * pass. Absence of work reported as success is how a green summary comes to mean
 * nothing.
 */
const { PHASES, phaseOf } = require('./matrix-cells');

/** The two gates, in the order they are documented. */
const GATES = ['report', 'stop'];

/**
 * Run everything and say what would have blocked.
 *
 * Chosen over `stop` as the default because the runs that matter are unattended.
 */
const DEFAULT_GATE = 'report';

function resolveGate(gate, env) {
  const chosen = gate || env.GAUNTLET_PHASE_GATE || DEFAULT_GATE;
  if (!GATES.includes(chosen)) {
    // Never silently fall back. An operator who asked for `stop` and got
    // `report` because of a typo loses the early exit they wanted, and finds out
    // hours later.
    throw new Error(
      `phase gate "${chosen}" is not recognised. Valid gates: ${GATES.join(', ')}. ` +
        `"report" runs every phase and names the gate that would have blocked; ` +
        `"stop" ends at the first failing phase.`,
    );
  }
  return chosen;
}

/**
 * @param {object} o
 * @param {string[]} o.cells       cell slugs to run, in dispatch order
 * @param {Function} o.runPhase    async (phase, cells) => { ok, cells }
 * @param {string} [o.gate]        'report' | 'stop'; beats the environment
 * @param {object} [o.env]         defaults to process.env
 * @param {Function} [o.onPhase]   optional progress callback per phase
 * @returns {Promise<{ok, gate, blockedBy, phases, cells}>}
 */
async function runPhases({ cells, runPhase, gate, env = process.env, onPhase }) {
  const resolved = resolveGate(gate, env);
  const phases = [];
  const allCells = [];
  let blockedBy = null;

  for (const phase of PHASES) {
    const phaseCells = cells.filter((c) => phaseOf(c) === phase);
    // An empty phase is omitted rather than dispatched. A "0 pass / 0 fail"
    // table reads like the phase ran and passed.
    if (phaseCells.length === 0) continue;

    if (blockedBy && resolved === 'stop') {
      phases.push({
        phase,
        cells: phaseCells,
        ok: false,
        outcome: 'skipped',
        pastRedGate: true,
        reason: `not run — the ${blockedBy} phase failed and the gate is "stop"`,
      });
      continue;
    }

    const pastRedGate = Boolean(blockedBy);
    if (onPhase) onPhase({ phase, cells: phaseCells, stage: 'start', pastRedGate });

    let entry;
    try {
      const result = await runPhase(phase, phaseCells);
      entry = {
        phase,
        cells: phaseCells,
        ok: Boolean(result && result.ok),
        outcome: result && result.ok ? 'pass' : 'fail',
        pastRedGate,
        result: result || null,
      };
      if (result && Array.isArray(result.cells)) allCells.push(...result.cells);
    } catch (e) {
      // A phase whose dispatch explodes must still leave a report, or a
      // multi-hour run ends in a stack trace with no verdict for what passed.
      entry = {
        phase,
        cells: phaseCells,
        ok: false,
        outcome: 'error',
        pastRedGate,
        reason: e.message,
        result: null,
      };
    }

    phases.push(entry);
    if (onPhase) onPhase({ ...entry, stage: 'end' });
    // FIRST failure, kept: it is the one that invalidates everything after it.
    if (!entry.ok && !blockedBy) blockedBy = phase;
  }

  return {
    ok: blockedBy === null,
    gate: resolved,
    blockedBy,
    phases,
    cells: allCells,
  };
}

/**
 * One-line operator summary, e.g.
 *   `app ✅ · web ✅ · cross ❌ — gate: cross would block (ran all phases)`
 */
function formatPhaseSummary(result) {
  const mark = (p) => {
    if (p.outcome === 'skipped') return '⏭';
    if (p.outcome === 'error') return '💥';
    return p.ok ? (p.pastRedGate ? '✅*' : '✅') : '❌';
  };
  const line = result.phases.map((p) => `${p.phase} ${mark(p)}`).join(' · ');
  if (!result.blockedBy) return `${line} — all phases green`;
  const tail =
    result.gate === 'stop'
      ? `stopped at ${result.blockedBy}`
      : `${result.blockedBy} would block (ran all phases; ✅* = ran past a red gate)`;
  return `${line} — gate: ${tail}`;
}

/**
 * Collapse a phased run into ONE matrix-shaped result.
 *
 * Everything downstream — the text table, the JSON report, the exit code — was
 * written against `runMatrix`'s `{cells, totals, summary, ok}`. Keeping that
 * shape means phases are additive rather than a rewrite of every consumer; the
 * extra `phases` key carries the gate verdicts for the report and the dashboard.
 *
 * A phase with `result: null` never ran. It contributes NOTHING — no cells, no
 * totals. Counting an un-run phase as passes would report untested work as
 * tested, which is the whole failure mode the stop gate exists to make visible.
 */
function aggregatePhaseResults(phased) {
  const cells = [];
  const totals = { pass: 0, fail: 0, skip: 0 };
  for (const p of phased.phases || []) {
    if (!p.result) continue;
    for (const cell of p.result.cells || []) cells.push({ ...cell, phase: p.phase });
    for (const key of Object.keys(totals)) totals[key] += (p.result.totals || {})[key] || 0;
  }
  return {
    cells,
    totals,
    summary: `${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip`,
    ok: Boolean(phased.ok),
    phases: (phased.phases || []).map(({ phase, ok, outcome, pastRedGate, reason, cells: c }) => ({
      phase,
      ok,
      outcome,
      pastRedGate,
      reason,
      cells: c,
    })),
  };
}

module.exports = {
  runPhases,
  aggregatePhaseResults,
  formatPhaseSummary,
  GATES,
  DEFAULT_GATE,
};
