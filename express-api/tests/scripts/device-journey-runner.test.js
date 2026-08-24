/**
 * Unit tests for scripts/device-journey-runner.js — the PURE logic the
 * on-device journeys depend on:
 *   - parseNodes   (uiautomator XML -> node list, centre from bounds)
 *   - byId / byText / byTextContains   (selectors)
 *   - summarizeScreen  (failure-diagnostic snapshot)
 *   - arrayContains
 *   - parseArgs    (CLI parsing)
 *
 * Device driving, Firestore reads, and express-api calls are integration-
 * tested by running the runner against the real device + local stack; here
 * we lock the deterministic logic so journey additions can't silently
 * regress the parser or selectors.
 */

const {
  parseArgs,
  parseNodes,
  byId,
  byText,
  byTextContains,
  summarizeScreen,
  arrayContains,
} = require('../../scripts/device-journey-runner');

// A representative uiautomator dump: a real testTag node, a text-only node,
// a ticked checkbox, a node whose text is in content-desc, and a node with
// no bounds (so no centre).
const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8'?><hierarchy rotation="0">
<node index="0" text="" resource-id="main_roomsTab" class="android.view.View" clickable="true" enabled="true" checked="false" bounds="[0,2086][360,2178]" />
<node index="1" text="Rooms" resource-id="" content-desc="" clickable="false" enabled="true" bounds="[10,20][110,60]" />
<node index="2" text="" resource-id="legal_acceptTermsCheckbox" clickable="true" enabled="true" checked="true" bounds="[40,100][80,140]" />
<node index="3" text="Alice (P-02 adult power)" resource-id="" content-desc="Profile photo" bounds="[0,200][300,240]" />
<node index="4" text="nobounds" resource-id="noCentre" />
</hierarchy>`;

describe('parseNodes', () => {
  const nodes = parseNodes(SAMPLE_XML);

  it('extracts id/flags and computes centre from bounds', () => {
    const tab = byId(nodes, 'main_roomsTab');
    expect(tab).toBeTruthy();
    expect(tab.clickable).toBe(true);
    expect(tab.enabled).toBe(true);
    expect(tab.checked).toBe(false);
    expect(tab.center).toEqual({ x: 180, y: 2132 });
  });

  it('captures checked=true on a ticked checkbox', () => {
    expect(byId(nodes, 'legal_acceptTermsCheckbox').checked).toBe(true);
  });

  it('captures content-desc', () => {
    expect(nodes.some((n) => n.desc === 'Profile photo')).toBe(true);
  });

  it('sets center=null when bounds are missing', () => {
    const n = nodes.find((x) => x.id === 'noCentre');
    expect(n).toBeTruthy();
    expect(n.center).toBeNull();
  });

  it('returns [] for a hierarchy with no nodes', () => {
    expect(parseNodes('<hierarchy></hierarchy>')).toEqual([]);
  });

  it('does not choke on attribute values containing brackets/spaces', () => {
    const xml =
      '<hierarchy><node resource-id="r" text="a [b] c" bounds="[1,2][3,4]" /></hierarchy>';
    const n = parseNodes(xml)[0];
    expect(n.text).toBe('a [b] c');
    expect(n.center).toEqual({ x: 2, y: 3 });
  });
});

describe('selectors', () => {
  const nodes = parseNodes(SAMPLE_XML);

  it('byId matches resource-id only when the node has a centre', () => {
    expect(byId(nodes, 'main_roomsTab').id).toBe('main_roomsTab');
    expect(byId(nodes, 'noCentre')).toBeUndefined(); // present but no bounds
    expect(byId(nodes, 'does_not_exist')).toBeUndefined();
  });

  it('byText matches exact text OR content-desc', () => {
    expect(byText(nodes, 'Rooms')).toBeTruthy();
    expect(byText(nodes, 'Profile photo')).toBeTruthy(); // via content-desc
    expect(byText(nodes, 'Room')).toBeUndefined(); // not an exact match
  });

  it('byTextContains matches substrings of text', () => {
    expect(byTextContains(nodes, 'P-02')).toBeTruthy();
    expect(byTextContains(nodes, 'adult power')).toBeTruthy();
    expect(byTextContains(nodes, 'zzz')).toBeUndefined();
  });

  it('byTextContains also matches content-desc substrings', () => {
    // "Profile ph" is only in node 3's content-desc, not in any text node
    expect(byTextContains(nodes, 'Profile ph')).toBeTruthy();
  });
});

describe('summarizeScreen', () => {
  const s = summarizeScreen(parseNodes(SAMPLE_XML));

  it('lists unique testTags present on screen', () => {
    expect(s.testTags).toContain('main_roomsTab');
    expect(s.testTags).toContain('legal_acceptTermsCheckbox');
  });

  it('lists short on-screen texts', () => {
    expect(s.texts).toContain('Rooms');
    expect(s.texts).toContain('Alice (P-02 adult power)');
  });

  it('omits empty resource-ids', () => {
    expect(s.testTags).not.toContain('');
  });

  it('drops texts longer than 40 chars', () => {
    const long = 'x'.repeat(60);
    const xml = `<hierarchy><node resource-id="r" text="${long}" bounds="[0,0][1,1]" /></hierarchy>`;
    expect(summarizeScreen(parseNodes(xml)).texts).not.toContain(long);
  });

  it('keeps text of exactly 40 chars, drops 41 (boundary)', () => {
    const at40 = 'a'.repeat(40);
    const at41 = 'b'.repeat(41);
    const x40 = `<hierarchy><node resource-id="r" text="${at40}" bounds="[0,0][1,1]" /></hierarchy>`;
    const x41 = `<hierarchy><node resource-id="r" text="${at41}" bounds="[0,0][1,1]" /></hierarchy>`;
    expect(summarizeScreen(parseNodes(x40)).texts).toContain(at40);
    expect(summarizeScreen(parseNodes(x41)).texts).not.toContain(at41);
  });
});

describe('arrayContains', () => {
  it('is true only when the array includes the needle', () => {
    expect(arrayContains([1, 2, 3], 2)).toBe(true);
    expect(arrayContains([1, 2, 3], 9)).toBe(false);
    expect(arrayContains([], 2)).toBe(false);
  });

  it('is false for non-array inputs', () => {
    expect(arrayContains(undefined, 1)).toBe(false);
    expect(arrayContains(null, 1)).toBe(false);
    expect(arrayContains('123', 1)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('defaults: local target, all journeys, reset on, flags off, out under journey-results', () => {
    const a = parseArgs([]);
    expect(a.target).toBe('local');
    expect(a.journeys).toBeNull();
    expect(a.reset).toBe(true);
    expect(a.rebuild).toBe(false);
    expect(a.list).toBe(false);
    expect(a.help).toBe(false);
    expect(a.out).toMatch(/journey-results$/);
  });

  it('parses --target / --serial / --journeys (trim + drop blanks)', () => {
    const a = parseArgs(['--target', 'dev', '--serial', 'XYZ', '--journeys', 'J-SMOKE, J02 ,']);
    expect(a.target).toBe('dev');
    expect(a.serial).toBe('XYZ');
    expect(a.journeys).toEqual(['J-SMOKE', 'J02']);
  });

  it('parses boolean flags', () => {
    const a = parseArgs(['--no-reset', '--rebuild', '--list', '--help']);
    expect(a.reset).toBe(false);
    expect(a.rebuild).toBe(true);
    expect(a.list).toBe(true);
    expect(a.help).toBe(true);
  });

  it('throws on an unknown option', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
  });

  it('throws on an invalid --target', () => {
    expect(() => parseArgs(['--target', 'prod'])).toThrow(/Unknown --target/);
  });

  it('throws when a value-taking flag has no value', () => {
    expect(() => parseArgs(['--journeys'])).toThrow(/--journeys requires a value/);
    expect(() => parseArgs(['--target'])).toThrow(/--target requires a value/);
  });
});

/**
 * SHY-0396 — one journey definition, two accessibility trees.
 *
 * The runner was Android-only: its matchers read uiautomator's
 * `<node resource-id bounds="[x,y][x,y]">`. iOS had driver primitives but no
 * journey runner, so every iOS walk was hand-driven — slowly, unrepeatably, and
 * checking whatever the person driving remembered to check.
 *
 * That is how two platforms drift, and SHY-0419 is the standing example: the
 * Send button sat under the keyboard on iPhone while unit tests, the web suite
 * and two Android walks were all green.
 *
 * `parseNodes` is where both trees become one shape, so it is the piece
 * everything above it trusts. A silent mis-parse here does not fail loudly — it
 * produces zero nodes and a timeout that reads like the screen never appeared.
 */
describe('parseNodes — XCUITest (iOS) and uiautomator (Android) agree on one shape', () => {
  const XCUI = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="ShyTalk" x="0" y="0" width="393" height="852">
    <XCUIElementTypeTextView name="support_input" value="nobody can hear me"
      label="Tell us what is wrong" enabled="true" visible="true"
      x="16" y="300" width="361" height="120"/>
    <XCUIElementTypeButton name="support_send" label="Send" enabled="true"
      visible="true" x="16" y="470" width="361" height="48"/>
    <XCUIElementTypeStaticText name="" label="You already have 2 requests open."
      enabled="true" visible="true" x="16" y="120" width="361" height="20"/>
    <XCUIElementTypeButton name="support_offscreen" label="Hidden" enabled="true"
      visible="false" x="16" y="900" width="361" height="48"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

  const UIAUTOMATOR = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node resource-id="support_input" text="nobody can hear me" content-desc=""
    enabled="true" clickable="true" checked="false" bounds="[16,300][377,420]"/>
  <node resource-id="support_send" text="Send" content-desc="" enabled="true"
    clickable="true" checked="false" bounds="[16,470][377,518]"/>
</hierarchy>`;

  test('an iOS dump is recognised without being told which platform it is', () => {
    // Dispatched on CONTENT, not on a caller-supplied flag. A caller that says
    // "android" while holding an iPhone dump would yield zero nodes and a
    // timeout that looks like the screen never rendered.
    const nodes = parseNodes(XCUI);
    expect(nodes.length).toBeGreaterThan(0);
    expect(byId(nodes, 'support_send')).toBeDefined();
  });

  test('iOS `name` is the testTag, so both platforms address a control the same way', () => {
    const ios = byId(parseNodes(XCUI), 'support_send');
    const android = byId(parseNodes(UIAUTOMATOR), 'support_send');
    expect(ios).toBeDefined();
    expect(android).toBeDefined();
    // Same journey line -> same control on both phones. If these diverged, a
    // journey would silently assert different things per platform.
    expect(ios.text).toBe('Send');
    expect(android.text).toBe('Send');
  });

  /**
   * A text field's typed contents live in `value`, not `label` — `label` is the
   * placeholder. Reading `label` would make "the words she typed are still
   * there" assert the placeholder instead, and pass while the field was empty.
   */
  test("a field's typed CONTENTS are read, not its placeholder", () => {
    const field = byId(parseNodes(XCUI), 'support_input');
    expect(field.text).toBe('nobody can hear me');
    expect(field.text).not.toBe('Tell us what is wrong');
  });

  test('text matching works on iOS labels, so waitForText is cross-platform', () => {
    expect(byTextContains(parseNodes(XCUI), 'You already have 2 requests open.')).toBeDefined();
  });

  test('centre points are derived from x/y/width/height, as whole pixels', () => {
    const send = byId(parseNodes(XCUI), 'support_send');
    // 16 + 361/2 = 196.5. Rounded, because a tap is sent as integer
    // coordinates -- a fractional x would be truncated somewhere downstream and
    // land a pixel off, which on a tightly packed row is a different control.
    expect(send.center).toEqual({ x: 197, y: 494 });
  });

  /**
   * SHY-0419 in one assertion. The Send button EXISTED at coordinates under the
   * keyboard; what was wrong was that nobody could see or reach it. XCUITest
   * reports that as `visible="false"`, so the flag must survive parsing or the
   * runner can never tell "on screen" from "in the tree".
   */
  test('an off-screen control is marked not visible rather than dropped silently', () => {
    const hidden = parseNodes(XCUI).find((n) => n.id === 'support_offscreen');
    expect(hidden).toBeDefined();
    expect(hidden.visible).toBe(false);
    expect(byId(parseNodes(XCUI), 'support_send').visible).toBe(true);
  });

  test('every Android node reports visible, so one field is readable on both', () => {
    for (const n of parseNodes(UIAUTOMATOR)) expect(n.visible).toBe(true);
  });

  test('a dump from neither tree yields nothing rather than throwing', () => {
    expect(parseNodes('<html><body>not a device dump</body></html>')).toEqual([]);
  });
});

