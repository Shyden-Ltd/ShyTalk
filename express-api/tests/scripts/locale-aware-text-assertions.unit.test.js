/**
 * Running a journey in Thai must assert the THAI string on screen.
 *
 * Operator 2026-08-03: every journey runs in all 5 MVP locales (en/zh/id/vi/th)
 * on the app and web phases, verifying translations as well as behaviour.
 *
 * The corpus asserts English literals — `Then Adam's app UI shows "Not enough
 * coins"`. Repeating that in Thai without translating the expectation fails
 * every text assertion for a reason unrelated to the product, and proves nothing
 * about the translation.
 *
 * `ctx.locale` already existed and was written by five matchers — and READ BY
 * NOTHING. This is what reads it: the expected text is resolved English -> key
 * -> target locale against the bundle the app actually ships, so the assertion
 * checks the REAL translation. A hard-coded expectation would drift the first
 * time a translator changed a word, and would be asserting the test rather than
 * the product.
 *
 * Data is left alone. Of 22 text literals in the corpus only 2 name a shipped UI
 * string; the rest are numbers, room names and messages the scenario itself
 * typed, and none belong in a string bundle.
 */
const { executeStep } = require('../../scripts/manual-qa-runner');

/** A ctx whose app dump contains `text`, running in `locale`. */
function ctxShowing(text, locale) {
  const dump = `<node text="${text}" resource-id="x" />`;
  return {
    locale,
    uiDriver: { androidUiDump: async () => dump },
  };
}

const step = (t) => ({ kind: 'Then', text: t });
const SHOWS = 'Adam\'s app UI shows "Not enough coins"';

describe('a text assertion follows the run locale', () => {
  it('passes when the screen shows the THAI string and the run is Thai', async () => {
    const ctx = ctxShowing('เหรียญไม่พอ.', 'th');
    expect(await executeStep(step(SHOWS), ctx)).toEqual({ ok: true });
  });

  it.each([
    ['zh', '金币不够'],
    ['id', 'Koin tidak cukup'],
    ['vi', 'Không đủ xu'],
  ])('passes for %s with its shipped translation', async (locale, translated) => {
    expect(await executeStep(step(SHOWS), ctxShowing(translated, locale))).toEqual({ ok: true });
  });

  it('FAILS when a Thai run still shows English — the untranslated-screen case', async () => {
    // The defect this whole exercise exists to catch: the app rendering English
    // to a Thai user must not read as a pass.
    const r = await executeStep(step(SHOWS), ctxShowing('Not enough coins', 'th'));
    expect(r.ok).toBe(false);
  });

  it('still passes in English, unchanged', async () => {
    expect(await executeStep(step(SHOWS), ctxShowing('Not enough coins', 'en'))).toEqual({
      ok: true,
    });
  });

  it('treats a missing locale as English rather than throwing', async () => {
    const ctx = ctxShowing('Not enough coins', undefined);
    expect(await executeStep(step(SHOWS), ctx)).toEqual({ ok: true });
  });
});

describe('data assertions are not translated', () => {
  it.each([
    ['6,000', 'a formatted number'],
    ["Theo's Test Room", 'a room the scenario created'],
  ])('%s is asserted literally even in Thai (%s)', async (literal) => {
    const ctx = ctxShowing(literal, 'th');
    const r = await executeStep(step(`Adam's app UI shows "${literal}"`), ctx);
    expect(r).toEqual({ ok: true });
  });
});

describe('the failure message names what it looked for', () => {
  it('reports the TRANSLATED text, not the English the corpus wrote', async () => {
    // A message quoting English while the run is Thai sends the reader looking
    // for the wrong string on the screenshot.
    const r = await executeStep(step(SHOWS), ctxShowing('something else', 'th'));
    expect(r.error).toContain('เหรียญไม่พอ.');
  });
});

describe('the iOS and Web matchers follow the locale too', () => {
  // The requirement covers both phases, and app-ios is a full cell of its own.
  // Fixing only Android would have left half the app phase asserting English
  // against a translated screen.
  const iosCtx = (text, locale) => ({
    locale,
    uiDriver: { iosUiDump: async () => `<XCUIElementTypeStaticText label="${text}" >` },
  });
  const webCtx = (text, locale) => ({
    locale,
    webDriver: { webUiDump: async () => `<div>${text}</div>` },
  });

  it('iOS asserts the Thai string', async () => {
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s iOS Sim UI shows "Not enough coins"' },
      iosCtx('เหรียญไม่พอ.', 'th'),
    );
    expect(r).toEqual({ ok: true });
  });

  it('iOS FAILS when the screen is still English in a Thai run', async () => {
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s iOS Sim UI shows "Not enough coins"' },
      iosCtx('Not enough coins', 'th'),
    );
    expect(r.ok).toBe(false);
  });

  it('Web asserts the Vietnamese string', async () => {
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Web UI shows "Not enough coins"' },
      webCtx('Không đủ xu', 'vi'),
    );
    expect(r).toEqual({ ok: true });
  });
});

describe('the iOS text check matches the REAL dump format', () => {
  // It did not. The matcher looked for `"label":"…"` — a JSON shape — while WDA
  // emits XML (`label="ShyTalk"`), as captured in
  // tests/scripts/drivers/fixtures/ios-dump-signin.xml. So every
  // `<persona>'s app UI shows "text"` step dispatched to iOS failed on the
  // FORMAT rather than the product, and the error message quoted the XML form
  // while the check used the JSON one — which is why reading it never gave the
  // game away.
  //
  // Asserted against the real capture rather than a hand-built string: a
  // fixture I invent can agree with a mistake I made.
  const fs = require('fs');
  const path = require('path');
  const REAL = fs.readFileSync(
    path.resolve(__dirname, '../../tests/scripts/drivers/fixtures/ios-dump-signin.xml'),
    'utf8',
  );

  it('finds text present in the captured device dump', async () => {
    const ctx = { locale: 'en', uiDriver: { iosUiDump: async () => REAL } };
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s iOS Sim UI shows "ShyTalk"' }, ctx);
    expect(r).toEqual({ ok: true });
  });

  it('still refuses text that is NOT in the captured dump', async () => {
    const ctx = { locale: 'en', uiDriver: { iosUiDump: async () => REAL } };
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s iOS Sim UI shows "definitely-not-on-this-screen"' },
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});
