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

/**
 * Only DEVICE platforms gate. Regression, caught 2026-08-01 by the suite.
 *
 * The first cut of this gate treated `web` as a requirement, which broke five
 * `runFeatureFile` tests and eleven journey-Given tests: a step like
 * `Given Alice [P-02] on Web has shyCoins=42` names a surface but seeds STATE —
 * it writes to the datastore and never opens a browser. Gating it turned
 * passing scenarios into skips, which is the same class of lie the gate exists
 * to remove, pointed the other way.
 *
 * The asymmetry is in the runner, not a judgement call: every hard driver
 * requirement it can emit is `UI step requires ctx.uiDriver` (10 sites in
 * manual-qa-runner.js). There is no `requires ctx.webDriver` anywhere — web
 * steps degrade to API/state assertions. So a missing uiDriver is fatal and a
 * missing webDriver is not, and only the fatal one may gate.
 *
 * This costs the matrix nothing: all 12 cells are browser cells, so `web` is a
 * universal capability there and never discriminated between cells anyway.
 */
describe('web never gates — only android and iOS do', () => {
  it('runs a web-only scenario on a harness with NO drivers at all', () => {
    // The exact regression: unit/integration harnesses drive runFeatureFile
    // with a fake db and no webDriver, and their fixtures say "on Web".
    const required = requiredPlatforms(steps('Alice [P-02] on Web has shyCoins=42'));
    expect(canRunScenario(required, cellCapabilities({}))).toEqual({ ok: true, missing: [] });
  });

  it('still skips an Android scenario on that same driverless harness', () => {
    const required = requiredPlatforms(steps('Adam on Android taps "signin_signUpLink"'));
    expect(canRunScenario(required, cellCapabilities({})).missing).toEqual(['android']);
  });

  it('reports web in requiredPlatforms even though it does not gate', () => {
    // The description stays truthful; only the GATE narrows. A future consumer
    // that wants "is this a web scenario?" must still get a straight answer.
    expect([...requiredPlatforms(steps('Alice on Web sees the gift'))]).toEqual(['web']);
  });

  it('a cross-surface scenario gates on its DEVICE half only', () => {
    const required = requiredPlatforms(
      steps('Adam on Android sends a gift', "Alice on Web sees Adam's gift"),
    );
    expect(canRunScenario(required, new Set(['web'])).missing).toEqual(['android']);
    expect(canRunScenario(required, new Set(['android'])).ok).toBe(true);
  });
});

/**
 * The runner says "I cannot drive this" in TWO ways, and only one of them means
 * the surface is wrong.
 *
 * Measured on the 2026-08-01 run: 97 of 161 chromium findings were
 * `ctx.<driver>.<method> not configured` — 51 on uiDriver, 45 on webDriver.
 * Gating on the `UI step requires ctx.uiDriver` message alone caught none of
 * them, which is why an identical 30-fail/2-pass split reappeared across
 * chromium, mobile-chrome-android AND mobile-safari-ios.
 *
 * The discriminator is whether the DRIVER OBJECT exists on ctx, not which
 * sentence was printed:
 *
 *   - chromium has no `uiDriver` at all, so `ctx.uiDriver.androidIsFlavorInstalled
 *     not configured` means "wrong surface" → SKIP.
 *   - chromium DOES have a `webDriver`, so `ctx.webDriver.webVisit not configured`
 *     means that driver is genuinely missing a method → FAIL. That is real debt
 *     (SHY-0259, "journey corpus outruns its drivers") and hiding it as a skip
 *     would erase the very backlog the story exists to burn down.
 */
