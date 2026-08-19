/**
 * The Compose-resources locale corpus, declared once.
 *
 * SHY-0271: three files had each grown their own idea of "the locale set" —
 * `scripts/translate-strings.js` hard-codes 20, `compose-resources-locale-parity`
 * hard-codes 20, and the new content guard was DISCOVERING them from disk. The
 * discovering one was the weak link: a renamed or deleted locale directory just
 * disappears from a discovered set, so the suite goes quieter instead of redder.
 *
 * Declared, not discovered. Adding a locale is a deliberate edit here.
 */

const fs = require('node:fs');
const path = require('node:path');

const RESOURCES_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'src',
  'commonMain',
  'composeResources',
);

/** The 20 translated locales (the default `values` dir is separate). */
const ALL_LOCALES = [
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

/** Every resource directory, default first: ['values', 'values-ar', ...]. */
const ALL_LOCALE_DIRS = ['values', ...ALL_LOCALES.map((l) => `values-${l}`)];

const localeFilePath = (dir) => path.join(RESOURCES_DIR, dir, 'strings.xml');

/**
 * Parse one locale file into `[{ name, value }]`.
 *
 * Also returns `rawCount` — the number of `<string` elements the file actually
 * contains — so a caller can prove the parser saw all of them. A regex that
 * silently stops matching after a reformat is the failure mode that lets a
 * content guard pass while reading nothing.
 */
function readLocaleStrings(dir) {
  const xml = fs.readFileSync(localeFilePath(dir), 'utf8');
  const entries = [];
  for (const m of xml.matchAll(/<string name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
    entries.push({ name: m[1], value: m[2] });
  }
  return { entries, rawCount: (xml.match(/<string\b/g) || []).length };
}

module.exports = { RESOURCES_DIR, ALL_LOCALES, ALL_LOCALE_DIRS, localeFilePath, readLocaleStrings };
