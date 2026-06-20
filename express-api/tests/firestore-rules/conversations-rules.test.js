/**
 * REAL Firestore security-rules tests for `conversations/{conversationId}`,
 * exercised against the live Firestore emulator via `@firebase/rules-unit-testing`
 * (v5). Companion to `room-rules.test.js` (SHY-0129) — SHY-0130.
 *
 * Pins the `get` + `list` contract for the conversations DM threads. The bug
 * (SHY-0130): the Android client coerces the caller's `uniqueId` to a Long
 * before `array-contains`, but the rule gates on `string(callerUniqueId()) in
 * resource.data.participantIds` and `participantIds` is stored as STRINGS, so
 * the Long query is denied/empty. These tests prove the STRING-typed query is
 * ALLOWED and the LONG-typed query is DENIED, plus DM-privacy + the OSA
 * `crossCohortAtMigration` migration gate, against the real engine.
 *
 * It also covers the `crossCohortAtMigration` LIST-leak + its fix (SHY-0132): the
 * rule's `!= true` clause is NOT enforced as a filter on `list`, so an unconstrained
 * query LEAKS migrated cross-cohort threads; the fix is the client query adding
 * `where('crossCohortAtMigration','==', false)` + a backfill (the `== false` filter
 * excludes absent-field docs). See the `crossCohortAtMigration segregation` block.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * `localhost:8080`). Start it with `bash local/start.sh`.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-conv-rules-${process.env.JEST_WORKER_ID || '1'}`;

// ── Realistic JWT claim shapes (uniqueId is a NUMBER in the claim, as Express
// mints it; the rule stringifies it via `string(callerUniqueId())`). ──────────
const ADULT = { uid: 'fbuid-adult-1', uniqueId: 50001, cohort: 'adult' };
const ADULT_2 = { uid: 'fbuid-adult-2', uniqueId: 50002, cohort: 'adult' };
// A signed-in caller who is NOT a participant of the seeded threads.
const OUTSIDER = { uid: 'fbuid-out-1', uniqueId: 50003, cohort: 'adult' };
const MINOR = { uid: 'fbuid-minor-1', uniqueId: 50010, cohort: 'minor' };
// Right after sign-in, before the custom-claim mint lands: no uniqueId claim,
// so `callerUniqueId()` throws → deny.
const NO_CLAIMS = { uid: 'fbuid-noclaims-1' };

let testEnv;
const handles = new Map();

function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

function dbAnon() {
  if (!handles.has('__anon__')) {
    handles.set('__anon__', testEnv.unauthenticatedContext().firestore());
  }
  return handles.get('__anon__');
}

/**
 * A conversation doc as the (fixed) client stamps it: `participantIds` are
 * STRINGS. `participants` is an array of personas; override fields per test.
 */
function convDoc(participants, overrides = {}) {
  return {
    participantIds: participants.map((p) => String(p.uniqueId)),
    lastMessageAt: 1000,
    isGroup: false,
    ...overrides,
  };
}

async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

function seedConv(id, data) {
  return seedDoc(`conversations/${id}`, data);
}

/** The STRING-typed array-contains list query (the fix). */
function listAsString(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', String(persona.uniqueId))
    .get();
}

/** The LONG-typed array-contains list query (the Android bug). */
function listAsLong(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', persona.uniqueId)
    .get();
}

/** SHY-0132 — the FIXED list query: string array-contains + the crossCohort
 * filter that excludes migrated cross-cohort threads on `list`. */
function listWithCrossCohortFilter(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', String(persona.uniqueId))
    .where('crossCohortAtMigration', '==', false)
    .get();
}