describe('missing-driver classification', () => {
  const { isSurfaceUnavailable } = require('../../scripts/scenario-surface');

  it('treats the hard uiDriver requirement as unavailable when there is no uiDriver', () => {
    const err = 'UI step requires ctx.uiDriver (platform=android, tag=persona_picker_open)';
    expect(isSurfaceUnavailable(err, { webDriver: {} })).toBe(true);
  });

  it('treats an unconfigured uiDriver METHOD as unavailable when there is no uiDriver', () => {
    // The 51 findings the message-only gate missed.
    const err = 'ctx.uiDriver.androidIsFlavorInstalled not configured';
    expect(isSurfaceUnavailable(err, { webDriver: {} })).toBe(true);
  });

  it('does NOT hide an unconfigured method on a driver the cell HAS', () => {
    // The 45 webDriver findings are real gaps on a cell that owns a webDriver.
    const err = 'ctx.webDriver.webVisit not configured';
    expect(isSurfaceUnavailable(err, { webDriver: {} })).toBe(false);
  });

  it('does NOT hide an unconfigured uiDriver method on a cell that HAS a uiDriver', () => {
    // A device cell missing a driver method is framework debt, not a surface
    // mismatch — turning it into a skip would make SHY-0259 invisible.
    const err = 'ctx.uiDriver.iosTapSameRoom not configured';
    expect(isSurfaceUnavailable(err, { webDriver: {}, uiDriver: { iosUiDump: () => {} } })).toBe(
      false,
    );
  });

  it('treats a missing webDriver as unavailable on a cell with no webDriver', () => {
    const err = 'Web step requires ctx.webDriver (document direction)';
    expect(isSurfaceUnavailable(err, { uiDriver: { androidUiDump: () => {} } })).toBe(true);
  });

  it('never hides an ordinary product failure', () => {
    // The whole point is that real defects stay red. These two are genuine
    // findings from the same run.
    expect(isSurfaceUnavailable('OSA invariants violated: 1 cross-cohort followingIds', {})).toBe(
      false,
    );
    expect(isSurfaceUnavailable("rooms/Selma's Saturday Sing-along does not exist", {})).toBe(
      false,
    );
  });

  it('is safe on an empty or absent error', () => {
    expect(isSurfaceUnavailable('', {})).toBe(false);
    expect(isSurfaceUnavailable(undefined, {})).toBe(false);
  });

  it('does not match a driver name merely mentioned in prose', () => {
    expect(isSurfaceUnavailable('the page explained that ctx.uiDriver exists', {})).toBe(false);
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

/**
 * A driver that exists but drives the WRONG platform is still a surface
 * mismatch.
 *
 * Caught by the 2026-08-01 gauntlet run, not by a test. On mobile-safari-ios
 * `ctx.uiDriver` is the iOS driver, so an Android step produced
 * `ctx.uiDriver.androidOpenScreen not configured`. The object-existence check
 * saw a uiDriver present and called it framework debt — a FAIL — when the cell
 * simply has no Android to drive.
 *
 * The distinction still matters in the other direction: on a cell that DOES
 * drive Android, a missing android* method is real SHY-0259 debt and must stay
 * red.
 */
describe('platform-aware surface gate', () => {
  const { isSurfaceUnavailable, methodPlatform } = require('../../scripts/scenario-surface');

  const iosCell = { webDriver: {}, uiDriver: { iosUiDump: () => {} } };
  const androidCell = { webDriver: {}, uiDriver: { androidUiDump: () => {} } };

  it('reads the platform out of the method name', () => {
    expect(methodPlatform('ctx.uiDriver.androidOpenScreen not configured')).toBe('android');
    expect(methodPlatform('ctx.uiDriver.iosSearchIn not configured')).toBe('ios');
    expect(methodPlatform('ctx.webDriver.webOpenScreen not configured')).toBeNull();
  });

  it('SKIPS an android method on an iOS-only cell', () => {
    expect(isSurfaceUnavailable('ctx.uiDriver.androidOpenScreen not configured', iosCell)).toBe(
      true,
    );
  });

  it('SKIPS an ios method on an Android-only cell', () => {
    expect(isSurfaceUnavailable('ctx.uiDriver.iosSearchIn not configured', androidCell)).toBe(true);
  });

  it('still FAILS a genuinely missing android method on an Android cell', () => {
    // Real debt on a cell that can drive the surface — hiding it would make
    // the SHY-0259 backlog invisible again.
    expect(
      isSurfaceUnavailable('ctx.uiDriver.androidSomethingUnbuilt not configured', androidCell),
    ).toBe(false);
  });

  it('still FAILS a webDriver method gap regardless of platform', () => {
    expect(isSurfaceUnavailable('ctx.webDriver.webOpenScreen not configured', iosCell)).toBe(false);
  });

  it('SKIPS when there is no uiDriver at all, as before', () => {
    expect(
      isSurfaceUnavailable('ctx.uiDriver.androidOpenScreen not configured', { webDriver: {} }),
    ).toBe(true);
  });

  it('never hides an ordinary product failure', () => {
    expect(isSurfaceUnavailable('response status was 404, expected 405', androidCell)).toBe(false);
  });
});

/**
 * "ON THE APP" — one scenario, both apps.
 *
 * Operator 2026-08-01: "why are most of the app scenarios android only??? all
 * app scenarios must be on both apps" — and then: "why are there so little app
 * scenarios... ??? there should be MANY more. so many gaps need to be filled
 * here. the app is the core product".
 *
 * MEASURED, and it is as bad as it sounds:
 *
 *   Android-only scenarios : 114
 *   iOS-only scenarios     :  12
 *   app screens with ZERO journey coverage : 29 of 37
 *   app testTags referenced by any journey : 15 of 160  (9.4%)
 *
 * The corpus says "on Android" in 376 steps and "on iOS" in 120, and
 * `requiredPlatforms` reads that literally — so a scenario about signing in,
 * which is identical on both apps, is pinned to one of them forever. The iOS
 * cell then SKIPS 282 scenarios, and the skew is invisible because a skip looks
 * like a decision rather than an omission.
 *
 * `on the app` says what these scenarios actually mean: this runs on the native
 * app, whichever one this cell drives. One sentence, both platforms, and the
 * count of app scenarios doubles without writing a single new one.
 */
describe('"on the app" — platform-neutral app steps', () => {
  const { requiredPlatforms, canRunScenario } = require('../../scripts/scenario-surface');
  const step = (text) => ({ text });

  it('requires an app, without naming which', () => {
    expect([...requiredPlatforms([step('Adam [P-01] on the app taps "rooms"')])]).toEqual(['app']);
  });

  it('is satisfied by the Android cell', () => {
    expect(canRunScenario(new Set(['app']), new Set(['android'])).ok).toBe(true);
  });

  it('is satisfied by the iOS cell', () => {
    expect(canRunScenario(new Set(['app']), new Set(['ios'])).ok).toBe(true);
  });

  it('is NOT satisfied by a browser-only cell', () => {
    // The whole point is that it needs a device. A web cell must skip it, not
    // fail it — same contract as a concrete platform.
    const v = canRunScenario(new Set(['app']), new Set(['web']));
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['app']);
  });

  it('still lets a genuinely Android-specific scenario pin itself', () => {
    // Some scenarios ARE platform-specific — an APK install flow, a Play
    // billing dialog. Naming the platform must keep working, or the neutral
    // form becomes a blunt instrument that erases real distinctions.
    expect([...requiredPlatforms([step('Adam [P-01] on Android taps "rooms"')])]).toEqual([
      'android',
    ]);
    expect(canRunScenario(new Set(['android']), new Set(['ios'])).ok).toBe(false);
  });

  it('combines with web for a cross-over scenario', () => {
    const required = requiredPlatforms([
      step('Adam [P-01] on the app sends a gift'),
      step('Alice [P-02] on Web sees the gift'),
    ]);
    expect([...required].sort()).toEqual(['app', 'web']);
    // A cross cell holding either device can run it.
    expect(canRunScenario(required, new Set(['web', 'android'])).ok).toBe(true);
    expect(canRunScenario(required, new Set(['web', 'ios'])).ok).toBe(true);
  });

  it('a scenario naming BOTH concrete apps still needs both', () => {
    // cross-all territory — unchanged by the neutral form.
    const required = requiredPlatforms([
      step('Adam [P-01] on Android sends'),
      step('Mia [P-07] on iOS receives'),
    ]);
    expect(canRunScenario(required, new Set(['android'])).ok).toBe(false);
    expect(canRunScenario(required, new Set(['android', 'ios'])).ok).toBe(true);
  });

  it('does not match "app" inside an ordinary word', () => {
    // "on the application", "on Apple" — anchored on the exact phrase, or every
    // sentence mentioning an app becomes a device requirement.
    expect([...requiredPlatforms([step('Adam sees the appearance settings')])]).toEqual([]);
  });
});
