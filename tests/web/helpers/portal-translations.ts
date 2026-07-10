/**
 * Shared reader for `public/portal/portal-translations.js`.
 *
 * Two specs parse that file for per-locale assertions. They used to carry
 * independent copies of these regexes, so a reformat of the translations file
 * could fix one parser and silently leave the other matching nothing — passing
 * for the wrong reason (reviewer R18-I2).
 */

import { expect, type APIRequestContext } from '@playwright/test';

export const PORTAL_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
] as const;

export type PortalLocale = (typeof PORTAL_LOCALES)[number];

/** Fetch the served translations bundle. Fails loudly; never returns undefined. */
export async function fetchPortalTranslations(
  request: APIRequestContext,
  base: string,
): Promise<string> {
  const res = await request.get(`${base}/portal/portal-translations.js`);
  expect(res.ok(), 'portal-translations.js must be served').toBe(true);
  const source = await res.text();
  expect(source.length, 'portal-translations.js must not be empty').toBeGreaterThan(0);
  return source;
}

/**
 * One locale's object literal. The non-greedy match is safe because every block
 * closes on a line that is exactly `  },` and no block contains a nested object.
 * `localeBlockCount` below pins both facts, so a future nested object fails the
 * guard rather than silently truncating a block.
 */
export function localeBlock(source: string, lang: string): string {
  const match = source.match(new RegExp(`  ${lang}:\\s*\\{[\\s\\S]*?\\n  \\},`));
  expect(match, `${lang} block not found in portal-translations.js`).not.toBeNull();
  return match![0];
}

/** How many locale blocks the file closes — must equal PORTAL_LOCALES.length. */
export function localeBlockCount(source: string): number {
  return (source.match(/^ {2}\},$/gm) ?? []).length;
}

/** True when any locale block contains a nested object, which would break parsing. */
export function hasNestedObject(source: string): boolean {
  return /^ {4}\w+: \{/m.test(source);
}

/**
 * A key's value, or null. The literal `:` immediately after the key name is what
 * stops `suspended_reason` from reading the co-resident `suspended_reason_label`,
 * and `\b` stops it matching inside a longer identifier.
 */
export function valueOf(block: string, key: string): string | null {
  const match = block.match(new RegExp(`\\b${key}:\\s*'([^']*)'`));
  return match ? match[1] : null;
}
