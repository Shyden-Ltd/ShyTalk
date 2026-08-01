/**
 * Everything needed to diagnose a failure, without re-running it.
 *
 * Operator 2026-08-01: "There should be another section where failures are
 * shown, it must include all the information the scenarios currently show. but
 * also more details, including all steps, the exact step that failed and any
 * screenshots. it must also show expected vs actual"
 *
 * The grid says WHICH scenario × cell went red. That is where the trail used to
 * end — finding out why meant re-running a feature file by hand, on the right
 * device, hours later. Everything here was already recorded by the run; it was
 * simply never assembled into one view.
 *
 * ON "EXPECTED VS ACTUAL", HONESTLY. The corpus has no structured assertion
 * payload. A step is a sentence and a failure is prose:
 *
 *   step  : within 3000ms Greta's Web Admin UI shows 1 row for "X" with status "PENDING"
 *   error : Greta's Admin UI does not show 1 row(s) for "X" with status "PENDING"
 *
 * The step text IS the expectation, in the corpus's own words, and the error is
 * what happened instead — so the pair is real rather than invented. But it is
 * DERIVED, and it is labelled as such, because a reader who believes a parser
 * extracted those values will trust them differently from one who knows they
 * are the step and the message. Where an error does carry an explicit
 * expected/actual shape, that is parsed out and marked `parsed`.
 */
const path = require('path');

/**
 * "expected" / "Expected:" — the left edge of an explicit pair.
 *
 * Every pattern here matches a FIXED phrase, never a `(.+?)` span. The first
 * version used `expected\s+(.+?)\s+(?:but\s+)?(?:got|received)\s+(.+?)$`, which
 * eslint's `sonarjs/slow-regex` flags for super-linear backtracking — two lazy
 * spans separated by optional groups, on attacker-adjacent text (an error
 * message can contain anything a step threw). Finding the delimiter and slicing
 * around it is provably linear and easier to read besides.
 */
const EXPECTED_PREFIX = /\bexpected:?\s+/i;

/**
 * The phrases that separate the expectation from what happened, most specific
 * first: `but got` must win over `got`, or the split lands mid-phrase and
 * reports "3 but" as the expected value.
 *
 * Deliberately NOT a general prose parser. Inventing a pair out of an ordinary
 * sentence would put fabricated values on the board, which is worse than
 * showing none — hence a short list of literal delimiters.
 */
const ACTUAL_DELIMITERS = [
  'actual:',
  'but got ',
  'but was ',
  ' to equal ',
  ' to be ',
  'got ',
  'received ',
  'was ',
];

const LETTER = /[a-z]/i;
const TRIM_LEFT = new Set([' ', '\t', '\n', '"', "'"]);
const TRIM_RIGHT = new Set([' ', '\t', '\n', '"', "'", '.', ',', ';']);

/**
 * Trim surrounding quotes, whitespace and trailing punctuation.
 *
 * A character loop rather than `replace(/["'.]+$/, '')`: an anchored quantifier
 * over a character class is exactly what `sonarjs/slow-regex` refuses, and this
 * runs on error text that can contain anything a step threw. Linear by
 * construction and no rule to argue with.
 */
function unwrap(s) {
  let start = 0;
  let end = s.length;
  while (start < end && TRIM_LEFT.has(s[start])) start++;
  while (end > start && TRIM_RIGHT.has(s[end - 1])) end--;
  return s.slice(start, end);
}

/**
 * Index of `needle` in `haystackLower`, but only where it starts a word.
 *
 * Without the boundary check, `got ` matches inside `forgot ` and the split
 * lands mid-word — reporting a fragment as the expected value.
 */
function findDelimiter(haystackLower, needle) {
  let from = 0;
  for (;;) {
    const i = haystackLower.indexOf(needle, from);
    if (i === -1) return -1;
    const before = i === 0 ? '' : haystackLower[i - 1];
    if (!LETTER.test(before)) return i;
    from = i + 1;
  }
}

