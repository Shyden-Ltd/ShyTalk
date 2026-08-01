/**
 * SHY-0259 batch 1 — Android interaction methods the corpus already assumed.
 *
 * Operator 2026-08-01: "fix the missing driver methods."
 *
 * Measured before this batch: 179 of the 217 driver methods the runner can
 * call did not exist anywhere in scripts/drivers/. Scenarios failed with
 * `ctx.uiDriver.androidTapNamedButton not configured` — a harness gap that
 * reads exactly like a product defect in a matrix report, which is why a
 * gauntlet run could not be used as a quality signal at all.
 *
 * WHAT IS UNDER TEST HERE: the targeting logic — given a real uiautomator
 * dump, does the method find the right element and tap the right pixel? That
 * is pure logic over test DATA, so it belongs in a unit location. The dump
 * fixture is a REAL capture from the connected CPH2653 (tests/fixtures/
 * android/real-ui-dump.xml), not an invention: attribute order, the
 * `androidx.compose.ui.platform.ComposeView` wrapper and the empty
 * `resource-id=""` nodes are all exactly what the device emits.
 *
 * The device round-trip itself is proven by the journey corpus on real
 * hardware, per the repo's real-only rule — not re-simulated here.
 */
const fs = require('fs');
const path = require('path');

const REAL_DUMP = fs.readFileSync(
  path.join(__dirname, '../fixtures/android/real-ui-dump.xml'),
  'utf8',
);

// A dump in the device's exact emitted shape, carrying the elements this batch
// targets. Attribute order copied from the real capture above.
const node = ({ text = '', id = '', desc = '', cls = 'android.view.View', bounds, hint = '' }) =>
  `<node index="0" text="${text}" resource-id="${id}" class="${cls}" ` +
  `package="com.shyden.shytalk.local" content-desc="${desc}" checkable="false" ` +
  `clickable="true" enabled="true" bounds="${bounds}" hint="${hint}" />`;

const DUMP =
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
  node({
    id: 'com.shyden.shytalk.local:id/userCard_Alice',
    text: 'Alice',
    bounds: '[0,100][400,200]',
  }) +
  node({ text: 'Follow', bounds: '[500,100][700,160]' }) +
  node({ desc: 'Send gift', bounds: '[800,100][900,160]' }) +
  node({ id: 'pm_messageInput', cls: 'android.widget.EditText', bounds: '[0,900][1440,980]' }) +
  node({ id: 'tab_rooms', text: 'Rooms', bounds: '[0,3000][360,3100]' }) +
  `</hierarchy>`;

describe('the fixture is a genuine device capture', () => {
  it('is real uiautomator XML from the connected phone', () => {
    expect(REAL_DUMP).toMatch(/^<\?xml version='1\.0'/);
    expect(REAL_DUMP).toContain('package="com.shyden.shytalk.local"');
    expect(REAL_DUMP).toContain('androidx.compose.ui.platform.ComposeView');
  });

  it('records that the app was on the DEGRADED screen when captured', () => {
    // Worth pinning: the phone could not reach the local stack at capture
    // time (the known "-PlocalHost" build issue). Anyone reusing this fixture
    // must know it shows an error screen, not a signed-in session.
    expect(REAL_DUMP).toContain('degraded_title');
  });
});

