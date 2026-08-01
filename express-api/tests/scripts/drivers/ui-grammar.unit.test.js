/**
 * The two dump grammars, against REAL captured dumps.
 *
 * Both fixtures are real device output: `android-dump-picker.xml` from the
 * connected Android phone, `ios-dump-signin.xml` pulled off the connected
 * iPhone through Appium's /source endpoint on 2026-08-02. They show the SAME
 * screen, which is what makes the parity block below meaningful — the same
 * query, asked of two platforms' rendering of one screen, must give one answer.
 *
 * That parity is the whole point of this module: it is what lets a journey
 * scenario say "on the app" instead of "on Android".
 *
 * These are unit tests over pure functions — the dumps are captured DATA, not a
 * mocked collaborator, so the real-only rule is satisfied without a device.
 */
const fs = require('fs');
const path = require('path');

const {
  ANDROID_GRAMMAR,
  IOS_GRAMMAR,
  createDumpQueries,
} = require('../../../scripts/drivers/ui-grammar');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const ANDROID_SIGNIN = fixture('android-dump-picker.xml');
const ANDROID_MAIN = fixture('android-dump-main.xml');
const IOS_SIGNIN = fixture('ios-dump-signin.xml');

const android = createDumpQueries(ANDROID_GRAMMAR);
const ios = createDumpQueries(IOS_GRAMMAR);

describe('the same screen answers the same on both platforms', () => {
  // Each case is a question the journey corpus actually asks. If any of these
  // diverges the corpus cannot be platform-neutral, so they are asserted as one
  // table rather than as separate tests.
  const bothWays = [
    ['a tag that is present', (q, d) => q.hasTag(d, 'signIn_googleButton'), true],
    ['a tag that is absent', (q, d) => q.hasTag(d, 'room_micToggleButton'), false],
    ['a tag prefix that is present', (q, d) => q.hasTagPrefix(d, 'signIn_'), true],
    ['a tag prefix that is absent', (q, d) => q.hasTagPrefix(d, 'adminStat_'), false],
    ['visible text that is present', (q, d) => q.hasText(d, 'Sign in with Google'), true],
    ['visible text that is absent', (q, d) => q.hasText(d, 'Leave room'), false],
  ];

  test.each(bothWays)('%s', (_label, ask, expected) => {
    expect(ask(android, ANDROID_SIGNIN)).toBe(expected);
    expect(ask(ios, IOS_SIGNIN)).toBe(expected);
  });

  test('both find a tappable centre INSIDE the button, not at a corner', () => {
    // A corner tap lands on the neighbouring view often enough to be flaky, so
    // the centre is asserted against the element's own real bounds.
    const a = android.centreOfTag(ANDROID_SIGNIN, 'signIn_googleButton');
    // bounds="[112,1461][1328,1629]"
    expect(a).toEqual({ cx: 720, cy: 1545 });

    const i = ios.centreOfTag(IOS_SIGNIN, 'signIn_googleButton');
    // x="32" y="433" width="356" height="48"
    expect(i).toEqual({ cx: 210, cy: 457 });
  });

  test('an absent tag yields null on both — never a guessed coordinate', () => {
    // Returning a default coordinate would tap something arbitrary and then
    // report success, which is the failure mode this whole layer exists to stop.
    expect(android.centreOfTag(ANDROID_SIGNIN, 'nope_missing')).toBeNull();
    expect(ios.centreOfTag(IOS_SIGNIN, 'nope_missing')).toBeNull();
  });
});