/**
 * Pull an explicit expected/actual pair out of an error message.
 *
 * Plain string search, no regex: every candidate pattern here tripped
 * `sonarjs/slow-regex`, and the rule is right — this parses arbitrary error
 * text. Scanning for literal delimiters is provably linear and, as it turns
 * out, easier to read than the alternation it replaced.
 *
 * @param {string} message
 * @returns {{expected: string, actual: string}|null} null when the message
 *   carries no explicit pair — the caller then derives one and says so.
 */
function splitExpectedActual(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const head = EXPECTED_PREFIX.exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const lower = rest.toLowerCase();
  for (const delim of ACTUAL_DELIMITERS) {
    const i = findDelimiter(lower, delim);
    if (i === -1) continue;
    const expected = unwrap(rest.slice(0, i));
    const actual = unwrap(rest.slice(i + delim.length));
    if (expected && actual) return { expected, actual };
  }
  return null;
}

/**
 * Locate the failed step in the scenario's step list.
 *
 * The progress record caps `failedStep` at 200 characters, so exact equality
 * silently finds nothing on a long step — and the panel would then render a
 * failure with no step highlighted. Prefix matching covers the truncation
 * without loosening into "any step that looks similar".
 *
 * @returns {number} index, or -1 when it genuinely cannot be located
 */
function locateFailedStep(steps, failedStep) {
  const needle = String(failedStep || '').trim();
  if (!needle || !Array.isArray(steps)) return -1;
  const exact = steps.findIndex((s) => String(s.text).trim() === needle);
  if (exact !== -1) return exact;
  // Truncated: the record holds a prefix of the real step.
  return steps.findIndex((s) => String(s.text).trim().startsWith(needle));
}

/**
 * Screenshot paths that are genuinely inside the report directory.
 *
 * The dashboard serves these by path, so anything escaping the report dir would
 * turn a read-only progress viewer into an arbitrary file reader. Resolved
 * first, then checked — `startsWith` on the raw string is defeated by `..`.
 */
function safeScreenshots(paths, reportDir) {
  if (!Array.isArray(paths) || !reportDir) return [];
  const root = path.resolve(reportDir);
  const out = [];
  for (const p of paths) {
    const abs = path.resolve(String(p));
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      out.push({ name: path.basename(abs), url: `/api/artifact?path=${encodeURIComponent(rel)}` });
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {object} o.record   one `fail` record from the progress stream
 * @param {Array}  [o.steps]  the scenario's steps, from the corpus
 * @param {string} [o.reportDir] run report dir, for screenshot scoping
 */
function buildFailureDetail({ record, steps, reportDir }) {
  const failedStepIndex = locateFailedStep(steps, record.failedStep);
  const located = failedStepIndex !== -1;

  // A step AFTER the failure did not pass and did not fail — it never ran.
  // Calling it either would be a claim about behaviour nothing exercised. And
  // when the step could not be located, every state is unknown rather than
  // guessed: a wrong highlight sends the reader to the wrong step.
  const annotated = (steps || []).map((s, i) => ({
    kind: s.kind,
    text: s.text,
    state: !located
      ? 'unknown'
      : i < failedStepIndex
        ? 'pass'
        : i === failedStepIndex
          ? 'fail'
          : 'notrun',
  }));

  const parsed = splitExpectedActual(record.error);

  return {
    cell: record.browser,
    file: record.file,
    scenario: record.scenario,
    at: record.at,
    error: record.error || null,
    code: record.code || null,
    reason: record.reason || null,
    failedStep: record.failedStep || null,
    failedStepIndex: located ? failedStepIndex : null,
    steps: annotated,
    expected: parsed ? parsed.expected : record.failedStep || null,
    actual: parsed ? parsed.actual : record.error || null,
    // 'parsed'  — pulled out of an explicit expected/actual message.
    // 'derived' — the step text is the expectation, the error is what happened.
    expectedActualSource: parsed ? 'parsed' : 'derived',
    screenshots: safeScreenshots(record.screenshots, reportDir),
  };
}

module.exports = { buildFailureDetail, splitExpectedActual, locateFailedStep, safeScreenshots };
