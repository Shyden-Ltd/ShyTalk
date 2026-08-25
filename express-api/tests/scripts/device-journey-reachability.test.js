/**
 * device-journey-reachability.test.js
 *
 * A control being FINDABLE is not the same as a person being able to press it.
 *
 * `tapIdScrolling` asks whether the node is present in the tree. An occluded
 * button is still present — it has an id, sane bounds and `enabled=true` — so
 * the walk clicks it and moves on. Seen on the real iPhone at t≈67s of the J38
 * recording: the Send button completely hidden behind the keyboard, tapped, and
 * the step went green.
 *
 * That matters because **SHY-0419 was exactly "the Send button is under the
 * keyboard on iPhone"**. It took three readings to fix and shipped twice. The
 * journey written to prove it stays fixed could not detect it. SHY-0428 is the
 * same class from the other side: Send drawn under the Android navigation bar,
 * its tappable centre landing on HOME.
 *
 * `visible` was already parsed from the XCUITest tree, with a comment naming
 * SHY-0419 — and read by nothing. One assignment, zero uses.
 *
 * The fixtures below are the geometry of both real defects.
 */

const {
  occluderOf,
  looksLikeSystemOverlay,
  assertReachable,
  parseNodes,
  tapId,
} = require('../../scripts/device-journey-runner');

const node = (over) => ({
  cls: '',
  id: '',
  text: '',
  desc: '',
  enabled: true,
  visible: true,
  bounds: null,
  center: null,
  ...over,
});

/** A node from a box, with its centre derived the way the parsers do. */
const boxed = (over, x1, y1, x2, y2) =>
  node({
    ...over,
    bounds: { x1, y1, x2, y2 },
    center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
  });

/** SHY-0419: iPhone, Send at y 620–700, keyboard covering from y 609 down. */
const sendUnderKeyboard = () => {
  const send = boxed({ id: 'support_send', cls: 'XCUIElementTypeButton' }, 40, 620, 380, 700);
  return {
    send,
    nodes: [
      boxed({ id: 'support_input', cls: 'XCUIElementTypeTextView' }, 40, 200, 380, 400),
      send,
      boxed({ cls: 'XCUIElementTypeKeyboard' }, 0, 609, 420, 854),
    ],
  };
};

/** SHY-0428: OnePlus, Send at y 2958–3098, navigation bar from y 3013 down. */
const sendUnderNavBar = () => {
  const send = boxed({ id: 'support_send', cls: 'android.widget.Button' }, 36, 2958, 1404, 3098);
  return {
    send,
    nodes: [send, boxed({ id: 'android:id/navigationBarBackground' }, 0, 3013, 1440, 3168)],
  };
};

describe('occluderOf', () => {
  test('finds the keyboard covering Send — the SHY-0419 geometry', () => {
    const { send, nodes } = sendUnderKeyboard();
    expect(occluderOf(nodes, send)?.cls).toBe('XCUIElementTypeKeyboard');
  });

  test('finds the navigation bar covering Send — the SHY-0428 geometry', () => {
    // The bar covers the lower half only. The TAPPABLE CENTRE is what decides,
    // which is why "partly visible" was still unusable on the device.
    const { send, nodes } = sendUnderNavBar();
    expect(occluderOf(nodes, send)?.id).toBe('android:id/navigationBarBackground');
  });

  test('an unobstructed button has no occluder', () => {
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    const nodes = [send, boxed({ cls: 'XCUIElementTypeKeyboard' }, 0, 609, 420, 854)];
    expect(occluderOf(nodes, send)).toBeNull();
  });

  test('a keyboard drawn EARLIER cannot occlude a button drawn later', () => {
    // Document order is paint order, so an overlay listed before the control
    // is behind it.
    const keyboard = boxed({ cls: 'XCUIElementTypeKeyboard' }, 0, 0, 420, 900);
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    expect(occluderOf([keyboard, send], send)).toBeNull();
  });

  test('ordinary content on top of a control is not treated as covering it', () => {
    // Only system overlays count. A UI tree is not a stack of painted
    // rectangles, and the general rule fired on the first real screen it met.
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    const label = boxed({ text: 'Send', cls: 'android.widget.TextView' }, 0, 0, 420, 900);
    expect(occluderOf([send, label], send)).toBeNull();
  });

  test('a node with no box cannot occlude anything', () => {
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    expect(occluderOf([send, node({ id: 'ghost' })], send)).toBeNull();
  });
});

