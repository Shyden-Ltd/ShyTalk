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
