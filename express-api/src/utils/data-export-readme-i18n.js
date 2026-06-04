/**
 * Locale-aware translation table for the README.txt that ships inside
 * every GDPR data-export ZIP. The table is structured for per-locale
 * override + automatic fallback to English:
 *
 *   buildReadme('en', ...)   → en strings
 *   buildReadme('fr', ...)   → en strings (no 'fr' override yet)
 *   buildReadme('en-US', ...) → en strings (region tag stripped)
 *
 * To add a new locale, add a key to STRINGS keyed by the 2-letter
 * ISO-639-1 code (matching the values written to user.language by the
 * client's language picker). Each locale entry must have the same
 * shape as `STRINGS.en` — see the `en` block for the required keys
 * and their semantics. Untranslated keys fall through to en.
 *
 * Architecture-only scope (the operator's "Architecture-only, en stays"
 * choice on the GDPR README i18n carry-forward): ship the
 * infrastructure with en-only translations. Translations for the 19
 * other ShyTalk locales should be PR'd by native speakers, not
 * machine-generated, because the README contains legal-leaning text
 * (GDPR Article 20 reference, compliance language) where mistranslation
 * could create regulatory exposure.
 */

const STRINGS = {
  en: {
    title: 'ShyTalk Data Export',
    titleUnderline: '===================',
    userIdLabel: 'User ID',
    exportDateLabel: 'Export date',
    partialWarning: '⚠️  PARTIAL EXPORT',
    partialIntroLine1: 'This export is incomplete. The following sections could not be',
    partialIntroLine2: 'retrieved due to a transient backend failure:',
    partialOutro: [
      'You can request a fresh export in 24 hours. We apologise for the',
      'inconvenience — this is a compliance issue we take seriously.',
    ],
    fullIntro: 'This ZIP contains all personal data associated with your ShyTalk account.',
    filesHeader: 'Files:',
    fileEntries: [
      ['manifest.json    ', 'Section-by-section status of this export'],
      ['profile.json     ', 'Your profile information'],
      ['settings.json    ', 'Your privacy and notification settings'],
      ['identity.json    ', 'Your linked sign-in providers'],
      ['followers.json   ', 'Your followers and following lists'],
      ['blocked.json     ', 'Your blocked users list'],
      ['economy/         ', 'Your coins, beans, transactions, and backpack'],
      ['gifts/           ', 'Your gift wall'],
      ['conversations/   ', 'Your conversation metadata and messages'],
      ['rooms/           ', 'Rooms you own'],
      ['reports/         ', 'Reports you filed and appeals'],
      ['devices/         ', 'Your device bindings'],
      ['moderation/      ', 'Your warning history'],
      [
        'suggestions/     ',
        'Suggestions you submitted, votes & comments you made, your subscription preferences, and notifications you received',
      ],
    ],
  },
};

const FALLBACK_LANGUAGE = 'en';

/**
 * Look up a translation key with locale + en fallback.
 *
 * Fallback rules — in priority order:
 *   1. Locale value missing → fall back to en.
 *   2. Locale value present but wrong type vs en → fall back to en.
 *      (Guards a contributor who writes `partialOutro: 'one line'`
 *      when en has it as an array — without this, the string would be
 *      character-spread into the README.)
 *   3. Locale value is an empty array where en has a non-empty array
 *      → fall back to en. (Guards a contributor who writes
 *      `fileEntries: []` as a placeholder — without this, the README
 *      would render `Files:` with no entries underneath.)
 *
 * @param {string|undefined} language - 2-letter ISO-639-1 code
 *   (case-insensitive, region tag stripped); undefined → fallback.
 * @param {string} key - One of the keys in STRINGS.en (see the en
 *   block for the canonical set).
 * @returns {string|string[]} the translated value, or the en value
 *   if the locale doesn't have a usable override for this key.
 */
function t(language, key) {
  const normalized = normaliseLanguage(language);
  const localeTable = STRINGS[normalized] || {};
  if (key in localeTable) {
    const val = localeTable[key];
    const enVal = STRINGS[FALLBACK_LANGUAGE][key];
    // Type-match guard: if the en value is an array but the locale
    // override isn't (or vice versa), fall back to en. Prevents the
    // character-spread bug when a contributor writes a string for an
    // array key.
    if (Array.isArray(enVal) !== Array.isArray(val)) return enVal;
    // Non-empty guard: if en has a non-empty array but the locale
    // override is empty, fall back to en. Prevents the empty-section
    // bug when a contributor leaves an array key as `[]`.
    if (Array.isArray(val) && val.length === 0 && enVal.length > 0) return enVal;
    return val;
  }
  return STRINGS[FALLBACK_LANGUAGE][key];
}

/**
 * Strip region tags (`en-US` → `en`) + lower-case (`EN` → `en`) so
 * the locale picker handles whatever shape the client writes to the
 * user doc. Returns FALLBACK_LANGUAGE if the input is missing or
 * unparseable.
 */
function normaliseLanguage(language) {
  if (typeof language !== 'string' || !language.trim()) {
    return FALLBACK_LANGUAGE;
  }
  return language.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Build the README.txt body for a GDPR data export.
 *
 * @param {object} args
 * @param {string|undefined} args.language - The owner's preferred
 *   locale from `user.language`. Falls back to en when absent or
 *   when the locale has no override.
 * @param {string} args.uniqueId - The owner's uniqueId.
 * @param {string} args.exportDateIso - ISO-8601 timestamp for the
 *   export.
 * @param {boolean} args.partial - Whether the export is partial
 *   (failed sections were omitted).
 * @param {string[]} args.failedSections - Section names that failed
 *   to be exported. Used only when `partial` is true.
 * @returns {string} The README.txt body as a newline-joined string.
 */
function buildReadme({ language, uniqueId, exportDateIso, partial, failedSections }) {
  const lines = [
    t(language, 'title'),
    t(language, 'titleUnderline'),
    '',
    `${t(language, 'userIdLabel')}: ${uniqueId}`,
    `${t(language, 'exportDateLabel')}: ${exportDateIso}`,
    '',
  ];

  if (partial) {
    lines.push(
      t(language, 'partialWarning'),
      '',
      t(language, 'partialIntroLine1'),
      t(language, 'partialIntroLine2'),
      '',
      ...failedSections.map((s) => `  - ${s}`),
      '',
      ...t(language, 'partialOutro'),
      '',
    );
  } else {
    lines.push(t(language, 'fullIntro'), '');
  }

  lines.push(t(language, 'filesHeader'));
  for (const [filename, description] of t(language, 'fileEntries')) {
    lines.push(`  ${filename} — ${description}`);
  }

  return lines.join('\n');
}

module.exports = {
  buildReadme,
  // Exported for tests + future contributors who want to add a
  // locale: confirm the en table is the source-of-truth shape, then
  // add a parallel entry.
  STRINGS,
  FALLBACK_LANGUAGE,
  normaliseLanguage,
};
