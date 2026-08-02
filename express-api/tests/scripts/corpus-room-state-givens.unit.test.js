/**
 * A matcher that ENSURES state must only ever answer a Given.
 *
 * Step handlers are called as `handler(m, ctx)` — the step KEYWORD is parsed
 * (`{ kind: 'Given'|'When'|'Then'|… }`) but never passed down. So one matcher
 * serves every keyword that phrases the step the same way, and a matcher that
 * SETS UP state cannot refuse to answer a `Then`.
 *
 * That is a false-pass factory: `Then Selma's room "X" is OPEN` would be
 * answered by creating the room and reporting success — the strongest possible
 * form of a test that proves nothing, because it manufactures exactly the
 * condition it was asked to verify.
 *
 * The room-state Givens were made to ensure (2026-08-02) so a subscenario can
 * run in isolation, which is what the family comment in manual-qa-runner.js
 * says they are for. This test is the other half of that decision: it holds the
 * precondition that made ensuring safe.
 *
 * Not hypothetical. `<Name>'s room "<X>" is OPEN` was reading its quoted
 * argument as a document ID while the corpus passes a TITLE, so it reported
 * `rooms/Selma's Saturday Sing-along does not exist` about a room that existed
 * under its generated id. Fixing the lookup meant routing through
 * `ensureRoomForHost`, which is what raised the question this pins.
 */
const fs = require('fs');
const path = require('path');

const CORPUS = path.resolve(__dirname, '../../../journey-tests');

/**
 * Step phrasings whose matcher CREATES or MUTATES state rather than reading it.
 * Adding one here without checking the corpus is how a Then starts passing for
 * free, so each must be paired with the matcher that ensures.
 */
const ENSURING_STEP_PATTERNS = [
  {
    name: '<Name>\'s room "<X>" is OPEN|CLOSED|FROZEN',
    rx: /[A-Z][a-z]+'s room "[^"]+" is (?:OPEN|CLOSED|FROZEN)$/,
  },
  { name: '<Name>\'s public room "<X>" is OPEN', rx: /[A-Z][a-z]+'s public room "[^"]+" is OPEN$/ },
];

/** Every step line in the corpus, with its keyword and origin. */
function corpusSteps() {
  const out = [];
  for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith('.feature'))) {
    const lines = fs.readFileSync(path.join(CORPUS, file), 'utf8').split('\n');
    let lastConcrete = null;
    lines.forEach((line, i) => {
      // The line is trimmed FIRST and the separator is a single `\s`, so no two
      // quantifiers can compete for the same spaces. A lazy `(.+?)\s*$`, or a
      // leading `[ \t]*` in front of `[ \t]+`, both leave the engine trying
      // every split point — sonarjs flags either, and the runner's own parser
      // carries that shape with a disable comment rather than a fix.
      const m = /^(Given|When|Then|And|But)\s(.+)$/.exec(line.trim());
      if (!m) return;
      const text = m[2].trim();
      // `And`/`But` inherit the keyword of the step above them, which is the
      // whole reason a naive "does it start with Given" check is not enough:
      // `Then …` followed by `And <ensuring step>` is a Then in disguise.
      const kind = m[1] === 'And' || m[1] === 'But' ? lastConcrete : m[1];
      if (m[1] !== 'And' && m[1] !== 'But') lastConcrete = m[1];
      out.push({ file, line: i + 1, kind, text });
    });
  }
  return out;
}

describe('the scan is real', () => {
  it('reads a substantial corpus', () => {
    // Calibration: an empty read would make every check below vacuous.
    expect(corpusSteps().length).toBeGreaterThan(500);
  });

  it('resolves And/But to the keyword they inherit', () => {
    const steps = corpusSteps();
    expect(steps.every((s) => ['Given', 'When', 'Then'].includes(s.kind))).toBe(true);
  });
});

describe('state-ensuring steps appear only as Givens', () => {
  it.each(ENSURING_STEP_PATTERNS)('$name is never a When or a Then', ({ rx }) => {
    const offenders = corpusSteps()
      .filter((s) => rx.test(s.text))
      .filter((s) => s.kind !== 'Given')
      .map((s) => `${s.file}:${s.line} [${s.kind}] ${s.text}`);
    // Named with the fix: phrase the assertion differently, or split the
    // matcher so the verifying form reads rather than writes.
    expect({ ensuringStepUsedAsAssertion: offenders }).toEqual({
      ensuringStepUsedAsAssertion: [],
    });
  });

  it('the patterns still match something — a stale regex would guard nothing', () => {
    // If a corpus rewording made these regexes match zero steps, every check
    // above would pass while watching an empty set.
    for (const { name, rx } of ENSURING_STEP_PATTERNS) {
      const hits = corpusSteps().filter((s) => rx.test(s.text));
      expect({ pattern: name, matched: hits.length > 0 }).toEqual({ pattern: name, matched: true });
    }
  });
});
