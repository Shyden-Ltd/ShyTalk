/**
 * SHY-0263 — tell "the machine ran out of memory" apart from "the code is broken".
 *
 * The symptom is NOT stable, which is the whole difficulty. The same starvation
 * produced `loadFirestoreRules 500 UNKNOWN` on 2026-07-30 and 140 x
 * `Exceeded timeout` with no 500 anywhere on 2026-07-31. Keying on either string
 * alone misclassifies half the occurrences as product regressions, and a
 * misclassified capacity failure costs hours of reading rules that are fine.
 *
 * So this keys on the SHAPE of the failure — a cluster, an infrastructure-level
 * abort, or a run that finished but far too slowly — never on one message.
 */

/** One slow test is a flake. A storm is starvation. */
const TIMEOUT_CLUSTER_THRESHOLD = 5;

/** Past this multiple of the healthy baseline, a green run is not a healthy run. */
const DURATION_INFLATION_FACTOR = 2;

const RULES_INFRA_FAILURE = /"code"\s*:\s*500|loadFirestoreRules|Test suite failed to run/;
const TIMEOUT_LINE = /Exceeded timeout of \d+ ms/g;
const GREEN_SUMMARY = /Test Suites:\s*\d+ passed,\s*\d+ total/;

/**
 * @param {string} log      Combined stdout+stderr of a run.
 * @param {object} [opts]
 * @param {number} [opts.elapsedSeconds] Wall clock of the run.
 * @param {number} [opts.budgetSeconds]  Expected healthy duration.
 * @returns {{kind: 'capacity'|'product'|'none', signal: string, detail?: object}}
 */
function classifyRunFailure(log, opts = {}) {
  const text = String(log || '');
  const { elapsedSeconds, budgetSeconds } = opts;

  // --- Shape 1: a storm of timeouts (2026-07-31) ---------------------------
  // Counted, not merely detected. A single timeout is an ordinary slow test;
  // the capacity signature is that everything starts timing out at once.
  const timeouts = (text.match(TIMEOUT_LINE) || []).length;
  if (timeouts >= TIMEOUT_CLUSTER_THRESHOLD) {
    return {
      kind: 'capacity',
      signal: `timeout cluster (${timeouts} tests exceeded their timeout)`,
      detail: { timeouts },
    };
  }

  // --- Shape 2: the harness cannot even start (2026-07-30) -----------------
  // An opaque 500 from loadFirestoreRules, or a suite that failed to run at
  // all, is the emulator refusing work — not an assertion about the product.
  if (RULES_INFRA_FAILURE.test(text)) {
    return {
      kind: 'capacity',
      signal: 'rules harness failed to initialise (500 / suite failed to run)',
    };
  }

  // --- Shape 3: green, but far too slow (the quiet one) --------------------
  // The 2026-07-31 starved run passed 432/432 with ZERO timeouts in 3382s
  // against a 366s baseline. On pass/fail alone it is indistinguishable from a
  // healthy run, so duration has to be part of the verdict or this shape is
  // invisible — which is exactly how it went unnoticed for two sessions.
  if (Number.isFinite(elapsedSeconds) && Number.isFinite(budgetSeconds) && budgetSeconds > 0) {
    if (elapsedSeconds > budgetSeconds * DURATION_INFLATION_FACTOR) {
      return {
        kind: 'capacity',
        signal: `duration ${Math.round(elapsedSeconds)}s exceeded the ${budgetSeconds}s budget`,
        detail: { elapsedSeconds, budgetSeconds },
      };
    }
  }

  // --- Not capacity: did anything actually fail? ---------------------------
  if (timeouts > 0) {
    return {
      kind: 'product',
      signal: `isolated timeout (${timeouts}), below the cluster threshold`,
    };
  }
  if (/●|✕|Tests:\s*\d+ failed|expect\(received\)/.test(text)) {
    return { kind: 'product', signal: 'assertion failure' };
  }
  if (GREEN_SUMMARY.test(text)) {
    return { kind: 'none', signal: 'run passed within budget' };
  }
  return { kind: 'none', signal: 'no failure signal found' };
}

module.exports = {
  TIMEOUT_CLUSTER_THRESHOLD,
  DURATION_INFLATION_FACTOR,
  classifyRunFailure,
};
