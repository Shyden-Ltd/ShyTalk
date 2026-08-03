/**
 * SHY-0271 — locale strings are CONTENT, and nothing was checking their content.
 *
 * The operator read `Driver\'s license` — with a literal backslash — off the
 * age-verification screen. It had shipped. Every existing check passed it:
 *
 *   - key-parity across the 21 locales counts KEYS, never their values
 *   - journey and instrumented assertions match by testTag, so a control with
 *     a corrupt label is still "found"
 *   - nothing at all read the locale files as text
 *
 * The trap: `\'` and `\"` are ANDROID XML escaping. Compose Multiplatform's
 * `composeResources` does NOT unescape them, so they render literally.
 *
 * What Compose DOES unescape was settled empirically rather than argued, by
 * resolving all 838 strings through the real pipeline on a real device
 * (`StringResourceContentTest`): `\uXXXX` IS unescaped, `\'` is NOT. The corpus
 * has since been normalised so the only backslash sequence remaining anywhere
 * is `\n`, a genuine line break — which lets the rule below be a flat "no
 * backslashes except `\n`" with no allowlist to rot.
 *
 * This file is the cross-locale half of the guard; the device test is the other
 * half. Neither is sufficient alone: this one reads all 21 locales but only as
 * text, and that one renders for real but only in the device's locale.
 */

const {
  ALL_LOCALE_DIRS,
  localeFilePath,
  readLocaleStrings,
} = require('../_helpers/compose-locales');

const fs = require('node:fs');

/**
 * The single escape predicate. Referenced by the real check AND by the mutation
 * guard, deliberately: a guard that re-declares the predicate inline only ever
 * proves that `String.includes` works, and stays green while the real one is
 * weakened.
 */
const carriesAndroidEscape = (value) => /\\(?!n)/.test(value);

/** `TODO` is the ordinary Spanish word for "all" — these two are correct copy. */
const TODO_IS_A_REAL_WORD = new Set(['values-es/all_caps', 'values-es/collect_all']);

/** [{ locale, name, value }] for every <string> in every locale. */
function allStrings() {
  return ALL_LOCALE_DIRS.flatMap((locale) =>
    readLocaleStrings(locale).entries.map(({ name, value }) => ({ locale, name, value })),
  );
}

/** The format placeholders a string takes, e.g. ['%1$s', '%2$d'], sorted. */
const placeholders = (value) => (value.match(/%\d+\$[a-z]/g) || []).sort();

