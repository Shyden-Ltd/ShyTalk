/**
 * "on the app" reaches whichever phone the cell owns.
 *
 * THE DEFECT THIS CLOSES. Every matcher used to hard-code `on Android` in its
 * pattern and `ctx.uiDriver.androidX` in its body, so a step could physically
 * only run on one phone. 87 of 228 scenarios said "on Android" and the iPhone
 * ran none of them — not because iOS was broken, but because the corpus had no
 * way to ask for it.
 *
 * These tests drive the REAL matcher table out of manual-qa-runner.js. A test
 * that re-implemented the dispatch would pass while the runner's own copy stayed
 * Android-only, which is precisely the failure being fixed.
 */
const { matchers, executeStep } = require('../../scripts/manual-qa-runner');

/** Find the matcher that owns a step, the same way the runner does. */
const matcherFor = (step) => matchers.find((mm) => mm.pattern.test(step));

/**
 * A driver exposing one platform's prefix, recording what was called.
 *
 * Not a stand-in for a device: the question here is purely "which method name
 * did the runner reach for", which is a fact about the runner, not the phone.
 */
function recorder(prefix, names) {
  const calls = [];
  const driver = {};
  // Every driver answers a dump — it is how the runner tells which phone it has.
  driver[`${prefix}UiDump`] = async () => {
    calls.push('UiDump');
    return '<node/>';
  };
  for (const n of names) {
    driver[`${prefix}${n}`] = async (...args) => {
      calls.push(`${n}(${args.join(',')})`);
      return true;
    };
  }
  return { driver, calls };
}

describe('the corpus can say "on the app"', () => {
  test.each([['Adam on the app taps "main_roomsTab"'], ['Adam on Android taps "main_roomsTab"']])(
    '%s is matched',
    (step) => {
      // Both phrasings must work: the flip to "on the app" is corpus-wide, but a
      // scenario that genuinely means one platform keeps saying so.
      expect(matcherFor(step)).toBeDefined();
    },
  );

  test.each([
    ['Adam on the app kills and relaunches the app'],
    ['Adam on the app force-refreshes the JWT'],
    ['Adam on the app searches "Selma" in messages'],
    ['Adam on the app types "hello" into "chat_input"'],
    ["Adam on the app taps Selma's user card"],
    ['Adam on the app sends "hi" to Selma'],
  ])('%s is matched', (step) => {
    expect(matcherFor(step)).toBeDefined();
  });

  test('a neutral step still refuses a phrasing that names no platform at all', () => {
    // The widening must not turn the matcher into a catch-all: a step with a
    // typo'd platform should fail to match rather than run somewhere arbitrary.
    expect(matcherFor('Adam on the phone taps "main_roomsTab"')).toBeUndefined();
  });
});

describe('the same neutral step drives EITHER phone', () => {
  const step = "Adam on the app taps Selma's user card";

  test('an Android-only cell calls the Android driver', async () => {
    const { driver, calls } = recorder('android', ['TapUserCard']);
    const res = await executeStep({ text: step }, { uiDriver: driver });
    expect(res.ok).toBe(true);
    expect(calls).toContain('TapUserCard(Adam,Selma)');
  });

  test('an iOS-only cell calls the iOS driver — the whole point', async () => {
    // Before this change the step could not reach the iPhone at all, whatever
    // the corpus said.
    const { driver, calls } = recorder('ios', ['TapUserCard']);
    const res = await executeStep({ text: step }, { uiDriver: driver });
    expect(res.ok).toBe(true);
    expect(calls).toContain('TapUserCard(Adam,Selma)');
  });

  test('a driver exposing the neutral app* surface is preferred', async () => {
    const { driver, calls } = recorder('app', ['TapUserCard']);
    const res = await executeStep({ text: step }, { uiDriver: driver });
    expect(res.ok).toBe(true);
    expect(calls).toContain('TapUserCard(Adam,Selma)');
  });

  test('a cell holding BOTH phones drives Android, not both and not neither', async () => {
    // Deliberate: full two-phone coverage comes from the dedicated app-android
    // and app-ios cells, not from running one step twice inside a cross cell.
    const a = recorder('android', ['TapUserCard']);
    const i = recorder('ios', ['TapUserCard']);
    const merged = { ...a.driver, ...i.driver };
    const res = await executeStep({ text: step }, { uiDriver: merged });
    expect(res.ok).toBe(true);
    expect(a.calls).toContain('TapUserCard(Adam,Selma)');
    expect(i.calls).not.toContain('TapUserCard(Adam,Selma)');
  });
});

describe('a missing method still fails, and still says what is missing', () => {
  test('the error names the neutral method AND every prefix that was tried', async () => {
    // "Not configured" without a name sends the operator hunting. The message
    // has to be enough to fix the gap from the report alone.
    const driver = { androidUiDump: async () => '<node/>' };
    const res = await executeStep(
      { text: "Adam on the app taps Selma's user card" },
      { uiDriver: driver },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('TapUserCard');
    expect(res.error).toMatch(/appTapUserCard/);
    expect(res.error).toMatch(/iosTapUserCard/);
  });

  test('no driver at all is refused rather than silently passing', async () => {
    const res = await executeStep({ text: "Adam on the app taps Selma's user card" }, {});
    expect(res.ok).toBe(false);
  });
});

describe('platform-named steps are unaffected', () => {
  test('"on Android" still reaches the Android driver', async () => {
    const { driver, calls } = recorder('android', ['TapUserCard']);
    const res = await executeStep(
      { text: "Adam on Android taps Selma's user card" },
      { uiDriver: driver },
    );
    expect(res.ok).toBe(true);
    expect(calls).toContain('TapUserCard(Adam,Selma)');
  });

  test('the widened patterns did not turn a capture group non-capturing', async () => {
    // The trap: swapping `(Android|iOS Sim)` for `(?:the app|Android|iOS Sim)`
    // shifts every later m[n] by one, so each handler silently reads the WRONG
    // argument. The DOB step's later captures are what proves it did not.
    const m = matcherFor('Adam on the app picks DOB "2001-01-01" in "dob_field"');
    expect(m).toBeDefined();
    const groups = m.pattern.exec('Adam on the app picks DOB "2001-01-01" in "dob_field"');
    expect(groups[1]).toBe('Adam');
    expect(groups[2]).toBe('the app');
    expect(groups[3]).toBe('2001-01-01');
    expect(groups[4]).toBe('dob_field');
  });
});
