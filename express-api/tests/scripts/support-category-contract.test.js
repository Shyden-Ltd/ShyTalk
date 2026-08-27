/**
 * SHY-0387 — the app's categories and the server's allowlist are one contract.
 *
 * They live in two languages and two files:
 *   client  `SupportCategory` in data/repository/SupportRepository.kt
 *   server  `CATEGORIES` in routes/support-tickets.js
 *
 * Each is correct on its own and neither can see the other, so the failure modes
 * are silent in both directions:
 *
 *   a value the CLIENT offers that the server rejects  → somebody picks a
 *     category, writes their message, presses send, and is refused for a reason
 *     they cannot act on
 *   a value the SERVER accepts that no client offers   → a dead branch in the
 *     allowlist, the same shape as SHY-0400's unreachable video path
 *
 * This story exists partly because that had already happened: the operator
 * approved SIX categories and the server allowlist had five, with no wire value
 * for "Something is broken" at all.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};

const ROUTE = 'express-api/src/routes/support-tickets.js';
const CLIENT =
  'shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/SupportRepository.kt';

/** The server's closed set. */
const serverCategories = () => {
  const m = read(ROUTE).match(/const CATEGORIES = \[([^\]]+)\]/);
  expect(m).not.toBeNull();
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

/** The client's enum, read from its wire values rather than its Kotlin names. */
const clientCategories = () => {
  const src = read(CLIENT);
  const block = src.slice(src.indexOf('enum class SupportCategory'));
  const end = block.indexOf('\n}');
  return [...block.slice(0, end).matchAll(/\w+\("([a-z_]+)"\)/g)].map((m) => m[1]);
};

describe('support categories: the app and the server agree', () => {
  test('both lists are findable and non-trivial (the scan is not vacuous)', () => {
    expect(serverCategories().length).toBeGreaterThan(1);
    expect(clientCategories().length).toBeGreaterThan(1);
  });

  test('every category the app offers, the server accepts', () => {
    // Otherwise somebody picks one, writes their message, and is refused.
    expect(clientCategories().filter((c) => !serverCategories().includes(c))).toEqual([]);
  });

  test('every category the server accepts, some app surface offers', () => {
    // Otherwise it is a dead branch in the allowlist — SHY-0400's shape.
    expect(serverCategories().filter((c) => !clientCategories().includes(c))).toEqual([]);
  });

  test('the sixth approved category exists on both sides', () => {
    // "Something is broken" had no wire value at all before this story.
    expect(serverCategories()).toContain('bug');
    expect(clientCategories()).toContain('bug');
  });

  test('every category has a label the reader can read', () => {
    // A category rendered from its enum name is SHY-0390's bug: a Thai reader
    // picking from English words on a moderation-adjacent surface.
    const strings = read('shared/src/commonMain/composeResources/values/strings.xml');
    for (const c of clientCategories()) {
      expect(strings).toContain(`<string name="support_category_${c}">`);
    }
  });
});
