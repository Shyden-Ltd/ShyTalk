/**
 * REAL Firestore security-rules tests for `rooms/{roomId}`, exercised against
 * the live Firestore emulator via `@firebase/rules-unit-testing` (v5).
 *
 * EPIC-0003 (SHY-0113) — "no more faking". This REPLACES the prior logic-level
 * string-assertion tests that used to live in this file. Those only checked
 * that `firestore.rules` CONTAINED certain text (`expect(ROOM_BLOCK).toContain(
 * 'allow create: ...')`) and even asserted pure tautologies
 * (`expect(true).toBe(true)`, `expect(callerRole).toEqual(expect.any(String))`).
 * A rules test that greps the rules SOURCE is structural-grep-as-behaviour: it
 * stays green even when the engine would DENY a legitimate write — the exact
 * false confidence the operator hit ("I still can't create rooms on the dev
 * app" while the mocked tests were green). These tests drive the real
 * `allow create` / `read` / `update` / `delete` gates with realistic token
 * claims so the contract is proven by the engine, not by text.
 *
 * The genuinely-structural source-contract guards that used to share this file
 * (the server-endpoint migration map, the `users/{uniqueId}` `currentRoomId`
 * self-write guard, the seat-mutation transaction-precondition guard) have NO
 * engine equivalent here and moved to `room-rules-static.unit.test.js` — they
 * assert SOURCE text on purpose, so they stay out of this behavioural suite.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * `localhost:8080`). Start it with `bash local/start.sh`; SHY-0109 provisions
 * the same emulator in CI, so this runs there too. `assertEmulatorReachable()`
 * fails FAST with an actionable message rather than letting the test hang — and
 * it never silently skips (a skip would be the soft-mock EPIC-0003 bans).
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

// A distinct demo-* projectId keeps this suite's data out of the seeded
// `demo-shytalk` namespace (local/seed.js) and lets clearFirestore() wipe only
// our rooms between tests. The per-worker suffix avoids a clash if Jest ever
// schedules another rules suite into the same emulator concurrently
// (jest.config maxWorkers: 2).
const PROJECT_ID = `demo-shytalk-rooms-rules-${process.env.JEST_WORKER_ID || '1'}`;

// ── Realistic JWT claim shapes ───────────────────────────────────────────────
// Express mints `uniqueId` + `cohort` (+ `admin`) as custom claims on sign-in
// (UK OSA #17 PR 2). `callerUniqueId()` reads `request.auth.token.uniqueId`
// WITHOUT a `.get` default, so a token missing it makes the create/delete rule
// THROW → deny. `cohort` defaults to 'minor' on both sides of the gate.
const ADULT = { uid: 'fbuid-adult-1', uniqueId: 50001, cohort: 'adult' };
const ADULT_2 = { uid: 'fbuid-adult-2', uniqueId: 50002, cohort: 'adult' };
// A same-cohort adult who is NOT a participant of the seeded room — isolates a
// "membership" denial from a "cohort" denial in the subcollection create gates.
const ADULT_3 = { uid: 'fbuid-adult-3', uniqueId: 50003, cohort: 'adult' };
const MINOR = { uid: 'fbuid-minor-1', uniqueId: 50010, cohort: 'minor' };
const ADMIN = { uid: 'fbuid-admin-1', uniqueId: 50099, cohort: 'minor', admin: true };
// Propagation-race caller: signed in, but the custom-claim mint/refresh hasn't
// landed yet, so the token carries NO uniqueId and NO cohort — the canonical
// state right after sign-in, before claims propagate onto the ID token.
const NO_CLAIMS = { uid: 'fbuid-noclaims-1' };
// Partial-propagation caller: `uniqueId` has landed but `cohort` has NOT yet.
// A DISTINCT race state from NO_CLAIMS — `callerUniqueId()` resolves fine, but
// `cohort` defaults to 'minor', so a create that stamps a non-minor cohort
// fails on the cohort-match clause (a different failure mode than no-claims,
// where `callerUniqueId()` throws first).
const PARTIAL_CLAIMS = { uid: 'fbuid-partial-1', uniqueId: 50011 };

let testEnv;
// One Firestore handle per caller, built ONCE in beforeAll and reused across
// every test. A fresh `authenticatedContext().firestore()` per assertion would
// open a new grpc channel each time (dozens of lingering keepalive timers →
// Jest's "worker failed to exit gracefully"). clearFirestore() wipes DATA
// between tests but leaves these context apps intact, so reuse is safe and
// `testEnv.cleanup()` closes the whole fixed set.
const handles = new Map();

/** Firestore handle for an authed caller with the given custom claims. */
function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