/**
 * THE FALSE POSITIVE, from the real device.
 *
 * The first version of this check asked a general question — is anything drawn
 * later holding this point — and fired on the first screen it met. The tree,
 * verbatim from the live dump of the daily-reward dialog:
 *
 *   <View clickable="true"  bounds="[405,2166][608,2334]">     the actual button
 *     <TextView text="Later" bounds="[461,2219][553,2282]"/>   the target
 *     <Button   text=""      bounds="[405,2180][608,2320]"/>   flagged as coverer
 *   </View>
 *
 * Compose SEMANTICS nodes, not painted views. The `Button` is the Role.Button
 * node for the same composable as the label: `clickable="false"`, a sibling,
 * and LARGER than the label — so the "wholly inside" exemption, which
 * anticipated label-inside-button, failed in the other direction.
 *
 * Every Compose button reached by its text has this shape. `Claim Today's
 * Reward` on the same dialog is identical.
 */
describe('Compose semantics siblings are not occluders', () => {
  const REWARD_DIALOG_XML = [
    '<hierarchy>',
    '<node class="android.view.View" clickable="true" bounds="[405,2166][608,2334]" enabled="true">',
    '<node text="Later" class="android.widget.TextView" clickable="false" bounds="[461,2219][553,2282]" enabled="true" />',
    '<node text="" class="android.widget.Button" clickable="false" bounds="[405,2180][608,2320]" enabled="true" />',
    '</node>',
    '</hierarchy>',
  ].join('');

  test('the sibling Button does not occlude the label', () => {
    const nodes = parseNodes(REWARD_DIALOG_XML);
    const later = nodes.find((n) => n.text === 'Later');
    expect(occluderOf(nodes, later)).toBeNull();
  });

  test('tapping it by text goes through, as it did before the check existed', async () => {
    const device = {
      kind: 'android',
      taps: [],
      async dumpXml() {
        return REWARD_DIALOG_XML;
      },
      async tap(x, y) {
        this.taps.push({ x, y });
      },
    };
    const nodes = parseNodes(REWARD_DIALOG_XML);
    const later = nodes.find((n) => n.text === 'Later');
    const { tapResolved } = require('../../scripts/device-journey-runner');
    await tapResolved(device, later, {
      relocate: (fresh) => fresh.find((n) => n.text === 'Later'),
    });
    // The label's own centre: (461+553)/2 = 507, (2219+2282)/2 = 2250.5 -> 2251.
    expect(device.taps).toEqual([{ x: 507, y: 2251 }]);
  }, 15000);
});

/**
 * The iOS false positives, from the real device tree.
 *
 * The broad rule blocked EVERY bottom-nav tab, so no iOS journey could navigate
 * past Home. Thirteen id-bearing controls on a settled Home screen were flagged,
 * in two classes — and neither coverer absorbs a touch.
 */
