import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Per-locale guard for the portal's ban screen (SHY-0149).
 *
 * Two things nothing else checks.
 *
 * 1. `scripts/check-orphan-i18n-keys.sh` proves a key is defined SOMEWHERE — it
 *    unions every locale block before comparing. Drop `banned_signout` from one
 *    locale and it still passes, because the other twenty still define it. The
 *    user of that one locale then sees the raw key, or English, silently.
 *
 * 2. `portal-a11y.spec.ts` only ever renders the default locale, so it proves the
 *    key is attached to exactly one DOM node — never that any other locale's
 *    dictionary carries it.
 *
 * The divergence assertion below exists because the ban screen was shipped with
 * `banned_heading` byte-identical to `suspended_heading` in Russian, and
 * semantically identical in Chinese (both said 封禁, "banned" — the *suspended*
 * copy was the mistranslation). A banned user in those locales could not tell
 * which state their account was in, which is the entire purpose of the screen.
 * The action buttons are exempt: appealing, contacting support and signing out
 * are the same action in both states, so sharing their copy is correct.
 */

const PORTAL_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

/** The ban screen's own keys. All six must exist in every locale. */
const BANNED_KEYS = [
  'banned_heading', 'banned_reason', 'banned_until',
  'banned_appeal', 'banned_contact', 'banned_signout',
];

/** State-describing copy: a banned user must not be shown a suspended user's words. */
const MUST_DIVERGE: ReadonlyArray<readonly [string, string]> = [
  ['banned_heading', 'suspended_heading'],
  ['banned_reason', 'suspended_reason'],
  ['banned_until', 'suspended_until'],
];

/** Action copy: the same action in both states, so sharing the wording is correct. */
const MAY_MATCH = ['banned_appeal', 'banned_contact', 'banned_signout'];

const localeBlock = (src: string, lang: string): string => {
  const match = src.match(new RegExp(`  ${lang}:\\s*\\{[\\s\\S]*?\\n  \\},`));
  expect(match, `${lang} block not found in portal-translations.js`).not.toBeNull();
  return match![0];
};

const valueOf = (block: string, key: string): string | null => {
  const match = block.match(new RegExp(`\\b${key}:\\s*'([^']*)'`));
  return match ? match[1] : null;
};

test.describe('Portal ban screen — i18n completeness across all 21 locales', () => {
  let source: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BASE}/portal/portal-translations.js`);
    expect(res.ok(), 'portal-translations.js must be served').toBe(true);
    source = await res.text();
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

  test('a banned user is never shown a suspended user’s state description', () => {
    const collisions: string[] = [];
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      for (const [bannedKey, suspendedKey] of MUST_DIVERGE) {
        const banned = valueOf(block, bannedKey);
        const suspended = valueOf(block, suspendedKey);
        if (banned !== null && banned === suspended) {
          collisions.push(`${lang}: ${bannedKey} is identical to ${suspendedKey} ("${banned}")`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  test('the action buttons may share the suspended copy, and are non-empty everywhere', () => {
    // Pinned deliberately: this documents that sharing is intentional, so a
    // future divergence check cannot be widened onto them by accident.
    for (const lang of PORTAL_LOCALES) {
      const block = localeBlock(source, lang);
      for (const key of MAY_MATCH) {
        expect(valueOf(block, key)?.trim(), `${lang}'s ${key} is empty`).toBeTruthy();
      }
    }
  });
});
