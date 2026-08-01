/**
 * A scenario for a feature that does not exist must say so.
 *
 * THE GAP THIS FILLS: j16 (event host / team leader) and j17 (teacher
 * classroom) assert on `teamRoster`, `rosterParticipants` and
 * `teachingLanguages`. None of those fields exist anywhere in the product,
 * because neither feature is built — there is no events collection and no
 * lessons surface in `express-api/src` or `shared/src`.
 *
 * Those scenarios therefore fail every run. Reported as ordinary failures they
 * are indistinguishable from regressions, so they train the reader to ignore
 * red — which is the most expensive thing a test suite can do.
 *
 * `@manual` already exists for "a human must verify this". `@unimplemented` is
 * a different statement: the PRODUCT does not have this yet. Conflating them
 * would hide a genuine build gap behind a testing-process one.
 *
 * The tag never suppresses a passing scenario: if the feature ships and the
 * scenario starts working, the tag is wrong and should be removed — which is
 * why the skip records the tag rather than silently omitting the scenario.
 */
const { shouldSkipScenario } = require('../../scripts/scenario-skip-tags');

describe('shouldSkipScenario', () => {
  it('skips @unimplemented with a reason naming the feature gap', () => {
    const r = shouldSkipScenario(['@blocker', '@unimplemented']);
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/not built/i);
  });

  it('keeps skipping @manual, with its own distinct reason', () => {
    const r = shouldSkipScenario(['@manual']);
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/interactive/i);
    // The two must not be conflated: one is a product gap, one is a process
    // constraint, and a report that merges them hides the first.
    expect(r.reason).not.toMatch(/not built/i);
  });

  it('runs an ordinary scenario', () => {
    expect(shouldSkipScenario(['@blocker', '@android-physical']).skip).toBe(false);
  });

  it('runs a scenario with no tags at all', () => {
    expect(shouldSkipScenario([]).skip).toBe(false);
    expect(shouldSkipScenario(undefined).skip).toBe(false);
  });

  it('prefers @manual when a scenario carries both', () => {
    // A human-verified scenario for an unbuilt feature is still, first and
    // foremost, not runnable here. Either reason is honest; picking one
    // deterministically keeps the report stable.
    const r = shouldSkipScenario(['@manual', '@unimplemented']);
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/interactive/i);
  });

  it('does not match a tag that merely CONTAINS the word', () => {
    // `@unimplemented-later` is not `@unimplemented`; a substring match would
    // let a typo silently disable a scenario forever.
    expect(shouldSkipScenario(['@unimplementedish']).skip).toBe(false);
    expect(shouldSkipScenario(['@manually']).skip).toBe(false);
  });

  it('reports WHICH tag caused the skip, so the report is auditable', () => {
    expect(shouldSkipScenario(['@unimplemented']).tag).toBe('@unimplemented');
    expect(shouldSkipScenario(['@manual']).tag).toBe('@manual');
    expect(shouldSkipScenario(['@blocker']).tag).toBeNull();
  });
});

describe('the corpus uses the tag where the feature is genuinely absent', () => {
  const fs = require('fs');
  const path = require('path');
  const CORPUS = path.resolve(__dirname, '../../../journey-tests');

  /** Feature files whose subject does not exist in the product. */
  const UNBUILT = ['j16-event-host-team-leader.feature', 'j17-teacher-classroom.feature'];

  it.each(UNBUILT)('%s marks its scenarios @unimplemented', (file) => {
    const src = fs.readFileSync(path.join(CORPUS, file), 'utf8');
    // `[ \t]*` not `\s*`: `\s` matches newlines, which lets the engine
    // backtrack across the whole file.
    const scenarios = (src.match(/^[ \t]*Scenario:/gm) || []).length;
    const tagged = (src.match(/@unimplemented/g) || []).length;
    expect(scenarios).toBeGreaterThan(0);
    // Every scenario in the file, since the whole feature is absent.
    expect(tagged).toBeGreaterThanOrEqual(scenarios);
  });

  it('does not mark scenarios for features that DO exist', () => {
    // The tag must stay rare. Applying it to a working journey would silently
    // stop testing a shipped feature — the exact failure this whole story is
    // about, wearing a different hat.
    const others = fs
      .readdirSync(CORPUS)
      .filter((f) => f.endsWith('.feature') && !UNBUILT.includes(f));
    const wrongly = others.filter((f) =>
      fs.readFileSync(path.join(CORPUS, f), 'utf8').includes('@unimplemented'),
    );
    expect(wrongly).toEqual([]);
  });
});