describe('iOS layout layers are not occluders', () => {
  /**
   * Class A — a child that overhangs its parent by ONE point.
   *
   * `main_profileTab` is [285,798][420,878]; its caption container is
   * [328,830][377,879]. A containment test needs `879 <= 878`, which is false
   * by a single point, so the child was not recognised as a child and was then
   * found to hold the parent's centre.
   */
  test('a tab is not occluded by its own caption container', () => {
    const tab = boxed({ id: 'main_profileTab', cls: 'XCUIElementTypeButton' }, 285, 798, 420, 878);
    const caption = boxed({ cls: 'XCUIElementTypeOther' }, 328, 830, 377, 879);
    expect(occluderOf([tab, caption], tab)).toBeNull();
  });

  /**
   * Class B — a full-screen transparent layer. Empty, unnamed,
   * `accessible="false"`, and `visible="true"` — so filtering occluders on
   * `visible` would not have cleared it either.
   */
  test('a full-screen transparent layer does not occlude what is under it', () => {
    const title = boxed({ id: 'rooms_title', cls: 'XCUIElementTypeStaticText' }, 20, 60, 200, 100);
    const layer = boxed({ cls: 'XCUIElementTypeOther' }, 0, 0, 420, 912);
    expect(occluderOf([title, layer], title)).toBeNull();
  });

  test('but a real keyboard over the same control still counts', () => {
    // The narrowing must not cost the detection it exists for.
    const send = boxed({ id: 'support_send' }, 40, 620, 380, 700);
    const layer = boxed({ cls: 'XCUIElementTypeOther' }, 0, 0, 420, 912);
    const keyboard = boxed({ cls: 'XCUIElementTypeKeyboard' }, 0, 609, 420, 854);
    expect(occluderOf([send, layer, keyboard], send)?.cls).toBe('XCUIElementTypeKeyboard');
  });
});

describe('looksLikeSystemOverlay', () => {
  test.each([
    ['XCUIElementTypeKeyboard', ''],
    ['android.inputmethodservice.SoftInputWindow', ''],
    ['android.view.View', 'android:id/navigationBarBackground'],
    ['android.widget.FrameLayout', 'com.android.systemui:id/status_bar'],
  ])('%s / %s is an overlay', (cls, id) => {
    expect(looksLikeSystemOverlay({ cls, id })).toBe(true);
  });

  test.each([
    ['android.widget.Button', ''],
    ['android.view.View', ''],
    ['XCUIElementTypeOther', ''],
    ['android.widget.TextView', 'support_send'],
  ])('%s / %s is ordinary content', (cls, id) => {
    expect(looksLikeSystemOverlay({ cls, id })).toBe(false);
  });
});