beforeAll(async () => {
  await assertEmulatorReachable();
  const { host, port } = firestoreHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  handles.clear();
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ═══════════════════════════════════════════════════════════════════════════
// get (single doc) — membership + migration gate
// ═══════════════════════════════════════════════════════════════════════════

describe('conversations/{id} get — real rules engine', () => {
  test('a participant CAN get their own conversation', async () => {
    await seedConv('c-get-1', convDoc([ADULT, ADULT_2]));
    await assertSucceeds(dbFor(ADULT).doc('conversations/c-get-1').get());
  });

  test('DENY: a non-participant cannot get the conversation', async () => {
    await seedConv('c-get-2', convDoc([ADULT, ADULT_2]));
    await assertFails(dbFor(OUTSIDER).doc('conversations/c-get-2').get());
  });

  test('DENY: a crossCohortAtMigration:true thread is hidden even from a participant', async () => {
    await seedConv('c-get-3', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));
    await assertFails(dbFor(ADULT).doc('conversations/c-get-3').get());
  });

  test('DENY: an unauthenticated caller cannot get a conversation', async () => {
    await seedConv('c-get-4', convDoc([ADULT, ADULT_2]));
    await assertFails(dbAnon().doc('conversations/c-get-4').get());
  });

  test('DENY: a caller with no uniqueId claim (propagation race) cannot get', async () => {
    await seedConv('c-get-5', convDoc([ADULT, ADULT_2]));
    await assertFails(dbFor(NO_CLAIMS).doc('conversations/c-get-5').get());
  });

  test('a participant whose id is stored as a STRING is matched (numeric-claim vs string-data)', async () => {
    // The doc stores "50001" (string); the caller's claim uniqueId is 50001
    // (number). The rule `string(callerUniqueId()) in participantIds` bridges
    // them. This is the get-side mirror of the list bug.
    await seedConv('c-get-6', { participantIds: ['50001', '50002'], lastMessageAt: 1 });
    await assertSucceeds(dbFor(ADULT).doc('conversations/c-get-6').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// list (collection query) — SHY-0130 contract: STRING query ALLOWED, LONG DENIED
// ═══════════════════════════════════════════════════════════════════════════

describe('conversations list (collection query) — SHY-0130 contract', () => {
  test('a participant CAN list with a STRING array-contains query (the fix)', async () => {
    await seedConv('c-list-1', convDoc([ADULT, ADULT_2]));
    await seedConv('c-list-2', convDoc([ADULT, MINOR]));
    await assertSucceeds(listAsString(ADULT));
  });

  test('DENY: a LONG array-contains query (the Android bug shape)', async () => {
    await seedConv('c-list-1', convDoc([ADULT, ADULT_2]));
    await assertFails(listAsLong(ADULT));
  });

  test('an EMPTY result (participant has no threads) returns empty, not denied', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(listAsString(ADULT));
  });

  test('DENY: listing for another user’s id (non-participant cannot enumerate)', async () => {
    await seedConv('c-list-3', convDoc([ADULT, ADULT_2]));
    // OUTSIDER tries to read ADULT's threads by querying ADULT's id.
    await assertFails(
      dbFor(OUTSIDER)
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .get(),
    );
  });

  test('DENY: an unauthenticated caller cannot list conversations', async () => {
    await seedConv('c-list-4', convDoc([ADULT, ADULT_2]));
    await assertFails(
      dbAnon()
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .get(),
    );
  });
});

// SHY-0132 — the `crossCohortAtMigration` LIST-leak (OSA §17) + its fix.
//
// Mechanics (proven against the real engine): the `!= true` clause IS present in
// the `list` rule text (firestore.rules L327-329, identical to `get`), BUT
// Firestore does NOT apply a `resource.data` condition as a per-document FILTER on
// `list` — the query returns every doc matching its EXPLICIT constraints and the
// engine does not drop docs that fail the rule's data condition. So an
// unconstrained `array-contains(string(uid))` list RETURNS the caller's
// `crossCohortAtMigration: true` threads (fail-OPEN leak of migrated cross-cohort
// thread metadata) even though `get` on the same doc is correctly denied. The fix
// is query + data: the client adds `.where('crossCohortAtMigration','==', false)`
// AND an Admin-SDK backfill stamps the field on EVERY doc (a `== false` filter
// excludes docs where the field is ABSENT — so the backfill is mandatory and new
// writes must always stamp it). No rule change is possible (a rule cannot enforce a
// field the query does not constrain).
describe('conversations list — crossCohortAtMigration segregation (SHY-0132)', () => {
  test('LEAK (pre-fix): an unconstrained list returns the migrated cross-cohort thread', async () => {
    // A normal thread (field present, false) + a migrated cross-cohort thread.
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await seedConv('cc-migrated', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));

    const snap = await assertSucceeds(listAsString(ADULT));
    const ids = snap.docs.map((d) => d.id).sort();
    // The leak: the migrated cross-cohort thread is returned alongside the normal
    // one. This documents the vulnerability; the fix below excludes it.
    expect(ids).toEqual(['cc-migrated', 'cc-normal']);
  });

  test('FIX: list + where(crossCohortAtMigration == false) returns ONLY the non-migrated thread', async () => {
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await seedConv('cc-migrated', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));

    const snap = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toEqual(['cc-normal']); // the migrated thread is excluded
  });

  test('the == false filter EXCLUDES a doc with the field ABSENT (backfill is mandatory)', async () => {
    // A legacy thread with NO crossCohortAtMigration field (pre-backfill).
    await seedConv('cc-legacy', convDoc([ADULT, ADULT_2])); // convDoc omits the field
    const before = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    expect(before.docs).toHaveLength(0); // == false does not match an absent field

    // After the backfill stamps the field false, the legitimate thread reappears.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .doc('conversations/cc-legacy')
        .update({ crossCohortAtMigration: false });
    });
    const after = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    expect(after.docs.map((d) => d.id)).toEqual(['cc-legacy']);
  });

  test('a non-participant still cannot list another member’s threads via the filter', async () => {
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await assertFails(
      dbFor(OUTSIDER)
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .where('crossCohortAtMigration', '==', false)
        .get(),
    );
  });
});
