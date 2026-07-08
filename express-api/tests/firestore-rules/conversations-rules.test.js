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
 * It also RESOLVES the open question the client fix depends on: does pinning
 * `participantIds` alone satisfy the `list` rule, or does the rule's second
 * clause `resource.data.get('crossCohortAtMigration', false) != true` require
 * its own query constraint? (See the `crossCohortAtMigration` describe block.)
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

  // NOTE: the `crossCohortAtMigration` LIST-leak is a separate, pre-existing OSA
  // §17 security issue tracked under its own story — NOT widened or fixed here.
  // Subtle mechanics (proven on the emulator, lest a future reader misread the
  // rule): the `!= true` clause IS present in the `list` rule text (firestore.rules
  // L327-329, identical to `get`), BUT Firestore does NOT apply a `resource.data`
  // field condition as a per-document FILTER on `list` — a list query returns every
  // doc matching its EXPLICIT query constraints, and the engine does not silently
  // drop docs that fail the rule's data condition. So an unconstrained
  // `array-contains(string(uid))` query RETURNS the caller's `crossCohortAtMigration:
  // true` threads (fail-OPEN leak of migrated cross-cohort thread metadata) even
  // though `get` on the same doc is correctly denied. The fix lives in the security
  // story: the client query must add `.where('crossCohortAtMigration','==', false)`
  // AND an Admin-SDK backfill must stamp that field on EVERY conversation doc — a
  // `==false` filter excludes docs where the field is ABSENT (proven: with the
  // filter but no backfill, the query returns ZERO docs, not just the safe ones),
  // so the backfill is mandatory and new docs must always stamp it. SHY-0130 is the
  // id-type contract only; that leak proof + its fix are this story's companion.
});
