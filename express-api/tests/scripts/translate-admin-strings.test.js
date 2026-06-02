/**
 * Unit tests for scripts/translate-admin-strings.js.
 *
 * The script extends the project's translation-source rule (Google free
 * endpoint with claude-fallback manifest, provenance-tagged) to the
 * admin-panel JS object format at public/admin/translations.js.
 *
 * Why this is its own script, not a flag on translate-strings.js:
 *   - The two writers (XML upsert vs JS-object brace-splice) are
 *     structurally different. A mode flag couples them; a shared lib
 *     for the Google call plus per-format scripts keeps each writer
 *     reasoning-local.
 *
 * The five overrides (DOB, ID, at, system, method) carry semantic
 * baggage that machine translation can't preserve:
 *   - DOB / ID are acronyms (must be verbatim across locales)
 *   - `at` is a single-letter English preposition with no portable
 *     translation absent context
 *   - `system` / `method` collide with multiple locale-specific terms;
 *     we hold off on machine guesses pending native-speaker review
 *
 * The override constant lives in the script itself, not in JSON: at 5
 * entries it's small enough that a JSON file adds schema-maintenance
 * overhead without paying back in clarity. If it grows past ~15 entries
 * the threshold to extract flips.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'translate-admin-strings.js');

describe('scripts/translate-admin-strings.js — module surface', () => {
  test('script file exists', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  test('exports the parser/writer/driver surface used by tests', () => {
    const mod = require(SCRIPT_PATH);
    expect(typeof mod.parseAdminTranslations).toBe('function');
    expect(typeof mod.upsertAdminTranslation).toBe('function');
    expect(typeof mod.findMissingKeys).toBe('function');
    expect(typeof mod.translateAdminKeys).toBe('function');
    expect(typeof mod.TRANSLATION_OVERRIDES).toBe('object');
    expect(Array.isArray(mod.LOCALES)).toBe(true);
    expect(mod.LOCALES).toHaveLength(20);
  });
});

describe('parseAdminTranslations', () => {
  let parseAdminTranslations;
  beforeAll(() => {
    parseAdminTranslations = require(SCRIPT_PATH).parseAdminTranslations;
  });

  test('extracts keys from a multi-line en block', () => {
    const src = [
      '/* eslint-disable */',
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    tab_users: 'Users', tab_appeals: 'Appeals',",
      "    btn_sign_in: 'Sign In',",
      '  },',
      '  ar: {',
      "    tab_users: 'arabic',",
      '  },',
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.en).toEqual({
      tab_users: 'Users',
      tab_appeals: 'Appeals',
      btn_sign_in: 'Sign In',
    });
    expect(parsed.ar).toEqual({ tab_users: 'arabic' });
  });

  test('extracts keys from a single-line compact block (nl-style)', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    a: 'A', b: 'B',",
      '  },',
      "  nl: { a: 'Aa', b: 'Bb', c: 'Cc' },",
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.nl).toEqual({ a: 'Aa', b: 'Bb', c: 'Cc' });
  });

  test('handles double-quoted values containing apostrophes', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      `    msg: "the user's profile",`,
      "    other: 'plain value',",
      '  },',
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.en).toEqual({
      msg: "the user's profile",
      other: 'plain value',
    });
  });

  test('handles single-quoted values containing escaped quotes', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    a: 'it\\'s here',",
      '  },',
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.en).toEqual({ a: "it's here" });
  });

  test('values containing a literal `{` do not confuse brace-depth tracking', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    tmpl: 'Welcome {name}, you have {count} items.',",
      "    next: 'Next',",
      '  },',
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.en.tmpl).toBe('Welcome {name}, you have {count} items.');
    expect(parsed.en.next).toBe('Next');
  });

  test('ignores section comments inside blocks', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      '    // ─── Section header ───',
      "    a: 'A',",
      '    /* block comment */',
      "    b: 'B',",
      '  },',
      '};',
    ].join('\n');
    const parsed = parseAdminTranslations(src);
    expect(parsed.en).toEqual({ a: 'A', b: 'B' });
  });
});

