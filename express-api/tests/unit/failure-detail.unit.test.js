/**
 * Everything needed to diagnose a failure, without re-running it.
 *
 * Operator 2026-08-01: "There should be another section where failures are
 * shown, it must include all the information the scenarios currently show. but
 * also more details, including all steps, the exact step that failed and any
 * screenshots. it must also show expected vs actual"
 *
 * The grid says WHICH scenario × cell went red. That is where the trail used to
 * end: finding out why meant re-running a feature file by hand on the right
 * device. This assembles the diagnosis from what the run already recorded.
 *
 * ON "EXPECTED VS ACTUAL". The corpus has no structured assertion payload — a
 * step is a sentence and a failure is prose:
 *
 *   step  : within 3000ms Greta's Web Admin UI shows 1 row for "X" with status "PENDING"
 *   error : Greta's Admin UI does not show 1 row(s) for "X" with status "PENDING"
 *
 * The step text IS the expectation, in the corpus's own words, and the error is
 * what happened instead. So the pair is real, not invented — but it is DERIVED,
 * and it says so, because a reader who thinks a parser found those values will
 * trust them differently than one who knows they are the step and the message.
 * Where an error does carry an explicit expected/actual shape, that is used
 * instead and marked as parsed.
 */
const {
  buildFailureDetail,
  splitExpectedActual,
} = require('../../scripts/gauntlet/failure-detail');

const STEPS = [
  { kind: 'Given', text: 'Greta [P-09] is signed in on Web' },
  { kind: 'And', text: 'Adam [P-01] has a pending submission' },
  { kind: 'When', text: 'Greta opens the Admin UI' },
  {
    kind: 'Then',
    text: 'within 3000ms Greta\'s Web Admin UI shows 1 row for "X" with status "PENDING"',
  },
  { kind: 'And', text: 'the audit log records the approval' },
];

const RECORD = {
  browser: 'chromium',
  file: 'j06-admin.feature',
  scenario: "Greta approves Adam's submission",
  status: 'fail',
  failedStep: 'within 3000ms Greta\'s Web Admin UI shows 1 row for "X" with status "PENDING"',
  error: 'Greta\'s Admin UI does not show 1 row(s) for "X" with status "PENDING"',
  at: 1785576740925,
};

describe('the full step list, with the failure located in it', () => {
  it('carries every step, not just the failing one', () => {
    // "including all steps" — the steps BEFORE the failure are the state the
    // scenario had built up, and are usually where the real cause is.
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.steps).toHaveLength(STEPS.length);
    expect(d.steps.map((s) => s.text)).toEqual(STEPS.map((s) => s.text));
  });

  it('marks the exact step that failed', () => {
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.failedStepIndex).toBe(3);
    expect(d.steps[3].state).toBe('fail');
  });

  it('marks earlier steps as passed and later ones as never run', () => {
    // A step after the failure did NOT pass and did not fail — it never
    // executed. Showing it as either would be a claim about untested behaviour.
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.steps.slice(0, 3).map((s) => s.state)).toEqual(['pass', 'pass', 'pass']);
    expect(d.steps[4].state).toBe('notrun');
  });

  it('keeps the Given/When/Then keyword — it is how the step reads', () => {
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.steps[0].kind).toBe('Given');
  });

  it('matches the failed step even when the runner truncated it', () => {
    // The progress record caps failedStep at 200 chars, so an exact-equality
    // match silently finds nothing on long steps — and the panel would then
    // show a failure with no step highlighted at all.
    const longStep = { kind: 'Then', text: 'x'.repeat(260) };
    const d = buildFailureDetail({
      record: { ...RECORD, failedStep: 'x'.repeat(200) },
      steps: [STEPS[0], longStep],
    });
    expect(d.failedStepIndex).toBe(1);
  });

  it('reports honestly when the step cannot be located', () => {
    // Never guess an index. A wrong highlight sends the reader to the wrong
    // step, which is worse than no highlight.
    const d = buildFailureDetail({
      record: { ...RECORD, failedStep: 'a step that is not in this scenario' },
      steps: STEPS,
    });
    expect(d.failedStepIndex).toBeNull();
    expect(d.steps.every((s) => s.state === 'unknown')).toBe(true);
  });

  it('survives a scenario whose steps were not found', () => {
    const d = buildFailureDetail({ record: RECORD, steps: undefined });
    expect(d.steps).toEqual([]);
    expect(d.failedStepIndex).toBeNull();
  });
});

