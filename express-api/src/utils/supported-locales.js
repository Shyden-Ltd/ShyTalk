/**
 * Server-side copy of the site's supported non-English locales (SHY-0072).
 *
 * The authoritative web source is public/js/language-selector.js — a
 * browser IIFE that cannot be require()d in Node. Cross-layer drift is
 * prevented by a grep-based pin test (translate-public test suite)
 * asserting every code here appears in that file. Update BOTH together.
 */

const SUPPORTED_LOCALES = [
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'km',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
];

module.exports = { SUPPORTED_LOCALES };
