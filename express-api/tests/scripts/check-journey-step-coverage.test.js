/**
 * check-journey-step-coverage.test.js
 *
 * SHY-0259. The journey corpus was written ahead of its drivers, so a large
 * share of it could never pass regardless of product state: 68 distinct
 * Gherkin steps had no matcher at all and failed as STEP_NOT_IMPLEMENTED.
 * That made a red cell ambiguous — "the product is broken" and "the harness
 * cannot perform this step" looked identical in the report.
 *
 * This gate makes the gap countable and one-directional. It is itself a gate,
 * so it gets the same treatment `check-test-defects.js` got: real module, real
 * corpus, real matcher table — no doubles. A gate nothing verifies is the
 * blind spot it exists to remove.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const checker = require(path.resolve(__dirname, '../../../scripts/check-journey-step-coverage.js'));
const { scanCorpus, isStepCovered, PROBE_VALUES } = checker;

const runner = require(path.resolve(__dirname, '../../scripts/manual-qa-runner.js'));

/** Write a throwaway .feature corpus and scan it. */
function scanFixture(features) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-coverage-'));
  try {
    for (const [name, body] of Object.entries(features)) {
      fs.writeFileSync(path.join(dir, name), body);
    }
    return scanCorpus({ dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolving a step against the real matcher table', () => {
  test('a step the runner can execute is covered', () => {
    // Taken from the corpus, not invented: this exact Background step runs today.
    expect(isStepCovered('the local stack is healthy')).toBe(true);
  });

  test('a step no matcher accepts is not covered', () => {
    expect(isStepCovered('Adam rides a unicycle across the admin dashboard')).toBe(false);
  });

  test('the trailing (human commentary) annotation is stripped, exactly as the runner strips it', () => {
    // The runner drops a trailing parenthetical before matching. If the gate
    // did not, every annotated step in the corpus would report as a gap —
    // a false positive that blocks CI on nothing.
    const bare = 'the local stack is healthy';
    expect(isStepCovered(bare)).toBe(true);
    expect(isStepCovered(`${bare} (first run of the day)`)).toBe(true);
  });

  test('a {placeholder} is swept across a class of probe values, not one guess', () => {
    // Placeholders resolve from ctx.scenarioVars at runtime; statically we do
    // not know the value. Encoding one caller's value would make the gate
    // depend on a number it invented, so it sweeps the class instead.
    expect(PROBE_VALUES.length).toBeGreaterThan(1);
    expect(PROBE_VALUES).toContain('1');
  });
});

describe('scanning a corpus', () => {
  test('an unmatched step is reported with its kind, text, file and occurrence count', () => {
    const report = scanFixture({
      'jZZ-fixture.feature': [
        'Feature: fixture',
        '  Scenario: one',
        '    Given Adam rides a unicycle',
        '  Scenario: two',
        '    Given Adam rides a unicycle',
      ].join('\n'),
    });
    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched[0]).toMatchObject({
      kind: 'Given',
      text: 'Adam rides a unicycle',
      count: 2,
      files: ['jZZ-fixture.feature'],
    });
  });

  test('Background steps are scanned, not only Scenario steps', () => {
    // A gap in a Background is the worst kind: it fails every scenario in the
    // file. Scanning only Scenario steps would hide exactly those.
    const report = scanFixture({
      'jZZ-bg.feature': [
        'Feature: fixture',
        '  Background:',
        '    Given Adam rides a unicycle',
        '  Scenario: one',
        '    Then Adam is happy',
      ].join('\n'),
    });
    expect(report.unmatched.map((u) => u.text)).toContain('Adam rides a unicycle');
  });

  test('a covered step is counted as scanned but not reported', () => {
    const report = scanFixture({
      'jZZ-ok.feature': [
        'Feature: fixture',
        '  Scenario: one',
        '    Given the local stack is healthy',
      ].join('\n'),
    });
    expect(report.total).toBe(1);
    expect(report.unmatched).toEqual([]);
  });

  test('an empty corpus is a failure, never a pass', () => {
    // "Zero steps scanned" and "zero gaps found" are the same output unless
    // something distinguishes them. A mistyped --dir must not report green.
    const report = scanFixture({});
    expect(report.total).toBe(0);
    expect(report.emptyCorpus).toBe(true);
  });
});

describe('the gate reads the real corpus', () => {
  const real = scanCorpus();

  test('it scans the whole journey corpus, not a subset', () => {
    // Counting the work is the only way to tell "it passed" from "it never ran".
    const featureFiles = fs
      .readdirSync(path.resolve(__dirname, '../../../journey-tests'))
      .filter((f) => f.endsWith('.feature'));
    expect(featureFiles.length).toBeGreaterThan(0);
    expect(real.filesScanned).toBe(featureFiles.length);
    expect(real.total).toBeGreaterThan(1000);
    expect(real.emptyCorpus).toBe(false);
  });

  test('it resolves against the runner’s own matcher table', () => {
    // Not a copy. If the runner drops a matcher, this gate must notice —
    // a gate with its own private idea of what runs is worse than none.
    expect(runner.matchers.length).toBeGreaterThan(0);
    const withNoMatchers = scanCorpus({ matchers: [] });
    expect(withNoMatchers.unmatchedOccurrences).toBe(withNoMatchers.total);
    expect(withNoMatchers.unmatchedOccurrences).toBeGreaterThan(real.unmatchedOccurrences);
  });

  test('dropping ONE matcher is caught — not just dropping all of them', () => {
    // The all-matchers mutation is a weak test: a gate that only notices total
    // collapse would miss the realistic regression, which is a single matcher
    // deleted in a refactor. Sweep every matcher and require that removing it
    // is detectable for at least the steps it alone serves.
    const detected = runner.matchers.filter((_, i) => {
      const without = runner.matchers.filter((__, j) => j !== i);
      return scanCorpus({ matchers: without }).unmatched.length > real.unmatched.length;
    });
    // Most matchers are load-bearing for at least one corpus step; some are
    // redundant with a broader pattern, which is a legitimate state. Assert
    // the gate has real detection power rather than asserting a magic count.
    expect(detected.length).toBeGreaterThan(runner.matchers.length / 2);
  });
});

describe('the ratchet', () => {
  test('exceeding the baseline fails', () => {
    expect(checker.verdict({ unmatched: new Array(5), emptyCorpus: false }, { total: 4 })).toBe(1);
  });

  test('matching the baseline passes', () => {
    expect(checker.verdict({ unmatched: new Array(4), emptyCorpus: false }, { total: 4 })).toBe(0);
  });

  test('improving on the baseline passes', () => {
    expect(checker.verdict({ unmatched: new Array(1), emptyCorpus: false }, { total: 4 })).toBe(0);
  });

  test('an empty corpus fails even at zero gaps', () => {
    expect(checker.verdict({ unmatched: [], emptyCorpus: true }, { total: 4 })).toBe(1);
  });
});