/** Firestore handle for an unauthenticated caller (single shared instance). */
function dbAnon() {
  if (!handles.has('__anon__')) {
    handles.set('__anon__', testEnv.unauthenticatedContext().firestore());
  }
  return handles.get('__anon__');
}

/**
 * A valid room document as the migrated client stamps it: `cohort` copied from
 * the owner's resolved cohort, `ownerId` = the owner's stringified uniqueId,
 * `ownerFirebaseUid` = the owner's Firebase uid. Override fields per test to
 * isolate a single failing clause.
 */
function roomDoc(owner, overrides = {}) {
  return {
    cohort: owner.cohort,
    ownerId: String(owner.uniqueId),
    ownerFirebaseUid: owner.uid,
    name: 'Test Room',
    state: 'OPEN',
    participantIds: [String(owner.uniqueId)],
    ...overrides,
  };
}

/** Seed any document bypassing rules (precondition for read/update/delete). */
async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

/** Seed a room doc (convenience wrapper around seedDoc for `rooms/{id}`). */
function seedRoom(roomId, data) {
  return seedDoc(`rooms/${roomId}`, data);
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
// create — cohort-stamped, owner==caller, ownerFirebaseUid bound to auth.uid
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId} create — real rules engine', () => {
  test('adult owner with a matching cohort claim CAN create an adult room (operator happy path)', async () => {
    await assertSucceeds(dbFor(ADULT).doc('rooms/r-create-1').set(roomDoc(ADULT)));
  });

  test('minor owner with a matching cohort claim CAN create a minor room', async () => {
    await assertSucceeds(dbFor(MINOR).doc('rooms/r-create-2').set(roomDoc(MINOR)));
  });

  test('legacy client that OMITS ownerFirebaseUid can still create (rollout default branch)', async () => {
    // `.get('ownerFirebaseUid', request.auth.uid)` — field-missing → default
    // matches `request.auth.uid` → passes (keeps pre-cron-elim app versions
    // creating rooms during Play/App Store rollout).
    const legacy = roomDoc(ADULT);
    delete legacy.ownerFirebaseUid;
    await assertSucceeds(dbFor(ADULT).doc('rooms/r-create-3').set(legacy));
  });

  test('DENY: a minor-claimed caller stamping cohort:adult (cohort forgery)', async () => {
    await assertFails(
      dbFor(MINOR)
        .doc('rooms/r-deny-1')
        .set(roomDoc(MINOR, { cohort: 'adult' })),
    );
  });

  test('DENY: stamped cohort does not match the caller cohort claim (adult claim, minor stamp)', async () => {
    await assertFails(
      dbFor(ADULT)
        .doc('rooms/r-deny-2')
        .set(roomDoc(ADULT, { cohort: 'minor' })),
    );
  });

  test('DENY: an unknown cohort value (neither adult nor minor)', async () => {
    // Even self-consistent with the claim, the rule pins cohort ∈ {adult,minor}.
    await assertFails(
      dbFor(ADULT)
        .doc('rooms/r-deny-2b')
        .set(roomDoc(ADULT, { cohort: 'teen' })),
    );
  });

  test('DENY: ownerId is not the caller uniqueId (proxy room)', async () => {
    await assertFails(
      dbFor(ADULT)
        .doc('rooms/r-deny-3')
        .set(roomDoc(ADULT, { ownerId: '99999' })),
    );
  });

  test('DENY: ownerFirebaseUid is forged (not the caller auth uid)', async () => {
    await assertFails(
      dbFor(ADULT)
        .doc('rooms/r-deny-4')
        .set(roomDoc(ADULT, { ownerFirebaseUid: 'someone-else' })),
    );
  });

  test('DENY (repro): a freshly-signed-in caller whose claims have NOT propagated cannot create', async () => {
    // Reproduces the operator's "can't create rooms" path at the rules layer:
    // the client resolves the user as adult and stamps cohort:adult + ownerId,
    // but the JWT carries no uniqueId/cohort yet → `callerUniqueId()` throws and
    // cohort defaults to 'minor' (≠ stamped 'adult') → PERMISSION_DENIED. The
    // fix lives in the CLIENT (force token refresh after claim mint, before
    // createRoom), not in the rule — this test pins that the rule is right to
    // deny the unclaimed state.
    await assertFails(
      dbFor(NO_CLAIMS).doc('rooms/r-deny-5').set({
        cohort: 'adult',
        ownerId: '50001',
        ownerFirebaseUid: NO_CLAIMS.uid,
        name: 'Test Room',
        state: 'OPEN',
      }),
    );
  });

  test('DENY (partial-claims race): uniqueId landed but cohort has NOT, stamping cohort:adult', async () => {
    // The second propagation-race state: `callerUniqueId()` resolves (uniqueId is
    // present, ownerId can match), so the deny is driven purely by the cohort
    // clause — the token cohort defaults to 'minor' while the stamp is 'adult'.
    // Distinct failure mode from NO_CLAIMS (where callerUniqueId() throws first);
    // pins that cohort-claim propagation is independently required on create.
    await assertFails(
      dbFor(PARTIAL_CLAIMS)
        .doc('rooms/r-deny-7')
        .set({
          cohort: 'adult',
          ownerId: String(PARTIAL_CLAIMS.uniqueId),
          ownerFirebaseUid: PARTIAL_CLAIMS.uid,
          name: 'Test Room',
          state: 'OPEN',
        }),
    );
  });

  test('DENY: unauthenticated create', async () => {
    await assertFails(dbAnon().doc('rooms/r-deny-6').set(roomDoc(ADULT)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// read — same-cohort gate, admin moderation bypass
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId} read — real rules engine (same-cohort gate)', () => {
  beforeEach(async () => {
    await seedRoom('r-adult', roomDoc(ADULT)); // cohort: 'adult'
    await seedRoom('r-minor', roomDoc(MINOR)); // cohort: 'minor'
  });

  test('adult caller CAN read an adult room', async () => {
    await assertSucceeds(dbFor(ADULT_2).doc('rooms/r-adult').get());
  });

  test('DENY: minor caller cannot read an adult room (SHY-0102 cross-cohort denial)', async () => {
    await assertFails(dbFor(MINOR).doc('rooms/r-adult').get());
  });

  test('minor caller CAN read a minor room', async () => {
    await assertSucceeds(dbFor(MINOR).doc('rooms/r-minor').get());
  });

  test('DENY (reverse direction): an adult caller cannot read a minor room', async () => {
    // OSA §17 segregation in BOTH directions — the adult→minor single-doc read
    // is denied too (the minor→adult case above is not sufficient on its own).
    await assertFails(dbFor(ADULT_2).doc('rooms/r-minor').get());
  });

  test('admin CAN read across cohorts (moderation bypass)', async () => {
    await assertSucceeds(dbFor(ADMIN).doc('rooms/r-adult').get());
  });

  test('DENY: unauthenticated read', async () => {
    await assertFails(dbAnon().doc('rooms/r-adult').get());
  });

  test('rollout-safety: a no-claims caller can read a no-cohort room (both default to minor)', async () => {
    await seedRoom('r-legacy', { ownerId: '50001', name: 'Legacy', state: 'OPEN' });
    await assertSucceeds(dbFor(NO_CLAIMS).doc('rooms/r-legacy').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// update — fully locked down (allow update: if false); all client writes route
// through the Admin-SDK Express endpoints (which bypass these rules)
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId} update — locked down (P3 server-authz cutover)', () => {
  beforeEach(async () => {
    await seedRoom('r-upd', roomDoc(ADULT));
  });

  test('DENY: even the room owner cannot update the room doc directly', async () => {
    await assertFails(dbFor(ADULT).doc('rooms/r-upd').update({ name: 'Renamed' }));
  });

  test('DENY: a same-cohort participant cannot update the room doc', async () => {
    await assertFails(dbFor(ADULT_2).doc('rooms/r-upd').update({ name: 'Hijack' }));
  });

  test('DENY: even an admin cannot update the room doc client-side (no admin bypass on update)', async () => {
    await assertFails(dbFor(ADMIN).doc('rooms/r-upd').update({ state: 'CLOSED' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// delete — owner-only (closeRoom writes state=CLOSED server-side; real deletes
// are rare but the owner-only gate must hold)
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId} delete — owner-only', () => {
  beforeEach(async () => {
    await seedRoom('r-del', roomDoc(ADULT));
  });

  test('owner CAN delete own room', async () => {
    await assertSucceeds(dbFor(ADULT).doc('rooms/r-del').delete());
  });

  test('DENY: a non-owner cannot delete the room', async () => {
    await assertFails(dbFor(ADULT_2).doc('rooms/r-del').delete());
  });

  test('DENY: even an admin cannot delete a room they do not own (no admin bypass on delete)', async () => {
    // The delete rule is owner-only (callerUniqueId == ownerId) with NO isAdmin()
    // branch — moderation closes rooms via the server endpoint (state=CLOSED),
    // not by client-side delete. Pin that admin gets no delete bypass.
    await assertFails(dbFor(ADMIN).doc('rooms/r-del').delete());
  });

  test('DENY: unauthenticated delete', async () => {
    await assertFails(dbAnon().doc('rooms/r-del').delete());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rooms/{roomId}/messages — same-cohort read, member-only create, sender-owns
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId}/messages — real rules engine', () => {
  // Parent room must exist: the message rules cross-read it via get() for the
  // cohort gate (read) and the owner/participant gate (create).
  beforeEach(async () => {
    await seedRoom(
      'r-msg',
      roomDoc(ADULT, { participantIds: [String(ADULT.uniqueId), String(ADULT_2.uniqueId)] }),
    );
  });

  const msg = (sender) => ({ senderId: String(sender.uniqueId), text: 'hi', sentAt: 1 });

  test('owner CAN post a message', async () => {
    await assertSucceeds(dbFor(ADULT).doc('rooms/r-msg/messages/m1').set(msg(ADULT)));
  });

  test('a room participant CAN post a message', async () => {
    await assertSucceeds(dbFor(ADULT_2).doc('rooms/r-msg/messages/m2').set(msg(ADULT_2)));
  });

  test('DENY: a same-cohort NON-participant cannot post (anti-spam membership gate)', async () => {
    await assertFails(dbFor(ADULT_3).doc('rooms/r-msg/messages/m3').set(msg(ADULT_3)));
  });

  test('DENY: a cross-cohort NON-participant (minor) cannot post to an adult room', async () => {
    // The message create rule gates on membership (owner OR in participantIds),
    // NOT on cohort — participation is the load-bearing control, and joining is
    // cohort-gated server-side (room update: if false blocks client participant
    // writes). In the reachable case a minor is never a participant of an adult
    // room, so they are denied here on the membership clause. (Defence-in-depth
    // cohort-gating ON create — for the Admin-SDK-only "minor planted in
    // participantIds" edge — would be a rules change, tracked separately.)
    await assertFails(dbFor(MINOR).doc('rooms/r-msg/messages/m3x').set(msg(MINOR)));
  });

  test('DENY: unauthenticated post', async () => {
    await assertFails(dbAnon().doc('rooms/r-msg/messages/m4').set(msg(ADULT)));
  });

  test('a same-cohort participant CAN read a message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertSucceeds(dbFor(ADULT_2).doc('rooms/r-msg/messages/seeded').get());
  });

  test('DENY: a cross-cohort caller cannot read a message (mirrors parent room gate)', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertFails(dbFor(MINOR).doc('rooms/r-msg/messages/seeded').get());
  });

  test('admin CAN read a message across cohorts', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertSucceeds(dbFor(ADMIN).doc('rooms/r-msg/messages/seeded').get());
  });

  test('the sender CAN edit own message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertSucceeds(
      dbFor(ADULT).doc('rooms/r-msg/messages/seeded').update({ text: 'edited' }),
    );
  });

  test('DENY: a non-sender cannot edit a message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertFails(dbFor(ADULT_2).doc('rooms/r-msg/messages/seeded').update({ text: 'hijack' }));
  });

  // delete is the OTHER half of `allow update, delete: ... senderId` — a
  // distinct destructive verb (permanently removing message history), so it is
  // proven separately from update in every direction.
  test('the sender CAN delete own message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertSucceeds(dbFor(ADULT).doc('rooms/r-msg/messages/seeded').delete());
  });

  test('DENY: a non-sender cannot delete a message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertFails(dbFor(ADULT_2).doc('rooms/r-msg/messages/seeded').delete());
  });

  test('DENY: an unauthenticated caller cannot delete a message', async () => {
    await seedDoc('rooms/r-msg/messages/seeded', msg(ADULT));
    await assertFails(dbAnon().doc('rooms/r-msg/messages/seeded').delete());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rooms/{roomId}/messages LIST (collection query) — the list-vs-get contract
// for the subcollection. Unlike the rooms list, the messages read rule gates on
// the PARENT room's cohort (via get()), NOT on per-message resource.data — so a
// member's list needs NO per-doc where filter (the rule is constant across the
// subcollection). This block proves the subcollection list is NOT subject to a
// SHY-0102-style denial, while cross-cohort listing is still blocked.
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId}/messages list (collection query)', () => {
  beforeEach(async () => {
    await seedRoom(
      'r-msg',
      roomDoc(ADULT, { participantIds: [String(ADULT.uniqueId), String(ADULT_2.uniqueId)] }),
    );
    await seedDoc('rooms/r-msg/messages/m1', {
      senderId: String(ADULT.uniqueId),
      text: 'a',
      sentAt: 1,
    });
    await seedDoc('rooms/r-msg/messages/m2', {
      senderId: String(ADULT_2.uniqueId),
      text: 'b',
      sentAt: 2,
    });
  });

  test('a same-cohort participant CAN list all messages (no cohort filter needed)', async () => {
    const snap = await assertSucceeds(dbFor(ADULT_2).collection('rooms/r-msg/messages').get());
    expect(snap.size).toBe(2);
  });

  test('admin CAN list messages across cohorts (moderation bypass)', async () => {
    const snap = await assertSucceeds(dbFor(ADMIN).collection('rooms/r-msg/messages').get());
    expect(snap.size).toBe(2);
  });

  test('DENY: a cross-cohort caller (minor) cannot list an adult room’s messages', async () => {
    await assertFails(dbFor(MINOR).collection('rooms/r-msg/messages').get());
  });

  test('DENY: an unauthenticated caller cannot list messages', async () => {
    await assertFails(dbAnon().collection('rooms/r-msg/messages').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rooms/{roomId}/seatRequests — same-cohort read, identity-bound create,
// owner-or-requester update
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms/{roomId}/seatRequests — real rules engine', () => {
  beforeEach(async () => {
    await seedRoom('r-seat', roomDoc(ADULT)); // owner = ADULT (50001), cohort adult
  });

  test('a caller CAN file a seat request bound to their OWN uniqueId', async () => {
    await assertSucceeds(
      dbFor(ADULT_2)
        .doc('rooms/r-seat/seatRequests/sr1')
        .set({ userId: String(ADULT_2.uniqueId) }),
    );
  });

  test('DENY: filing a seat request attributed to ANOTHER user (impersonation)', async () => {
    // SECURITY: create MUST bind userId to the caller; otherwise any authed user
    // could file a request attributed to another account, making the owner
    // promote the wrong user.
    await assertFails(
      dbFor(ADULT_2)
        .doc('rooms/r-seat/seatRequests/sr2')
        .set({ userId: String(ADULT.uniqueId) }),
    );
  });

  test('DENY: unauthenticated seat request', async () => {
    await assertFails(
      dbAnon()
        .doc('rooms/r-seat/seatRequests/sr3')
        .set({ userId: String(ADULT_2.uniqueId) }),
    );
  });

  test('a same-cohort caller CAN read a seat request', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertSucceeds(dbFor(ADULT_2).doc('rooms/r-seat/seatRequests/seeded').get());
  });

  test('DENY: a cross-cohort caller (minor) cannot read an adult room’s seat request', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertFails(dbFor(MINOR).doc('rooms/r-seat/seatRequests/seeded').get());
  });

  test('DENY (reverse direction): an adult cannot read a minor room’s seat request', async () => {
    // OSA §17 segregation must hold in BOTH directions — the seatRequests read
    // rule mirrors the parent room cohort gate, so adult→minor is denied too.
    await seedRoom('r-seat-minor', roomDoc(MINOR));
    await seedDoc('rooms/r-seat-minor/seatRequests/seeded', { userId: String(MINOR.uniqueId) });
    await assertFails(dbFor(ADULT_2).doc('rooms/r-seat-minor/seatRequests/seeded').get());
  });

  test('admin CAN read a seat request across cohorts (moderation bypass)', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertSucceeds(dbFor(ADMIN).doc('rooms/r-seat/seatRequests/seeded').get());
  });

  test('the room owner CAN update a seat request (approve/deny)', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertSucceeds(
      dbFor(ADULT).doc('rooms/r-seat/seatRequests/seeded').update({ status: 'approved' }),
    );
  });

  test('the requester CAN cancel their OWN seat request', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertSucceeds(
      dbFor(ADULT_2).doc('rooms/r-seat/seatRequests/seeded').update({ status: 'cancelled' }),
    );
  });

  test('DENY: an unrelated user cannot update a seat request', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertFails(
      dbFor(ADULT_3).doc('rooms/r-seat/seatRequests/seeded').update({ status: 'approved' }),
    );
  });

  // The seatRequests rule has no `allow delete`, so delete is implicitly denied
  // for EVERYONE — proven separately for the requester and the owner so a
  // regression names which caller category broke. A future edit that adds
  // `allow delete` (or widens `update` to `update, delete`) is then a
  // deliberate, test-visible contract change. Cancellation is an UPDATE
  // (status: 'cancelled'), never a delete.
  test('DENY: the requester cannot DELETE their own seat request', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertFails(dbFor(ADULT_2).doc('rooms/r-seat/seatRequests/seeded').delete());
  });

  test('DENY: the room owner cannot DELETE a seat request either', async () => {
    await seedDoc('rooms/r-seat/seatRequests/seeded', { userId: String(ADULT_2.uniqueId) });
    await assertFails(dbFor(ADULT).doc('rooms/r-seat/seatRequests/seeded').delete());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rooms LIST (collection query) — SHY-0102 contract
//
// `get` (single doc) and `list` (collection query) evaluate DIFFERENTLY. Every
// test above uses `.doc().get()`; this block exercises the `list` path that the
// `get`-only tests could never catch.
//
// Firestore rules are NOT filters: a `list` is REJECTED unless the query's own
// `where` constraints GUARANTEE every returnable doc satisfies the rule (the
// rule is evaluated against the query, with `resource.data` available only when
// the query pins the field). The rooms read rule gates on
// `resource.data.cohort` (`cohortMatchesCaller()`), so a list is allowed ONLY
// when the client constrains the query with `where('cohort','==', <claim>)`.
//
// SHY-0102 ROOT CAUSE (proven by emulator probe 2026-06-19): the production
// query is `rooms where state in [ACTIVE, OWNER_AWAY]` with NO cohort filter
// (IosRoomRepositoryImpl.kt:31 + the Android/common equivalents) → Firestore
// can't guarantee the cohort rule → PERMISSION_DENIED → empty Rooms screen. The
// rule is CORRECT and SECURE; the FIX is CLIENT-side — add
// `where('cohort','==', cohortClaim)` to the query. No rules change, so no
// rules-deploy checkpoint. These tests pin that contract: filtered list ALLOWED,
// unfiltered list DENIED (the bug the client must stop sending), segregation
// preserved.
// ═══════════════════════════════════════════════════════════════════════════

describe('rooms list (collection query) — SHY-0102 contract', () => {
  // The CORRECT production query post-fix: cohort-pinned so Firestore can prove
  // every returned room matches the caller's cohort.
  const cohortRoomsQuery = (db, cohort) =>
    db
      .collection('rooms')
      .where('cohort', '==', cohort)
      .where('state', 'in', ['ACTIVE', 'OWNER_AWAY'])
      .get();
  // The CURRENT (buggy) production query: state-only, no cohort filter.
  const unfilteredRoomsQuery = (db) =>
    db.collection('rooms').where('state', 'in', ['ACTIVE', 'OWNER_AWAY']).get();

  beforeEach(async () => {
    await seedRoom('r-list-a1', roomDoc(ADULT, { state: 'ACTIVE' }));
    await seedRoom('r-list-a2', roomDoc(ADULT, { state: 'OWNER_AWAY' }));
    await seedRoom('r-list-m1', roomDoc(MINOR, { state: 'ACTIVE' }));
  });

  test('an adult member CAN list rooms when the query pins cohort==adult (the fix)', async () => {
    const snap = await assertSucceeds(cohortRoomsQuery(dbFor(ADULT), 'adult'));
    // Only the adult rooms come back — the minor room is excluded by the filter.
    expect(snap.size).toBe(2);
  });

  test('a minor member CAN list rooms when the query pins cohort==minor', async () => {
    const snap = await assertSucceeds(cohortRoomsQuery(dbFor(MINOR), 'minor'));
    expect(snap.size).toBe(1);
  });

  test('an EMPTY cohort-pinned list returns empty, not PERMISSION_DENIED', async () => {
    await testEnv.clearFirestore(); // zero rooms — a constrained list is still allowed
    const snap = await assertSucceeds(cohortRoomsQuery(dbFor(ADULT), 'adult'));
    expect(snap.size).toBe(0);
  });

  test('SHY-0102 repro: the current state-only query (no cohort filter) is DENIED', async () => {
    // This is exactly what the app sends today → the empty Rooms screen. The
    // rule is right to deny it (it cannot prove cohort segregation); the client
    // must add the cohort filter. Pinned so a regression that re-drops the
    // filter is caught here, and so the fix's intent is documented.
    await assertFails(unfilteredRoomsQuery(dbFor(ADULT)));
  });

  test('DENY (segregation): a minor pinning cohort==adult cannot list adult rooms', async () => {
    // The adversarial case the fix must NOT open: a repackaged minor client that
    // filters cohort==adult is still rejected — the rule needs the caller's
    // 'minor' claim to equal the room cohort, which 'adult' never will.
    await assertFails(cohortRoomsQuery(dbFor(MINOR), 'adult'));
  });

  test('DENY: an unauthenticated caller cannot list rooms', async () => {
    await assertFails(cohortRoomsQuery(dbAnon(), 'adult'));
  });
});
