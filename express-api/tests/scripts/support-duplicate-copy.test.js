/**
 * The copy somebody sees when they already have a support request open —
 * SHY-0396.
 *
 * Key parity is covered by `compose-resources-locale-parity`. This file is
 * about the copy being USABLE once it is present, in every language, which key
 * parity cannot see:
 *
 *   - the count sentence must keep its `%1$d`, or somebody is told they have
 *     "requests open" with no number — or the formatter throws
 *   - the three choices must stay three DISTINCT sentences, because a machine
 *     translation that collapses two of them leaves a screen with two buttons
 *     that read identically and mean opposite things
 *   - the refusal that SHY-0396 removed must not survive anywhere
 *
 * The last one is the reason this file exists at all. The operator asked for
 * multiple support requests to be ALLOWED on 2026-08-21, and the refusal was
 * still shipping on 2026-08-22 because it had been carried forward from
 * SHY-0385 without being checked against what had already been said.
 */

const { ALL_LOCALE_DIRS, readLocaleStrings } = require('../_helpers/compose-locales');

/** The keys SHY-0396 introduced, and what each one has to survive. */
const DUPLICATE_KEYS = [
  'support_open_requests_one',
  'support_open_requests_many',
  'support_open_requests_more',
  'support_duplicate_reminder',
  'support_duplicate_same',
  'support_duplicate_new',
  'support_duplicate_back',
  'support_form_added',
];

/** The three answers, which must never read the same as one another. */
const THE_THREE_CHOICES = [
  'support_duplicate_same',
  'support_duplicate_new',
  'support_duplicate_back',
];

const stringsFor = (dir) => {
  const map = new Map();
  for (const { name, value } of readLocaleStrings(dir).entries) {
    map.set(name, value);
  }
  return map;
};

describe('SHY-0396 — the copy for somebody who already has a request open', () => {
  describe.each(ALL_LOCALE_DIRS)('%s', (dir) => {
    const strings = stringsFor(dir);

    test.each(DUPLICATE_KEYS)('%s is present and says something', (key) => {
      expect(strings.has(key)).toBe(true);
      expect((strings.get(key) ?? '').trim()).not.toBe('');
    });

    test.each(['support_open_requests_many', 'support_open_requests_more'])(
      '%s keeps its number',
      (key) => {
        const value = strings.get(key) ?? '';
        const placeholders = value.match(/%1\$d/g) ?? [];
        expect({ dir, key, value, placeholders: placeholders.length }).toEqual({
          dir,
          key,
          value,
          placeholders: 1,
        });
      },
    );

    test('the singular sentence does NOT take a number it will not be given', () => {
      // It is rendered without arguments, so a `%1$d` that a translator
      // introduced here would print a literal placeholder or throw.
      expect(strings.get('support_open_requests_one') ?? '').not.toMatch(/%\d\$/);
    });

    test('the three choices are three different sentences', () => {
      const values = THE_THREE_CHOICES.map((k) => (strings.get(k) ?? '').trim().toLowerCase());
      expect(new Set(values).size).toBe(THE_THREE_CHOICES.length);
    });

    test('the refusal SHY-0396 removed is gone', () => {
      // Checked by KEY, because the sentence itself exists in 21 languages and
      // only one of them is greppable by eye.
      expect(strings.has('support_form_error_already_open')).toBe(false);
      expect(strings.has('support_duplicate_title')).toBe(false);
    });
  });
});
