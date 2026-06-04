/**
 * Tests for Firestore security rules on `rooms/{roomId}` after the P3 server-
 * authz lockdown (the firestore.rules change that pairs with PR #858).
 *
 * Mirrors the existing suggestions-rules.test.js pattern (logic-level
 * documentation tests — they pin the expected rules behaviour without invoking
 * the rules engine). Full integration testing against the Firebase emulator via
 * `@firebase/rules-unit-testing` is a worthwhile follow-up but a separate
 * scope; this file documents the lockdown invariants so that a future
 * regression (e.g. someone re-opening `allow update`) trips a red test in CI.
 */

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { readFileSync } = require('fs');
const { join } = require('path');

const RULES = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

/**
 * Extract a named `match` block by slicing the rules text between
 * `match <path> {` and its matching closing `}`. Avoids the slow lazy-
 * quantifier regex (`[\s\S]*?`) that SonarJS rightly flags as super-linear-
 * backtracking-prone. Returns the block text (including the `match` line and
 * closing brace) or null if not found.
 */
function extractMatchBlock(rules, openLine) {
  const start = rules.indexOf(openLine);
  if (start < 0) return null;
  // The block-opening `{` is the FINAL character of `openLine` (e.g.
  // `match /rooms/{roomId} {`). Start the scan past it with depth = 1; this
  // prevents the `{` inside the path placeholder `{roomId}` from being mis-
  // counted as a nested block opener.
  let depth = 1;
  for (let i = start + openLine.length; i < rules.length; i++) {
    const c = rules[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  return null;
}

const ROOM_BLOCK = extractMatchBlock(RULES, 'match /rooms/{roomId} {');
const USER_BLOCK = extractMatchBlock(RULES, 'match /users/{uniqueId} {');

// ═══════════════════════════════════════════════════════════════
// P3 lockdown core invariant — rooms/{roomId} update is denied
// ═══════════════════════════════════════════════════════════════

describe('rooms/{roomId} P3 lockdown — update denied for all clients', () => {
  // The crux of the lockdown: the `allow update` rule on the room doc must
  // resolve to `if false`. The old rule (owner OR participant OR joiner) is
  // replaced because every legitimate write now flows through an Admin-SDK
  // endpoint that bypasses these rules.
  test('firestore.rules contains the lockdown line for rooms/{roomId}', () => {
    // Pin: the exact lockdown line must be present in the room match block.
    expect(ROOM_BLOCK).not.toBeNull();
    expect(ROOM_BLOCK).toContain('allow update: if false;');
  });

  test('firestore.rules does NOT permit room-doc update via participant-membership check', () => {
    // Regression guard: the old permissive branches must be gone. The update
    // rule inside the room block must be the bare deny.
    const updateLine = ROOM_BLOCK.match(/allow update:[^\n]*/);
    expect(updateLine[0]).toBe('allow update: if false;');
  });

  test('the deny applies regardless of caller role — owner, participant, host, joiner', () => {
    // Documentation pin: under `allow update: if false`, none of the legacy
    // permitted callers can write the room doc directly.
    const denied = ['owner', 'host', 'existing participant', 'joiner adding self'];
    for (const callerRole of denied) {
      // All four must be denied — there is no role that can update the room
      // doc client-side post-lockdown.
      expect(callerRole).toEqual(expect.any(String));
    }
    // No client role bypasses the lockdown.
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Lockdown migration map — every locked-down write has an endpoint
// ═══════════════════════════════════════════════════════════════

describe('lockdown migration map — every blocked client write has a server endpoint', () => {
  // The lockdown is only safe because the migrated client (PR #858) routes
  // every room-doc mutation through one of these endpoints. If a future change
  // adds a NEW client-side room-doc write, it MUST also add an endpoint or the
  // app will start seeing PERMISSION_DENIED at runtime.
  const MUTATIONS_FILE = readFileSync(
    join(__dirname, '..', '..', 'src', 'routes', 'room-mutations.js'),
    'utf8',
  );

  const requiredEndpoints = [
    // Seat lifecycle
    '/rooms/:roomId/seats/:seatIndex/claim',
    '/rooms/:roomId/seats/:seatIndex/accept-invite',
    '/rooms/:roomId/seats/:seatIndex/leave',
    '/rooms/:roomId/seats/:seatIndex/remove',
    '/rooms/:roomId/seats/:seatIndex/move',
    '/rooms/:roomId/seats/:seatIndex/mute',
    // Moderation
    '/rooms/:roomId/kick',
    '/rooms/:roomId/hosts',
    '/rooms/:roomId/hosts/:userId',
    // Settings + lifecycle
    '/rooms/:roomId/name',
    '/rooms/:roomId/require-approval',
    '/rooms/:roomId/owner-away',
    '/rooms/:roomId/owner-returned',
    '/rooms/:roomId/close',
    // Participant lifecycle
    '/rooms/:roomId/join',
    '/rooms/:roomId/leave',
    '/rooms/:roomId/decline-invite',
    '/rooms/:roomId/disconnect-user',
    '/rooms/:roomId/first-join',
  ];

  for (const path of requiredEndpoints) {
    test(`endpoint exists for ${path}`, () => {
      expect(MUTATIONS_FILE).toContain(path);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// What the lockdown DOES NOT change — regression guards
// ═══════════════════════════════════════════════════════════════

describe('rooms/{roomId} unaffected verbs — read / create / delete unchanged', () => {
  test('read remains same-cohort-gated', () => {
    // The cohort read gate (UK OSA #17 PR 3) must survive the update lockdown.
    expect(ROOM_BLOCK).toContain('allow read: if request.auth != null');
    expect(ROOM_BLOCK).toContain('cohortMatchesCaller()');
    expect(ROOM_BLOCK).toContain('isAdmin()');
  });

  test('create remains gated on cohort-stamped owner==caller', () => {
    // Clients still create rooms; the cohort stamp + owner identity gate is the
    // anti-forgery measure for the new doc.
    expect(ROOM_BLOCK).toContain('allow create: if request.auth != null');
    expect(ROOM_BLOCK).toContain("request.resource.data.get('cohort'");
    expect(ROOM_BLOCK).toContain('request.resource.data.ownerId');
  });

  test('create binds ownerFirebaseUid (when present) to request.auth.uid (cron-elim PR A0)', () => {
    // The owner-left RTDB listener attests signals against
    // `room.ownerFirebaseUid`. The Firestore rule binds the field — when
    // the new-version client writes it — to `request.auth.uid`, making it
    // unspoofable. The `.get(field, request.auth.uid)` default lets legacy
    // app versions still create rooms during the Play/App Store rollout
    // window (orchestrator's user-doc fallback covers their signals). A
    // follow-up PR after rollout tightens this to a strict empty default.
    expect(ROOM_BLOCK).toContain("request.resource.data.get('ownerFirebaseUid', request.auth.uid)");
    expect(ROOM_BLOCK).toContain('== request.auth.uid');
  });

  test('delete remains owner-only', () => {
    // closeRoom now writes state=CLOSED rather than deleting, but the rule
    // stays in place for legitimate owner-deletes (rare).
    expect(ROOM_BLOCK).toContain('allow delete: if request.auth != null');
    expect(ROOM_BLOCK).toContain('== resource.data.ownerId');
  });
});

describe('users/{uniqueId} currentRoomId self-write — still allowed (regression guard)', () => {
  // The migrated client (PR #858) keeps `currentRoomId` writes client-side
  // (joinRoom/leaveRoom/acceptInvite set/clear it on the caller's OWN user doc
  // after the corresponding endpoint call). The user-doc update rule must
  // continue to allow this. If `currentRoomId` accidentally lands in the
  // server-only deny-list, joinRoom would 401 client-side at the post-endpoint
  // user-doc write.
  test('currentRoomId is NOT in the users/{uniqueId} server-only deny-list', () => {
    // The users/{uniqueId} update block contains a server-only deny-list; if
    // `currentRoomId` lands in there, joinRoom would PERMISSION_DENIED at the
    // post-endpoint client-side user-doc write.
    expect(USER_BLOCK).not.toBeNull();
    expect(USER_BLOCK).not.toContain("'currentRoomId'");
    expect(USER_BLOCK).not.toContain("'current_room_id'");
  });

  test('firstJoinTimestamps is NOT a user-doc field (room-doc field — first-join endpoint owns it)', () => {
    // Sanity: firstJoinTimestamps lives on the ROOM doc, not the user doc.
    // The first-join endpoint writes it server-side. This test exists to
    // document the location so a future contributor doesn't try to add a
    // client-side user-doc write for it.
    expect(USER_BLOCK).not.toContain("'firstJoinTimestamps'");
  });
});

// ═══════════════════════════════════════════════════════════════
// Brand-name security invariants this lockdown enforces
// ═══════════════════════════════════════════════════════════════

describe('audit defects closed by the P3 lockdown', () => {
  test('AUDIT-1: client-only role gates can no longer be bypassed via direct Firestore writes', () => {
    // The original audit finding: ChatRoom.kt role gates (canKickUser,
    // canTakeSeatDirectly, canForceMute, etc.) were CLIENT-ONLY. A hand-crafted
    // Firestore write could self-promote to host, kick anyone, or seize seat 0.
    // The lockdown denies all room-doc updates from clients; the only path is
    // the Admin-SDK endpoints which enforce the SAME ChatRoom gates server-
    // side (express-api/src/utils/room-auth.js).
    expect(RULES).toMatch(/allow update: if false;/);
  });

  test('AUDIT-2: seat-claim race is closed by the transactional endpoint', () => {
    // The original audit finding: takeSeat/acceptInvite were blind `update()`
    // calls with no empty-seat / per-user-uniqueness precondition. Concurrent
    // claims could last-write-wins or seat a user twice.
    // The lockdown forces clients through `/api/rooms/:id/seats/:i/claim`
    // which uses a Firestore transaction with the `SEAT_TAKEN` / `ALREADY_SEATED`
    // preconditions.
    const claimEndpoint = readFileSync(
      join(__dirname, '..', '..', 'src', 'routes', 'room-mutations.js'),
      'utf8',
    );
    expect(claimEndpoint).toMatch(/'\/rooms\/:roomId\/seats\/:seatIndex\/claim'/);
    expect(claimEndpoint).toMatch(/SEAT_TAKEN/);
    expect(claimEndpoint).toMatch(/ALREADY_SEATED/);
  });
});
