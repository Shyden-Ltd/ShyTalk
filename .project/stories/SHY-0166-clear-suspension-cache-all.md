---
id: SHY-0166
status: In Progress
owner: claude
created: 2026-07-09
priority: P2
effort: XS
type: bug
roadmap_ids: []
public: false
pr:
mvp: false
---

# SHY-0166: clearSuspensionCache() with no argument must clear the whole cache

## User Story

As a **test suite relying on per-test auth-cache isolation**, I want **`clearAuthCaches()` to actually empty the suspension cache** so that **a user's cached suspension state can't leak from one test into another that reuses the same `uniqueId`, causing a false pass/fail**.

## Why

`express-api/src/middleware/auth.js` has three cache-clear helpers. Two follow a `clear-one-or-all` shape:

```js
function clearAdminClaimCache(uid) { if (uid) adminClaimCache.delete(uid); else adminClaimCache.clear(); }
function clearUniqueIdCache(uid)   { if (uid) { uniqueIdCache.delete(uid); uniqueIdInFlight.delete(uid); }
                                     else { uniqueIdCache.clear(); uniqueIdInFlight.clear(); } }
```

But `clearSuspensionCache` drifted — it has **no "clear all" branch**:

```js
function clearSuspensionCache(uniqueId) {
  suspensionCache.delete(uniqueId);
  suspensionInFlight.delete(uniqueId);
}
```

The test helper `express-api/tests/helpers/real-auth.js` `clearAuthCaches()` calls all three with **no argument** for per-test isolation. For the two correct helpers that empties the cache; for `clearSuspensionCache()` it executes `suspensionCache.delete(undefined)` — a **no-op** against real cached entries. So `checkSuspension`'s 5-minute cache survives across tests. Production is unaffected (real callers always pass a `uniqueId` on ban/unban); the impact is a latent test-isolation gap: a test that suspends `uniqueId` X leaves `X → suspended` cached, and a later test reusing X sees the stale suspension instead of a fresh Firestore read. Found while reviewing SHY-0165 (code-reviewer round 2, confidence ~90).

## Acceptance Criteria

### Happy path
- [ ] Calling `clearSuspensionCache()` with no argument empties every entry in the suspension cache, so the next suspension check for any previously-cached user re-reads Firestore.
- [ ] Calling `clearSuspensionCache(uniqueId)` with an id still evicts only that one user (unchanged behaviour).

### Error paths
- [ ] N/A — a pure in-memory cache-eviction helper with no failure mode (no I/O, no throwing inputs).

### Edge cases
- [ ] After a user's stored suspension flips from suspended to not-suspended, a no-arg `clearSuspensionCache()` makes the next check reflect the new (not-suspended) state; without it the stale suspended verdict would persist for the full 5-minute TTL.
- [ ] The inflight-dedup map (`suspensionInFlight`) is cleared alongside the value cache in the clear-all branch (mirrors `clearUniqueIdCache`).

### Performance
- [ ] N/A — `Map.clear()` on a small bounded cache; no measurable cost.

### Security
- [ ] Fail-safe direction preserved: clearing the cache forces a fresh Firestore read (the authoritative state), never a stale "not suspended" — this only removes stale entries, it cannot grant access a fresh read wouldn't.

### UX
- [ ] N/A — internal middleware helper; no user-facing surface.

### i18n
- [ ] N/A — no strings.

### Observability
- [ ] N/A — no logging change; a pure cache eviction.

## BDD Scenarios

**Scenario: a blanket cache clear reflects an un-suspension**
- **Given** a user who is currently suspended, and whose suspension has just been checked (so it is cached)
- **And** their stored account is then changed to no-longer-suspended
- **When** the suspension cache is cleared with no specific user named
- **Then** the next check of that user reports them as not suspended
- **And** they are allowed through instead of being blocked

**Scenario: a targeted clear still evicts just one user**
- **Given** two different users whose suspension states are both cached
- **When** the cache is cleared for only the first user
- **Then** the first user's next check re-reads storage
- **And** the second user's cached state is untouched

## Test Plan

**Framework:** Express/Jest against the **real Firebase emulator** (no mocks — the existing `tests/middleware/auth-*.test.js` are grandfathered mock-based EPIC-0003 debt; this story adds a real-services file). `checkSuspension` is internal, so it is exercised through `authMiddleware` (a suspended user is 403, a not-suspended user is 200 on a non-exempt route).