describe('assertReachable', () => {
  test('throws for a button behind the keyboard, and NAMES the keyboard', () => {
    // "not found" would send the reader hunting for a missing element. The
    // whole value is saying what was in the way.
    const { send, nodes } = sendUnderKeyboard();
    expect(() => assertReachable(nodes, send, '#support_send')).toThrow(/XCUIElementTypeKeyboard/);
    expect(() => assertReachable(nodes, send, '#support_send')).toThrow(/#support_send/);
  });

  test("does NOT judge a control on XCUITest's `visible` flag", () => {
    // A reversal, forced by the device. This guard did throw on
    // `visible === false`, on the strength of the attribute's name. But on a
    // plain, settled Home screen the tab captions `Rooms`, `Messages` and
    // `Profile` all report `visible="false"` while rendered in front of you —
    // ShyTalk draws through Compose, so the accessibility snapshot's idea of
    // visible does not track what is painted.
    //
    // A guard that fires on plainly-visible controls reddens healthy walks,
    // gets disabled, and then catches nothing at all.
    const flagged = boxed({ id: 'main_roomsTab', visible: false }, 40, 300, 380, 380);
    expect(() => assertReachable([flagged], flagged, '#main_roomsTab')).not.toThrow();
  });

  test('passes for an ordinary, reachable control', () => {
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    expect(() => assertReachable([send], send, '#support_send')).not.toThrow();
  });

  test('a target with no box is not judged — it is checked elsewhere', () => {
    // Reachability is a question about rectangles. Without one, this check has
    // nothing to say, and must not invent a failure.
    const ghost = node({ id: 'support_send' });
    expect(() => assertReachable([ghost], ghost, '#support_send')).not.toThrow();
  });
});

/**
 * The CALLER, not the helper.
 *
 * A first version of this file tested `occluderOf` and `assertReachable` only.
 * Mutation settled it: deleting the `assertReachable` call from `tapResolved`
 * left all twelve green. The helper was correct and unused — which is the exact
 * shape of the `visible` field this work replaced, parsed since the driver was
 * written and read by nothing.
 *
 * So these drive `tapId` with real XML and assert that no tap happens.
 */
describe('tapId refuses a control nobody could press', () => {
  const KEYBOARD_OVER_SEND = [
    '<hierarchy>',
    '<node resource-id="support_input" class="android.widget.EditText" text="" bounds="[40,200][380,400]" enabled="true" />',
    '<node resource-id="support_send" class="android.widget.Button" text="Send" bounds="[40,620][380,700]" enabled="true" />',
    '<node resource-id="" class="android.inputmethodservice.SoftInputWindow" text="" bounds="[0,609][420,854]" enabled="true" />',
    '</hierarchy>',
  ].join('');

  const CLEAR_SEND = [
    '<hierarchy>',
    '<node resource-id="support_send" class="android.widget.Button" text="Send" bounds="[40,300][380,380]" enabled="true" />',
    '</hierarchy>',
  ].join('');

  const deviceServing = (xml, extra = {}) => ({
    kind: 'android',
    taps: [],
    elementTaps: [],
    async dumpXml() {
      return xml;
    },
    async tap(x, y) {
      this.taps.push({ x, y });
    },
    ...extra,
  });

  test('a coordinate backend does not tap a button behind the keyboard', async () => {
    const device = deviceServing(KEYBOARD_OVER_SEND);
    await expect(tapId(device, 'support_send')).rejects.toThrow(/covered by/);
    expect(device.taps).toEqual([]);
  }, 15000);

  test('an ELEMENT-click backend does not click it either', async () => {
    // The route that mattered most: iOS clicks elements, and SHY-0419 was an
    // iOS defect. Short-circuiting to tapElement skipped the check entirely.
    const device = deviceServing(KEYBOARD_OVER_SEND, {
      async tapElement(id) {
        this.elementTaps.push(id);
      },
    });
    await expect(tapId(device, 'support_send')).rejects.toThrow(/covered by/);
    expect({ taps: device.taps, elements: device.elementTaps }).toEqual({
      taps: [],
      elements: [],
    });
  }, 15000);

  test('the failure names the control AND what covered it', async () => {
    const device = deviceServing(KEYBOARD_OVER_SEND);
    await expect(tapId(device, 'support_send')).rejects.toThrow(/#support_send/);
    await expect(tapId(device, 'support_send')).rejects.toThrow(/SoftInputWindow/);
  }, 15000);

  test('an unobstructed button is still tapped, by element where possible', async () => {
    const device = deviceServing(CLEAR_SEND, {
      async tapElement(id) {
        this.elementTaps.push(id);
      },
    });
    await tapId(device, 'support_send');
    expect({ elements: device.elementTaps, taps: device.taps }).toEqual({
      elements: ['support_send'],
      taps: [],
    });
  }, 15000);
});

describe('the parsers supply what reachability needs', () => {
  test('android nodes carry bounds and a class', () => {
    const xml =
      '<hierarchy><node resource-id="a" class="android.widget.Button" text="" ' +
      'bounds="[10,20][110,120]" enabled="true" /></hierarchy>';
    const [n] = parseNodes(xml);
    expect({ bounds: n.bounds, cls: n.cls, center: n.center }).toEqual({
      bounds: { x1: 10, y1: 20, x2: 110, y2: 120 },
      cls: 'android.widget.Button',
      center: { x: 60, y: 70 },
    });
  });

  test('ios nodes carry bounds and the element type', () => {
    const xml = '<XCUIElementTypeKeyboard x="0" y="609" width="420" height="245" enabled="true" />';
    const [n] = parseNodes(xml);
    expect({ bounds: n.bounds, cls: n.cls }).toEqual({
      bounds: { x1: 0, y1: 609, x2: 420, y2: 854 },
      cls: 'XCUIElementTypeKeyboard',
    });
  });
});
