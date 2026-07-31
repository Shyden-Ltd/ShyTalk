/**
 * Web cells must SKIP device-only scenarios, not fail them.
 *
 * Operator 2026-07-31: "fix the framework defect so web cells skip device-only
 * scenarios."
 *
 * The corpus is surface-specific — 151 steps say "on Android", 159 "on Web",
 * 46 "on iOS", 4 "on iPhone" — but every matrix cell walks all 226 scenarios.
 * A web-only cell has no ctx.uiDriver, so the first Android step returned
 * `UI step requires ctx.uiDriver (tag=persona_picker_open)` and the whole
 * scenario was recorded as FAILED.
 *
 * Measured consequence: an identical 40-fail / 2-pass split across chromium,
 * mobile-chrome-android AND mobile-safari-ios. Three unrelated surfaces failing
 * exactly the same scenarios is not product debt — it is the harness scoring
 * cells on work they cannot perform. It also buried real defects under ~90%
 * noise, and made the two "passes" meaningless: both were negative assertions
 * ("UI hides adult-only features") that pass trivially when nothing renders.
 *
 * A skip is honest — "this cell cannot drive this surface". A fail is a lie.
 */
const {
  requiredPlatforms,
  cellCapabilities,
  canRunScenario,
} = require('../../scripts/scenario-surface');

const steps = (...texts) => texts.map((text) => ({ kind: 'When', text }));

describe('requiredPlatforms', () => {
  it('finds Android from step text', () => {
    expect([...requiredPlatforms(steps('Adam on Android taps "signin_signUpLink"'))]).toEqual([
      'android',
    ]);
  });

  it('treats "on iPhone" as iOS — the corpus uses both spellings', () => {
    expect([...requiredPlatforms(steps('Mia on iPhone opens the rooms tab'))]).toEqual(['ios']);
    expect([...requiredPlatforms(steps('Mia on iOS opens the rooms tab'))]).toEqual(['ios']);
  });

  it('finds Web', () => {
    expect([...requiredPlatforms(steps("Alice on Web sees Adam's gift"))]).toEqual(['web']);
  });

  it('returns EVERY platform a cross-platform handoff scenario needs', () => {
    // These journeys deliberately thread a device and the web together; a cell
    // that can only do one of them cannot run the scenario at all.
    const found = requiredPlatforms(
      steps('Adam on Android sends a gift', "Alice on Web sees Adam's gift"),
    );
    expect([...found].sort()).toEqual(['android', 'web']);
  });

  it('requires nothing for a scenario with no platform-bound steps', () => {
    // Pure API/state scenarios must keep running on every cell.
    expect([...requiredPlatforms(steps('the audit log has a row for the ban'))]).toEqual([]);
  });

  it('is case-insensitive on the platform word but not fooled by prose', () => {
    expect([...requiredPlatforms(steps('Adam on android taps x'))]).toEqual(['android']);
    // "Android" inside a quoted value is not a platform declaration.
    expect([...requiredPlatforms(steps('the report reason is "Android bug"'))]).toEqual([]);
  });
});

describe('cellCapabilities', () => {
  it('a web-only cell can drive web and nothing else', () => {
    expect([...cellCapabilities({ webDriver: {} })]).toEqual(['web']);
  });

  it('detects Android from the driver method that actually drives it', () => {
    const caps = cellCapabilities({ webDriver: {}, uiDriver: { androidUiDump: () => {} } });
    expect([...caps].sort()).toEqual(['android', 'web']);
  });

  it('detects iOS the same way', () => {
    const caps = cellCapabilities({ webDriver: {}, uiDriver: { iosUiDump: () => {} } });
    expect([...caps].sort()).toEqual(['ios', 'web']);
  });

  it('detects both when the loader merged Android and iOS onto one driver', () => {
    const caps = cellCapabilities({
      webDriver: {},
      uiDriver: { androidUiDump: () => {}, iosUiDump: () => {} },
    });
    expect([...caps].sort()).toEqual(['android', 'ios', 'web']);
  });

  it('does NOT claim a platform from a uiDriver that lacks its methods', () => {
    // A uiDriver object exists but cannot dump Android UI — claiming android
    // here is how the scenario fails deep inside instead of skipping cleanly.
    expect([...cellCapabilities({ webDriver: {}, uiDriver: {} })]).toEqual(['web']);
  });

  it('claims nothing when there is no driver at all', () => {
    expect([...cellCapabilities({})]).toEqual([]);
  });
});

