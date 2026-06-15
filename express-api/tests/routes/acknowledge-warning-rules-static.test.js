/**
 * SHY-0097 — static guard: firestore.rules must keep the moderation warning
 * fields in the client-write deny-list on `users/{uniqueId}`.
 *
 * Why static (a source scan), not behavioral: a behavioral rules test needs
 * the real Firestore emulator + @firebase/rules-unit-testing harness, which
 * is EPIC-0003 infrastructure not yet built (operator rule, 2026-06-14: only
 * unit tests may use mocks; everything else must be REAL — and the real rules
 * harness doesn't exist yet). The behavioral proof is therefore the j11
 * device journey (real device → server-authorized acknowledge → flag flips).
 *
 * This unit-level scan pins the SECURITY INVARIANT that makes the
 * acknowledge endpoint necessary in the first place: a client must NOT be
 * able to clear its own `hasActiveWarning` via a direct Firestore write —
 * only the server (Admin SDK) may. If someone removes these fields from the
 * rules' protected list, a client could self-clear its warning and the
 * endpoint's reason-for-being silently evaporates. This test fails loudly
 * before that ships. Mirrors the existing static-scan pattern in
 * admin-client/users-stale-write-guard-static.test.js.
 */
const fs = require('fs');
const path = require('path');

const RULES = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');

/**
 * Extracts the `hasAny([...])` protected-key list from the
 * `users/{uniqueId}` `allow update` rule, so field assertions are scoped to
 * that rule and can't accidentally match the same field name elsewhere.
 * Returns '' if the structure can't be located (the "locates" test catches
 * that, turning a rules refactor into a visible failure rather than a
 * silently-vacuous pass).
 */
function usersUpdateDenyList() {
  const start = RULES.indexOf('match /users/{uniqueId}');
  if (start < 0) return '';
  const allowUpdate = RULES.indexOf('allow update:', start);
  if (allowUpdate < 0) return '';
  const hasAny = RULES.indexOf('hasAny([', allowUpdate);
  if (hasAny < 0) return '';
  const close = RULES.indexOf('])', hasAny);
  if (close < 0) return '';
  return RULES.substring(hasAny, close);
}

describe('firestore.rules — users warning fields are client-write-protected (SHY-0097)', () => {
  const denyList = usersUpdateDenyList();

  test('locates the users/{uniqueId} update deny-list', () => {
    expect(denyList.length).toBeGreaterThan(0);
  });

  test.each([
    'hasActiveWarning',
    'has_active_warning',
    'warningReason',
    'warning_reason',
    'warningCount',
    'warning_count',
    // SHY-0097 I1: the acknowledgement-audit fields the endpoint writes
    // server-side must also be client-write-protected (a client must not be
    // able to forge an acknowledgement and falsify the moderation record).
    'warningAcknowledged',
    'warning_acknowledged',
    'warningAcknowledgedAt',
    'warning_acknowledged_at',
  ])('keeps %s in the client-write deny-list', (field) => {
    expect(denyList).toContain(`'${field}'`);
  });

  test('protection is a negated affectedKeys().hasAny (deny-list shape, not allow-list)', () => {
    const start = RULES.indexOf('match /users/{uniqueId}');
    const ruleBlock = RULES.substring(start, start + 2500);
    expect(ruleBlock).toMatch(/!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)/);
    expect(ruleBlock).toMatch(/\.hasAny\(\[/);
  });

  test('owner-gated: update requires firebaseUid === request.auth.uid', () => {
    const start = RULES.indexOf('match /users/{uniqueId}');
    const ruleBlock = RULES.substring(start, start + 2500);
    expect(ruleBlock).toMatch(/resource\.data\.firebaseUid == request\.auth\.uid/);
  });
});
