/**
 * Check the personas are seeded BEFORE walking anything (SHY-0449).
 *
 * Twice on 2026-08-23 the local emulator lost its persona data mid-session.
 * The runner does not notice: it signs in, the app demands a date of birth,
 * and twelve of thirteen journeys fail with
 *
 *   stuck on RequiredDOB — persona has no date of birth (seed incomplete?)
 *
 * which is a guess in a failure message, one journey at a time, after minutes
 * of walking. The first time it cost an hour of looking at the wrong thing;
 * the second it invalidated a run that was checking something else entirely.
 *
 * The data is knowable before the first tap, so it is checked before the first
 * tap — once, naming the command that fixes it.
 */

const { personasLookSeeded } = require('../../scripts/device-journey-runner');

const persona = (over) => ({ uniqueId: 50000010, dateOfBirth: 946684800000, ...over });

describe('personasLookSeeded', () => {
  test('a fully seeded set passes', () => {
    expect(personasLookSeeded([persona(), persona({ uniqueId: 60000010 })])).toEqual({
      ok: true,
      missing: [],
    });
  });

  test('a persona with no date of birth is named', () => {
    // This is the exact shape the app rejects with RequiredDOB.
    const result = personasLookSeeded([
      persona(),
      persona({ uniqueId: 60000010, dateOfBirth: null }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([60000010]);
  });

  test('a persona document that is missing entirely is named', () => {
    const result = personasLookSeeded([persona(), null]);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  test('an empty set is not quietly treated as fine', () => {
    // Nothing seeded at all is the WORST case and the easiest to mistake for
    // "no problems found".
    expect(personasLookSeeded([]).ok).toBe(false);
  });

  test('a zero date of birth counts as missing, not as 1970', () => {
    expect(personasLookSeeded([persona({ dateOfBirth: 0 })]).ok).toBe(false);
  });
});
