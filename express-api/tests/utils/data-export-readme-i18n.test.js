const {
  buildReadme,
  STRINGS,
  FALLBACK_LANGUAGE,
  normaliseLanguage,
} = require('../../src/utils/data-export-readme-i18n');

describe('normaliseLanguage', () => {
  test('strips region tags and lower-cases', () => {
    expect(normaliseLanguage('en-US')).toBe('en');
    expect(normaliseLanguage('FR')).toBe('fr');
    expect(normaliseLanguage('zh-Hans-CN')).toBe('zh');
    expect(normaliseLanguage('pt_BR')).toBe('pt');
  });

  test('returns fallback for missing / empty / non-string input', () => {
    expect(normaliseLanguage(undefined)).toBe(FALLBACK_LANGUAGE);
    expect(normaliseLanguage(null)).toBe(FALLBACK_LANGUAGE);
    expect(normaliseLanguage('')).toBe(FALLBACK_LANGUAGE);
    expect(normaliseLanguage('   ')).toBe(FALLBACK_LANGUAGE);
    expect(normaliseLanguage(42)).toBe(FALLBACK_LANGUAGE);
  });
});

describe('STRINGS table shape', () => {
  test('every locale entry has the same shape as the en source-of-truth', () => {
    const enKeys = Object.keys(STRINGS.en).sort();
    for (const [locale, table] of Object.entries(STRINGS)) {
      if (locale === FALLBACK_LANGUAGE) continue;
      const localeKeys = Object.keys(table).sort();
      // Each non-en locale may have a SUBSET of keys (untranslated
      // keys fall back to en), but every key it DOES have must exist
      // in en. This catches typos like 'titleUnderlne' that would
      // silently miss the en fallback because the key is wrong.
      for (const key of localeKeys) {
        expect(enKeys).toContain(key);
        // Type-match guard: if en has an array, the locale override
        // must also be an array (and non-empty). Without this check,
        // a contributor writing `partialOutro: 'one sentence'` would
        // pass the key-existence test, then fail at runtime by
        // character-spreading the string into the README.
        if (Array.isArray(STRINGS.en[key])) {
          expect(Array.isArray(table[key])).toBe(true);
          expect(table[key].length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('STRINGS.en defines all the keys that buildReadme references', () => {
    // Calling buildReadme with an unsupported locale exercises every
    // fallback path; if buildReadme references a key that en doesn't
    // have, this would throw or produce undefined-joined strings.
    const en = STRINGS.en;
    expect(en.title).toBe('ShyTalk Data Export');
    expect(en.titleUnderline).toBeDefined();
    expect(en.userIdLabel).toBeDefined();
    expect(en.exportDateLabel).toBeDefined();
    expect(en.partialWarning).toBeDefined();
    expect(en.partialIntroLine1).toBeDefined();
    expect(en.partialIntroLine2).toBeDefined();
    expect(Array.isArray(en.partialOutro)).toBe(true);
    expect(en.fullIntro).toBeDefined();
    expect(en.filesHeader).toBeDefined();
    expect(Array.isArray(en.fileEntries)).toBe(true);
    expect(en.fileEntries.length).toBeGreaterThan(0);
    for (const entry of en.fileEntries) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry.length).toBe(2);
    }
  });
});

describe('buildReadme', () => {
  const baseArgs = {
    language: 'en',
    uniqueId: '12345678',
    exportDateIso: '2026-06-04T03:30:00.000Z',
    partial: false,
    failedSections: [],
  };

  test('en full export contains expected sections', () => {
    const readme = buildReadme(baseArgs);

    expect(readme).toContain('ShyTalk Data Export');
    expect(readme).toContain('===================');
    expect(readme).toContain('User ID: 12345678');
    expect(readme).toContain('Export date: 2026-06-04T03:30:00.000Z');
    expect(readme).toContain('This ZIP contains all personal data');
    expect(readme).toContain('Files:');
    expect(readme).toContain('profile.json');
    expect(readme).toContain('manifest.json');
    // Full exports do NOT have the partial warning.
    expect(readme).not.toContain('PARTIAL EXPORT');
  });

  test('en partial export surfaces the warning + failed sections', () => {
    const readme = buildReadme({
      ...baseArgs,
      partial: true,
      failedSections: ['conversations', 'rooms'],
    });

    expect(readme).toContain('PARTIAL EXPORT');
    expect(readme).toContain('This export is incomplete');
    expect(readme).toContain('  - conversations');
    expect(readme).toContain('  - rooms');
    expect(readme).toContain('You can request a fresh export in 24 hours');
    // Partial exports do NOT have the "all personal data" intro.
    expect(readme).not.toContain('This ZIP contains all personal data');
  });

  test('missing language defaults to en', () => {
    const enReadme = buildReadme(baseArgs);
    const undefinedReadme = buildReadme({ ...baseArgs, language: undefined });
    const emptyReadme = buildReadme({ ...baseArgs, language: '' });
    const nullReadme = buildReadme({ ...baseArgs, language: null });

    expect(undefinedReadme).toBe(enReadme);
    expect(emptyReadme).toBe(enReadme);
    expect(nullReadme).toBe(enReadme);
  });

  test('unsupported language falls back to en', () => {
    const enReadme = buildReadme(baseArgs);
    const klingonReadme = buildReadme({ ...baseArgs, language: 'tlh' });

    expect(klingonReadme).toBe(enReadme);
  });

  test('region tags are stripped before lookup', () => {
    const enReadme = buildReadme(baseArgs);
    const enUsReadme = buildReadme({ ...baseArgs, language: 'en-US' });
    const upperEnReadme = buildReadme({ ...baseArgs, language: 'EN' });

    expect(enUsReadme).toBe(enReadme);
    expect(upperEnReadme).toBe(enReadme);
  });

  test('partial export with no failed sections still renders cleanly', () => {
    const readme = buildReadme({ ...baseArgs, partial: true, failedSections: [] });

    expect(readme).toContain('PARTIAL EXPORT');
    expect(readme).not.toContain('  - ');
  });

  test('file entries are formatted as `  <name> — <description>`', () => {
    const readme = buildReadme(baseArgs);
    // Spot-check one entry to pin the format. The leading two spaces
    // come from the template literal; the padding spaces between the
    // filename column and the em-dash come from the STRINGS table's
    // trailing-space padding so all file entries align vertically.
    expect(readme).toMatch(/ {2}profile\.json {6}— Your profile information/);
  });
});

describe('contributor-footgun guards (reviewer Important findings on PR)', () => {
  test('wrong-type override falls back to en (string-where-array expected)', () => {
    // A contributor writes `partialOutro: 'Vous pouvez...'` (a string)
    // for a locale that needs only a single-sentence outro. Without
    // the type-match guard, `...t(language, 'partialOutro')` would
    // character-spread the string into the README. With the guard,
    // we fall back to en's array form so the output stays sane.
    const originalEs = STRINGS.es;
    STRINGS.es = {
      partialOutro: 'Single sentence wrongly typed as a string',
    };

    try {
      const readme = buildReadme({
        language: 'es',
        uniqueId: '12345678',
        exportDateIso: '2026-06-04T03:30:00.000Z',
        partial: true,
        failedSections: ['conversations'],
      });

      // The en outro is used (two lines), not the locale's string.
      expect(readme).toContain('You can request a fresh export in 24 hours');
      // No characters from the wrong-type string leak in.
      expect(readme).not.toContain('Single sentence wrongly typed');
      // No character-spread evidence: should NOT contain a line that's
      // just one character (which would happen if the string spread).
      const lines = readme.split('\n');
      const singleCharLines = lines.filter((l) => l.length === 1);
      expect(singleCharLines).toHaveLength(0);
    } finally {
      if (originalEs === undefined) delete STRINGS.es;
      else STRINGS.es = originalEs;
    }
  });

  test('empty-array override falls back to en (fileEntries: [] placeholder)', () => {
    // A contributor leaves `fileEntries: []` as a TODO placeholder.
    // Without the empty-guard, the README would render `Files:` with
    // no entries — silently empty. With the guard, we fall back to
    // en's populated array so the user sees the file list.
    const originalEs = STRINGS.es;
    STRINGS.es = {
      fileEntries: [],
    };

    try {
      const readme = buildReadme({
        language: 'es',
        uniqueId: '12345678',
        exportDateIso: '2026-06-04T03:30:00.000Z',
        partial: false,
        failedSections: [],
      });

      // The en fileEntries are used, not the empty array.
      expect(readme).toContain('profile.json');
      expect(readme).toContain('manifest.json');
      expect(readme).toContain('conversations/');
    } finally {
      if (originalEs === undefined) delete STRINGS.es;
      else STRINGS.es = originalEs;
    }
  });

  test('array-where-string expected falls back to en (inverse type mismatch)', () => {
    // Mirror of the wrong-type guard: if a contributor writes
    // `title: ['ShyTalk', 'Data Export']` (an array) for a key that
    // en has as a string, fall back to en. Without the guard, the
    // string concatenation `${t(...)}: ${...}` would produce
    // `ShyTalk,Data Export: ...` (JS array-to-string coercion).
    const originalEs = STRINGS.es;
    STRINGS.es = {
      title: ['Wrong', 'Type', 'Override'],
    };

    try {
      const readme = buildReadme({
        language: 'es',
        uniqueId: '12345678',
        exportDateIso: '2026-06-04T03:30:00.000Z',
        partial: false,
        failedSections: [],
      });

      // The en title is used, not the array.
      expect(readme).toContain('ShyTalk Data Export');
      expect(readme).not.toContain('Wrong,Type,Override');
    } finally {
      if (originalEs === undefined) delete STRINGS.es;
      else STRINGS.es = originalEs;
    }
  });
});

describe('contributor flow — adding a new locale', () => {
  // The README-i18n module is structured so a future PR can add a
  // locale by dropping an entry into STRINGS keyed by the 2-letter
  // code. This test simulates the contributor pattern to ensure the
  // mechanics work end-to-end without needing to actually ship 19
  // translations in this PR.
  test('locale-specific override is used when present', () => {
    // Temporarily monkey-patch STRINGS for the duration of the test.
    const originalEs = STRINGS.es;
    STRINGS.es = {
      title: 'Exportación de datos de ShyTalk',
      // Other keys deliberately omitted to exercise the per-key
      // fallback to en.
    };

    try {
      const readme = buildReadme({
        language: 'es',
        uniqueId: '12345678',
        exportDateIso: '2026-06-04T03:30:00.000Z',
        partial: false,
        failedSections: [],
      });

      // Spanish title is used.
      expect(readme).toContain('Exportación de datos de ShyTalk');
      // English files header is used (no Spanish override).
      expect(readme).toContain('Files:');
      // English file entries are used (no Spanish override).
      expect(readme).toContain('profile.json');
    } finally {
      // Restore so this test doesn't leak state into other tests.
      if (originalEs === undefined) {
        delete STRINGS.es;
      } else {
        STRINGS.es = originalEs;
      }
    }
  });
});