describe('canRunScenario', () => {
  const web = new Set(['web']);
  const android = new Set(['android', 'web']);

  it('runs a web scenario on a web cell', () => {
    expect(canRunScenario(new Set(['web']), web)).toEqual({ ok: true, missing: [] });
  });

  it('SKIPS an Android scenario on a web-only cell — the defect being fixed', () => {
    expect(canRunScenario(new Set(['android']), web)).toEqual({ ok: false, missing: ['android'] });
  });

  it('skips a cross-platform scenario when only one half is available', () => {
    const verdict = canRunScenario(new Set(['android', 'web']), web);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['android']);
  });

  it('runs a cross-platform scenario on a cell that can do both', () => {
    expect(canRunScenario(new Set(['android', 'web']), android).ok).toBe(true);
  });

  it('runs a scenario that requires nothing, on any cell', () => {
    expect(canRunScenario(new Set(), web).ok).toBe(true);
    expect(canRunScenario(new Set(), new Set()).ok).toBe(true);
  });

  it('reports every missing platform, not just the first', () => {
    const verdict = canRunScenario(new Set(['android', 'ios']), web);
    expect(verdict.missing.sort()).toEqual(['android', 'ios']);
  });

  it('never reports missing platforms when it says ok', () => {
    // Guards against a caller trusting `missing` while ignoring `ok`.
    expect(canRunScenario(new Set(['web']), android)).toEqual({ ok: true, missing: [] });
  });
});

/**
 * The dashboard must distinguish "not applicable" from "pending".
 *
 * Operator 2026-07-31: "icons columns must be appropriate to the testing. if
 * it's an app testing, don't have a chrome icon etc."
 *
 * Measured: a web-only cell can run 39 of 226 scenarios; web+android 147;
 * web+ios 51. Rendering the other 187 as "pending" tells the operator to wait
 * for work that will never happen, and inflates the denominator by 65%
 * (2712 combinations claimed vs 948 that can actually run).
 */
describe('applicableCells', () => {
  const { applicableCells } = require('../../scripts/scenario-surface');

  const CAPS = {
    chromium: ['web'],
    'mobile-chrome-android': ['web', 'android'],
    'mobile-safari-ios': ['web', 'ios'],
  };

  it('marks a device scenario n/a on a web-only cell', () => {
    const steps = [{ kind: 'When', text: 'Adam on Android taps "x"' }];
    expect(applicableCells(steps, CAPS)).toEqual({
      chromium: false,
      'mobile-chrome-android': true,
      'mobile-safari-ios': false,
    });
  });

  it('marks a web scenario applicable everywhere, since every cell has web', () => {
    const steps = [{ kind: 'Then', text: 'Alice on Web sees the gift wall' }];
    expect(Object.values(applicableCells(steps, CAPS))).toEqual([true, true, true]);
  });

  it('marks a cross-platform scenario applicable only where BOTH surfaces exist', () => {
    const steps = [
      { kind: 'When', text: 'Adam on Android sends a gift' },
      { kind: 'Then', text: 'Alice on Web sees it' },
    ];
    const applicable = applicableCells(steps, CAPS);
    expect(applicable['mobile-chrome-android']).toBe(true);
    expect(applicable.chromium).toBe(false);
    expect(applicable['mobile-safari-ios']).toBe(false);
  });

  it('marks a platform-free scenario applicable everywhere', () => {
    const steps = [{ kind: 'Then', text: 'the audit log has a row' }];
    expect(Object.values(applicableCells(steps, CAPS))).toEqual([true, true, true]);
  });
});
