/**
 * `{adamId}` must resolve to Adam's uniqueId.
 *
 * The corpus uses `{<persona>Id}` seven times across j07 and j18 —
 *
 *   Then the database has 1 entries in "conversations" matching
 *        {participantIds: [1, {adamId}]}
 *
 * — and nothing ever set it, so the predicate parser refused with
 * "unresolved placeholder {adamId} (variable resolution not yet implemented)".
 * That refusal is the right behaviour (coercing it to the literal string
 * "{adamId}" would compare against braces and fail later as a confusing value
 * mismatch), but it left j18 blocked at its first assertion and j07 unable to
 * check any of its follow/PM state.
 *
 * There is already a precedent for auto-populated placeholders: `{ts}` is seeded
 * at scenario start with a documented convention. Persona ids follow it.
 *
 * TWO SOURCES, because personas come from two places. Sixteen are provisioned
 * with fixed ids in the registry, and the ephemeral ones (Adam P-01, Mia P-03)
 * have no id until the run creates them — which is why a single `{newUniqueId}`
 * slot could not serve a scenario using two of them.
 */
const { interpolateScenarioVars, seedPersonaIdVars } = require('../../scripts/manual-qa-runner');

describe('registry personas resolve by name', () => {
  it('seeds an id for every provisioned persona', () => {
    const vars = new Map();
    seedPersonaIdVars(vars);
    // Alice is P-02 with a fixed registry uniqueId.
    expect(vars.get('aliceId')).toBe('50000010');
    expect(vars.get('theoId')).toBe('50000060');
  });

  it('interpolates the placeholder into a step', () => {
    const vars = new Map();
    seedPersonaIdVars(vars);
    expect(interpolateScenarioVars('the database has document "users/{aliceId}"', vars)).toBe(
      'the database has document "users/50000010"',
    );
  });

  it('resolves an EPHEMERAL persona too — they carry stable ids as well', () => {
    // I expected Adam to have no id until a run created him. He does:
    // EPHEMERAL_PERSONAS in the runner gives P-01 and P-03 fixed uniqueIds, and
    // `loadPersonas` merges both sets. That is what makes `{adamId}` resolvable
    // at all, and it is why j07/j18 can name him.
    const vars = new Map();
    seedPersonaIdVars(vars);
    expect(vars.get('adamId')).toBe('90000002');
    expect(interpolateScenarioVars('users/{adamId}', vars)).toBe('users/90000002');
  });

  it('Adam does NOT share the admin id', () => {
    // He did — 90000001 is P-12 Greta, the admin, and the corpus hard-codes it
    // as `adminId` in four journeys. Pinned here as well as in
    // persona-unique-ids-are-unique because this is the file that would notice
    // the placeholder silently pointing at the wrong person.
    const vars = new Map();
    seedPersonaIdVars(vars);
    expect(vars.get('adamId')).not.toBe('90000001');
    expect(vars.get('gretaId')).toBe('90000001');
  });

  it('leaves an unknown name alone rather than blanking it', () => {
    const vars = new Map();
    seedPersonaIdVars(vars);
    expect(interpolateScenarioVars('users/{zebediahId}', vars)).toBe('users/{zebediahId}');
  });

  it('does not clobber a value already set for this scenario', () => {
    // A scenario that captured a real id must win over the registry default —
    // the captured one is what actually happened in this run.
    const vars = new Map([['aliceId', '99999999']]);
    seedPersonaIdVars(vars);
    expect(vars.get('aliceId')).toBe('99999999');
  });
});

describe('an ephemeral persona registers its id when created', () => {
  it('sets BOTH newUniqueId and the name-keyed placeholder', () => {
    // `newUniqueId` is a single slot, so a scenario creating Adam AND Mia could
    // only ever refer to one of them. The name-keyed form is what makes j07 and
    // j18 expressible.
    const vars = new Map();
    seedPersonaIdVars(vars, { name: 'Adam', uniqueId: 90000123 });
    expect(vars.get('adamId')).toBe('90000123');
    expect(vars.get('newUniqueId')).toBe('90000123');
  });

  it('a later creation replaces the id for THAT persona only', () => {
    const vars = new Map();
    seedPersonaIdVars(vars, { name: 'Adam', uniqueId: 1 });
    seedPersonaIdVars(vars, { name: 'Mia', uniqueId: 2 });
    expect(vars.get('adamId')).toBe('1');
    expect(vars.get('miaId')).toBe('2');
    expect(vars.get('newUniqueId')).toBe('2');
  });
});
