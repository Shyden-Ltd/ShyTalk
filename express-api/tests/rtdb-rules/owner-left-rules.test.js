/**
 * Tests for the RTDB security rule on `ownerLeft/{roomId}` introduced
 * alongside the event-driven owner-left handler (PR #997).
 *
 * Mirrors the structural-rule-grep convention used in
 * `tests/firestore-rules/room-rules.test.js` — parses the rules file and
 * asserts the expected structure WITHOUT spinning up an emulator. Full
 * emulator-based rule testing via `@firebase/rules-unit-testing` is a
 * worthwhile follow-up but a separate scope.
 *
 * The rule shape we are asserting:
 *
 *   "ownerLeft": {
 *     "$roomId": {
 *       ".write":    "auth != null && (!newData.exists() || newData.val() === auth.uid)",
 *       ".validate": "newData.isString() || !newData.exists()"
 *     }
 *   }
 *
 * Security semantics:
 *   - Only authenticated users can write.
 *   - Writers must SIGN the entry with their own auth.uid (server-side
 *     orchestrator additionally enforces writer === room.ownerId; the rule
 *     alone is not sufficient).
 *   - Removal (set null) is allowed; the validate skips on null per RTDB.
 *   - Reads are denied by the root `.read: false` rule (no need to repeat).
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const RULES = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'database.rules.json'), 'utf8'),
);

describe('database.rules.json — ownerLeft rule', () => {
  const ownerLeftRule = RULES?.rules?.ownerLeft?.$roomId;

  test('ownerLeft.$roomId stanza exists', () => {
    expect(ownerLeftRule).toBeDefined();
    expect(typeof ownerLeftRule).toBe('object');
  });

  test('.write requires authenticated session', () => {
    expect(ownerLeftRule['.write']).toContain('auth != null');
  });

  test('.write forces value to equal auth.uid OR be a removal (set null)', () => {
    // The writer must SIGN the entry with their own uid (cannot forge
    // a different uid into the signal). Removals (newData.exists() === false)
    // are allowed so a graceful client-side cancel of the onDisconnect
    // can clean up the path.
    const write = ownerLeftRule['.write'];
    expect(write).toContain('newData.val()');
    expect(write).toContain('auth.uid');
    expect(write).toContain('newData.exists()');
  });

  test('.validate constrains the value to a string', () => {
    // The value is the writer's auth.uid (a string). Reject objects,
    // arrays, numbers, booleans. Allow null (removal) per RTDB semantics
    // (.validate skips when newData is null) — but assert intent in the
    // rule for documentation.
    expect(ownerLeftRule['.validate']).toContain('newData.isString()');
  });

  test('does NOT expose a default .read (root .read: false denies)', () => {
    // The root-level `.read: false` denies reads by default. ownerLeft
    // does not need a .read rule of its own — clients have no business
    // reading other rooms' onDisconnect signals.
    expect(ownerLeftRule['.read']).toBeUndefined();
  });

  test('rule sits under the top-level "rules" object (NOT under "rooms")', () => {
    // ownerLeft is a SEPARATE top-level path from rooms/* — keeps the
    // listener's RTDB ref clean and the security boundary explicit.
    expect(RULES.rules.ownerLeft).toBeDefined();
    expect(RULES.rules.rooms.ownerLeft).toBeUndefined();
  });

  test('rule does not accidentally widen reads/writes on adjacent paths', () => {
    // Pin the existing structure so this PR did not regress the presence
    // or events rules on rooms/{roomId}.
    expect(RULES.rules.rooms.$roomId.presence.$userId['.write']).toContain('auth.uid == $userId');
    expect(RULES.rules.rooms.$roomId.events.lastEvent['.write']).toBe(false);
    expect(RULES.rules['.read']).toBe(false);
    expect(RULES.rules['.write']).toBe(false);
  });
});
