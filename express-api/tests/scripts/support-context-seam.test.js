/**
 * SHY-0385/0387 — every context field the server keeps must be one a client sends.
 *
 * `sanitiseContext` filters the ticket payload through `CONTEXT_ALLOWED_FIELDS`.
 * A field in that allowlist that no client ever emits is dead: the server
 * sanitises for it, the ticket has a slot for it, the admin panel renders it, and
 * it is always absent. That is the same defect as SHY-0400's video path — a
 * consumer branch with no producer — and it was true of `appVersion` and
 * `platform` the day the wiring was written.
 *
 * Neither side's own tests can see it. The route test sends a payload it made up
 * and asserts the allowlist filters it, which passes for a field nothing sends.
 * The client test asserts the map it was handed arrives, which passes for a map
 * missing two keys. Only comparing the two catches it.
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

/**
 * Split by WHO owns each field, because "somebody sends it" is not good enough.
 *
 * The first version of this test asked whether ANY client source emitted the
 * field. Deleting `appVersion` from the Android repository left it GREEN, because
 * the iOS repository still had it — a pin that checks one platform and infers the
 * other is a pin that ships the other unattested. Per platform, always.
 */
const ENTRY_POINT_SOURCES = [
  // SHY-0387 moved the three inline maps out of the Compose files and into one
  // enum, which is why this list shrank from three screens to one. That is the
  // improvement: the context is now ordinary logic with ordinary tests
  // (SupportSourceTest), and this seam check has one producer to look at.
  'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportSource.kt',
];

/** Fields the PLATFORM owns; each platform must supply them independently. */
const PLATFORM_OWNED = ['platform', 'appVersion'];
const PLATFORM_SOURCES = {
  android: 'app/src/main/java/com/shyden/shytalk/data/repository/SupportRepositoryImpl.kt',
  ios: 'shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosSmallRepositories.kt',
};

/** Code only: a field named in a comment is documentation, not a producer. */
const codeOf = (rel) =>
  read(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

describe('support ticket context: allowlist vs what any client can send', () => {
  const allowed = (() => {
    const m = codeOf(ROUTE).match(/CONTEXT_ALLOWED_FIELDS\s*=\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  })();

  test('the allowlist is findable and non-trivial (the scan is not vacuous)', () => {
    expect(allowed.length).toBeGreaterThan(1);
    expect(allowed).toContain('feature');
  });

  test('every allowed field is owned by either an entry point or a platform', () => {
    // Nothing may sit in the allowlist unclaimed — an unclaimed field is one
    // nobody has decided how to populate, which is how the two dead ones arose.
    const entryOwned = allowed.filter((f) => !PLATFORM_OWNED.includes(f));
    expect(entryOwned.sort()).toEqual(['feature', 'reason', 'screen']);
  });

  test.each(allowed.filter((f) => !PLATFORM_OWNED.includes(f)))(
    'an entry point sends context field "%s"',
    (field) => {
      // Either Kotlin map form — `"feature" to x` or `put("feature", x)`. The
      // assertion is that the field is EMITTED, not how it happens to be written.
      const emitted = ENTRY_POINT_SOURCES.some((rel) =>
        new RegExp(`"${field}"\\s*(?:to\\b|,)`).test(codeOf(rel)),
      );

      expect(emitted).toBe(true);
    },
  );

  // The cross product, so neither platform can lean on the other.
  test.each(
    PLATFORM_OWNED.flatMap((field) =>
      Object.entries(PLATFORM_SOURCES).map(([name, rel]) => [field, name, rel]),
    ),
  )('%s is sent by the %s client', (field, _name, rel) => {
    expect(codeOf(rel)).toMatch(new RegExp(`"${field}"\\s*(?:to\\b|,)`));
  });
});
