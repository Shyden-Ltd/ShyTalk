/**
 * SHY-0259 batch 3 — XCUITest locator construction.
 *
 * The device round-trip is proven by the journey corpus on real hardware. What
 * is proven HERE is the part that cannot be seen from a journey result: a
 * malformed XPath and a genuinely absent element both come back as "not
 * found", so a broken locator reads as a product finding forever.
 *
 * The nastiest case is quoting. XPath 1.0 has no escape character, and this
 * corpus contains names like `Selma's Saturday Sing-along` — an apostrophe
 * inside a single-quoted literal ends the literal early and yields either a
 * syntax error or, worse, a valid expression matching the wrong thing.
 */
const {
  xpathLiteral,
  xpathForText,
  xpathContainingText,
  xpathForButton,
  xpathForTextField,
  xpathForCardWithLabel,
  dumpHasText,
  dumpHasTextField,
} = require('../../scripts/drivers/ios-element-query');

describe('xpathLiteral — the quoting trap', () => {
  it('single-quotes ordinary text', () => {
    expect(xpathLiteral('Follow')).toBe("'Follow'");
  });

  it('switches to double quotes when the value contains an apostrophe', () => {
    // "Selma's Saturday Sing-along" is a real room name in this corpus.
    expect(xpathLiteral("Selma's room")).toBe('"Selma\'s room"');
  });

  it('falls back to concat() when the value contains BOTH quote kinds', () => {
    const lit = xpathLiteral(`Selma's "Saturday" room`);
    expect(lit.startsWith('concat(')).toBe(true);
    // Every apostrophe must be contributed as a separate "'" fragment, or the
    // expression is silently wrong rather than loudly broken.
    expect(lit).toContain(`"'"`);
  });

  it('always produces a WELL-FORMED XPath string expression', () => {
    // Counting raw quotes is the wrong invariant — "it's" is a perfectly valid
    // double-quoted literal that contains an unmatched apostrophe. What must
    // hold is that the DELIMITER never appears inside its own literal, which
    // is the thing that actually ends the string early.
    const wellFormed = (lit) => {
      if (lit.startsWith('concat(')) return lit.endsWith(')');
      const q = lit[0];
      if (q !== "'" && q !== '"') return false;
      if (!lit.endsWith(q)) return false;
      return !lit.slice(1, -1).includes(q);
    };
    for (const v of ['plain', "it's", 'say "hi"', `both ' and "`, 'Selma\'s "Saturday"']) {
      expect(wellFormed(xpathLiteral(v))).toBe(true);
    }
  });
});

describe('locators check every text-ish attribute', () => {
  it('matches by label, name AND value — they are not interchangeable', () => {
    // name is the accessibilityIdentifier, label is what a person reads, value
    // is a field's contents. Checking only name misses every button the corpus
    // refers to by its visible words, which is most of them.
    const xp = xpathForText('Follow');
    expect(xp).toContain('@label=');
    expect(xp).toContain('@name=');
    expect(xp).toContain('@value=');
  });

  it('offers a contains() variant for partial text', () => {
    expect(xpathContainingText('Sing-along')).toContain('contains(@label,');
  });

  it('restricts a button locator to tappable types', () => {
    // An unrestricted match hits the containing cell or a static text node,
    // and tapping those does nothing or activates the wrong row.
    const xp = xpathForButton('Follow');
    expect(xp).toContain('XCUIElementTypeButton');
    expect(xp).toContain('XCUIElementTypeCell');
  });

  it('covers all three editable field types', () => {
    const xp = xpathForTextField();
    expect(xp).toContain('XCUIElementTypeTextField');
    expect(xp).toContain('XCUIElementTypeTextView');
    // Secure fields matter: the sign-in password box is one, and omitting it
    // makes password entry silently impossible.
    expect(xp).toContain('XCUIElementTypeSecureTextField');
  });

  it('scopes a field locator to a tag when one is given', () => {
    expect(xpathForTextField('pm_messageInput')).toContain("@name='pm_messageInput'");
  });

  it('finds a card by prefix AND occupant, including a nested label', () => {
    const xp = xpathForCardWithLabel('userCard_', 'Alice');
    expect(xp).toContain("starts-with(@name, 'userCard_')");
    // The name often sits on a CHILD text node, not the cell itself.
    expect(xp).toContain('.//*');
  });

  it('quotes safely inside a card locator too', () => {
    expect(xpathForCardWithLabel('roomCard_', "Selma's")).toContain('"Selma\'s"');
  });
});