describe('upsertAdminTranslation', () => {
  let upsertAdminTranslation;
  let parseAdminTranslations;
  beforeAll(() => {
    const mod = require(SCRIPT_PATH);
    upsertAdminTranslation = mod.upsertAdminTranslation;
    parseAdminTranslations = mod.parseAdminTranslations;
  });

  const baseSrc = [
    'var ADMIN_TRANSLATIONS = {',
    '  en: {',
    "    existing_key: 'Existing',",
    '  },',
    '  ar: {',
    "    existing_key: 'arabic existing',",
    '  },',
    '};',
  ].join('\n');

  test('inserts a new key with provenance comment', () => {
    const updated = upsertAdminTranslation(baseSrc, 'ar', 'new_key', 'arabic new', 'google');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.ar.existing_key).toBe('arabic existing');
    expect(parsed.ar.new_key).toBe('arabic new');
    // Provenance tag MUST be in the file so future re-runs can skip it.
    expect(updated).toMatch(/google-translated \d{4}-\d{2}-\d{2}/);
  });

  test('re-running upsert with same key/value is idempotent', () => {
    const once = upsertAdminTranslation(baseSrc, 'ar', 'new_key', 'arabic new', 'google');
    const twice = upsertAdminTranslation(once, 'ar', 'new_key', 'arabic new', 'google');
    const parsed = parseAdminTranslations(twice);
    expect(parsed.ar.new_key).toBe('arabic new');
    // `new_key:` must appear exactly once in the ar block — duplicates
    // would corrupt the object at runtime (last-wins, but with stale
    // provenance pointing at non-current value).
    const arStart = twice.indexOf('\n  ar: {');
    const arEnd = twice.indexOf('\n  },', arStart);
    const arBody = twice.substring(arStart, arEnd);
    const matches = arBody.match(/\bnew_key\s*:/g) || [];
    expect(matches).toHaveLength(1);
  });

  test('upserting with a new value replaces the old one', () => {
    const once = upsertAdminTranslation(baseSrc, 'ar', 'new_key', 'first', 'google');
    const twice = upsertAdminTranslation(once, 'ar', 'new_key', 'second', 'google');
    const parsed = parseAdminTranslations(twice);
    expect(parsed.ar.new_key).toBe('second');
  });

  test.each(['google', 'claude', 'override'])(
    'replacing a key previously sourced from %s leaves exactly one provenance comment',
    (initialSource) => {
      const once = upsertAdminTranslation(baseSrc, 'ar', 'new_key', 'first', initialSource);
      const twice = upsertAdminTranslation(once, 'ar', 'new_key', 'second', 'override');
      const arStart = twice.indexOf('\n  ar: {');
      const arEnd = twice.indexOf('\n  },', arStart);
      const arBody = twice.substring(arStart, arEnd);
      // The new entry has one provenance comment (the override one).
      // The old comment from the initial source must have been
      // consumed by the replacement regex, not left dangling above
      // it — checking by count covers all three initial sources with
      // the same assertion shape.
      const provenanceMatches = arBody.match(/(?:google|claude|override)-translated/g) || [];
      expect(provenanceMatches).toHaveLength(1);
      expect(arBody).toMatch(/override-translated/);
    },
  );

  test('inserts into the correct locale block — does not touch others', () => {
    const updated = upsertAdminTranslation(baseSrc, 'ar', 'new_key', 'arabic new', 'google');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.en).not.toHaveProperty('new_key');
    expect(parsed.ar.new_key).toBe('arabic new');
  });

  test('handles values containing quotes via JSON-safe escaping', () => {
    const updated = upsertAdminTranslation(
      baseSrc,
      'ar',
      'tricky',
      `she said "hi" — it's odd`,
      'google',
    );
    const parsed = parseAdminTranslations(updated);
    expect(parsed.ar.tricky).toBe(`she said "hi" — it's odd`);
  });

  test('handles values with literal backslashes', () => {
    const updated = upsertAdminTranslation(baseSrc, 'ar', 'p', 'C:\\Users\\x', 'google');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.ar.p).toBe('C:\\Users\\x');
  });

  test('upsert into a single-line compact locale block (nl-style)', () => {
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    a: 'A',",
      '  },',
      "  nl: { a: 'Aa' },",
      '};',
    ].join('\n');
    const updated = upsertAdminTranslation(src, 'nl', 'b', 'Bb', 'google');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.nl).toEqual({ a: 'Aa', b: 'Bb' });
  });

  test('upsert REPLACES an existing key in a compact single-line block', () => {
    // Reviewer-flagged gap: insertion into a compact block was tested
    // but the replace path on the same shape was not — and the brace-
    // counting upsert logic takes a different branch for replace.
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    a: 'A', b: 'B',",
      '  },',
      "  nl: { a: 'Aa', b: 'Bb' },",
      '};',
    ].join('\n');
    const updated = upsertAdminTranslation(src, 'nl', 'a', 'Aaa', 'override');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.nl).toEqual({ a: 'Aaa', b: 'Bb' });
    // The `b` key in nl must remain intact AFTER the in-place replace.
    expect(updated).toMatch(/b:\s*['"]Bb['"]/);
  });

  test('upsert does not false-match a key occurrence inside a comment', () => {
    // Reviewer I1: a section comment like `// EXAMPLE: 'old_value'`
    // contains the regex-shaped `identifier: 'string'` pattern. The
    // existence check must be made against a comment-blanked view so
    // the splice does not accidentally rewrite the comment.
    const src = [
      'var ADMIN_TRANSLATIONS = {',
      '  en: {',
      "    // example_key: 'should not match'",
      "    real_key: 'real',",
      '  },',
      '  ar: {',
      "    // example_key: 'comment-only'",
      "    real_key: 'real_ar',",
      '  },',
      '};',
    ].join('\n');
    const updated = upsertAdminTranslation(src, 'ar', 'example_key', 'inserted', 'override');
    const parsed = parseAdminTranslations(updated);
    expect(parsed.ar.example_key).toBe('inserted');
    // The comment line must still be intact — the splice must NOT
    // have replaced the commented-out example.
    expect(updated).toMatch(/\/\/ example_key: 'comment-only'/);
  });

  test('throws on unknown locale rather than corrupting the file', () => {
    expect(() => upsertAdminTranslation(baseSrc, 'zz', 'k', 'v', 'google')).toThrow(/locale.*zz/i);
  });
});

