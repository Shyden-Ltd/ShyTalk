import { test, expect } from '@playwright/test';
import {
  PORTAL_LOCALES,
  fetchPortalTranslations,
  hasNestedObject,
  localeBlock,
  localeBlockCount,
  valueOf,
} from './helpers/portal-translations';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Per-locale guard for the portal's ban screen (SHY-0149).
 *
 * Two things nothing else checks.
 *
 * 1. `scripts/check-orphan-i18n-keys.sh` proves a key is defined SOMEWHERE — it
 *    unions every locale block before comparing. Drop `banned_signout` from one
 *    locale and it still passes, because the other twenty define it. That
 *    locale's user then silently sees the raw key, or English.
 *
 * 2. `portal-a11y.spec.ts` only ever renders the default locale, so it proves a
 *    key is attached to exactly one DOM node — never that another locale's
 *    dictionary carries it.
 *
 * The ban screen shipped with `banned_heading` byte-identical to
 * `suspended_heading` in Russian; both states reading 封禁 ("banned") in Chinese;
 * and — caught only after a byte-equality check proved too weak — Ukrainian
 * saying `заблоковано` ("blocked") for BOTH, differing only in the noun for
 * "account". A banned user in any of those locales could not tell which state
 * their account was in, which is the entire purpose of the screen.
 *
 * So equality is not the test. Each locale declares the ROOT that means "ban"
 * and the ROOT that means "suspend", and each state's copy must contain its
 * own root and not the other's. That table is the specification: a translator
 * changing the copy must keep it true, and an engineer cannot satisfy it by
 * swapping a noun.
 *
 * A ROOT, not a whole word, because the copy shifts part-of-speech between
 * keys: the Russian heading says `забанен` (participle) but `banned_until`
 * says `Бан заканчивается:` (noun) — they share only the stem `бан`. A
 * whole-word table could therefore never cover the `_until` pair, and that
 * pair is precisely where `ru`/`uk` shipped the suspension's generic noun
 * (`Блокировка`/`Блокування`) with nothing to catch it.
 */

/**
 * [root meaning "ban", root meaning "suspend"] — lowercase stems, matched
 * case-insensitively (`Бан` at sentence start must still count). Each root is
 * the invariant substring across every grammatical form its state word takes
 * in this locale's state-describing copy (the STATE_PAIRS below — headings,
 * reasons, untils; NOT the shared action strings, where "appeal your ban"
 * would legitimately carry a root), and each is absent from the OTHER state's
 * copy — that absence is what makes the exclusion assertions meaningful.
 * Indonesian's suspend-root is `angguh` because the stem `tangguh`
 * nasal-mutates under prefixation: di+tangguh → ditangguhkan, but
 * peN+tangguh → peNangguhan.
 */
const STATE_ROOTS: Record<(typeof PORTAL_LOCALES)[number], readonly [string, string]> = {
  en: ['ban', 'suspen'],
  ar: ['حظر', 'تعليق'],
  de: ['bann', 'sperr'],
  es: ['bane', 'suspen'],
  fr: ['banni', 'suspen'],
  hi: ['प्रतिबंध', 'निलंब'],
  id: ['blokir', 'angguh'],
  it: ['band', 'sospe'],
  ja: ['禁止', '停止'],
  km: ['ហាមឃាត់', 'ផ្អាក'],
  ko: ['차단', '정지'],
  nl: ['verbann', 'schors'],
  pl: ['ban', 'zawiesz'],
  pt: ['ban', 'suspens'],
  ru: ['бан', 'блок'],
  sv: ['bannlys', 'stäng'],
  th: ['แบน', 'ระงับ'],
  tr: ['yasak', 'askı'],
  uk: ['бан', 'блок'],
  vi: ['cấm', 'ngừng'],
  zh: ['封禁', '暂停'],
};

const BANNED_KEYS = [
  'banned_heading', 'banned_reason', 'banned_until',
  'banned_appeal', 'banned_contact', 'banned_signout',
];

/**
 * The suspension screen renders the same six, plus `suspended_reason_label` —
 * the prefix `portal.js` composes in front of the account's stored suspension
 * reason. The ban screen has no such label; `renderBan` writes the reason
 * whole. That asymmetry is why this list is seven keys, not six.
 */
