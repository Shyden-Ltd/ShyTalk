/**
 * REAL Firestore security-rules tests for the follow-list reads — SHY-0338.
 *
 * The operator reported that the followers, following and stalkers lists "do
 * not work at all". This suite proves WHY, against the live rules engine
 * rather than by reading the rules source.
 *
 * `firestore.rules` gates `users/{uniqueId}` reads on `cohortMatchesCaller()`,
 * which compares the caller's token claim against
 * `resource.data.get('cohort', 'minor')` — a condition on document CONTENT.
 *
 * The mechanism was established by RUNNING it, and the first theory was wrong.
 * "Rules are not filters" does NOT apply to `documentId() in [...]`: that query
 * names exact document paths, so the engine evaluates the gate per document and
 * an all-same-cohort batch SUCCEEDS (proved by the CONTROL test below).
 *
 * What actually breaks the lists is that the refusal is ALL-OR-NOTHING. If any
 * ONE document in the chunk fails the gate, Firestore denies the WHOLE query —
 * the other 29 readable users go with it. `cohort` arrived with UK OSA #17, so
 * any user document written before it reads as the 'minor' default, and one
 * such follower empties an entire page for an adult viewer. A genuinely
 * cross-cohort member does the same.
 *
 * Stalkers is deadest of the three, for two FURTHER independent reasons — see
 * the last describe block. There, "rules are not filters" genuinely does apply.
 *
 * ── STATUS: CHARACTERISATION ────────────────────────────────────────────────
 * The `assertFails` cases below pin CURRENT, BROKEN behaviour. They exist to
 * prove the diagnosis, not to protect it. When the fix lands — moving these
 * reads onto the API, where the Admin SDK can filter per user instead of
 * refusing wholesale — the client-side query disappears and every one of them
 * must be REPLACED by an assertion of the intended contract. A green run of
 * this file is not evidence the lists work; it is evidence they are still
 * broken in exactly the way described.
 *
 * `UserRepositoryImpl.getUsers()` (Android) and `IosUserRepositoryImpl.getUsers()`
 * (iOS) both issue exactly such a query — `whereIn(FieldPath.documentId(), chunk)`
 * — and both swallow the refusal into `emptyList()`. So every follow list
 * renders empty on both platforms with nothing on screen to say why.
 *
 * Every other rules suite in this directory tests single-document
 * `get()`/`set()`; none issues a QUERY (grepped for `whereIn` / `documentId` /
 * `orderBy` across `tests/firestore-rules/` — no hits). That is the gap that
 * let this ship: the rule was verified for the operation the app never performs.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * `localhost:8080`). Start it with `bash local/start.sh`.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-follow-lists-${process.env.JEST_WORKER_ID || '1'}`;

// Express mints `uniqueId` + `cohort` as custom claims on sign-in (UK OSA #17
// PR 2). These are the personas a follow list puts side by side: the viewer,
// and people in the SAME cohort that they follow — i.e. exactly the people the
// rules are supposed to let them see.
const VIEWER = { uid: 'fbuid-follow-viewer', uniqueId: 60001, cohort: 'adult' };
const FOLLOWED_A = { uid: 'fbuid-follow-a', uniqueId: 60002, cohort: 'adult' };
const FOLLOWED_B = { uid: 'fbuid-follow-b', uniqueId: 60003, cohort: 'adult' };

let testEnv;
const handles = new Map();

function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

function userDoc(persona, overrides = {}) {
  return {
    firebaseUid: persona.uid,
    uniqueId: persona.uniqueId,
    cohort: persona.cohort,
    displayName: `User ${persona.uniqueId}`,
    followerIds: [],
    followingIds: [],
    ...overrides,
  };
}

async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
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
  await seedDoc(
    `users/${VIEWER.uniqueId}`,
    userDoc(VIEWER, {
      followingIds: [String(FOLLOWED_A.uniqueId), String(FOLLOWED_B.uniqueId)],
      followerIds: [String(FOLLOWED_A.uniqueId)],
    }),
  );
  await seedDoc(`users/${FOLLOWED_A.uniqueId}`, userDoc(FOLLOWED_A));
  await seedDoc(`users/${FOLLOWED_B.uniqueId}`, userDoc(FOLLOWED_B));
});

// ═══════════════════════════════════════════════════════════════════════════
// The rule works for the operation it was tested with…
// ═══════════════════════════════════════════════════════════════════════════

describe('users/{uniqueId} single-document reads — the rule behaves as designed', () => {
  test('the viewer can read their OWN profile document', async () => {
    // This is why the profile screen opens at all while its lists sit empty:
    // the own-doc carve-out is decidable from the path alone.
    await assertSucceeds(dbFor(VIEWER).doc(`users/${VIEWER.uniqueId}`).get());
  });

  test('the viewer can read a SAME-COHORT user one document at a time', async () => {
    // The people in the follow list ARE readable individually. Nothing about
    // this user is secret from this viewer — which is what makes the query
    // refusal below a defect rather than the rule doing its job.
    await assertSucceeds(dbFor(VIEWER).doc(`users/${FOLLOWED_A.uniqueId}`).get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// …and refuses the operation the app actually performs.
// ═══════════════════════════════════════════════════════════════════════════

describe('users batch QUERY — the SHY-0338 defect', () => {
  test('CONTROL: a batch where every named user is same-cohort SUCCEEDS', async () => {
    // Establishes what "working" looks like, and rules out the explanation I
    // first assumed. A `documentId() in [...]` query names exact paths, so the
    // engine CAN evaluate the rule per document — it is not the blanket
    // "rules are not filters" refusal that applies to a filtered query.
    await assertSucceeds(
      dbFor(VIEWER)
        .collection('users')
        .where(firebase.firestore.FieldPath.documentId(), 'in', [
          String(FOLLOWED_A.uniqueId),
          String(FOLLOWED_B.uniqueId),
        ])
        .get(),
    );
  });

  test('ONE member with no cohort field REFUSES THE WHOLE BATCH — the defect', async () => {
    // `cohort` arrived with UK OSA #17. Any user document written before it, or
    // by a path that does not stamp it, reads as the 'minor' default — so an
    // adult viewer fails the gate on that ONE document.
    //
    // The refusal is not per-document. Firestore denies the ENTIRE query, so
    // the other 29 readable users in the chunk are lost with it. getUsers()
    // chunks by 30, which means a single legacy follower empties an entire
    // page of the list.
    await seedDoc(`users/${FOLLOWED_B.uniqueId}`, {
      firebaseUid: FOLLOWED_B.uid,
      uniqueId: FOLLOWED_B.uniqueId,
      displayName: 'Legacy user with no cohort field',
    });
    await assertFails(
      dbFor(VIEWER)
        .collection('users')
        .where(firebase.firestore.FieldPath.documentId(), 'in', [
          String(FOLLOWED_A.uniqueId),
          String(FOLLOWED_B.uniqueId),
        ])
        .get(),
    );
  });

  test('the readable member is NOT returned on its own — it is all or nothing', async () => {
    // The consequence that makes this "not working at all" rather than
    // "sometimes incomplete". A partial result would show most of the list;
    // instead the caller gets an exception, and both platforms turn that into
    // emptyList().
    await seedDoc(`users/${FOLLOWED_B.uniqueId}`, {
      firebaseUid: FOLLOWED_B.uid,
      uniqueId: FOLLOWED_B.uniqueId,
      displayName: 'Legacy user with no cohort field',
    });
    let error = null;
    try {
      await dbFor(VIEWER)
        .collection('users')
        .where(firebase.firestore.FieldPath.documentId(), 'in', [
          String(FOLLOWED_A.uniqueId),
          String(FOLLOWED_B.uniqueId),
        ])
        .get();
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(String(error)).toMatch(/permission|PERMISSION_DENIED|insufficient/i);
  });

  test('a genuinely CROSS-COHORT member refuses the whole batch too', async () => {
    // The same all-or-nothing behaviour when the cohort gate is doing its
    // intended job. Even here the outcome is wrong: hiding one minor from an
    // adult should hide THAT PERSON, not the adult's entire follow list.
    await seedDoc(`users/${FOLLOWED_B.uniqueId}`, {
      firebaseUid: FOLLOWED_B.uid,
      uniqueId: FOLLOWED_B.uniqueId,
      cohort: 'minor',
      displayName: 'A minor',
    });
    await assertFails(
      dbFor(VIEWER)
        .collection('users')
        .where(firebase.firestore.FieldPath.documentId(), 'in', [
          String(FOLLOWED_A.uniqueId),
          String(FOLLOWED_B.uniqueId),
        ])
        .get(),
    );
  });
});

describe('stalkers subcollection QUERY — the same defect, second surface', () => {
  test('the ordered stalkers query getStalkers() issues is REFUSED even for your own stalkers', async () => {
    // getStalkers() reads users/{id}/stalkers ordered by lastVisitedAt. The
    // rule is `callerUniqueId() == int(uniqueId) && cohortMatchesCaller()`.
    // The first clause is decidable from the path; the second reads
    // resource.data on the STALKER document, so the query is refused.
    await seedDoc(`users/${VIEWER.uniqueId}/stalkers/${FOLLOWED_A.uniqueId}`, {
      visitorId: String(FOLLOWED_A.uniqueId),
      lastVisitedAt: Date.now(),
    });
    await assertFails(
      dbFor(VIEWER)
        .collection(`users/${VIEWER.uniqueId}/stalkers`)
        .orderBy('lastVisitedAt', 'desc')
        .limit(50)
        .get(),
    );
  });

  test('even a single stalker document read one at a time is refused for an adult viewer', async () => {
    // The second, INDEPENDENT reason stalkers cannot work: a stalker document
    // carries no `cohort` field, so cohortMatchesCaller() compares the adult
    // caller's 'adult' claim against the 'minor' default and never matches.
    // Fixing only the query form would leave this one standing.
    await seedDoc(`users/${VIEWER.uniqueId}/stalkers/${FOLLOWED_A.uniqueId}`, {
      visitorId: String(FOLLOWED_A.uniqueId),
      lastVisitedAt: Date.now(),
    });
    await assertFails(
      dbFor(VIEWER).doc(`users/${VIEWER.uniqueId}/stalkers/${FOLLOWED_A.uniqueId}`).get(),
    );
  });
});
