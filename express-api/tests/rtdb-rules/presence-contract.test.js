/**
 * SHY-0270 — the presence path is a THREE-PARTY contract, and it silently broke.
 *
 * Three artefacts have to agree, and nothing checked that they did:
 *
 *   1. the CLIENT writes    rooms/{roomId}/presence/{uniqueId}
 *      (RtdbPresenceService.setPresence, handed currentUserId)
 *   2. the SERVER reads     rooms/{roomId}/presence/{userId}
 *      (event-listeners.js presenceChecker, called with room.ownerId — a uniqueId)
 *   3. the RULE authorises  rooms/$roomId/presence/$userId
 *
 * Parties 1 and 2 agreed on the uniqueId. Party 3 compared against `auth.uid`,
 * the FIREBASE uid. Every write was denied, the server's owner-left re-check
 * found no owner present, and it closed the room — which is the documented
 * "ACTIVE and no non-owner seated" branch, not a timeout.
 *
 * Each artefact was individually defensible; only the RELATIONSHIP was wrong,
 * so no per-file test could see it. This one checks the relationship.
 *
 * Deliberately source-level: it must fail at commit time, not at 2.4 seconds
 * into a room on a real phone.
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RULES = JSON.parse(read('database.rules.json')).rules;
const CLIENT = read('app/src/main/java/com/shyden/shytalk/data/remote/RtdbPresenceService.kt');
const LISTENERS = read('express-api/src/utils/event-listeners.js');
const ORCHESTRATOR = read('express-api/src/utils/owner-left-orchestrator.js');

describe('presence path: client write, server read, and rule all agree', () => {
  test('the client writes presence under rooms/{roomId}/presence/{userId}', () => {
    expect(CLIENT).toMatch(/rooms\/\$roomId\/presence\/\$userId/);
  });

  test('the server reads presence from the same path shape', () => {
    expect(LISTENERS).toMatch(/rooms\/\$\{roomId\}\/presence\/\$\{userId\}/);
  });

  test('the server checks presence for the room OWNER, whose id is a uniqueId', () => {
    // `room.ownerId` is the numeric uniqueId (the same value the client is
    // handed as currentUserId). If this ever became a Firebase uid, the rule
    // and the client would both have to move with it.
    expect(ORCHESTRATOR).toMatch(/presenceChecker\(\s*roomId\s*,\s*\w+\.ownerId\s*\)/);
  });

  test('the rule authorises the identity the client actually writes', () => {
    const write = RULES.rooms.$roomId.presence.$userId['.write'];
    // The client key is a uniqueId, so the rule must compare against the
    // uniqueId claim. Comparing against auth.uid can never be true — that was
    // the defect, and it denied every presence write.
    expect(write).toContain('auth.token.uniqueId');
    expect(write).not.toMatch(/auth\.uid\s*==\s*\$userId/);
  });

  test('a denied presence write would close the room — so this contract is load-bearing', () => {
    // Pins WHY the mismatch was so destructive, so a future reader does not
    // treat presence as cosmetic: the owner-left handler NOOPs only when the
    // owner is found present, and otherwise closes an ACTIVE room outright.
    const handler = read('express-api/src/utils/owner-left-handler.js');
    expect(handler).toMatch(/if\s*\(ownerStillPresent\)\s*return\s+OWNER_LEFT_ACTION\.NOOP/);
    expect(handler).toMatch(/CLOSE/);
  });

  test('the guard reads real files (vacuous-pass guard)', () => {
    expect(CLIENT.length).toBeGreaterThan(500);
    expect(LISTENERS.length).toBeGreaterThan(500);
    expect(ORCHESTRATOR.length).toBeGreaterThan(500);
  });
});