describe('centreOf — where a tap actually lands', () => {
  // The REAL implementation the driver calls. Previously this test carried a
  // local copy of the logic, which would have passed happily while the
  // driver's own version was broken — a test testing itself.
  const {
    centreOf,
    centreOfTag,
    centreOfCardWithLabel,
    dumpHas,
    hasEditableField,
    escapeInputText,
  } = require('../../scripts/drivers/ui-dump-query');

  it('taps the CENTRE of the element, not a corner', () => {
    // A corner tap lands on the neighbouring view often enough to be flaky.
    expect(centreOf(DUMP, 'text', 'Follow')).toEqual({ cx: 600, cy: 130 });
  });

  it('finds an icon-only control by content-desc', () => {
    expect(centreOf(DUMP, 'content-desc', 'Send gift')).toEqual({ cx: 850, cy: 130 });
  });

  it('returns null rather than a guess when the element is absent', () => {
    // Guessing a coordinate would tap something arbitrary and report success.
    expect(centreOf(DUMP, 'text', 'NotPresent')).toBeNull();
  });

  it('is not fooled by a regex metacharacter in the label', () => {
    const d = node({ text: 'Save (draft)', bounds: '[0,0][100,100]' });
    expect(centreOf(d, 'text', 'Save (draft)')).toEqual({ cx: 50, cy: 50 });
  });

  it('matches a tag whether the dump gives it short or fully-qualified', () => {
    // uiautomator emits the package-qualified form; the corpus writes the short
    // one. Matching only one of them finds nothing on real hardware.
    expect(centreOfTag(DUMP, 'userCard_Alice')).toEqual({ cx: 200, cy: 150 });
    expect(centreOfTag(DUMP, 'tab_rooms')).toEqual({ cx: 180, cy: 3050 });
  });

  it('finds the card bearing a particular person, not just any card', () => {
    expect(centreOfCardWithLabel(DUMP, 'userCard_', 'Alice')).toEqual({ cx: 200, cy: 150 });
    expect(centreOfCardWithLabel(DUMP, 'userCard_', 'Nobody')).toBeNull();
  });

  it('reads a label from text, content-desc OR hint', () => {
    expect(dumpHas(DUMP, 'Follow')).toBe(true);
    expect(dumpHas(DUMP, 'Send gift')).toBe(true);
    expect(dumpHas(DUMP, 'Absent')).toBe(false);
  });

  it('detects the composer by tag or by an EditText with no id', () => {
    // Compose renders the composer without a resource-id on some screens, so
    // tag-only detection reports "no input" on a screen that plainly has one.
    expect(hasEditableField(DUMP)).toBe(true);
    expect(hasEditableField('<hierarchy></hierarchy>')).toBe(false);
    expect(hasEditableField(node({ cls: 'android.widget.EditText', bounds: '[0,0][10,10]' }))).toBe(
      true,
    );
  });

  it('is safe on an empty or absent dump', () => {
    expect(centreOf('', 'text', 'x')).toBeNull();
    expect(centreOf(null, 'text', 'x')).toBeNull();
    expect(dumpHas(null, 'x')).toBe(false);
  });

  it('encodes spaces for `input text` and touches nothing else', () => {
    // It used to POSIX-escape apostrophes too, and this test asserted that.
    // The escaping was for the HOST shell, which adb() no longer uses — and
    // it never reached the DEVICE shell, so "Selma's room" failed on the
    // phone with `/system/bin/sh: no closing quote` while this test was
    // green. Quoting now lives in device-shell.js; doing it here as well
    // would double-escape and type the escape sequence.
    expect(escapeInputText("Selma's room")).toBe("Selma's%sroom");
    expect(escapeInputText('hello world')).toBe('hello%sworld');
    expect(escapeInputText('plain')).toBe('plain');
  });
});

describe('androidTypeText — text reaches the device intact', () => {
  /**
   * THIS BLOCK USED TO TEST ITS OWN COPY OF THE LOGIC.
   *
   *   const escape = (t) => String(t).replace(/'/g, `'\\''`).replace(/ /g, '%s');
   *
   * It defined the rule locally and asserted on that, so it passed no matter
   * what the driver did — and the driver was broken: the escaping targeted
   * the HOST shell, while `adb shell` hands everything to a shell ON THE
   * DEVICE. Verified 2026-08-01 against the connected phone,
   * `/system/bin/sh: no closing quote`.
   *
   * Now it calls the real functions, composed the way production composes
   * them, so a regression in either one fails here.
   */
  const { escapeInputText: encode } = require('../../scripts/drivers/ui-dump-query');
  const { deviceShellArg } = require('../../scripts/drivers/device-shell');

  /** Exactly what the driver builds for `adb shell input text <arg>`. */
  const asDriverSends = (t) => deviceShellArg(encode(t));

  it('quotes the apostrophe that used to break the device shell', () => {
    expect(asDriverSends("Selma's room")).toBe(`'Selma'\\''s%sroom'`);
  });

  it('encodes spaces, which `input text` would otherwise split on', () => {
    expect(asDriverSends('hello world')).toBe("'hello%sworld'");
  });

  it('leaves ordinary text untouched apart from the quoting', () => {
    expect(asDriverSends('hello')).toBe("'hello'");
  });

  it('does not double-escape — the escape sequence must not be typed', () => {
    // If encode() started escaping apostrophes again, the user would see
    // literal backslashes and quotes appear in the field.
    expect(encode("it's")).toBe("it's");
  });
});