describe('tag lookup is anchored', () => {
  test('a tag is not matched by a longer tag that merely starts with it', () => {
    // `hasTag` is exact. Without the anchor, asserting `seat_1` would pass on a
    // screen showing only `seat_10`.
    expect(android.hasTag(ANDROID_SIGNIN, 'signIn_google')).toBe(false);
    expect(ios.hasTag(IOS_SIGNIN, 'signIn_google')).toBe(false);
    expect(ios.hasTagPrefix(IOS_SIGNIN, 'signIn_google')).toBe(true);
  });

  test('on iOS a tag lookup does not match an element whose LABEL contains it', () => {
    // The iOS-specific trap: an untagged element repeats its visible text in
    // `name`, so `name` means "tag OR text". An unanchored search would let a
    // button labelled "Sign in with Google" satisfy a lookup for a tag.
    expect(ios.hasTag(IOS_SIGNIN, 'Sign in with Google')).toBe(true); // it IS a name
    expect(ios.hasTagPrefix(IOS_SIGNIN, 'in with Google')).toBe(false); // not a prefix
  });

  test('android matches a short tag against a package-qualified resource-id', () => {
    // The corpus names `action_bar_root`; the device emits
    // `com.shyden.shytalk.local:id/action_bar_root`.
    expect(android.hasTag(ANDROID_SIGNIN, 'action_bar_root')).toBe(true);
  });

  test('regex metacharacters in a tag are matched literally, not as a pattern', () => {
    // `.` in a tag would otherwise match any character and pass on a near-miss.
    expect(android.hasTag(ANDROID_SIGNIN, 'signIn.googleButton')).toBe(false);
    expect(ios.hasTag(IOS_SIGNIN, 'signIn.googleButton')).toBe(false);
  });
});

describe('absent input is answered, never thrown', () => {
  // A dump can legitimately be '' mid-journey — the screen has not rendered, or
  // the device call was bounded out. Throwing here would fail the scenario for a
  // timing artefact; answering false lets the caller's own wait retry.
  test.each([
    ['', 'empty dump'],
    [null, 'null dump'],
    [undefined, 'undefined dump'],
  ])('%s: every query answers falsy', (dump) => {
    for (const q of [android, ios]) {
      expect(q.hasTag(dump, 'x')).toBe(false);
      expect(q.hasTagPrefix(dump, 'x')).toBe(false);
      expect(q.hasText(dump, 'x')).toBe(false);
      expect(q.centreOfTag(dump, 'x')).toBeNull();
      expect(q.elements(dump)).toEqual([]);
      expect(q.seatGrid(dump)).toEqual([]);
      expect(q.allText(dump)).toEqual([]);
    }
  });

  test.each([null, undefined, ''])('an absent TAG answers false, not a wildcard match', (tag) => {
    // A blank tag must never match everything: a scenario whose tag went missing
    // would otherwise pass against any screen at all.
    expect(android.hasTag(ANDROID_SIGNIN, tag)).toBe(false);
    expect(android.hasTagPrefix(ANDROID_SIGNIN, tag)).toBe(false);
    expect(ios.hasTag(IOS_SIGNIN, tag)).toBe(false);
    expect(ios.hasTagPrefix(IOS_SIGNIN, tag)).toBe(false);
    expect(ios.hasText(IOS_SIGNIN, tag)).toBe(false);
  });
});

describe('elements are counted individually', () => {
  test('android counts each tagged node once', () => {
    expect(android.countTagPrefix(ANDROID_MAIN, 'main_')).toBe(4);
    expect(android.countTagPrefix(ANDROID_MAIN, 'roomList_')).toBe(1);
  });

  test('iOS nests, so only OPENING tags are counted — not whole subtrees', () => {
    // The trap: XCUITest containers nest and every `Other` wrapper spans the
    // full screen. Matching a subtree would attribute a child's tag to its
    // parent and count one button many times.
    expect(ios.countTagPrefix(IOS_SIGNIN, 'signIn_')).toBe(2);
    expect(ios.countTagPrefix(IOS_SIGNIN, 'persona_picker_')).toBe(1);
  });

  test('an absent prefix counts zero', () => {
    expect(android.countTagPrefix(ANDROID_MAIN, 'nope_')).toBe(0);
    expect(ios.countTagPrefix(IOS_SIGNIN, 'nope_')).toBe(0);
  });
});

