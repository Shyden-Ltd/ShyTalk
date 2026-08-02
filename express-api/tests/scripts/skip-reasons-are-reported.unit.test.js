/**
 * A SKIP has to say WHY.
 *
 * `skipReason()` computes one, `runScenario` attaches it to the scenario report
 * — and both output points dropped it. The per-cell log printed a bare
 * `SKIP <file> :: <scenario>`, and the JSON report's cells carry only
 * browser/outcome/duration/attempts/retries/phase.
 *
 * On 2026-08-02 the app-android cell skipped 110 of 228 scenarios and recorded
 * no reason for any of them. That is half the corpus in a state nobody can
 * audit: a legitimate skip ("this cell has no browser") and a wrong one (a step
 * misread as needing a surface it does not) printed identically. SKIP is the one
 * status nobody investigates, which is exactly why it must be explicable —
 * across seven runs FAIL fell 115 -> 102 while SKIP rose 98 -> 110, and there
 * was no way to tell how much of that was coverage quietly going missing.
 *
 * The summary line was worse than silent. It read `Skipped (@manual): 110`,
 * attributing every surface-gate skip to a tag that had nothing to do with it —
 * a number worth investigating, labelled as deliberate.
 */
const {
  formatScenarioLine,
  summariseSkips,
  formatReport,
} = require('../../scripts/manual-qa-runner');

describe('a skipped scenario prints its reason', () => {
  it('appends the reason to the SKIP line', () => {
    const line = formatScenarioLine('j07.feature', {
      status: 'skipped',
      scenario: 'Adam creates a DIRECT conversation',
      reason: 'surface not available on this cell — needs Web',
    });
    expect(line).toBe(
      'SKIP j07.feature :: Adam creates a DIRECT conversation — surface not available on this cell — needs Web',
    );
  });

  it('still prints a bare SKIP when no reason was recorded', () => {
    // Never invent one. A skip with no reason is itself worth seeing — it means
    // a path reached the gate without saying what it lacked.
    const line = formatScenarioLine('j07.feature', { status: 'skipped', scenario: 'X' });
    expect(line).toBe('SKIP j07.feature :: X');
  });

  it('leaves OK and FAIL lines exactly as they were', () => {
    // The gauntlet dashboard and every `grep -c "^  OK "` in the tooling parse
    // these; changing their shape would silently break the counting used to
    // judge every run.
    expect(formatScenarioLine('j01.feature', { status: 'pass', scenario: 'Y' })).toBe(
      'OK j01.feature :: Y',
    );
    expect(formatScenarioLine('j01.feature', { status: 'fail', scenario: 'Z' })).toBe(
      'FAIL j01.feature :: Z',
    );
    // A FAIL must not grow a reason suffix either — findings carry that detail.
    expect(
      formatScenarioLine('j01.feature', { status: 'fail', scenario: 'Z', reason: 'nope' }),
    ).toBe('FAIL j01.feature :: Z');
  });
});

describe('skips are summarised by reason', () => {
  const reports = [
    { status: 'skipped', reason: 'needs Web' },
    { status: 'skipped', reason: 'needs Web' },
    { status: 'skipped', reason: 'needs iOS Sim' },
    { status: 'skipped', skippedBy: '@unimplemented' },
    { status: 'pass' },
    { status: 'fail' },
  ];

  it('groups by reason, most frequent first', () => {
    expect(summariseSkips(reports)).toEqual([
      { reason: 'needs Web', count: 2 },
      { reason: 'needs iOS Sim', count: 1 },
      { reason: '@unimplemented', count: 1 },
    ]);
  });

  it('falls back to the skip TAG when there is no surface reason', () => {
    // `@manual` / `@unimplemented` skips carry `skippedBy`, not `reason`, and
    // merging them into an unlabelled bucket would hide the product gaps
    // `@unimplemented` exists to track.
    expect(summariseSkips([{ status: 'skipped', skippedBy: '@unimplemented' }])).toEqual([
      { reason: '@unimplemented', count: 1 },
    ]);
  });

  it('says so when a skip recorded nothing at all', () => {
    expect(summariseSkips([{ status: 'skipped' }])).toEqual([
      { reason: 'no reason recorded', count: 1 },
    ]);
  });

  it('counts only skips', () => {
    expect(summariseSkips([{ status: 'pass' }, { status: 'fail' }])).toEqual([]);
  });
});

describe('the report summary no longer blames @manual for every skip', () => {
  const reports = [
    { status: 'skipped', reason: 'surface not available on this cell — needs Web' },
    { status: 'skipped', reason: 'surface not available on this cell — needs Web' },
    { status: 'pass' },
  ];

  it('reports the total without attributing it to a tag', () => {
    const out = formatReport([], reports, 'local', 1);
    expect(out).toMatch(/^Skipped: 2$/m);
    expect(out).not.toMatch(/Skipped \(@manual\)/);
  });

  it('breaks the total down by reason', () => {
    const out = formatReport([], reports, 'local', 1);
    expect(out).toMatch(/2 × surface not available on this cell — needs Web/);
  });
});

describe('the reason names the driver that was actually absent', () => {
  const { skipReason } = require('../../scripts/scenario-surface');

  it('a web-only gap says BROWSER, not device UI driver', () => {
    // `missing` only ever holds GATING_PLATFORMS and `web` is deliberately not
    // one, so every web scenario skipped on an app cell arrived with an empty
    // set. Measured on run 20260803-011547-local: 70 of app-android's 111 skips
    // said "the step needs a device UI driver" — on a cell whose device UI
    // driver was present and working. The skips were right; the explanation
    // sent the reader hunting a problem that did not exist, which is worse than
    // silence because it looks like an answer.
    expect(skipReason([], 'webDriver')).toMatch(/needs a browser/);
    expect(skipReason([], 'webDriver')).not.toMatch(/device UI driver/);
  });

  it('a named platform still wins over the driver', () => {
    // The specific statement is the better one whenever it exists.
    expect(skipReason(['ios'], 'uiDriver')).toBe('surface not available on this cell — needs ios');
  });

  it('falls back to the generic reason when nothing more precise is known', () => {
    // Still says SOMETHING. A skip with no explanation is the state this whole
    // change exists to remove.
    expect(skipReason([], 'uiDriver')).toMatch(/device UI driver/);
    expect(skipReason([])).toMatch(/device UI driver/);
  });
});
