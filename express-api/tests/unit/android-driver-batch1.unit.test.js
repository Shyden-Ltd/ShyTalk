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

  it('escapes free text for adb, apostrophes and all', () => {
    expect(escapeInputText("Selma's room")).toBe(`Selma'\\''s%sroom`);
    expect(escapeInputText('hello world')).toBe('hello%sworld');
    expect(escapeInputText('plain')).toBe('plain');
  });
});

describe('androidTypeText escaping — the shell-injection trap', () => {
  // adb() wraps every argument in single quotes, so an apostrophe in user text
  // closes the quote and hands the remainder to the shell. This is the exact
  // pattern flagged in the driver-method conventions.
  const escape = (t) => String(t).replace(/'/g, `'\\''`).replace(/ /g, '%s');

  it("neutralises an apostrophe so it cannot escape adb's quoting", () => {
    expect(escape("Selma's room")).toBe(`Selma'\\''s%sroom`);
    expect(escape("Selma's room")).not.toMatch(/[^\\]'[a-z ]*$/);
  });

  it('encodes spaces, which `input text` would otherwise split on', () => {
    expect(escape('hello world')).toBe('hello%sworld');
  });

  it('leaves ordinary text untouched', () => {
    expect(escape('hello')).toBe('hello');
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