describe('blankCommentsPreservingOffsets', () => {
  let blankCommentsPreservingOffsets;
  beforeAll(() => {
    blankCommentsPreservingOffsets = require(SCRIPT_PATH).blankCommentsPreservingOffsets;
  });

  test('produces an output of equal length to the input', () => {
    const src = "abc // foo\nbar /* a */ baz 'q' x";
    const blanked = blankCommentsPreservingOffsets(src);
    expect(blanked).toHaveLength(src.length);
  });

  test('replaces line comments with spaces (no leak of comment text)', () => {
    const blanked = blankCommentsPreservingOffsets('a // foo\nb');
    expect(blanked).toBe('a       \nb');
  });

  test('replaces block comments with spaces, preserving embedded newlines', () => {
    const src = 'a /* one\ntwo */ b';
    const blanked = blankCommentsPreservingOffsets(src);
    expect(blanked).toHaveLength(src.length);
    // The two embedded newlines (well, one) survive so line indexing aligns.
    expect(blanked).toContain('\n');
    expect(blanked.replace(/\s/g, '')).toBe('ab');
  });

  test('leaves string literals (including comment-like content) intact', () => {
    const src = "x: 'value // not a comment'";
    const blanked = blankCommentsPreservingOffsets(src);
    expect(blanked).toBe(src);
  });

  test('handles escaped quotes inside strings — string body intact, trailing comment blanked', () => {
    const src = "x: 'it\\'s here' // trailing";
    const blanked = blankCommentsPreservingOffsets(src);
    expect(blanked).toHaveLength(src.length);
    // The string literal portion (incl. the escaped apostrophe) is
    // preserved verbatim.
    expect(blanked.startsWith("x: 'it\\'s here'")).toBe(true);
    // Everything past the closing quote is whitespace (the space
    // between the quote and `//`, plus the blanked comment).
    expect(blanked.slice("x: 'it\\'s here'".length)).toMatch(/^ +$/);
  });
});

