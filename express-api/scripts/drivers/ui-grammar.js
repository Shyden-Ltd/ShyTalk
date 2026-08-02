/**
 * The two UI-dump grammars, and pure queries written ONCE against both.
 *
 * WHY THIS EXISTS. The Android driver had 73 methods; the real iOS driver had
 * 11 — so the journey corpus could only ever say "on Android". That gap was not
 * a missing feature, it was a missing ABSTRACTION: every one of those methods is
 * "find a tag / find some text in the current screen dump", and the only thing
 * that actually differs between the platforms is which XML attribute carries the
 * tag and which carries the text.
 *
 * Writing them twice is what produced the gap and is what would reopen it. So
 * the queries live here once, parameterised by grammar, and each driver supplies
 * the grammar plus its own device I/O.
 *
 * GROUND TRUTH, not guesswork. Both grammars were read off real captured dumps
 * (`tests/scripts/drivers/fixtures/android-dump-*.xml`, `ios-dump-signin.xml`)
 * and the tests run against those same files. Two assumptions died on contact
 * with the real iPhone dump:
 *
 *   - XCUITest emits NO `identifier` attribute. The accessibility identifier —
 *     which is where a Compose `testTag` lands — comes through as `name`.
 *   - iOS has no `bounds`; it has `x` / `y` / `width` / `height`.
 *
 * And one thing that is true only on iOS: an element with no testTag repeats its
 * visible text in `name`. So `name` is "tag OR text", which is why a tag lookup
 * must be anchored (full value or explicit prefix) rather than a substring — an
 * unanchored search would match a button whose LABEL merely contained the tag.
 */

/** Escape a value for safe use inside a RegExp. */
const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ANDROID_GRAMMAR = {
  platform: 'android',
  // uiautomator emits every node as a self-contained `<node …>` element.
  elementRx: /<node\b[^>]*>/g,
  // `resource-id` is fully qualified (`com.shyden.shytalk.local:id/tab_rooms`)
  // but the corpus names the short form, so the package part is optional.
  tagRx: (tag) => new RegExp(`resource-id="(?:[^"]*:id\\/)?${esc(tag)}"`),
  tagPrefixRx: (prefix) => new RegExp(`resource-id="(?:[^"]*:id\\/)?${esc(prefix)}[^"]*"`),
  // All three, because the app puts a label in whichever fits: an icon-only
  // button carries it in content-desc and nowhere else, an empty field in hint.
  textRx: (text) => new RegExp(`(?:text|content-desc|hint)="[^"]*${esc(text)}[^"]*"`),
  /** Centre of one element, or null — never a guessed coordinate. */
  centreOf(el) {
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(el);
    if (!b) return null;
    return {
      cx: Math.floor((Number(b[1]) + Number(b[3])) / 2),
      cy: Math.floor((Number(b[2]) + Number(b[4])) / 2),
    };
  },
  /** The tag this element carries, or null. */
  tagOf(el) {
    const m = /resource-id="(?:[^"]*:id\/)?([^"]*)"/.exec(el);
    return m ? m[1] : null;
  },
  /** The visible text this element carries, or null. */
  textOf(el) {
    const m = /\btext="([^"]*)"/.exec(el);
    return m && m[1] ? m[1] : null;
  },
  /** True when the element is an editable field. */
  isEditable: (el) => /class="android\.widget\.EditText"/.test(el),
  /** True when the element is disabled. */
  isDisabled: (el) => /\benabled="false"/.test(el),
};

const IOS_GRAMMAR = {
  platform: 'ios',
  // XCUITest elements NEST, so this matches opening tags only. Matching a whole
  // subtree would attribute a child's text to its parent container, and every
  // `Other` wrapper spans the full screen — the assertion would pass anywhere.
  elementRx: /<XCUIElementType[A-Za-z]+\b[^>]*>/g,
  // `identifier` is accepted although the real dumps never emit it: WDA has
  // shipped it on some element types historically, and accepting a second
  // spelling costs nothing while missing it costs a false failure.
  tagRx: (tag) => new RegExp(`(?:name|identifier)="${esc(tag)}"`),
  tagPrefixRx: (prefix) => new RegExp(`(?:name|identifier)="${esc(prefix)}[^"]*"`),
  textRx: (text) => new RegExp(`(?:label|value|name)="[^"]*${esc(text)}[^"]*"`),
  centreOf(el) {
    const x = /\bx="(-?\d+)"/.exec(el);
    const y = /\by="(-?\d+)"/.exec(el);
    const w = /\bwidth="(\d+)"/.exec(el);
    const h = /\bheight="(\d+)"/.exec(el);
    if (!x || !y || !w || !h) return null;
    return {
      cx: Math.floor(Number(x[1]) + Number(w[1]) / 2),
      cy: Math.floor(Number(y[1]) + Number(h[1]) / 2),
    };
  },
  tagOf(el) {
    const m = /(?:name|identifier)="([^"]*)"/.exec(el);
    return m ? m[1] : null;
  },
  // `label` before `value`: a text field's label is its prompt and its value is
  // what the user typed, and callers asking "what does this say" mean the label.
  textOf(el) {
    const m = /\blabel="([^"]*)"/.exec(el) || /\bvalue="([^"]*)"/.exec(el);
    return m && m[1] ? m[1] : null;
  },
  isEditable: (el) => /<XCUIElementType(?:TextField|SecureTextField|TextView)\b/.test(el),
  isDisabled: (el) => /\benabled="false"/.test(el),
};

/**
 * Pure queries over a dump, in one platform's grammar.
 *
 * Every one takes the dump as an argument — there is no device I/O in this file,
 * so the whole targeting layer is testable against captured dumps. That matters:
 * these decide WHICH PIXEL a tap lands on, and a test that re-implemented them
 * would pass while the driver's real copy was broken.
 */
