/**
 * An assertion must assert something about ITS SUBJECT.
 *
 * Operator 2026-08-01: "viewing a screen isn't enough, you need to test the
 * functionalities behave as expected."
 *
 * THE SHAPE OF THE PROBLEM. A driver assertion is handed the thing it is
 * supposed to check, and throws it away:
 *
 *   driver.androidShowsCountBadge = async (_name, _delta, _label) => {
 *     const dump = await driver.androidUiDump();
 *     return /resource-id="(?:[^"]*:id\/)?countBadge_[^"]*"/.test(dump);
 *   };
 *
 * The scenario says "Bea's badge shows +3 stalkers". The assertion says "a
 * badge exists somewhere on screen". It passes when the count is wrong, when
 * the badge belongs to someone else, when the delta is negative, and when the
 * feature is broken in every way except being rendered at all.
 *
 * MEASURED on 2026-08-01: 28 of 49 Android assertions — 57% — ignored EVERY
 * argument they were given. `androidShowsToastAndNavigates` took four and used
 * none of them.
 *
 * This is worse than an uncovered screen. An uncovered screen is a known gap;
 * this is a green tick over a question nobody asked, and it is indistinguishable
 * from real coverage on every dashboard and report we have.
 *
 * WHY A RATCHET RATHER THAN A FLAT BAN. 28 methods cannot be rewritten in one
 * change without the rewrite itself going unreviewed. So the list below is
 * frozen and may only SHRINK — the same mechanism `check-no-direct-backend.js`
 * uses for the backend-access debt. Adding a new argument-ignoring assertion
 * fails immediately; fixing one and forgetting to remove it from the list also
 * fails, so the list cannot rot into decoration.
 */
const fs = require('fs');
const path = require('path');

const DRIVERS = path.join(__dirname, '../../scripts/drivers');

/**
 * Assertions that answer a question about a named subject. `Shows`/`Is`/`Has`
 * take the subject as an argument; a method with no arguments makes no claim
 * about a specific one and is out of scope.
 */
const ASSERTION_PREFIX = /^(Shows|Is|Has|Displays|Sees)/;

function assertionsIgnoringEveryArgument(file, prefix) {
  const src = fs.readFileSync(path.join(DRIVERS, file), 'utf8');
  const offenders = [];
  const re = new RegExp(
    `^[ \\t]*driver\\.(${prefix}[A-Za-z0-9_]*)\\s*=\\s*async\\s*\\(([^)]*)\\)`,
    'gm',
  );
  for (const m of src.matchAll(re)) {
    const [, name, rawArgs] = m;
    if (!ASSERTION_PREFIX.test(name.replace(new RegExp(`^${prefix}`), ''))) continue;
    const args = rawArgs
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    // The FIRST argument is the viewer ("Adam's Android UI shows…"). A driver
    // owns exactly one device, so the viewer is already implied and ignoring it
    // is correct — `androidShowsMessageInConversationThread(_name)` is not
    // hollow, it simply has no subject beyond "the thread that is open".
    //
    // What must never be ignored are the arguments describing WHAT should be
    // shown. Flagging the viewer too made the first version of this check
    // report three methods as regressions the moment they were fixed.
    const subject = args.slice(1);
    if (subject.length === 0) continue;
    if (subject.every((a) => a.startsWith('_'))) offenders.push(name);
  }
  return offenders.sort();
}

/**
 * FROZEN 2026-08-01. This list may only get SHORTER.
 *
 * Each entry is an assertion that takes a subject and checks something else —
 * usually "does a tag with this prefix exist anywhere on screen". Removing an
 * entry means the method now uses its arguments; adding one is a regression.
 */
// NOTE. Eleven entries left this list when the rule was tightened to subject
// arguments — NOT because they were fixed. They take only a viewer, so this
// guard has nothing to say about them. Several still check a testTag the
// product never renders (roomClosedSummary_, rankings_, beansChart_,
// userCardSkeleton_), and THAT is caught by no-phantom-testtags.unit.test.js.
// Two guards, two questions: "does it check its subject" and "does the thing
// it checks exist". Neither subsumes the other.
const KNOWN_HOLLOW = [
  'androidShowsCountBadge',
  'androidShowsEditedBodyWithTag',
  'androidShowsFrozenBanner',
  'androidShowsInAppGiftNotification',
  'androidShowsInResults',
  'androidShowsNonEmptyLocaleText',
  'androidShowsOfficialBadge',
  'androidShowsOwnRankInTop',
  'androidShowsSeatRequestNotification',
  'androidShowsStalkersDelta',
  'androidShowsToastAndNavigates',
  'androidShowsToastAndNavigatesBack',
  'androidShowsWelcomePmInLanguage',
];

describe('the scan is real', () => {
  it('finds assertions at all', () => {
    // A regex that matched nothing would make the ratchet vacuously green while
    // the debt grew unchecked.
    const all = assertionsIgnoringEveryArgument('android-adb-driver.js', 'android');
    expect(all.length).toBeGreaterThan(0);
  });

  it('recognises an argument-using assertion as fine', () => {
    // `androidShowsBanner = async (_name, banner) => …` uses `banner`, so it
    // must NOT be flagged. Proves the detector distinguishes rather than
    // flagging every method with an underscore in its signature.
    const offenders = assertionsIgnoringEveryArgument('android-adb-driver.js', 'android');
    expect(offenders).not.toContain('androidShowsBanner');
  });
});

describe('the hollow-assertion debt may only shrink', () => {
  it('no NEW assertion ignores every argument it is given', () => {
    const offenders = assertionsIgnoringEveryArgument('android-adb-driver.js', 'android');
    const added = offenders.filter((n) => !KNOWN_HOLLOW.includes(n));
    // Named in the failure so the fix is obvious: use the arguments, or do not
    // take them.
    expect({ newHollowAssertions: added }).toEqual({ newHollowAssertions: [] });
  });

  it('the frozen list contains no entries that are already fixed', () => {
    // Stops the list rotting into decoration. A fixed method left on the list
    // makes the ratchet look tighter than it is.
    const offenders = assertionsIgnoringEveryArgument('android-adb-driver.js', 'android');
    const stale = KNOWN_HOLLOW.filter((n) => !offenders.includes(n));
    expect({ alreadyFixedButStillListed: stale }).toEqual({ alreadyFixedButStillListed: [] });
  });

  it('iOS has none, and must not acquire any', () => {
    // The iOS driver is younger and was written after this lesson; it uses
    // every argument it takes. Pinned so parity work does not import the
    // Android habit along with the Android method names.
    expect(assertionsIgnoringEveryArgument('ios-appium-driver.js', 'ios')).toEqual([]);
  });

  it('the web driver has none, and must not acquire any', () => {
    expect(assertionsIgnoringEveryArgument('web-playwright-driver.js', 'web')).toEqual([]);
  });
});

describe('the guard can fail', () => {
  it('detects a hollow assertion in a synthetic source', () => {
    // Mutation in miniature: without this, a broken regex would report an empty
    // offender list forever and every assertion above would pass vacuously.
    const tmp = path.join(DRIVERS, '.__hollow_probe.js');
    fs.writeFileSync(
      tmp,
      'driver.androidShowsThing = async (_a, _b) => true;\n' +
        'driver.androidShowsReal = async (_a, b) => b;\n',
    );
    try {
      const offenders = assertionsIgnoringEveryArgument('.__hollow_probe.js', 'android');
      expect(offenders).toEqual(['androidShowsThing']);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
