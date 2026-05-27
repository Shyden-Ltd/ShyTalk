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
