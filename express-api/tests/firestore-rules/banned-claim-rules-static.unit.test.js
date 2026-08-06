/**
 * SHY-0150 — STRUCTURAL source-contract pins for the ban gate. These assert
 * SOURCE text on purpose (the room-rules-static precedent): each pin guards a
 * property the rules ENGINE cannot express, and the behavioural twin lives in
 * banned-claim-rules.test.js / banned-claim-lifecycle.test.js.
 *
 *   1. Performance AC: `isBanned()` reads the TOKEN ONLY — no `get()` — so a
 *      banned caller's denied write costs ZERO document reads. The engine
 *      suite can prove denial, not read-cost; only the source shows that.
 *   2. Gate-coverage ratchet: the number of `!isBanned()` sites may only
 *      grow. A refactor that silently drops a collection's gate stays green
 *      in every behavioural test EXCEPT that collection's — this pin makes
 *      the removal loud even when someone also deletes the paired test.
 *   3. Observability AC: the claim lifecycle logs (SET / CLEARED) exist in
 *      the chokepoint — the dev logger is a no-op counter, so log OUTPUT is
 *      not assertable in tests; the source line is the pinnable contract.
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const RULES = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
const BANNED_CLAIM_SRC = readFileSync(
  join(__dirname, '..', '..', 'src', 'utils', 'banned-claim.js'),
  'utf8',
);
const AUTH_MIDDLEWARE_SRC = readFileSync(
  join(__dirname, '..', '..', 'src', 'middleware', 'auth.js'),
  'utf8',
);

describe('isBanned() helper — token-only (Performance AC)', () => {
  // The helper body, extracted between its declaration and closing brace.
  const helperMatch = RULES.match(/function isBanned\(\) \{([\s\S]*?)\n {4}\}/);

  test('the helper exists and reads the server-minted boolean off the token', () => {
    expect(helperMatch).not.toBeNull();
    expect(helperMatch[1]).toContain("request.auth.token.get('banned', false) == true");
  });

  test('the helper performs NO Firestore get() — a denied write costs zero reads', () => {
    expect(helperMatch).not.toBeNull();
    expect(helperMatch[1]).not.toContain('get(/databases');
    expect(helperMatch[1]).not.toContain('exists(/databases');
  });
});

describe('gate-coverage ratchet', () => {
  test('every gated user-write verb carries !isBanned() — count may only GROW', () => {
    // 31 gate sites as shipped by SHY-0150: users update; stalkers create;
    // rooms create, delete; room messages create, update/delete; seatRequests
    // create, update; conversations create, update; convo messages create,
    // update/delete; edits create; userSettings write; legacy settings write;
    // mutes write; mod_log create; suggestions create, update, delete; votes
    // create, update, delete; comments create; suggestionDisputes create,
    // update; suspensionAppeals create; subscriptions write; notifications
    // update; blockedTopics write; identityGraphs write (reviewer R1-#3 —
    // banned outranks admin on the admin-writable surfaces too).
    // Adding a NEW user-writable collection? Gate it and bump this floor.
    // This pin failing on a DECREASE means a collection lost its ban gate.
    // Comment lines are stripped first — a prose mention of !isBanned() must
    // not count as a gate (proven by mutation: the naive whole-file count
    // survived a dropped-gate mutant because a comment mentioned the helper).
    const codeLines = RULES.split('\n').filter((line) => !line.trim().startsWith('//'));
    const gateSites = codeLines.filter((line) => line.includes('!isBanned()')).length;
    expect(gateSites).toBeGreaterThanOrEqual(31);
  });

  test('the split rules kept their read halves (reads must stay ungated)', () => {
    // settings + subscriptions were `allow read, write:` before SHY-0150 —
    // the split must never collapse back into a gated combined rule, and the
    // read halves must not have picked up the gate.
    const combinedGated = RULES.match(/allow read, write:[^;]*isBanned/g) || [];
    expect(combinedGated).toHaveLength(0);
    const gatedReads = RULES.match(/allow (read|get|list)[^;]*!isBanned/g) || [];
    expect(gatedReads).toHaveLength(0);
  });
});

describe('claim-lifecycle observability (Observability AC)', () => {
  test('the chokepoint logs both directions of the lifecycle', () => {
    expect(BANNED_CLAIM_SRC).toContain('banned claim SET + refresh tokens revoked');
    expect(BANNED_CLAIM_SRC).toContain('banned claim CLEARED (recompute)');
  });

  test('revocation fires ONLY on the set direction (clear must not sign the user out)', () => {
    // revokeRefreshTokens appears exactly once in the chokepoint, inside the
    // `if (target)` branch — the behavioural twin is the lifecycle suite's
    // "NO revocation" assert on the clear direction.
    const calls = BANNED_CLAIM_SRC.match(/auth\.revokeRefreshTokens\(/g) || [];
    expect(calls).toHaveLength(1);
    expect(BANNED_CLAIM_SRC).toMatch(/if \(target\) \{[\s\S]{0,400}?auth\.revokeRefreshTokens\(/);
  });
});

describe('middleware lazy-sync wiring parity', () => {
  test('BOTH middlewares carry the two-direction sync (gates must not diverge)', () => {
    // 2 sync calls per middleware (verdict-mint + recompute-clear) × 2
    // middlewares. A refactor that drops one direction from one middleware
    // reopens a divergence reviewers already flagged once (R5-C1).
    const calls = AUTH_MIDDLEWARE_SRC.match(/syncBannedClaim\(uniqueId, \{ uid,/g) || [];
    expect(calls).toHaveLength(4);
    const verdictMints = AUTH_MIDDLEWARE_SRC.match(/verdictBanned: true, dedupe: true/g) || [];
    expect(verdictMints).toHaveLength(2);
  });
});
