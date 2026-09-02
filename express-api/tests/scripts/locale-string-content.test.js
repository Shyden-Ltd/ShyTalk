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
 * resolving all 838 strings (839 since SHY-0348) through the real pipeline on a real device
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

/**
 * Locales where `TODO` is a real word rather than an unfinished string.
 *
 * Empty since SHY-0289. It held two Spanish entries — `TODO` is the ordinary
 * Spanish word for "all" — and Spanish is no longer one of the five languages
 * shipped. Kept as an empty set rather than deleted: the check it feeds is
 * still needed, and the next language that collides with `TODO` needs somewhere
 * to say so with a reason attached.
 */
const TODO_IS_A_REAL_WORD = new Set([]);

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
    // 838 -> 839 on 2026-08-19: SHY-0348 added `blocked_unblock_required` to
    // every locale ("They need to unblock you before you can view their
    // profile."). The count is pinned precisely so an addition has to be
    // acknowledged here rather than sliding in unnoticed.
    // 839 -> 838 on 2026-08-20: SHY-0144 retired the FunFact splash, which took
    // `splash_tagline` ("Voice chat rooms, reimagined.") out of all 21 locales
    // along with the screen that rendered it. A REMOVAL has to be acknowledged
    // here for the same reason an addition does.
    // 846 -> 859 on 2026-08-21: SHY-0387 turned the support dialog into a page --
    // three attachment errors, the category question, six category labels, and
    // three attachment controls.
    // 838 -> 846 on 2026-08-21: SHY-0385 added the in-app support form -- title,
    // hint, send, sent, and four error strings -- to all 21 locales. Worth noting
    // for the next person: the MVP locale rule (en/zh/id/vi/th) governs which
    // languages the PRODUCT ships in, not which files must stay in parity. The
    // 16 retired `values-*` directories still exist, and this pin plus the
    // locale-parity guard require every key in every one of them until SHY-0194
    // deletes them.
    // 860 -> 867 on 2026-08-22: SHY-0396 replaced the refusal with a choice.
    // OUT: `support_form_error_already_open` ("You already have a request open.
    // We will reply to that one.") and `support_duplicate_title`, both of which
    // said a second request would not be taken. IN: nine -- the confirmation for
    // a message ADDED to an open request, the back-of-the-queue reminder, the
    // three choices, and singular/plural/overflow forms of how many are open.
    // Net 860 - 2 + 9 = 867, and every one of the 21 files agrees on it, which
    // is what proves the removals did not silently take a neighbour with them.
    // 867 -> 870 on 2026-08-22: SHY-0387's attachment limits, corrected by the
    // operator. OUT: `support_form_error_attachment_too_large` ("under 25 MB"),
    // a single flat cap over images AND video that nobody had chosen. IN: the
    // image refusal (5 MB), the video refusal (30 seconds), the honest refusal
    // for a video whose length could not be READ, and the limits stated up
    // front before anybody picks a file. Net 867 - 1 + 4 = 870.
    // 870 -> 871 on 2026-08-22: the live character counter. The message bound
    // moved from 2,000 to 1,000 (operator), and a bound somebody only discovers
    // when they press Send costs them what they wrote — so the field shows the
    // count as they type.
    // 871 -> 872 on 2026-08-24: SHY-0422. `support_contact` -- "go to Settings
    // and choose Contact us" -- was shared by WarningScreen and SuspensionScreen.
    // The warned person lands back in the app; the suspended person is on a
    // terminal screen with no route to Settings, so for them that sentence names
    // somewhere they cannot get to. Split into `suspension_support_contact`,
    // which points at the appeal box beside it and at shyden.co.uk beyond that.
    // 872 -> 880 on 2026-08-24: SHY-0437's report guide. Choosing "Safety &
    // another user" now shows how to report -- profile, in-room user card, and
    // press-and-hold on a message -- before offering a ticket. Eight strings:
    // title, intro, three steps, and the escape hatch's heading, body and
    // button. No step mentions reporting a ROOM, because there is no such
    // control (SHY-0440).
    // 880 -> 883 on 2026-08-24: SHY-0433. An attachment was a filename and
    // nothing else; it now shows a thumbnail and opens full screen. Three
    // strings: open, close, and what a file with no thumbnail says instead.
    // 883 -> 880 on 2026-08-25: SHY-0454, and the only entry here that goes
    // DOWN. DegradedModeScreen was deleted -- a full-screen interstitial shown
    // whenever /api/health answered "degraded", announcing "Technical
    // Difficulties" to the public before anybody could get in. Its three
    // strings went with it: the title, the description, and
    // `contact_support_help`, which said "This is our problem, not yours".
    // A fourth string was RENAMED rather than removed in the same change
    // (`contact_support_hint` -> `connection_tips`), which is why this falls by
    // three and not four.
    // 880 -> 884 on 2026-08-26: SHY-0466. A room used to render nothing until
    // voice connected, so a network that blocks media cost ten seconds of
    // blank screen, and the banner that followed could only say "temporarily
    // unavailable" because three of its four sites recorded no reason. Four
    // strings: voice dropped, what still works, voice connecting, and what
    // the microphone says when it is tapped and cannot be used.
    expect([...new Set(report.map((r) => r.parsed))]).toEqual([884]);
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

  test('no string leaks an XML entity other than the three XML requires', () => {
    // `&apos;` is the entity form of the same defect the escapes were. It also
    // round-trips WRONG through the translation pipeline: `unescapeXml` used
    // not to decode it, so the raw `&apos;` reached the translator and came
    // back through `escapeXml`, which escapes `&` — writing `&amp;apos;` into
    // all 20 locales. Only `&amp;` `&lt;` `&gt;` are structurally required in
    // XML element text; everything else should be the literal character.
    const offenders = strings
      .filter((s) => /&(?!amp;|lt;|gt;)[a-zA-Z#][a-zA-Z0-9]*;/.test(s.value))
      .map(describeOffender);
    expect(offenders).toEqual([]);
  });

  test('the escape predicate actually fires, and spares a real line break', () => {
    // Mutation guard on the SHARED predicate — weakening the rule above
    // reddens this. A guard with its own inline copy of the regex proves
    // nothing, which is the reason this defect shipped in the first place.
    expect(carriesAndroidEscape("Driver\\'s license")).toBe(true);
    expect(carriesAndroidEscape('escaped \\" quote')).toBe(true);
    expect(carriesAndroidEscape('curly \\“ quote')).toBe(true);
    expect(carriesAndroidEscape('a real\\nline break')).toBe(false);
    // Boundary cases that encode deliberate decisions, so a future
    // "relaxation" of the rule has to break a test to happen.
    expect(carriesAndroidEscape('a\\tb')).toBe(true); // no tabs — write the character
    expect(carriesAndroidEscape('a\\\\b')).toBe(true); // escaped backslash
    expect(carriesAndroidEscape('ends with\\')).toBe(true); // trailing
    expect(carriesAndroidEscape('\\Name')).toBe(true); // uppercase N is not \n
    expect(carriesAndroidEscape("Driver's license")).toBe(false);
  });
});
