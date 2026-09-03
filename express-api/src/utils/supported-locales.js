/**
 * Server-side copy of the site's supported non-English locales (SHY-0072).
 *
 * Five languages, not twenty (SHY-0289). Supporting a language is a promise
 * about the quality of what it says — including legal and safety copy read by
 * minors — and that promise can only be made for the five the MVP ships.
 *
 * The authoritative web source is public/js/language-selector.js — a
 * browser IIFE that cannot be require()d in Node. Cross-layer drift is
 * prevented by a grep-based pin test (translate-public test suite)
 * asserting every code here appears in that file. Update BOTH together.
 */

const SUPPORTED_LOCALES = ['id', 'th', 'vi', 'zh'];

module.exports = { SUPPORTED_LOCALES };