function createDumpQueries(grammar) {
  /** Every element in the dump, as opening-tag strings. */
  const elements = (dump) => (dump ? String(dump).match(grammar.elementRx) || [] : []);

  /** Exact tag present anywhere. */
  const hasTag = (dump, tag) => Boolean(dump && tag && grammar.tagRx(tag).test(String(dump)));

  /**
   * Any tag starting with `prefix` — the corpus's usual shape (`userCard_`,
   * `adminStat_`), where the suffix is an id the scenario does not know.
   */
  const hasTagPrefix = (dump, prefix) =>
    Boolean(dump && prefix && grammar.tagPrefixRx(prefix).test(String(dump)));

  /** Visible text present anywhere. */
  const hasText = (dump, text) => Boolean(dump && text && grammar.textRx(text).test(String(dump)));

  /** Elements whose tag starts with `prefix`. */
  const elementsWithTagPrefix = (dump, prefix) => {
    if (!prefix) return [];
    const rx = grammar.tagPrefixRx(prefix);
    return elements(dump).filter((el) => rx.test(el));
  };

  /** How many elements carry a tag starting with `prefix`. */
  const countTagPrefix = (dump, prefix) => elementsWithTagPrefix(dump, prefix).length;

  /**
   * One element carrying tag-prefix AND text — e.g. the `userCard_*` bearing
   * "Alice". Returns the element string, or null.
   *
   * Scans whole elements rather than assuming an attribute order: real
   * uiautomator emits text before the id and before the bounds, and an ordered
   * pattern found nothing on the first real dump it met.
   */
  const elementWithTagPrefixAndText = (dump, prefix, text) => {
    if (!prefix || !text) return null;
    const textRx = grammar.textRx(text);
    for (const el of elementsWithTagPrefix(dump, prefix)) {
      if (textRx.test(el)) return el;
    }
    return null;
  };

  const hasTagPrefixWithText = (dump, prefix, text) =>
    Boolean(elementWithTagPrefixAndText(dump, prefix, text));

  /** Centre of the first element with this exact tag, or null. */
  const centreOfTag = (dump, tag) => {
    if (!tag) return null;
    const rx = grammar.tagRx(tag);
    for (const el of elements(dump)) {
      if (rx.test(el)) return grammar.centreOf(el);
    }
    return null;
  };

  /**
   * The TEXT of the first element with this exact tag, or null.
   *
   * `hasText` answers "is this string anywhere on screen", which cannot serve an
   * assertion about what ONE element says — a scenario checking a suspension
   * reason would pass on the same words appearing in a banner behind it. Reading
   * the element named by the tag is the difference between "the screen mentions
   * this" and "this control displays this".
   *
   * null when the tag is absent, distinct from '' for a present-but-empty
   * element: "no such control" and "the control is blank" are different defects.
   */
  const textOfTag = (dump, tag) => {
    if (!tag) return null;
    const rx = grammar.tagRx(tag);
    for (const el of elements(dump)) {
      if (rx.test(el)) return grammar.textOf(el);
    }
    return null;
  };

  /** Centre of the first element whose tag starts with `prefix`, or null. */
  const centreOfTagPrefix = (dump, prefix) => {
    const [el] = elementsWithTagPrefix(dump, prefix);
    return el ? grammar.centreOf(el) : null;
  };

  /** Centre of the element carrying both tag-prefix and text, or null. */
  const centreOfTagPrefixWithText = (dump, prefix, text) => {
    const el = elementWithTagPrefixAndText(dump, prefix, text);
    return el ? grammar.centreOf(el) : null;
  };

  /** Centre of the first element whose visible text contains `text`, or null. */
  const centreOfText = (dump, text) => {
    if (!text) return null;
    const rx = grammar.textRx(text);
    for (const el of elements(dump)) {
      if (rx.test(el)) return grammar.centreOf(el);
    }
    return null;
  };

  /**
   * Seats and their occupants.
   *
   * [] for an absent dump rather than a throw: a room screen that has not
   * rendered yet is a normal mid-journey state, and throwing would fail the
   * scenario for a timing artefact.
   */
  const seatGrid = (dump) => {
    const out = [];
    for (const el of elements(dump)) {
      const tag = grammar.tagOf(el);
      const m = tag && /^seat_(\d+)$/.exec(tag);
      if (!m) continue;
      out.push({ index: Number(m[1]), occupant: grammar.textOf(el) });
    }
    return out.sort((a, b) => a.index - b.index);
  };

  /** True when the tagged element exists AND is disabled. */
  const isTagDisabled = (dump, tag) => {
    if (!tag) return false;
    const rx = grammar.tagRx(tag);
    for (const el of elements(dump)) {
      if (rx.test(el)) return grammar.isDisabled(el);
    }
    return false;
  };

  /** True when any editable field is on screen. */
  const hasEditableField = (dump) => elements(dump).some((el) => grammar.isEditable(el));

  /** Every visible text string on screen, in document order, deduplicated. */
  const allText = (dump) => {
    const seen = new Set();
    for (const el of elements(dump)) {
      const t = grammar.textOf(el);
      if (t) seen.add(t);
    }
    return [...seen];
  };

  return {
    grammar,
    elements,
    hasTag,
    hasTagPrefix,
    hasText,
    elementsWithTagPrefix,
    countTagPrefix,
    elementWithTagPrefixAndText,
    hasTagPrefixWithText,
    centreOfTag,
    textOfTag,
    centreOfTagPrefix,
    centreOfTagPrefixWithText,
    centreOfText,
    seatGrid,
    isTagDisabled,
    hasEditableField,
    allText,
  };
}

module.exports = { ANDROID_GRAMMAR, IOS_GRAMMAR, createDumpQueries, esc };
