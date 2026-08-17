/**
 * SHY-0270 — the RTDB presence rule must be written against the identity the
 * CLIENT actually uses.
 *
 * Observed on a real device against dev:
 *
 *   setValue at /rooms/{roomId}/presence/50000030 failed: Permission denied
 *
 * The client writes `rooms/{roomId}/presence/{uniqueId}` — see
 * `RtdbPresenceService.setPresence`, which is handed
 * `_uiState.value.currentUserId`, the app's numeric uniqueId. The rule
 * required `auth.uid == $userId`, i.e. the FIREBASE uid. Those two never
 * match, so every presence write was denied, the room looked empty to the
 * connection monitor, and the client closed the room ~2.4s after creation.
 *
 * The uniqueId is the correct key, not a client bug: `ActiveRoomManager`
 * computes `absentUsers = participantIds - presentUserIds - currentUserId`,
 * and `participantIds` are uniqueIds. Keying presence by Firebase uid would
 * make every participant permanently "absent".
 *
 * Rules cannot query Firestore, but they do not need to: `uniqueId` is a
 * custom claim on the token (verified on dev:
 * `{"uniqueId":50000030,"cohort":"adult"}`), so the rule can authorise the
 * write without weakening it — a user may still only write their OWN
 * presence.
 *
 * Structural grep, matching the convention in `owner-left-rules.test.js`:
 * parse the rules file, assert the shape, no emulator.
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const RULES_PATH = join(__dirname, '..', '..', '..', 'database.rules.json');
const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8')).rules;

/** The `$userId` node under a room's presence map. */
const presenceUser = rules?.rooms?.$roomId?.presence?.$userId;
/** The `$userId` node under a conversation's typing map — same identity shape. */
const typingUser = rules?.conversations?.$convId?.typing?.$userId;

describe('RTDB presence rule authorises the identity the client writes', () => {
  test('the presence node exists where the client writes it', () => {
    // Guards against a vacuous pass if the rules are restructured.
    expect(presenceUser).toBeDefined();
    expect(typeof presenceUser['.write']).toBe('string');
  });

  test('presence is authorised by the uniqueId claim, not the Firebase uid', () => {
    const write = presenceUser['.write'];
    expect(write).toContain('auth.token.uniqueId');
    // `auth.uid == $userId` is the defect: the client keys presence by
    // uniqueId, so that comparison can never be true.
    expect(write).not.toMatch(/auth\.uid\s*==\s*\$userId/);
  });

  test('presence still requires authentication and self-ownership', () => {
    const write = presenceUser['.write'];
    expect(write).toContain('auth != null');
    // Self-ownership: the key being written must be the caller's own id.
    expect(write).toContain('$userId');
  });

  test('the uniqueId claim is compared as a string', () => {
    // The claim is a NUMBER (50000030) and RTDB path keys are STRINGS, so a
    // bare `===` would silently never match — the same class of failure this
    // story exists to fix.
    expect(presenceUser['.write']).toMatch(/auth\.token\.uniqueId\s*\+\s*''/);
  });

  test('typing presence uses the same identity as room presence', () => {
    // conversations/{id}/typing/{userId} is written by the same client-side
    // identity. Leaving it on auth.uid would reproduce this bug in DMs.
    expect(typingUser).toBeDefined();
    expect(typingUser['.write']).toContain('auth.token.uniqueId');
    expect(typingUser['.write']).not.toMatch(/auth\.uid\s*==\s*\$userId/);
  });

  test('presence values are still validated as booleans', () => {
    expect(presenceUser['.validate']).toContain('isBoolean');
  });
});