describe('dump assertions read real XCUITest source', () => {
  // Shape as XCUITest actually emits it.
  const SOURCE =
    `<XCUIElementTypeApplication name="ShyTalk">` +
    `<XCUIElementTypeButton type="XCUIElementTypeButton" name="follow_btn" label="Follow" enabled="true"/>` +
    `<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="pm_messageInput" value=""/>` +
    `<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Alice" name="userCard_Alice"/>` +
    `</XCUIElementTypeApplication>`;

  it('finds text in label, name or value', () => {
    expect(dumpHasText(SOURCE, 'Follow')).toBe(true);
    expect(dumpHasText(SOURCE, 'userCard_Alice')).toBe(true);
    expect(dumpHasText(SOURCE, 'NotPresent')).toBe(false);
  });

  it('is not fooled by regex metacharacters in the query', () => {
    expect(dumpHasText('<x label="Save (draft)"/>', 'Save (draft)')).toBe(true);
  });

  it('detects an editable field by type', () => {
    expect(dumpHasTextField(SOURCE)).toBe(true);
    expect(dumpHasTextField('<XCUIElementTypeApplication/>')).toBe(false);
  });

  it('is safe on an empty or absent dump', () => {
    expect(dumpHasText('', 'x')).toBe(false);
    expect(dumpHasText(null, 'x')).toBe(false);
    expect(dumpHasTextField(null)).toBe(false);
  });
});

describe('the iOS batch is attached and not placeholders', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../scripts/drivers/ios-appium-driver.js'),
    'utf8',
  );
  const BATCH_3 = [
    'iosTapNamedButton',
    'iosTapBareVerb',
    'iosTapQuotedTarget',
    'iosTapUserCard',
    'iosTapRoomCard',
    'iosTapSameRoom',
    'iosTypeText',
    'iosTypeAndSubmit',
    'iosTypeIntoConversationInput',
    'iosShowsNamedButton',
    'iosShowsPlaceholder',
    'iosShowsMessageInput',
    'iosIsOnConversationWith',
    'iosOpenScreen',
    'iosOpenTab',
    'iosOpenListView',
    'iosOpenConversation',
    'iosConfirmDialog',
    'iosConfirm',
    'iosAcceptLegalAndContinue',
    'iosAttemptAction',
    'iosOpenDeepLink',
    'iosRelaunchAndSignIn',
    'iosRefreshRoomsList',
  ];

  it.each(BATCH_3)('%s is defined on the driver', (name) => {
    expect(SRC).toMatch(new RegExp(`driver\\.${name}\\s*=`));
  });

  it('none is a stub', () => {
    for (const name of BATCH_3) {
      const at = SRC.indexOf(`driver.${name} =`);
      expect(SRC.slice(at, at + 300)).not.toMatch(/'stub:|TODO|not implemented/i);
    }
  });
});

describe('batch 6 — the rest of the iOS surface', () => {
  // SRC is scoped to the sibling describe above; re-read it here rather than
  // reaching across scopes, which is what broke this block on first write.
  const fs2 = require('fs');
  const path2 = require('path');
  const SRC = fs2.readFileSync(
    path2.join(__dirname, '../../scripts/drivers/ios-appium-driver.js'),
    'utf8',
  );
  const BATCH_6 = [
    'iosAttemptProfileDeepLink',
    'iosEditBodyAndConfirm',
    'iosPickDOB',
    'iosSendGift',
    'iosSeatGridState',
    'iosShowsBannerFromUser',
    'iosShowsAdultCohortVisitor',
    'iosShowsNewFollowerNotification',
    'iosShowsStatsForUser',
    'iosShowsTranslationOf',
    'iosShowsCohortChangeBanner',
    'iosShowsPmWithBadge',
    'iosShowsTabWithNoNavTo',
    'iosNetworkLinkConditioner',
    'iosNetworkDropFor',
    'iosReceiveLiveKitToken',
  ];

  it.each(BATCH_6)('%s is defined on the driver', (name) => {
    expect(SRC).toMatch(new RegExp(`driver\\.${name}\\s*=`));
  });

  it('none is a stub', () => {
    for (const name of BATCH_6) {
      const at = SRC.indexOf(`driver.${name} =`);
      expect(SRC.slice(at, at + 300)).not.toMatch(/'stub:|TODO|not implemented/i);
    }
  });

  it('network conditioning REPORTS its capability instead of silently no-opping', () => {
    // iOS exposes link conditioning only through Developer settings; it cannot
    // be synthesised from the host. A silent no-op would let a connectivity
    // scenario pass having tested nothing about connectivity — the exact
    // shape of false confidence this whole story exists to remove.
    const at = SRC.indexOf('driver.iosNetworkLinkConditioner');
    const body = SRC.slice(at, at + 700);
    expect(body).toContain('supported: false');
    expect(body).toContain('why:');
  });

  it('iosShowsTabWithNoNavTo checks BOTH halves', () => {
    // A one-sided check is satisfied by a tab that is simply absent, which is
    // a different bug entirely.
    const at = SRC.indexOf('driver.iosShowsTabWithNoNavTo');
    const body = SRC.slice(at, at + 500);
    expect(body).toContain('dumpHasText');
    expect(body).toContain('iosOpenTab');
  });

  it('parses the iOS seat grid from name + label, which are separate attributes', () => {
    // Unlike Android, where both can ride on `text`, XCUITest puts the seat id
    // on @name and the occupant on @label. Reading only one yields empty seats.
    const at = SRC.indexOf('driver.iosSeatGridState');
    const body = SRC.slice(at, at + 600);
    expect(body).toContain('name="seat_');
    expect(body).toContain('label=');
  });
});