describe('expected vs actual', () => {
  it('derives the pair from the step and the error when nothing structured exists', () => {
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.expected).toBe(RECORD.failedStep);
    expect(d.actual).toBe(RECORD.error);
    expect(d.expectedActualSource).toBe('derived');
  });

  it('labels a derived pair as derived, so it is not mistaken for parsed data', () => {
    // A reader who thinks a parser extracted these will trust them differently
    // from one who knows they are the step text and the error message.
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d.expectedActualSource).not.toBe('parsed');
  });

  it.each([
    ['expected 3 but got 5', '3', '5'],
    ['Expected: PENDING, Actual: APPROVED', 'PENDING', 'APPROVED'],
    ['expected "rose" to equal "tulip"', 'rose', 'tulip'],
    ['expected 200, received 403', '200', '403'],
  ])('parses %s', (msg, expected, actual) => {
    expect(splitExpectedActual(msg)).toEqual({ expected, actual });
  });

  it('returns null when the error carries no explicit pair', () => {
    // Inventing a pair from prose would put fabricated values on the board.
    expect(splitExpectedActual('no signed-in session for "Mia" — Given step missing?')).toBeNull();
  });

  it('prefers a parsed pair over the derived one', () => {
    const d = buildFailureDetail({
      record: { ...RECORD, error: 'expected 200, received 403' },
      steps: STEPS,
    });
    expect(d.expected).toBe('200');
    expect(d.actual).toBe('403');
    expect(d.expectedActualSource).toBe('parsed');
  });

  it('keeps the raw error even when a pair was parsed out of it', () => {
    // The parse is a convenience; the message is the evidence.
    const d = buildFailureDetail({
      record: { ...RECORD, error: 'expected 200, received 403' },
      steps: STEPS,
    });
    expect(d.error).toBe('expected 200, received 403');
  });
});

describe('screenshots', () => {
  it('exposes each screenshot as a URL the dashboard can load', () => {
    const d = buildFailureDetail({
      record: { ...RECORD, screenshots: ['/tmp/run/report/scenario-0/chromium-alice.png'] },
      steps: STEPS,
      reportDir: '/tmp/run/report',
    });
    expect(d.screenshots).toEqual([
      { name: 'chromium-alice.png', url: '/api/artifact?path=scenario-0%2Fchromium-alice.png' },
    ]);
  });

  it('is an empty list, never undefined, when none were captured', () => {
    // Device cells take no screenshots. A missing key makes every consumer
    // write the same `|| []` and one of them eventually forgets.
    expect(buildFailureDetail({ record: RECORD, steps: STEPS }).screenshots).toEqual([]);
  });

  it('refuses a screenshot path outside the report directory', () => {
    // The dashboard serves these by path. Anything that escapes the report dir
    // turns a read-only progress viewer into an arbitrary file reader.
    const d = buildFailureDetail({
      record: { ...RECORD, screenshots: ['/etc/passwd', '/tmp/run/report/ok.png'] },
      steps: STEPS,
      reportDir: '/tmp/run/report',
    });
    expect(d.screenshots.map((s) => s.name)).toEqual(['ok.png']);
  });

  it('refuses a traversal that only looks like it is inside', () => {
    const d = buildFailureDetail({
      record: { ...RECORD, screenshots: ['/tmp/run/report/../../../etc/passwd'] },
      steps: STEPS,
      reportDir: '/tmp/run/report',
    });
    expect(d.screenshots).toEqual([]);
  });
});

describe('the identifying context the grid already shows', () => {
  it('carries cell, file and scenario', () => {
    // "it must include all the information the scenarios currently show" — the
    // panel has to stand alone, not send the reader back to the grid.
    const d = buildFailureDetail({ record: RECORD, steps: STEPS });
    expect(d).toMatchObject({
      cell: 'chromium',
      file: 'j06-admin.feature',
      scenario: "Greta approves Adam's submission",
    });
  });

  it('carries the failure code when the runner classified one', () => {
    const d = buildFailureDetail({
      record: { ...RECORD, code: 'STEP_NOT_IMPLEMENTED' },
      steps: STEPS,
    });
    expect(d.code).toBe('STEP_NOT_IMPLEMENTED');
  });

  it('carries the timestamp so failures can be ordered', () => {
    expect(buildFailureDetail({ record: RECORD, steps: STEPS }).at).toBe(RECORD.at);
  });
});
