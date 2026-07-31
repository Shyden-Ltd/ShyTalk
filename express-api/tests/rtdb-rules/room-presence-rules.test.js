/**
 * room-presence-rules.test.js — SHY-0261
 *
 * Room presence is the gate that decides whether a room stays open. If a
 * presence write is rejected, the server concludes the owner left, and a room
 * closes itself seconds after opening. So the question "which key may a client
 * write?" is not a rules detail — it is the room lifecycle.
 *
 * These run against the REAL RTDB emulator rather than grepping the rules
 * text. The bug being pinned here was invisible to inspection: every file
 * involved looked correct on its own, and only an actual write attempt showed
 * that the key the client used was one the rules would never accept.
 *
 * Contract:
 *   rooms/{roomId}/presence/{firebaseAuthUid} = "{uniqueId}"
 *
 *   - the KEY is the writer's Firebase Auth uid — the rule is
 *     `auth.uid == $userId`, so presence cannot be forged for anyone else
 *   - the VALUE is the writer's Firestore uniqueId, because room documents
 *     speak uniqueId and readers must correlate the two without a lookup
 */
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

const { readFileSync } = require('fs');
const { join } = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const RULES = readFileSync(join(__dirname, '..', '..', '..', 'database.rules.json'), 'utf8');

// The two namespaces this bug conflated, shaped so a failure message makes the
// distinction obvious at a glance.
const ALICE_UID = 'aliceFirebaseUid123';
const ALICE_UNIQUE_ID = '10000005';
const MALLORY_UID = 'malloryFirebaseUid999';

const ROOM = 'presence-rules-room';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: `demo-shytalk-presence-rules-${process.env.JEST_WORKER_ID || '0'}`,
    database: { host: '127.0.0.1', port: 9000, rules: RULES },
  });
});

afterEach(async () => {
  await testEnv.clearDatabase();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function presenceRef(ctx, uid) {
  return ctx.database().ref(`rooms/${ROOM}/presence/${uid}`);
}

describe('who may write a presence node', () => {
  test('a signed-in user may claim presence under their own Firebase uid', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertSucceeds(presenceRef(alice, ALICE_UID).set(ALICE_UNIQUE_ID));
  });

  test('a user may NOT claim presence under their Firestore uniqueId', async () => {
    // THE BUG. Both clients keyed presence by uniqueId, so every presence
    // write was rejected, every user read as absent, and a freshly opened room
    // took the "owner has left, close it" branch. Pinned as an explicit
    // expectation so re-keying by uniqueId can never silently return.
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertFails(presenceRef(alice, ALICE_UNIQUE_ID).set(ALICE_UNIQUE_ID));
  });

  test('a user may NOT claim presence for someone else', async () => {
    const mallory = testEnv.authenticatedContext(MALLORY_UID);
    await assertFails(presenceRef(mallory, ALICE_UID).set(ALICE_UNIQUE_ID));
  });

  test('an unauthenticated client may not claim presence at all', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(presenceRef(anon, ALICE_UID).set(ALICE_UNIQUE_ID));
  });

  test('a user may clear their own presence', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertSucceeds(presenceRef(alice, ALICE_UID).set(ALICE_UNIQUE_ID));
    await assertSucceeds(presenceRef(alice, ALICE_UID).remove());
  });

  test('a user may NOT clear someone else’s presence', async () => {
    // Clearing a victim's presence is how you would evict them: the server's
    // disconnect-user gate asks exactly this node whether they are still here.
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await admin.database().ref(`rooms/${ROOM}/presence/${ALICE_UID}`).set(ALICE_UNIQUE_ID);
    });
    const mallory = testEnv.authenticatedContext(MALLORY_UID);
    await assertFails(presenceRef(mallory, ALICE_UID).remove());
  });
});

describe('what a presence node may contain', () => {
  test('the value may be a uniqueId string', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertSucceeds(presenceRef(alice, ALICE_UID).set(ALICE_UNIQUE_ID));
  });

  test('an empty value is rejected — it identifies nobody', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertFails(presenceRef(alice, ALICE_UID).set(''));
  });

  test('an over-long value is rejected', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertFails(presenceRef(alice, ALICE_UID).set('x'.repeat(65)));
  });

  test('a structured value is rejected — presence is one id, not a payload', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertFails(presenceRef(alice, ALICE_UID).set({ uniqueId: ALICE_UNIQUE_ID }));
  });
});

describe('reading presence', () => {
  test('a signed-in user can read the room’s presence set', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertSucceeds(alice.database().ref(`rooms/${ROOM}/presence`).get());
  });

  test('an unauthenticated client cannot read presence', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(anon.database().ref(`rooms/${ROOM}/presence`).get());
  });
});

describe('the value carries the identity room documents are written in', () => {
  test('a presence node written by uid resolves back to the writer’s uniqueId', async () => {
    // The correlation the client depends on: room membership is a list of
    // uniqueIds, so a presence set of raw uids would mark every participant
    // absent. Reading the VALUE is what keeps the two namespaces joined.
    const alice = testEnv.authenticatedContext(ALICE_UID);
    await assertSucceeds(presenceRef(alice, ALICE_UID).set(ALICE_UNIQUE_ID));

    await testEnv.withSecurityRulesDisabled(async (admin) => {
      const snap = await admin.database().ref(`rooms/${ROOM}/presence`).get();
      const byUniqueId = Object.values(snap.val() || {});
      expect(byUniqueId).toContain(ALICE_UNIQUE_ID);
      // And the key really is the uid, not the uniqueId — the property the
      // server relies on when it looks presence up by ownerFirebaseUid.
      expect(Object.keys(snap.val() || {})).toEqual([ALICE_UID]);
    });
  });
});