describe('tag AND text together', () => {
  test('finds the element carrying both, and rejects a pair that is split', () => {
    // The real question is "the card FOR Alice", so a screen where the tag and
    // the text exist on DIFFERENT elements must not satisfy it.
    expect(ios.hasTagPrefixWithText(IOS_SIGNIN, 'signIn_', 'Sign in with Google')).toBe(true);
    expect(ios.hasTagPrefixWithText(IOS_SIGNIN, 'signIn_', 'Sign in as test persona')).toBe(false);
    expect(ios.hasTagPrefixWithText(IOS_SIGNIN, 'persona_picker_', 'Sign in as test persona')).toBe(
      true,
    );
  });

  test('the centre returned is the MATCHING element, not the first tagged one', () => {
    // `signIn_googleButton` precedes `signIn_appleButton`; asking for the Apple
    // one must not return Google's coordinates.
    const apple = ios.centreOfTagPrefixWithText(IOS_SIGNIN, 'signIn_', 'Sign in with Apple');
    const google = ios.centreOfTagPrefixWithText(IOS_SIGNIN, 'signIn_', 'Sign in with Google');
    expect(apple).not.toEqual(google);
    expect(apple.cy).toBeGreaterThan(google.cy);
  });

  test('a missing half yields null on both platforms', () => {
    expect(ios.centreOfTagPrefixWithText(IOS_SIGNIN, 'signIn_', 'Nonexistent')).toBeNull();
    expect(ios.centreOfTagPrefixWithText(IOS_SIGNIN, 'nope_', 'Sign in with Apple')).toBeNull();
    expect(android.centreOfTagPrefixWithText(ANDROID_SIGNIN, 'signIn_', 'Nope')).toBeNull();
  });
});

describe('reading the screen', () => {
  test('iOS reports the real visible strings', () => {
    const text = ios.allText(IOS_SIGNIN);
    expect(text).toContain('Voice chat rooms, reimagined.');
    expect(text).toContain('Sign in with Apple');
  });

  test('text is deduplicated — a label repeated on a button and its child counts once', () => {
    // XCUITest emits the button AND its StaticText child with the same label.
    const text = ios.allText(IOS_SIGNIN);
    expect(text.filter((t) => t === 'Sign in with Google')).toHaveLength(1);
  });

  test('an editable field is detected by its element type on iOS', () => {
    // The sign-in screen has none; asserting false here pins that the detector
    // is not simply answering true.
    expect(ios.hasEditableField(IOS_SIGNIN)).toBe(false);
    expect(ios.hasEditableField('<XCUIElementTypeTextField name="x" />')).toBe(true);
    expect(ios.hasEditableField('<XCUIElementTypeSecureTextField name="x" />')).toBe(true);
  });

  test('a disabled control is distinguished from an absent one', () => {
    // "Absent" and "present but disabled" are different facts, and a check that
    // conflated them would pass a scenario asserting an input was locked out
    // simply because the screen had not rendered.
    const dump =
      '<XCUIElementTypeButton name="send_button" enabled="false" x="0" y="0" width="10" height="10" />';
    expect(ios.isTagDisabled(dump, 'send_button')).toBe(true);
    expect(ios.isTagDisabled(dump, 'other_button')).toBe(false);
    expect(ios.isTagDisabled(IOS_SIGNIN, 'signIn_googleButton')).toBe(false);
  });
});

describe('the seat grid', () => {
  const iosSeats = [
    '<XCUIElementTypeOther name="seat_0" label="Tariq" x="0" y="0" width="10" height="10" />',
    '<XCUIElementTypeOther name="seat_2" label="Selma" x="0" y="20" width="10" height="10" />',
    '<XCUIElementTypeOther name="seat_1" label="" x="0" y="10" width="10" height="10" />',
  ].join('\n');

  test('parses occupants and returns them in seat order, not document order', () => {
    expect(ios.seatGrid(iosSeats)).toEqual([
      { index: 0, occupant: 'Tariq' },
      { index: 1, occupant: null },
      { index: 2, occupant: 'Selma' },
    ]);
  });

  test('an empty seat is null, not the empty string', () => {
    // Callers test truthiness to mean "occupied"; '' is falsy but would compare
    // unequal to null in an assertion, so it is normalised here.
    const [, empty] = ios.seatGrid(iosSeats);
    expect(empty.occupant).toBeNull();
  });

  test('a tag that merely starts with seat_ is not a seat', () => {
    // `seatRequest_` shares the prefix and is a different control entirely.
    const dump =
      '<XCUIElementTypeOther name="seatRequest_alice" label="Alice" x="0" y="0" width="4" height="4" />';
    expect(ios.seatGrid(dump)).toEqual([]);
  });
});
