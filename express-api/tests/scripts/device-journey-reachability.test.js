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

  test('a node drawn EARLIER cannot occlude one drawn later', () => {
    // Document order is paint order in both dumps. A background behind the
    // button is not covering it.
    const background = boxed({ id: 'page_background' }, 0, 0, 420, 900);
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    expect(occluderOf([background, send], send)).toBeNull();
  });

  test("a control's own children do not occlude it", () => {
    // A button's label sits inside the button and comes later in the tree. If
    // containment alone counted, every button would look covered by its text.
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    const label = boxed({ text: 'Send' }, 100, 320, 320, 360);
    expect(occluderOf([send, label], send)).toBeNull();
  });

  test('a node with no box cannot occlude anything', () => {
    const send = boxed({ id: 'support_send' }, 40, 300, 380, 380);
    expect(occluderOf([send, node({ id: 'ghost' })], send)).toBeNull();
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

  test('throws for a control XCUITest itself reports as not visible', () => {
    // Parsed all along, read by nothing.
    const hidden = boxed({ id: 'support_send', visible: false }, 40, 300, 380, 380);
    expect(() => assertReachable([hidden], hidden, '#support_send')).toThrow(/not visible/i);
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
