/**
 * THE RATCHET: every step in the journey corpus is claimed by a matcher.
 *
 * A step with no matcher does not fail — the runner records it as an unknown
 * step and moves on. So a corpus line that asserts nothing looks exactly like
 * coverage, and reads like it in a report. That is worse than having no line at
 * all: it is a claim about the product that nobody is checking.
 *
 * Two of those had been sitting in j19 for months (`X's UI shows Officia`) —
 * found only by measuring, because nothing ever went red.
 *
 * This also guards the app-neutral flip. Rewriting 359 corpus lines from
 * "on Android" to "on the app" broke 159 matchers in one edit; without this
 * test the run would simply have got quieter.
 */
const fs = require('fs');
const path = require('path');

const { parseGherkin, matchers, stripStepAnnotation } = require('../../scripts/manual-qa-runner');

const CORPUS = path.resolve(__dirname, '../../../journey-tests');
const featureFiles = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.feature'));

/** Every step in the corpus, with the file it came from. */
function allSteps() {
  const out = [];
  for (const file of featureFiles) {
    const parsed = parseGherkin(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
    for (const scenario of parsed.scenarios) {
      for (const step of scenario.steps) {
        out.push({ file, scenario: scenario.name, text: stripStepAnnotation(step.text) });
      }
    }
  }
  return out;
}

const steps = allSteps();
const claimed = (text) => matchers.some((m) => m.pattern.test(text));

describe('the corpus is fully claimed', () => {
  test('every step matches a matcher', () => {
    const orphans = steps
      .filter((s) => !claimed(s.text))
      .map((s) => `${s.file} :: ${s.text}`)
      .sort();
    expect(orphans).toEqual([]);
  });

  test('the corpus is actually being read', () => {
    // Without this, a wrong path yields zero steps and the assertion above
    // passes having checked nothing. An absence reported as success is the
    // exact failure this file exists to catch.
    expect(featureFiles.length).toBeGreaterThan(15);
    expect(steps.length).toBeGreaterThan(1000);
  });
});

describe('the app corpus runs on BOTH phones', () => {
  /** Scenarios grouped by which platform their steps name. */
  const byScenario = new Map();
  for (const s of steps) {
    const key = `${s.file} :: ${s.scenario}`;
    const entry = byScenario.get(key) || { android: false, ios: false, app: false };
    if (/\bon Android\b|'s Android (?:UI|JWT|network)\b/.test(s.text)) entry.android = true;
    if (/\bon (?:iOS|iPhone)\b|'s (?:iOS|iPhone) (?:UI|network)\b/.test(s.text)) entry.ios = true;
    if (/\bon the app\b|'s app (?:UI|JWT|network)\b/.test(s.text)) entry.app = true;
    byScenario.set(key, entry);
  }

  test('no scenario is pinned to ONE phone without saying why', () => {
    // Operator, 2026-08-01: "why are most of the app scenarios android only???
    // all app scenarios must be on both apps." 87 scenarios named Android and
    // 29 named iOS, for behaviour that is identical on both — so the iPhone
    // never ran the majority of the app's journeys.
    //
    // A scenario MAY still name a platform when the platform is the point (an
    // APK install, a Play billing sheet). Those are listed below by name, so
    // adding one is a visible decision rather than a drift.
    const PLATFORM_SPECIFIC_ALLOWED = [
      // Installing a build: an APK only exists on Android, an IPA only on iOS.
      'j20-signin-environment-matrix.feature',
    ];
    // NAMING one phone pins the scenario even alongside neutral steps: a
    // scenario requiring both `android` and `app` needs a cell with Android, so
    // the iPhone cell skips the whole thing. A first version of this check only
    // flagged scenarios that were EXCLUSIVELY platform-named, and a mutant
    // mixing one Android step into a neutral scenario sailed past it — the
    // mutation is what caught that.
    //
    // Naming BOTH phones is the opposite case and must NOT be flagged. A
    // journey with two app actors needs two handsets: "Theo on Android hosts,
    // Ines on iOS joins" is testing the handoff BETWEEN the phones, and
    // collapsing it to "the app" would seat both actors on one device and
    // silently stop testing the thing the scenario is about.
    const pinned = [...byScenario.entries()]
      .filter(([key, v]) => {
        if (PLATFORM_SPECIFIC_ALLOWED.some((f) => key.startsWith(f))) return false;
        if (v.android && v.ios) return false;
        return v.android || v.ios;
      })
      .map(([key]) => key)
      .sort();
    expect(pinned).toEqual([]);
  });

  test('the app corpus is substantial — this is not passing on an empty set', () => {
    const appScenarios = [...byScenario.values()].filter((v) => v.app).length;
    expect(appScenarios).toBeGreaterThan(100);
  });
});
