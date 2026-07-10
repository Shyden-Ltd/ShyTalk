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
 * So equality is not the test. Each locale declares the WORD that means "banned"
 * and the WORD that means "suspended", and each state's copy must contain its
 * own word and not the other's. That table is the specification: a translator
 * changing the copy must keep it true, and an engineer cannot satisfy it by
 * swapping a noun.
 */

/** [word meaning "banned", word meaning "suspended"] — stems, to survive inflection. */
const STATE_WORDS: Record<(typeof PORTAL_LOCALES)[number], readonly [string, string]> = {
  en: ['banned', 'suspended'],
  ar: ['حظر', 'تعليق'],
  de: ['gebannt', 'gesperrt'],
  es: ['bane', 'suspend'],
  fr: ['banni', 'suspend'],
  hi: ['प्रतिबंधित', 'निलंबित'],
  id: ['diblokir', 'ditangguhkan'],
  it: ['bandit', 'sospes'],
  ja: ['禁止', '停止'],
  km: ['ហាមឃាត់', 'ផ្អាក'],
  ko: ['차단', '정지'],
  nl: ['verbannen', 'geschorst'],
  pl: ['zbanowan', 'zawieszon'],
  pt: ['banida', 'suspens'],
  ru: ['забанен', 'заблокирован'],
  sv: ['bannlyst', 'stängts av'],
  th: ['แบน', 'ระงับ'],
  tr: ['yasakla', 'askıya'],
  uk: ['забанено', 'заблоковано'],
  vi: ['cấm', 'tạm ngừng'],
  zh: ['封禁', '暂停'],
};

const BANNED_KEYS = [
  'banned_heading', 'banned_reason', 'banned_until',
  'banned_appeal', 'banned_contact', 'banned_signout',
];

/** State-describing copy: each must carry its own state word, and not the other's. */
const STATE_PAIRS = [
  ['banned_heading', 'suspended_heading'],
  ['banned_reason', 'suspended_reason'],
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

  test('every locale defines all six banned_* keys with a non-empty value', () => {
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      for (const key of BANNED_KEYS) {
        const value = valueOf(block, key);
        expect(value, `${lang} is missing ${key}`).not.toBeNull();
        expect(value!.trim(), `${lang}'s ${key} is empty`).not.toBe('');
      }
    }
  });

  test('each state’s copy carries its own state word, and never the other’s', () => {
    const problems: string[] = [];
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      const [banWord, suspendWord] = STATE_WORDS[lang];

      for (const [bannedKey, suspendedKey] of STATE_PAIRS) {
        const banned = valueOf(block, bannedKey);
        const suspended = valueOf(block, suspendedKey);
        if (banned === null || suspended === null) continue; // covered by the test above

        if (!banned.includes(banWord)) {
          problems.push(`${lang}: ${bannedKey} does not say "${banWord}" — "${banned}"`);
        }
        if (banned.includes(suspendWord)) {
          problems.push(`${lang}: ${bannedKey} says "${suspendWord}", the suspension word`);
        }
        if (!suspended.includes(suspendWord)) {
          problems.push(`${lang}: ${suspendedKey} does not say "${suspendWord}" — "${suspended}"`);
        }
        if (suspended.includes(banWord)) {
          problems.push(`${lang}: ${suspendedKey} says "${banWord}", the ban word`);
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