describe('decodeJsStringLiteral edge cases', () => {
  let decodeJsStringLiteral;
  beforeAll(() => {
    decodeJsStringLiteral = require(SCRIPT_PATH).decodeJsStringLiteral;
  });

  test('throws on truncated \\uXXXX escape rather than silently emitting \\u0000', () => {
    // Reviewer I4: parseInt('', 16) returns NaN; String.fromCharCode(NaN)
    // is U+0000 — silent corruption. Must throw instead.
    expect(() => decodeJsStringLiteral("'\\u00'")).toThrow(/truncated|invalid/i);
    expect(() => decodeJsStringLiteral("'\\u'")).toThrow(/truncated|invalid/i);
  });

  test('throws on non-hex characters in \\uXXXX', () => {
    expect(() => decodeJsStringLiteral("'\\uGHIJ'")).toThrow(/truncated|invalid/i);
  });

  test('still decodes valid 4-digit \\uXXXX escapes', () => {
    expect(decodeJsStringLiteral("'\\u0627'")).toBe('ا'); // Arabic alef
    expect(decodeJsStringLiteral('"\\u00E9"')).toBe('é');
  });

  test('decodes \\n, \\t, \\r, \\\\ and pass-through escapes', () => {
    expect(decodeJsStringLiteral("'a\\nb'")).toBe('a\nb');
    expect(decodeJsStringLiteral("'a\\tb'")).toBe('a\tb');
    expect(decodeJsStringLiteral("'a\\rb'")).toBe('a\rb');
    expect(decodeJsStringLiteral("'a\\\\b'")).toBe('a\\b');
    expect(decodeJsStringLiteral("'it\\'s'")).toBe("it's");
  });
});

describe('findMissingKeys', () => {
  let findMissingKeys;
  beforeAll(() => {
    findMissingKeys = require(SCRIPT_PATH).findMissingKeys;
  });

  test('returns en keys absent in each non-en locale', () => {
    const parsed = {
      en: { a: 'A', b: 'B', c: 'C' },
      ar: { a: 'arA' },
      de: { a: 'deA', b: 'deB' },
    };
    expect(findMissingKeys(parsed, ['ar', 'de'])).toEqual({
      ar: ['b', 'c'],
      de: ['c'],
    });
  });

  test('omits locales that already have full parity', () => {
    const parsed = {
      en: { a: 'A' },
      ar: { a: 'arA' },
    };
    expect(findMissingKeys(parsed, ['ar'])).toEqual({});
  });

  test('throws if en block is missing rather than report all keys missing', () => {
    expect(() => findMissingKeys({ ar: { a: 'arA' } }, ['ar'])).toThrow(/en/i);
  });
});

