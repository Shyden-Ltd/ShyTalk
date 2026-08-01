/**
 * XCUITest element-locator construction.
 *
 * Pure string building, extracted so it can be tested without an iPhone, an
 * Appium server or a WebDriverAgent build. That separation is the point: the
 * device round-trip is proven by the journey corpus on real hardware, but a
 * malformed XPath fails identically to a missing element, and only one of
 * those is a product signal.
 *
 * XCUITest exposes three text-ish attributes and they are NOT
 * interchangeable:
 *   - `name`  — the accessibilityIdentifier (Compose testTag projects here)
 *   - `label` — the human-visible label a person reads
 *   - `value` — the current contents of a field
 * A locator that checks only `name` misses every button the corpus refers to
 * by its visible words, which is most of them. SHY-0259.
 */

/**
 * Escape a value for embedding in an XPath string literal.
 *
 * XPath 1.0 has no escape character, so a value containing both quote kinds
 * must be built with concat(). Names like `Selma's "Saturday" Sing-along` are
 * real in this corpus, so this is not hypothetical.
 */
function xpathLiteral(value) {
  const s = String(value);
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `concat(${s
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`;
}

/** Any element whose visible label, name or value equals `text`. */
function xpathForText(text) {
  const lit = xpathLiteral(text);
  return `//*[@label=${lit} or @name=${lit} or @value=${lit}]`;
}

/** Any element whose visible label, name or value CONTAINS `text`. */
function xpathContainingText(text) {
  const lit = xpathLiteral(text);
  return `//*[contains(@label, ${lit}) or contains(@name, ${lit}) or contains(@value, ${lit})]`;
}

/**
 * A tappable control bearing `label`.
 *
 * Restricted to the types a person can actually press. An unrestricted match
 * hits the containing cell or a static text node, and a tap on those either
 * does nothing or activates the wrong row.
 */
function xpathForButton(label) {
  const lit = xpathLiteral(label);
  return (
    `//*[(@type='XCUIElementTypeButton' or @type='XCUIElementTypeCell' or ` +
    `@type='XCUIElementTypeStaticText') and (@label=${lit} or @name=${lit})]`
  );
}

/** A text field, optionally the one identified by `tag`. */
function xpathForTextField(tag) {
  const types = `(@type='XCUIElementTypeTextField' or @type='XCUIElementTypeTextView' or @type='XCUIElementTypeSecureTextField')`;
  if (!tag) return `//*[${types}]`;
  return `//*[${types} and @name=${xpathLiteral(tag)}]`;
}

/** A cell whose name starts with `prefix` and which carries `label`. */
function xpathForCardWithLabel(prefix, label) {
  const p = xpathLiteral(prefix);
  const l = xpathLiteral(label);
  return `//*[starts-with(@name, ${p}) and (contains(@label, ${l}) or contains(@name, ${l}) or .//*[contains(@label, ${l})])]`;
}

/** True if an XCUITest source dump mentions `text` in any text-ish attribute. */
function dumpHasText(dump, text) {
  if (!dump || !text) return false;
  const esc = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:label|name|value)="[^"]*${esc}[^"]*"`).test(String(dump));
}

/** True if the dump contains any editable field. */
function dumpHasTextField(dump) {
  if (!dump) return false;
  return /type="XCUIElementType(?:TextField|TextView|SecureTextField)"/.test(String(dump));
}

module.exports = {
  xpathLiteral,
  xpathForText,
  xpathContainingText,
  xpathForButton,
  xpathForTextField,
  xpathForCardWithLabel,
  dumpHasText,
  dumpHasTextField,
};
