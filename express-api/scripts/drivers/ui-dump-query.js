/**
 * Pure queries over a uiautomator dump.
 *
 * Extracted from android-adb-driver.js so the targeting logic can be tested
 * against real captured dumps without a device attached. That matters: these
 * functions decide WHICH PIXEL a tap lands on, and a test that re-implements
 * them locally would pass while the driver's own copy was broken.
 *
 * No device I/O here — the caller supplies the dump. SHY-0259.
 */

/** Escape a value for safe use inside a RegExp. */
const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Centre point of the first node whose `attr` equals `value`.
 *
 * Tolerant of attribute ORDER: uiautomator emits `text` before `bounds`, but a
 * `--compressed` dump can reorder them, and matching only one order silently
 * finds nothing on half the screens.
 *
 * Returns the CENTRE, never a corner — a corner tap lands on the neighbouring
 * view often enough to be flaky.
 *
 * @returns {{cx: number, cy: number}|null} null when absent, never a guess: a
 * guessed coordinate taps something arbitrary and then reports success.
 */
function centreOf(dump, attr, value) {
  if (!dump || !value) return null;
  const v = esc(value);
  const m =
    new RegExp(`${attr}="${v}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(dump) ||
    new RegExp(`bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*?${attr}="${v}"`).exec(dump);
  if (!m) return null;
  return {
    cx: Math.floor((Number(m[1]) + Number(m[3])) / 2),
    cy: Math.floor((Number(m[2]) + Number(m[4])) / 2),
  };
}

/**
 * Centre of a node carrying the given resource-id, short or fully-qualified
 * (`tab_rooms` matches `com.shyden.shytalk.local:id/tab_rooms`).
 */
function centreOfTag(dump, tag) {
  if (!dump || !tag) return null;
  const m = new RegExp(
    `resource-id="(?:[^"]*:id/)?${esc(tag)}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  ).exec(dump);
  if (!m) return null;
  return {
    cx: Math.floor((Number(m[1]) + Number(m[3])) / 2),
    cy: Math.floor((Number(m[2]) + Number(m[4])) / 2),
  };
}

/**
 * True if `value` appears in a node's text, content-desc or hint.
 *
 * All three are checked because the app puts a label in whichever fits: an
 * icon-only button carries it in content-desc and nowhere else, and an empty
 * field carries its prompt in hint.
 */
function dumpHas(dump, value) {
  if (!dump || !value) return false;
  return new RegExp(`(?:text|content-desc|hint)="[^"]*${esc(value)}[^"]*"`).test(dump);
}

/**
 * Centre of a card whose resource-id starts with `prefix` AND whose text or
 * content-desc contains `label` — e.g. the `userCard_*` bearing "Alice".
 */
function centreOfCardWithLabel(dump, prefix, label) {
  if (!dump || !prefix || !label) return null;
  // Scan whole <node …> elements rather than assuming an attribute order.
  // Real uiautomator emits index, text, resource-id, class, package,
  // content-desc, …, bounds, hint — so `text` precedes both the id and the
  // bounds. An ordered pattern found nothing on the very first real dump this
  // was tried against, which is how the ordering assumption was caught.
  const idRx = new RegExp(`resource-id="(?:[^"]*:id/)?${esc(prefix)}[^"]*"`);
  const labelRx = new RegExp(`(?:text|content-desc)="[^"]*${esc(label)}[^"]*"`);
  const boundsRx = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;
  for (const el of dump.match(/<node\b[^>]*>/g) || []) {
    if (!idRx.test(el) || !labelRx.test(el)) continue;
    const b = boundsRx.exec(el);
    if (!b) continue;
    return {
      cx: Math.floor((Number(b[1]) + Number(b[3])) / 2),
      cy: Math.floor((Number(b[2]) + Number(b[4])) / 2),
    };
  }
  return null;
}

/** True if the dump contains any editable text field. */
function hasEditableField(dump) {
  if (!dump) return false;
  return (
    /resource-id="(?:[^"]*:id\/)?(?:pm_messageInput|conversation_input|message_input)"/.test(
      dump,
    ) || /class="android\.widget\.EditText"/.test(dump)
  );
}

/**
 * Encode free text for `adb shell input text`.
 *
 * ONLY the space encoding. `input text` splits its argument on spaces, and
 * `%s` is the encoding it decodes back to one — a property of the Android
 * `input` command itself, independent of any shell.
 *
 * IT NO LONGER ESCAPES APOSTROPHES, and the escaping it used to do never
 * worked. It escaped for the HOST shell (`'` → `'\''`), but `adb shell X Y Z`
 * does not pass X Y Z as argv: adb joins them and hands the result to
 * `/system/bin/sh` ON THE DEVICE. The host shell consumed the escaping and
 * the device shell then received a bare apostrophe. Verified against the
 * connected device on 2026-08-01:
 *
 *   adb -s … shell echo 'Selma'\''s%sroom'  →  /system/bin/sh: no closing quote
 *
 * Quoting now happens on the DEVICE side, in the driver's `adb()` helper,
 * which is the only place that knows which arguments reach a device shell.
 * Doing it here as well would double-escape and type the escape sequence.
 *
 * KNOWN LIMITATION (unchanged): a literal `%s` in the text is
 * indistinguishable from an encoded space — `input text` has no `%%` escape.
 */
function escapeInputText(text) {
  return String(text).replace(/ /g, '%s');
}

module.exports = {
  centreOf,
  centreOfTag,
  centreOfCardWithLabel,
  dumpHas,
  hasEditableField,
  escapeInputText,
};

/**
 * Seats and their occupants, parsed from a dump.
 *
 * Returns [] for an absent dump rather than throwing: a room screen that has
 * not rendered yet is a normal mid-journey state, not an error, and throwing
 * here would fail the scenario for a timing artefact.
 */
function parseSeatGrid(dump) {
  if (!dump) return [];
  const out = [];
  for (const el of String(dump).match(/<node\b[^>]*>/g) || []) {
    const id = /resource-id="(?:[^"]*:id\/)?seat_(\d+)"/.exec(el);
    if (!id) continue;
    const text = /text="([^"]*)"/.exec(el);
    out.push({ index: Number(id[1]), occupant: text && text[1] ? text[1] : null });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Layout direction of the rendered hierarchy.
 *
 * uiautomator does not expose direction as an attribute, so this reads the
 * marker the app sets. Defaults to 'ltr' on an absent dump — guessing 'rtl'
 * would silently pass an RTL assertion against a blank screen.
 */
function parseLayoutDirection(dump) {
  if (!dump) return 'ltr';
  return /layout-direction="rtl"|rtl_marker/.test(String(dump)) ? 'rtl' : 'ltr';
}

module.exports.parseSeatGrid = parseSeatGrid;
module.exports.parseLayoutDirection = parseLayoutDirection;
