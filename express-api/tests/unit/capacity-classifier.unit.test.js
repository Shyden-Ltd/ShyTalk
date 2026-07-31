/**
 * SHY-0263 — the same starvation must be recognised however it surfaces.
 *
 * The symptom is NOT stable. The same underlying condition produced
 * `loadFirestoreRules 500 UNKNOWN` on 2026-07-30 and 140 x `Exceeded timeout`
 * with no 500 at all on 2026-07-31. A classifier keyed on either error string
 * alone misses half the occurrences, so this suite is parameterised over both
 * real shapes — and over a genuine product failure, because a classifier that
 * answered "capacity" unconditionally would pass every other test in this file.
 *
 * Fixtures: real captured output, see tests/fixtures/preflight/README.md.
 */
const fs = require('fs');
const path = require('path');

const { classifyRunFailure } = require('../../scripts/preflight/capacity-classifier');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '../fixtures/preflight', name), 'utf8');

const RULES_500 = fixture('failure-rules-500.txt');
const TIMEOUT_STORM = fixture('failure-timeout-storm.txt');
const PRODUCT_ASSERTION = fixture('failure-product-assertion.txt');

describe('classifyRunFailure — both recorded capacity shapes', () => {
  it.each([
    ['the 2026-07-30 loadFirestoreRules 500 UNKNOWN', RULES_500],
    ['the 2026-07-31 timeout storm, which carries no 500 at all', TIMEOUT_STORM],
  ])('classifies %s as capacity', (_label, log) => {
    expect(classifyRunFailure(log).kind).toBe('capacity');
  });

  it('confirms the two shapes really are different, so the test is not tautological', () => {
    expect(RULES_500).toMatch(/500/);
    expect(TIMEOUT_STORM).not.toMatch(/"code":500/);
    expect(TIMEOUT_STORM).toMatch(/Exceeded timeout/);
    expect(RULES_500).not.toMatch(/Exceeded timeout/);
  });

  it('explains which signal fired, so the guidance can be specific', () => {
    expect(classifyRunFailure(RULES_500).signal).toMatch(/rules|500/i);
    expect(classifyRunFailure(TIMEOUT_STORM).signal).toMatch(/timeout/i);
  });
});

describe('classifyRunFailure — must not over-claim', () => {
  it('classifies a genuine assertion failure as a product failure', () => {
    // Without this, a classifier returning 'capacity' unconditionally passes
    // every other assertion in this file.
    expect(classifyRunFailure(PRODUCT_ASSERTION).kind).toBe('product');
  });

  it('does not treat the watchman recrawl warning as a capacity signal', () => {
    // This warning appears in almost every run, including entirely healthy ones,
    // and was itself misread as a hang signature during the investigation.
    const warningOnly = [
      'watchman warning: Recrawled this watch 135 times, most recently because:',
      'MustScanSubDirs UserDroppedTo resolve, please review the information on',
    ].join('\n');
    expect(classifyRunFailure(warningOnly).kind).not.toBe('capacity');
  });

  it('does not classify a clean passing run as any kind of failure', () => {
    const green =
      'Test Suites: 432 passed, 432 total\nTests: 13999 passed, 13999 total\nTime: 366.21 s';
    expect(classifyRunFailure(green).kind).toBe('none');
  });

  it('needs a real cluster of timeouts, not one slow test', () => {
    // A single timeout is an ordinary flake or a genuinely slow test. The
    // capacity signature is the storm.
    const single = 'FAIL tests/foo.test.js\n    thrown: "Exceeded timeout of 10000 ms for a hook.';
    expect(classifyRunFailure(single).kind).not.toBe('capacity');
  });
});

describe('classifyRunFailure — duration is part of the verdict', () => {
  it('flags a run that passed everything but took 9x the budget', () => {
    // The 2026-07-31 starved run was 432/432 with ZERO timeouts in 3382s
    // against a 366s baseline. On pass/fail alone it is indistinguishable
    // from a healthy run, which is exactly why duration is a first-class input.
    const green = 'Test Suites: 432 passed, 432 total\nTests: 13999 passed, 13999 total';
    const verdict = classifyRunFailure(green, { elapsedSeconds: 3382, budgetSeconds: 550 });
    expect(verdict.kind).toBe('capacity');
    expect(verdict.signal).toMatch(/durat|slow|budget/i);
  });

  it('leaves a green run inside its budget alone', () => {
    const green = 'Test Suites: 432 passed, 432 total\nTests: 13999 passed, 13999 total';
    expect(classifyRunFailure(green, { elapsedSeconds: 366, budgetSeconds: 550 }).kind).toBe(
      'none',
    );
  });

  it('does not need a budget to be supplied', () => {
    expect(() => classifyRunFailure(TIMEOUT_STORM)).not.toThrow();
  });
});