describe('translateAdminKeys — driver with mocked Google', () => {
  let translateAdminKeys;
  let TRANSLATION_OVERRIDES;
  let tmpFile;

  beforeAll(() => {
    const mod = require(SCRIPT_PATH);
    translateAdminKeys = mod.translateAdminKeys;
    TRANSLATION_OVERRIDES = mod.TRANSLATION_OVERRIDES;
  });

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `admin-translations-${crypto.randomUUID()}.js`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  function writeFixture(contents) {
    fs.writeFileSync(tmpFile, contents);
  }

  test('inserts mock-translated values for the requested keys × locales', async () => {
    writeFixture(
      [
        'var ADMIN_TRANSLATIONS = {',
        '  en: {',
        "    new_key: 'Hello',",
        '  },',
        '  ar: {',
        "    existing: 'arabic existing',",
        '  },',
        '  de: {',
        "    existing: 'deutsch existing',",
        '  },',
        '};',
      ].join('\n'),
    );

    const fakeTranslate = jest.fn(async (text, locale) => `${locale}:${text}`);

    const result = await translateAdminKeys({
      filePath: tmpFile,
      keys: ['new_key'],
      locales: ['ar', 'de'],
      apply: true,
      googleTranslateFn: fakeTranslate,
    });

    expect(fakeTranslate).toHaveBeenCalledWith('Hello', 'ar');
    expect(fakeTranslate).toHaveBeenCalledWith('Hello', 'de');
    expect(result.googleCount).toBe(2);
    expect(result.skipCount).toBe(0);
    expect(result.claudeTodo).toHaveLength(0);

    const after = fs.readFileSync(tmpFile, 'utf8');
    const parsed = require(SCRIPT_PATH).parseAdminTranslations(after);
    expect(parsed.ar.new_key).toBe('ar:Hello');
    expect(parsed.de.new_key).toBe('de:Hello');
  });

  test('TRANSLATION_OVERRIDES bypass Google entirely', async () => {
    writeFixture(
      [
        'var ADMIN_TRANSLATIONS = {',
        '  en: {',
        "    DOB: 'DOB',",
        '  },',
        '  ar: {},',
        '  de: {},',
        '};',
      ].join('\n'),
    );

    expect(TRANSLATION_OVERRIDES).toHaveProperty('DOB');

    const fakeTranslate = jest.fn(async () => {
      throw new Error('Google must NOT be called for override keys');
    });

    const result = await translateAdminKeys({
      filePath: tmpFile,
      keys: ['DOB'],
      locales: ['ar', 'de'],
      apply: true,
      googleTranslateFn: fakeTranslate,
    });

    expect(fakeTranslate).not.toHaveBeenCalled();
    expect(result.googleCount).toBe(0);
    expect(result.overrideCount).toBe(2);
    const after = fs.readFileSync(tmpFile, 'utf8');
    const parsed = require(SCRIPT_PATH).parseAdminTranslations(after);
    expect(parsed.ar.DOB).toBe('DOB');
    expect(parsed.de.DOB).toBe('DOB');
  });

  test('does not write when apply=false', async () => {
    writeFixture(
      [
        'var ADMIN_TRANSLATIONS = {',
        '  en: {',
        "    new_key: 'Hello',",
        '  },',
        '  ar: {},',
        '};',
      ].join('\n'),
    );
    const before = fs.readFileSync(tmpFile, 'utf8');

    const fakeTranslate = jest.fn(async (text, locale) => `${locale}:${text}`);
    await translateAdminKeys({
      filePath: tmpFile,
      keys: ['new_key'],
      locales: ['ar'],
      apply: false,
      googleTranslateFn: fakeTranslate,
    });

    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(before);
  });

  test('falls back to claude-todo manifest on GOOGLE_QUOTA_EXHAUSTED', async () => {
    writeFixture(
      [
        'var ADMIN_TRANSLATIONS = {',
        '  en: {',
        "    new_key: 'Hello',",
        '  },',
        '  ar: {},',
        '  de: {},',
        '};',
      ].join('\n'),
    );

    const fakeTranslate = jest.fn(async () => {
      throw new Error('GOOGLE_QUOTA_EXHAUSTED');
    });

    const result = await translateAdminKeys({
      filePath: tmpFile,
      keys: ['new_key'],
      locales: ['ar', 'de'],
      apply: true,
      googleTranslateFn: fakeTranslate,
    });

    expect(result.googleCount).toBe(0);
    expect(result.claudeTodo).toHaveLength(2);
    expect(result.claudeTodo[0]).toMatchObject({
      key: 'new_key',
      en: 'Hello',
    });
  });

  test('skips keys missing from the en block with a warning', async () => {
    writeFixture(
      [
        'var ADMIN_TRANSLATIONS = {',
        '  en: {',
        "    real_key: 'Real',",
        '  },',
        '  ar: {},',
        '};',
      ].join('\n'),
    );

    const fakeTranslate = jest.fn(async (text, locale) => `${locale}:${text}`);
    const result = await translateAdminKeys({
      filePath: tmpFile,
      keys: ['real_key', 'phantom_key'],
      locales: ['ar'],
      apply: true,
      googleTranslateFn: fakeTranslate,
    });

    expect(result.googleCount).toBe(1);
    expect(result.skipCount).toBe(1);
    expect(fakeTranslate).toHaveBeenCalledTimes(1);
    expect(fakeTranslate).toHaveBeenCalledWith('Real', 'ar');
  });
});

describe('TRANSLATION_OVERRIDES — content invariants', () => {
  let TRANSLATION_OVERRIDES;
  beforeAll(() => {
    TRANSLATION_OVERRIDES = require(SCRIPT_PATH).TRANSLATION_OVERRIDES;
  });

  test.each([
    ['DOB', 'acronym — must stay verbatim across locales'],
    ['ID', 'acronym — must stay verbatim across locales'],
    ['at', 'single-letter preposition with no portable translation'],
    ['system', 'collides with multiple locale-specific terms'],
    ['method', 'collides with multiple locale-specific terms'],
  ])('%s is overridden (%s)', (key) => {
    expect(TRANSLATION_OVERRIDES).toHaveProperty(key);
  });

  test('overrides with null value mean "copy en verbatim"', () => {
    for (const [, value] of Object.entries(TRANSLATION_OVERRIDES)) {
      // The contract: either null (copy en) or a string (fixed value
      // used for every locale). Anything else is a typo.
      expect(value === null || typeof value === 'string').toBe(true);
    }
  });
});
