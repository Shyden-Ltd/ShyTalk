/**
 * SHY-0268 follow-up — every step phrase the journey corpus uses must resolve
 * to a runner matcher.
 *
 * A step with no matcher does not fail the scenario loudly: it returns
 * STEP_NOT_IMPLEMENTED, the scenario is skipped, and the corpus quietly covers
 * less than it appears to. That is the "absence reported as success" shape, so
 * it needs a ratchet rather than a one-off audit.
 *
 * The Gherkin sweep replaced 24 carried-forward mutations with
 * state-describing `Given`s (replaying a gift-send or an admin approval as a
 * precondition would have double-charged coins and duplicated audit rows).
 * Those phrases are implemented as real seeding handlers; this file pins that
 * they stay implemented, and caps the pre-existing backlog so it can only
 * shrink.
 *
 * No test doubles here by design: the probe drives the real matcher table with
 * a context that has no `db`, so an implemented step fails on the missing
 * collaborator (proving it matched) while an unimplemented one reports
 * STEP_NOT_IMPLEMENTED (proving it did not).
 */

const fs = require('fs');
const path = require('path');

const { executeStep } = require('../../scripts/manual-qa-runner');

const CORPUS_DIR = path.join(__dirname, '..', '..', '..', 'journey-tests');

/**
 * Unmatched-step debt, measured 2026-08-03 by this file's own probe over the
 * 1141 distinct phrases in the corpus (157 unmatched, minus the 4 blocked on
 * the unbuilt events feature that are pinned separately below).
 *
 * Measured with the SAME probe the test uses, deliberately: an earlier figure
 * of 194 came from a looser regex scan that did not strip the `within <n>ms`
 * wrapper, and a cap set from a different instrument is a cap that never
 * bites.
 *
 * NEVER raise this number to make a build pass — that converts a coverage
 * regression into a silent policy change. Lower it as steps get implemented.
 */
const UNMATCHED_BASELINE = 153;

/** Every distinct step phrase in the journey corpus, keyword stripped. */
function corpusStepPhrases() {
  const phrases = new Set();
  for (const file of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.feature'))) {
    const text = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s+(?:Given|When|Then|And|But) (.+)$/.exec(line);
      if (m) phrases.add(m[1].trim());
    }
  }
  return [...phrases];
}

/**
 * True when the runner has a matcher for this phrase.
 *
 * The `within <n>ms ...` wrapper is stripped first for two reasons: it polls
 * for its full budget on failure, which would make this probe take minutes
 * across the corpus, and what actually needs a matcher is the INNER step —
 * `within 5000ms X` and a bare `X` are the same coverage question.
 */
async function isImplemented(phrase) {
  const inner = phrase.replace(/^within \d+ms /, '');
  // A context with no db/fetch/driver: an implemented handler fails on the
  // missing collaborator, an unimplemented one reports STEP_NOT_IMPLEMENTED.
  const ctx = { sessions: new Map(), personaPlatforms: new Map(), scenarioVars: new Map() };
  const result = await executeStep({ kind: 'Given', text: inner }, ctx);
  return result.code !== 'STEP_NOT_IMPLEMENTED';
}

async function unmatchedPhrases() {
  const out = [];
  for (const phrase of corpusStepPhrases()) {
    if (!(await isImplemented(phrase))) out.push(phrase);
  }
  return out.sort();
}

/**
 * j16 describes an events feature — scheduling, event rooms, rosters,
 * eventInvites — that the backend does not have. `express-api/src` contains no
 * `events` collection at all; the only trace of the concept is the
 * MC_EVENT_HOST userType. Seeding these would mean inventing a schema and
 * asserting against it, which manufactures a passing journey for a feature
 * nobody has built.
 *
 * They are excluded from the ratchet below and pinned by name instead, so the
 * debt is visible as "blocked on an unbuilt feature" rather than buried in a
 * raised baseline number.
 */
const BLOCKED_ON_UNBUILT_EVENTS_FEATURE = [
  'Selma has joined the event room',
  'Tariq has scheduled the "Saturday Showcase" event',
  'Tariq\'s event "Saturday Showcase" has just closed',
  'Tariq\'s event "Saturday Showcase" is LIVE',
];

describe('journey corpus step coverage', () => {
  test('the probe reads a real corpus (guard against a vacuous pass)', () => {
    const phrases = corpusStepPhrases();
    expect(phrases.length).toBeGreaterThan(500);
  });

  test('unmatched steps do not exceed the pinned baseline', async () => {
    const unmatched = await unmatchedPhrases();
    // The blocked-on-unbuilt-feature set is pinned separately, by name, so it
    // never inflates this cap — and so nobody can quietly park new debt here
    // by adding to that list without the accompanying named pin below.
    const countable = unmatched.filter((p) => !BLOCKED_ON_UNBUILT_EVENTS_FEATURE.includes(p));
    expect(countable.length).toBeLessThanOrEqual(UNMATCHED_BASELINE);
  }, 60_000);

  // Each phrase the Gherkin sweep introduced, pinned by name so a regression
  // reports WHICH precondition stopped being seeded rather than a count.
  const SWEEP_INTRODUCED = [
    'Adam has been sent the age-up welcome system PM',
    'Alice has been issued a LiveKit token for room "ra1"',
    "Alice has joined Theo's room from Web",
    'Alice has just been refunded for receipt "receipt-R3"',
    'Alice has just pulled the gacha 3 times',
    'Alice has replied to Adam and he has opened the thread',
    'Alice has sent Selma a rose in the room',
    'Hayato has been downgraded to cohort=minor after ID review',
    'Ines has a message queued while offline',
    "Ines's queued message has been delivered after reconnecting",
    'Kenji has sent Alice a rose',
    'Marcus has been refused a LiveKit token for the adult room "ra1"',
    'Nora has blocked Raul',
    'Raul has sent Nora a second offensive message',
    'Selma has closed a room that earned 755 beans this session',
    'Selma has closed her room',
    'Theo has rejoined room "r1" after acknowledging his warning',
    'Theo has sent Selma a crown',
    "Vexa's cross-cohort coin transfer to Marcus has been refused",
    'the conversation "c1" is frozen for both participants',
  ];

  test.each(SWEEP_INTRODUCED)('"%s" resolves to a matcher', async (phrase) => {
    expect(await isImplemented(phrase)).toBe(true);
  });

  test('every pinned phrase is actually used by the corpus', () => {
    // Stops the pin list rotting into a list of phrases nobody writes any
    // more, which would keep passing while covering nothing.
    const inCorpus = new Set(corpusStepPhrases());
    const orphaned = SWEEP_INTRODUCED.filter((p) => !inCorpus.has(p));
    expect(orphaned).toEqual([]);
  });

  test.each(BLOCKED_ON_UNBUILT_EVENTS_FEATURE)(
    '"%s" stays unimplemented until the events feature is built',
    async (phrase) => {
      expect(await isImplemented(phrase)).toBe(false);
    },
  );

  test('a seeding step fails loudly when the database is unavailable', async () => {
    // Seeding handlers must report the missing collaborator, never pretend to
    // have seeded. Uses one representative phrase from the set above.
    const ctx = { sessions: new Map(), personaPlatforms: new Map(), scenarioVars: new Map() };
    const result = await executeStep({ kind: 'Given', text: 'Nora has blocked Raul' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/db|firestore/i);
  });
});