describe('every batch-1 method is actually attached to the driver', () => {
  // The failure this whole story is about was "not configured" — a name the
  // runner calls that the driver never defines. This is the check that the
  // gap is genuinely closed for these, and it fails loudly if one is renamed.
  const BATCH_1 = [
    'androidTapUserCard',
    'androidTapNamedButton',
    'androidTapBareVerb',
    'androidTapSameRoom',
    'androidTypeText',
    'androidTypeAndSubmit',
    'androidTypeIntoConversationInput',
    'androidShowsNamedButton',
    'androidShowsPlaceholder',
    'androidShowsMessageInput',
    'androidOpenTab',
    'androidOpenListView',
    'androidConfirm',
  ];

  it.each(BATCH_1)('%s exists in the driver source', (name) => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../scripts/drivers/android-adb-driver.js'),
      'utf8',
    );
    expect(src).toMatch(new RegExp(`driver\\.${name}\\s*=`));
  });

  it('none of them is a stub — the repo forbids placeholders outside unit tests', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../scripts/drivers/android-adb-driver.js'),
      'utf8',
    );
    for (const name of BATCH_1) {
      const body = src.slice(src.indexOf(`driver.${name} =`));
      expect(body.slice(0, 400)).not.toMatch(/'stub:|TODO|not implemented/i);
    }
  });
});

/**
 * Batch 5 — composites, attempt-verbs and parsing.
 *
 * The parsing is tested for real here; the device round-trip is proven by the
 * journey corpus on hardware. What could not be seen from a journey result is
 * a parser that returns plausible-but-wrong structure, so that is what is
 * pinned.
 */
