/**
 * Text sanitisation utilities for user-generated content.
 *
 * Strips HTML tags, zero-width characters, null bytes, and other
 * potentially dangerous or invisible content from user input.
 */

/**
 * Strip all HTML tags from text.
 * @param {string} text
 * @returns {string}
 */
function stripHtml(text) {
  if (typeof text !== 'string') return '';
  // Strip HTML tags safely (no backtracking risk)
  let result = '';
  let inTag = false;
  for (const ch of text) {
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) result += ch;
  }
  return result;
}

/**
 * Strip zero-width and invisible formatting characters.
 * U+200B zero-width space, U+200C zero-width non-joiner,
 * U+200D zero-width joiner (kept in emoji context handled separately),
 * U+2063 invisible separator, U+FEFF byte order mark,
 * U+202E right-to-left override (bidi attack prevention).
 * @param {string} text
 * @returns {string}
 */
function stripZeroWidth(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u200B\u200C\u2063\uFEFF\u202E]/g, '');
}

/**
 * Strip null bytes.
 * @param {string} text
 * @returns {string}
 */
function stripNullBytes(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\0/g, '');
}

/**
 * Full sanitisation pipeline for user text input.
 * Strips HTML, zero-width chars, null bytes, and trims whitespace.
 * @param {string} text
 * @returns {string}
 */
function sanitise(text) {
  if (typeof text !== 'string') return '';
  let clean = stripHtml(text);
  clean = stripZeroWidth(clean);
  clean = stripNullBytes(clean);
  return clean.trim();
}

/**
 * Sanitise a suggestion title. Returns null if invalid.
 * Must contain at least one letter character from any script.
 * @param {string} text
 * @returns {string|null}
 */
function sanitiseTitle(text) {
  const clean = sanitise(text);
  if (!clean) return null;
  // Must contain at least one Unicode letter (any script)
  if (!/[\p{L}]/u.test(clean)) return null;
  return clean;
}

module.exports = { stripHtml, stripZeroWidth, stripNullBytes, sanitise, sanitiseTitle };