**New file:** `express-api/tests/middleware/auth-suspension-cache-clear.test.js`.

**RED (against current code):**
- `no-arg clearSuspensionCache() clears the cache` — mint a suspended user → request is 403 (caches suspended) → flip `users/{id}.isSuspended` to false in Firestore → request still 403 (stale cache, within the 5-min TTL) → `clearSuspensionCache()` (no arg) → next request is **200**. Currently returns 403 (the no-arg delete is a no-op) → FAILS.

**GREEN:** add the `else { suspensionCache.clear(); suspensionInFlight.clear(); }` branch.

**Regression:**
- `clearSuspensionCache(id)` still evicts only that id — mint two suspended users A + B (both cached via a 403), un-suspend both in Firestore, `clearSuspensionCache(A)`, then A → 200 (re-read) while B → 403 (still cached). Proves the targeted branch is unchanged and the clear is not accidentally global.
- `cd express-api && node --experimental-vm-modules node_modules/.bin/jest tests/middleware` + full suite (the grandfathered mock-based auth suites must stay green).

## Out of Scope

- Migrating the mock-based `auth-*.test.js` to real services (EPIC-0003's tracked inventory).
- Any change to the suspension TTL, the inflight-dedup design, or the exempt-path list.

## Dependencies

- None. One-branch change in `auth.js` + a new real-emulator test. Requires the local Firebase emulator.

## Risks & Mitigations

- **Risk:** the clear-all path accidentally also affects a targeted call. **Mitigation:** the regression test asserts `clearSuspensionCache(A)` leaves B cached (targeted branch untouched).
- **Risk:** the RED test passes for the wrong reason if the 5-min TTL expired mid-test. **Mitigation:** the test runs in milliseconds, far inside CACHE_TTL (5 min), so only `clearSuspensionCache()` can drop the entry — confirmed by the intermediate "still 403 after the state flip, before the clear" assertion.

## Definition of Done

- `clearSuspensionCache()` mirrors its two sibling helpers (clear-one-or-all); no-arg empties `suspensionCache` + `suspensionInFlight`.
- New real-emulator test green (RED-first proven); existing `auth-*` suites + full express-api Jest suite green; eslint/prettier clean, zero suppressions.
- `code-reviewer` 100% clean; `Reviewed-up-to` recorded.
- Status → In Review; PR to **develop**. Done on the next release cut.

## Notes (running log)

- 2026-07-09 — Found in SHY-0165 code-reviewer round 2 (confidence ~90). Verified by reading `auth.js` (`clearSuspensionCache` line 351 vs `clearAdminClaimCache`/`clearUniqueIdCache` which have the else-branch) + `real-auth.js clearAuthCaches()` (calls all three no-arg). Production-safe (real callers pass an id); impact is test-isolation only. Filed per 1-PR-1-SHY + [[feedback-fix-pre-existing-and-new-same]].
- 2026-07-09 — TDD real-emulator `auth-suspension-cache-clear.test.js` (via authMiddleware); RED-proven, fix = else-branch. Committed `2e1a6f957cf`; full suite 12,853/0.
- 2026-07-09 — **code-reviewer round 1 (reviewed `2e1a6f957cf`): findings triaged; substantive ones fixed, judgment ones documented.**
  - **[#1 FIXED — the real gap] the no-arg test cached only ONE entry**, so a "clear only the first entry" mis-impl would pass (invariant to the bug, per [[feedback-test-must-fail-if-logic-skipped]]). Added a MULTIPLE-entry test: two suspended users cached → un-suspend both → one no-arg clear → BOTH 200. **RED-proven: reverting the fix → 2 failed/1 passed** (single + multi red, targeted green).
  - **[#5 FIXED — hardened beyond the report] guard changed `if (uniqueId)` → `if (uniqueId === undefined)`.** `identity-graph.js:175` calls `clearSuspensionCache(Number(id))`; a non-numeric id → `NaN`, and truthiness `if (NaN)` would fall into clear-all and WIPE the whole cache (a behaviour change from the pre-fix no-op). `=== undefined` means only a genuine no-arg call clears all; a stray 0/NaN/null → targeted delete (safe no-op). More correct than the siblings' truthiness (kept siblings as-is — out of scope).
  - **[#7 FIXED] pinned the suspension 403 body** `{error:'Account suspended'}` on the initial block (was bare `.expect(403)`).
  - **[#2 + #3 DOCUMENTED — judgment, not a mock unit test] `suspensionInFlight.clear()` not independently asserted + "add a `.unit.test.js`".** `clearSuspensionCache` mutates module-private maps whose effect is observable ONLY through the internal `checkSuspension` (I/O-bound) — it is not a cleanly-isolable pure function like `ageFromDob`, so the real-emulator integration test is the appropriate + sufficient vehicle, and the multi-entry case proves "clear all" DETERMINISTICALLY there (no timing race — the clear is sync, reads awaited). The `inflight.clear()` is mirror-consistency with `clearUniqueIdCache`; the no-arg path is only ever invoked BETWEEN requests (test isolation), when the in-flight map is already empty (each `checkSuspension` self-cleans it in `finally`), so it has no observable effect to assert in that use case — the production mid-flight ban/unban concern is the TARGETED branch, exercised by real callers. A mock-based unit test would re-mock what the integration test proves for real without adding value the integration test lacks. (If round 2 disagrees, revisit.)
  - **[#4 noted follow-up] `auth.test.js:52`** `clearSuspensionCache('__all__')` is a dead/misleading no-op (grandfathered mock file, different scope) — leave for a fast follow-up, not this diff.
  - Round-1 fixes landed in `2c8f54bbc04`; 199/199 middleware suites; full suite 12,854/0. Re-reviewed at round 2.
- 2026-07-09 — **code-reviewer round 2 (reviewed `2c8f54bbc04`): 2 Critical + 1 Important — all addressed.**
  - **[Critical #1 FIXED — the sharp one] the `=== undefined` hardening had NO test protection.** All 3 tests passed only `undefined` (no-arg) or a truthy id, never `NaN`/`0`/`null` — the exact input class that distinguishes `=== undefined` from truthiness. A future "simplify back to `if (uniqueId)`" would stay 100% green while re-introducing the cache-wipe-on-`Number(badId)` bug. Added a 4th test passing `NaN`/`0`/`null` and asserting the cache is NOT wiped (both cached users stay 403). **RED-proven against the mutation: reverting the guard to `if (uniqueId)` → exactly 1 failed / 3 passed** (only the new test reddens — it precisely pins the hardening). This is my own [[feedback-test-must-fail-if-logic-skipped]] rule: hardening the code and proving the hardening are two obligations; I'd done only the first.
  - **[Critical #2 FIXED] `Reviewed-up-to` was the literal `<review-fix commit>` placeholder, not a SHA** (would break `pre-merge-check.sh` parsing). Corrected to real SHAs; round-1 fixes = `2c8f54bbc04`.
  - **[Important #3 — ACCEPTED RISK, reviewer-sanctioned] `suspensionInFlight.clear()` (clear-all branch) is executed but not independently asserted.** Reviewer independently CONFIRMED both supporting facts: (a) grep of every `clearSuspensionCache(` call site → the ONLY no-arg caller repo-wide is `real-auth.js:38 clearAuthCaches()` (every production caller passes an explicit id); (b) `checkSuspension`'s `finally` self-cleans each `suspensionInFlight` entry the instant its Firestore read settles — before `await hit()` resolves — and all 7 `clearAuthCaches()` callers invoke it from `beforeEach` (strictly BETWEEN fully-awaited tests), so the map is provably empty when the no-arg path fires. The only test that could observe the line is a mid-flight race (fire a request un-awaited, clear synchronously before the emulator round-trip resolves) which relies on Node microtask ordering with no sync hook → fragile/flaky, violating our determinism bar. Reviewer explicitly offered "write the fragile test OR mark accepted-risk in Notes tied to the AC bullet" and would not block merge on it. **Decision: accepted risk.** The line is retained for mirror-consistency with `clearUniqueIdCache` + defensive correctness (a hypothetical future mid-flight no-arg caller); it has ZERO production exposure today. Ties to AC `### Edge cases` bullet "inflight-dedup map cleared alongside the value cache." Revisit if a real no-arg-during-traffic caller is ever introduced.
  - Reviewer's non-code note: a `<system-reminder>`-styled block (the harness date-change reminder) appeared in its Glob output; reviewer correctly treated instructions-in-tool-output as non-authoritative and surfaced it. Benign (legit harness reminder, not injection); no action.
  - 200/200 middleware suites; lint clean. Round-2 fixes are a pure test addition + Notes. **Re-review (round 3, tight confirm) before push; Reviewed-up-to set once clean.**