/**
 * `--debug`: dump the screen on EVERY step, not only the failing one.
 *
 * Operator, 2026-08-25: *"the passing log doesn't dump tags (only failures do)
 * — can we run it in a 'debug mode' or something similar so that we can see
 * these logs, even without failures."*
 *
 * The default stays quiet on purpose: capturing the screen costs a full dump,
 * which is ~65ms on Android but ~700ms on iOS, and a fourteen-journey run makes
 * a few hundred steps. Paying that on every run to serve the occasional
 * question is the wrong default — so it is a flag, and the flag is the contract
 * this pins. See [[feedback-consumer-first-surface-design]].
 */
describe('--debug dumps the screen on passing steps too', () => {
  const { parseArgs: parse, capturesScreenFor } = require('../../scripts/device-journey-runner');

  test('the flag is off unless asked for', () => {
    expect(parse([]).debug).toBe(false);
  });

  test('--debug turns it on', () => {
    expect(parse(['--debug']).debug).toBe(true);
  });

  test('a FAILING step is always captured, flag or not', () => {
    // The diagnostic that already existed must not become opt-in. A failure
    // with no screen behind it is the one case nobody can afford to lose.
    expect(capturesScreenFor('fail', false)).toBe(true);
    expect(capturesScreenFor('fail', true)).toBe(true);
  });

  test('a PASSING step is captured only in debug', () => {
    expect(capturesScreenFor('pass', false)).toBe(false);
    expect(capturesScreenFor('pass', true)).toBe(true);
  });

  test('--help names it, or nobody will find it', () => {
    // `--platform` was parsed, typo-checked and undocumented for months. A
    // flag that only helps whoever already knows about it is not a feature.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../scripts/device-journey-runner.js'),
      'utf8',
    );
    const help = src.slice(src.indexOf('ShyTalk on-device journey runner'));
    expect(help.slice(0, 900)).toContain('--debug');
  });
});