const SUSPENDED_KEYS = [
  'suspended_heading', 'suspended_reason', 'suspended_until',
  'suspended_appeal', 'suspended_contact', 'suspended_signout',
  'suspended_reason_label',
];

/** State-describing copy: each must carry its own state root, and not the other's. */
const STATE_PAIRS = [
  ['banned_heading', 'suspended_heading'],
  ['banned_reason', 'suspended_reason'],
  ['banned_until', 'suspended_until'],
] as const;

/** Action copy: the same action in both states, so sharing the wording is correct. */
const ACTION_KEYS = ['banned_appeal', 'banned_contact', 'banned_signout'];

test.describe('Portal ban screen — i18n completeness across all 21 locales', () => {
  let source: string;

  test.beforeAll(async ({ request }) => {
    source = await fetchPortalTranslations(request, BASE);
  });

  test('the translations file parses the way this spec assumes', () => {
    // If a future edit nests an object inside a locale block, `localeBlock`'s
    // non-greedy match would truncate — and every assertion below would pass
    // against a fragment. Fail here instead.
    expect(localeBlockCount(source)).toBe(PORTAL_LOCALES.length);
    expect(hasNestedObject(source)).toBe(false);
  });

  test('every locale defines all thirteen banned_* and suspended_* keys with a non-empty value', () => {
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      for (const key of [...BANNED_KEYS, ...SUSPENDED_KEYS]) {
        const value = valueOf(block, key);
        expect(value, `${lang} is missing ${key}`).not.toBeNull();
        expect(value!.trim(), `${lang}'s ${key} is empty`).not.toBe('');
      }
    }
  });

  test('each state’s copy carries its own state root, and never the other’s', () => {
    const problems: string[] = [];
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      const [banRoot, suspendRoot] = STATE_ROOTS[lang].map((r) => r.toLowerCase());

      for (const [bannedKey, suspendedKey] of STATE_PAIRS) {
        const banned = valueOf(block, bannedKey)?.toLowerCase();
        const suspended = valueOf(block, suspendedKey)?.toLowerCase();
        if (banned == null || suspended == null) continue; // covered by the test above

        if (!banned.includes(banRoot)) {
          problems.push(`${lang}: ${bannedKey} does not carry "${banRoot}" — "${banned}"`);
        }
        if (banned.includes(suspendRoot)) {
          problems.push(`${lang}: ${bannedKey} carries "${suspendRoot}", the suspension root`);
        }
        if (!suspended.includes(suspendRoot)) {
          problems.push(`${lang}: ${suspendedKey} does not carry "${suspendRoot}" — "${suspended}"`);
        }
        if (suspended.includes(banRoot)) {
          problems.push(`${lang}: ${suspendedKey} carries "${banRoot}", the ban root`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('the action buttons may share the suspended copy, and are non-empty everywhere', () => {
    // Pinned deliberately: appealing, contacting support and signing out are the
    // same action in both states, so a future divergence check must not be
    // widened onto them by accident.
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      for (const key of ACTION_KEYS) {
        expect(valueOf(block, key)?.trim(), `${lang}'s ${key} is empty`).toBeTruthy();
      }
    }
  });
});

test.describe('Parser guards — the detect-branch, on synthetic fixtures', () => {
  // The guard test above proves the REAL file passes both checks — only ever
  // their pass-branch. Nothing there proves either check can still FAIL: a
  // regression that neuters one regex would leave the guard green while
  // `localeBlock` silently truncates, and every locale assertion in this file
  // would then pass against a fragment. These fixtures pin the detect-branch.
  test('hasNestedObject flags a nested object literal', () => {
    const nested = "  en: {\n    tooltip: {\n      title: 'x',\n    },\n  },\n";
    expect(hasNestedObject(nested)).toBe(true);
  });

  test('localeBlockCount counts two-space block closers only', () => {
    const twoBlocks = "  en: {\n    a: 'x',\n  },\n  fr: {\n    b: 'y',\n  },\n";
    expect(localeBlockCount(twoBlocks)).toBe(2);

    // A nested object's four-space closer is not a block close — the count
    // stays honest about how many LOCALE blocks the file finishes.
    const nestedClose = "  en: {\n    o: {\n    },\n  },\n";
    expect(localeBlockCount(nestedClose)).toBe(1);

    expect(localeBlockCount('')).toBe(0);
  });
});