describe('seat-grid parsing', () => {
  const { parseSeatGrid } = require('../../scripts/drivers/ui-dump-query');

  const seat = (i, occupant) =>
    node({ id: `seat_${i}`, text: occupant || '', bounds: `[0,${i * 100}][100,${i * 100 + 90}]` });

  it('reads each seat and its occupant', () => {
    const dump = `<hierarchy>${seat(0, 'Theo')}${seat(1, '')}${seat(2, 'Alice')}</hierarchy>`;
    expect(parseSeatGrid(dump)).toEqual([
      { index: 0, occupant: 'Theo' },
      { index: 1, occupant: null },
      { index: 2, occupant: 'Alice' },
    ]);
  });

  it('reports an EMPTY seat as null, not as an empty string', () => {
    // A caller checking `if (seat.occupant)` must see empty and absent alike;
    // '' is truthy in some comparisons and would read as occupied.
    expect(parseSeatGrid(`<hierarchy>${seat(3, '')}</hierarchy>`)[0].occupant).toBeNull();
  });

  it('returns seats in index order regardless of dump order', () => {
    const dump = `<hierarchy>${seat(2, 'C')}${seat(0, 'A')}${seat(1, 'B')}</hierarchy>`;
    expect(parseSeatGrid(dump).map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('ignores non-seat nodes entirely', () => {
    const dump = `<hierarchy>${node({ id: 'roomTitle', text: 'seat_9', bounds: '[0,0][1,1]' })}</hierarchy>`;
    // A node whose TEXT merely mentions a seat id must not become a seat.
    expect(parseSeatGrid(dump)).toEqual([]);
  });

  it('returns [] rather than throwing when the screen has not rendered', () => {
    // Mid-journey this is normal, not an error; throwing would fail a scenario
    // for a timing artefact.
    expect(parseSeatGrid(null)).toEqual([]);
    expect(parseSeatGrid('')).toEqual([]);
  });
});

describe('layout direction', () => {
  const { parseLayoutDirection } = require('../../scripts/drivers/ui-dump-query');

  it('detects rtl from the marker the app sets', () => {
    expect(parseLayoutDirection('<node rtl_marker="1"/>')).toBe('rtl');
    expect(parseLayoutDirection('<node layout-direction="rtl"/>')).toBe('rtl');
  });

  it('defaults to ltr, including on a blank dump', () => {
    // Guessing rtl would pass an RTL assertion against a screen that never
    // rendered — a false green on an i18n check.
    expect(parseLayoutDirection('<node/>')).toBe('ltr');
    expect(parseLayoutDirection(null)).toBe('ltr');
  });
});

describe('batch 5 is attached and honest', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../scripts/drivers/android-adb-driver.js'),
    'utf8',
  );
  const BATCH_5 = [
    'androidAttemptAction',
    'androidAttemptBlock',
    'androidAttemptFollowViaProfile',
    'androidAttemptStartConversation',
    'androidAttemptProfileDeepLink',
    'androidOpenDeepLink',
    'androidOpenConversation',
    'androidIsOnConversationWith',
    'androidSendMessageTo',
    'androidLongPressMessageAndTap',
    'androidEditBodyAndConfirm',
    'androidAcceptLegalAndContinue',
    'androidPickDOB',
    'androidSignupWithDOB',
    'androidPickIdType',
    'androidSelectGalleryImage',
    'androidPickTestImageBySize',
    'androidSelectGiftRecipient',
    'androidSelectFromFollowedPicker',
    'androidSendGift',
    'androidCreateRoomComposite',
    'androidRefreshRoomsList',
    'androidTapEventInviteAction',
    'androidRetrySamePurchase',
    'androidRelaunchAndSignIn',
    'androidForceRefreshJwt',
    'androidForceRefreshSecureToken',
    'androidGetLayoutDirection',
    'androidShowsBannerFromUser',
    'androidShowsCohortChangeBanner',
    'androidShowsAdultCohortVisitor',
    'androidShowsNewFollowerNotification',
    'androidShowsStatsForUser',
    'androidShowsTranslationOf',
    'androidShowsPmWithBadge',
    'androidShowsTabWithNoNavTo',
    'androidSeatGridState',
  ];

  it.each(BATCH_5)('%s is defined', (name) => {
    expect(SRC).toMatch(new RegExp(`driver\\.${name}\\s*=`));
  });

  it('a long-press outlasts the system threshold', () => {
    // A swipe shorter than ~500ms registers as an ordinary tap, the context
    // menu never opens, and the following step fails for the wrong reason.
    // Format-independent on purpose: prettier wraps the argument array, and a
    // regex that pinned the layout would fail on a reformat while the
    // behaviour was untouched.
    const at = SRC.indexOf('driver.androidLongPressMessageAndTap');
    const body = SRC.slice(at, at + 900);
    const durations = [...body.matchAll(/'(\d{3,})'/g)].map((m) => Number(m[1]));
    expect(Math.max(0, ...durations)).toBeGreaterThanOrEqual(500);
  });

  it('attempt-verbs report actuation separately from permission', () => {
    // The corpus uses these where refusal is EXPECTED. Returning a bare false
    // for "blocked" would make a working safety gate look like a driver fault.
    const at = SRC.indexOf('driver.androidAttemptAction');
    expect(SRC.slice(at, at + 200)).toContain('attempted: true');
    expect(SRC.slice(at, at + 200)).toContain('actuated');
  });

  it('deep links go through am start, exercising the real intent filters', () => {
    const at = SRC.indexOf('driver.androidOpenDeepLink');
    expect(SRC.slice(at, at + 400)).toContain('android.intent.action.VIEW');
  });

  it('none of batch 5 is a stub', () => {
    for (const name of BATCH_5) {
      const at = SRC.indexOf(`driver.${name} =`);
      expect(SRC.slice(at, at + 300)).not.toMatch(/'stub:|TODO|not implemented/i);
    }
  });
});
