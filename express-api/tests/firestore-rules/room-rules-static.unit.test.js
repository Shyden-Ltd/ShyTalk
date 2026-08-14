/**
 * STATIC source-contract guards for the room server-authz lockdown.
 *
 * These assert SOURCE TEXT on purpose — they are NOT behaviour tests. The
 * behavioural `rooms/{roomId}` rule contract (create / read / update-lockdown /
 * delete) is proven for real against the rules engine in `room-rules.test.js`
 * (EPIC-0003 / SHY-0113). What remains here are invariants about the *codebase
 * shape* that keep the lockdown safe and that no engine test can express:
 *
 *   1. Every client write the lockdown blocked has a replacement Admin-SDK
 *      endpoint (if a future change re-locks a verb without adding its endpoint,
 *      the app would start seeing PERMISSION_DENIED at runtime).
 *   2. The transactional seat endpoints keep their race-safety preconditions.
 *   3. `currentRoomId` stays OUT of the `users/{uniqueId}` server-only
 *      deny-list, so joinRoom/leaveRoom can self-write it after the endpoint
 *      call.
 *
 * When the room-mutations express tests are migrated to the real stack (the
 * next SHY-0113 slice), guards (1) + (2) get superseded by tests that actually
 * call those endpoints; until then they are the safety net.
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
const MUTATIONS_FILE = readFileSync(
  join(__dirname, '..', '..', 'src', 'routes', 'room-mutations.js'),
  'utf8',
);

/**
 * Extract a named `match` block by slicing the rules text between
 * `match <path> {` and its matching closing `}`. Brace-counting (not a lazy
 * regex) avoids the super-linear backtracking SonarJS flags, and starting the
 * depth scan PAST the opening line prevents the `{` inside the path placeholder
 * `{uniqueId}` being mis-counted as a nested block opener.
 *
 * Assumption (holds for our `firestore.rules` style): the `match … {` opener
 * sits on its own line and never shares a line with a second `{`-opening match.
 * The `expect(USER_BLOCK).not.toBeNull()` assertion below is the backstop — if
 * the extraction ever mis-balances, the block comes back null and the test
 * fails loudly rather than asserting against a truncated slice.
 */
function extractMatchBlock(rules, openLine) {
  const start = rules.indexOf(openLine);
  if (start < 0) return null;
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

const USER_BLOCK = extractMatchBlock(RULES, 'match /users/{uniqueId} {');

// ═══════════════════════════════════════════════════════════════
// (1) Lockdown migration map — every blocked client write has a server endpoint
// ═══════════════════════════════════════════════════════════════

describe('lockdown migration map — every blocked client write has a server endpoint', () => {
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
// (2) Race-safety preconditions on the transactional seat endpoints
// ═══════════════════════════════════════════════════════════════

describe('seat-claim race-safety preconditions survive in the server endpoint', () => {
  test('the claim endpoint keeps its SEAT_TAKEN / ALREADY_SEATED transaction guards', () => {
    // AUDIT-2: takeSeat/acceptInvite used to be blind client `update()` calls
    // with no empty-seat / per-user-uniqueness precondition — concurrent claims
    // could last-write-wins or seat a user twice. The lockdown forces clients
    // through `/api/rooms/:id/seats/:i/claim`, a Firestore transaction with the
    // SEAT_TAKEN / ALREADY_SEATED preconditions. Pin they stay.
    expect(MUTATIONS_FILE).toMatch(/'\/rooms\/:roomId\/seats\/:seatIndex\/claim'/);
    expect(MUTATIONS_FILE).toMatch(/SEAT_TAKEN/);
    expect(MUTATIONS_FILE).toMatch(/ALREADY_SEATED/);
  });
});

// ═══════════════════════════════════════════════════════════════
// (3) currentRoomId self-write stays allowed on the user doc
// ═══════════════════════════════════════════════════════════════

describe('users/{uniqueId} currentRoomId self-write — still allowed (regression guard)', () => {
  test('currentRoomId is NOT in the users/{uniqueId} server-only deny-list', () => {
    // The migrated client keeps `currentRoomId` writes client-side
    // (joinRoom/leaveRoom/acceptInvite set/clear it on the caller's OWN user doc
    // after the corresponding endpoint call). If `currentRoomId` accidentally
    // landed in the server-only deny-list, joinRoom would PERMISSION_DENIED at
    // the post-endpoint client-side user-doc write.
    expect(USER_BLOCK).not.toBeNull();
    expect(USER_BLOCK).not.toContain("'currentRoomId'");
    expect(USER_BLOCK).not.toContain("'current_room_id'");
  });

  test('firstJoinTimestamps is a ROOM-doc field, not a user-doc field', () => {
    // firstJoinTimestamps lives on the room doc (the first-join endpoint writes
    // it server-side). Documenting the location so a future contributor does not
    // add a client-side user-doc write for it.
    expect(USER_BLOCK).not.toContain("'firstJoinTimestamps'");
  });
});