describe('locale strings render as written', () => {
  const strings = allStrings();
  const describeOffender = (s) => `${s.locale}/${s.name}: ${s.value.slice(0, 60)}`;

  test('every declared locale file exists and was parsed COMPLETELY', () => {
    // Not a threshold. A count-based floor ("at least 20 files, at least 15000
    // strings") tolerates whole files going dark — three could vanish and the
    // suite would stay green. Comparing the parser's yield against the raw
    // element count, per file, fails on any formatting the regex cannot handle.
    const report = ALL_LOCALE_DIRS.map((dir) => {
      expect(fs.existsSync(localeFilePath(dir))).toBe(true);
      const { entries, rawCount } = readLocaleStrings(dir);
      return { dir, parsed: entries.length, raw: rawCount };
    });
    expect(report.filter((r) => r.parsed !== r.raw)).toEqual([]);
    // Every locale carries the same key count; a change here is deliberate.
    expect([...new Set(report.map((r) => r.parsed))]).toEqual([838]);
  });

  test('no string carries an Android-style escape sequence', () => {
    // Any backslash except `\n`. Enumerating the sequences we know about is
    // exactly how `\'` survived — and then `\"`, and then zh's `\“`. The strict
    // rule needs no maintenance and cannot be outflanked by a new character.
    expect(strings.filter((s) => carriesAndroidEscape(s.value)).map(describeOffender)).toEqual([]);
  });

  test('no string is empty or whitespace-only', () => {
    expect(strings.filter((s) => s.value.trim() === '').map(describeOffender)).toEqual([]);
  });

  test('no string leaks a developer marker left in place of copy', () => {
    const offenders = strings
      .filter((s) => {
        if (/\b(FIXME|XXX|PLACEHOLDER)\b/.test(s.value)) return true;
        if (TODO_IS_A_REAL_WORD.has(`${s.locale}/${s.name}`)) return false;
        return /\bTODO\b/.test(s.value);
      })
      .map(describeOffender);
    expect(offenders).toEqual([]);
  });

  test('the TODO allowlist has no dead entries', () => {
    // An allowlist that stops matching decays into a silent bypass. If one of
    // these keys is retranslated away from "TODO", the entry must go too.
    const stale = [...TODO_IS_A_REAL_WORD].filter(
      (entry) =>
        !strings.some((s) => `${s.locale}/${s.name}` === entry && /\bTODO\b/.test(s.value)),
    );
    expect(stale).toEqual([]);
  });

  test('no string contains a stray XML/HTML tag', () => {
    // Compose renders these literally; they are almost always a paste error.
    const offenders = strings
      .filter((s) => /<\/?(?:div|span|p|br|b|i|html|body)\b/i.test(s.value))
      .map(describeOffender);
    expect(offenders).toEqual([]);
  });

  test('every translation takes the same placeholders as the English it replaces', () => {
    // A translation that drops `%1$d` renders a sentence with the number
    // missing — a count or a username that simply never appears. Key parity
    // cannot see this: the key is present and the value is plausible prose.
    const english = new Map(
      strings.filter((s) => s.locale === 'values').map((s) => [s.name, s.value]),
    );
    const offenders = strings
      .filter((s) => s.locale !== 'values')
      .filter((s) => english.has(s.name))
      .map((s) => ({ s, en: placeholders(english.get(s.name)), loc: placeholders(s.value) }))
      .filter(({ en, loc }) => en.join(',') !== loc.join(','))
      .map(({ s, en, loc }) => `${s.locale}/${s.name}: en=[${en}] ${s.locale}=[${loc}]`);
    expect(offenders).toEqual([]);
  });

  test('a format string never contains an unescaped literal percent', () => {
    // `String.format` reads every `%` as the start of a conversion, so a bare
    // one in a string that also takes arguments throws
    // UnknownFormatConversionException at render time — a crash, not a typo.
    // Found live: German shipped `(10 % % Bonus!)` and French `(bonus de 10 % !)`
    // where English correctly had `10%%`. A machine translator had inserted a
    // space into the escape.
    //
    // Strings with NO arguments never reach `String.format`, so a bare `%` in
    // prose ("10% bonus") is fine there and deliberately not flagged.
    const offenders = strings
      .filter((s) => /%\d+\$[a-z]/.test(s.value))
      .filter((s) => s.value.replace(/%(?:\d+\$[a-z]|%)/g, '').includes('%'))
      .map(describeOffender);
    expect(offenders).toEqual([]);
  });

  test('the percent rule distinguishes a crash from ordinary prose', () => {
    // Mutation guard for the check above: it must fire on the real German
    // defect and stay quiet on both a correctly-escaped format string and a
    // plain sentence that merely mentions a percentage.
    const isBroken = (v) =>
      /%\d+\$[a-z]/.test(v) && v.replace(/%(?:\d+\$[a-z]|%)/g, '').includes('%');
    expect(isBroken('%1$s Bohnen (10 % % Bonus!)')).toBe(true);
    expect(isBroken('Redeemed %1$s beans (10%% bonus!)')).toBe(false);
    expect(isBroken('+10% daily login coins')).toBe(false);
  });

  test('the escape predicate actually fires, and spares a real line break', () => {
    // Mutation guard on the SHARED predicate — weakening the rule above
    // reddens this. A guard with its own inline copy of the regex proves
    // nothing, which is the reason this defect shipped in the first place.
    expect(carriesAndroidEscape("Driver\\'s license")).toBe(true);
    expect(carriesAndroidEscape('escaped \\" quote')).toBe(true);
    expect(carriesAndroidEscape('curly \\“ quote')).toBe(true);
    expect(carriesAndroidEscape('a real\\nline break')).toBe(false);
    expect(carriesAndroidEscape("Driver's license")).toBe(false);
  });
});
