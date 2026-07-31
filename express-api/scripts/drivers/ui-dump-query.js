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
 * Escape free text for `adb shell input text`.
 *
 * The driver's adb() helper wraps every argument in single quotes, so an
 * apostrophe in user text closes the quote and hands the rest to the shell.
 * Spaces are encoded because `input text` splits on them.
 */
function escapeInputText(text) {
  return String(text).replace(/'/g, `'\\''`).replace(/ /g, '%s');
}

module.exports = {
  centreOf,
  centreOfTag,
  centreOfCardWithLabel,
  dumpHas,
  hasEditableField,
  escapeInputText,
};
