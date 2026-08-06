---
id: SHY-0165
status: In Review
owner: claude
created: 2026-07-09
priority: P2
effort: S
type: bug
roadmap_ids: []
public: false
pr:
mvp: false
---

# SHY-0165: Fix message-translation cache — verifyParticipant String/Number id mismatch

## User Story

As a **member translating chat messages**, I want **repeat translations of the same message to be served from cache** so that **I don't burn my free daily translation quota re-translating text the server already translated once**.

## Why

`express-api/src/routes/translate.js`'s `verifyParticipant(messagePath, uniqueId)` (line 127-133) returns `participantIds.includes(uniqueId)`. `participantIds` on both `conversations/{id}` and `rooms/{id}` docs are stored as **Strings** (conversations: the iOS/Android repos write sorted string ids + `firestore.rules` enforces `string(callerUniqueId()) in participantIds`; rooms: `room-mutations.js` writes `FieldValue.arrayUnion(String(req.auth.uniqueId))`), but `uniqueId` is `req.auth.uniqueId`, a **Number**. `["63000010"].includes(63000010)` is always `false`, so `participantVerified` is `false` for **every real chat/room message**.

Consequences (`handleChatTranslate`, line 141-216):
- The message-level cache **read** (line 157-160) is skipped → an already-translated message is re-translated every time.
- The cache **write** (line 189-199) is skipped → the translation is never stored, so it can never be a future cache hit.
- The daily quota counter still increments (line 202-209), so free-tier users burn `FREE_DAILY_LIMIT` (50/day) on repeat translations that should have cost nothing.

This is the same String/Number class as the SHY-0060 DM-gate Critical; it was found while reviewing that fix. It fails **safe** (a false-negative only disables the cache — no cross-conversation data leak), so it is a cost/quota/UX defect, not a security hole. It shipped because `translate.test.js` is fully mock-based and mocks `participantIds` to whatever value makes the assertion pass, never exercising the real String-vs-Number shape.

## Acceptance Criteria

### Happy path
- [ ] A member who is a participant of a **conversation** translating one of its messages, where that message already has a cached translation for the target language, receives the cached translation (the response is flagged as coming from cache) without a new provider call.
- [ ] The same holds for a member who is a participant of a **room** translating one of its messages.
- [ ] When a participant translates a message that is not yet cached, the resulting translation is stored on that message so the next request for the same message + language is a cache hit.

### Error paths
- [ ] A caller who is **not** a participant of the conversation/room still receives a working translation (the cache is participant-gated, not the translation itself) but nothing is read from or written to that message's cache.
- [ ] Behaviour is unchanged for requests with no `messagePath` (ad-hoc translation): no cache read/write, quota still applies.

### Edge cases
- [ ] Coercion is symmetric: the participant check passes whether `participantIds` are Strings (production) or Numbers (any legacy doc), for a Number `uniqueId`.
- [ ] A non-participant is never admitted by the coercion (the fix is a strict superset of the intended check, not a bypass) — a caller whose id is absent from `participantIds` stays unverified.

### Performance
- [ ] The fix adds only an O(n) `map(String)` over the (tiny, ≤ small-group) `participantIds` array already loaded — no extra reads.

### Security
- [ ] No widening of access: the cache read/write is still gated on real participation; coercion only fixes a false-negative and never turns a non-participant into a participant. (Participation here gates only the message's own `translations` cache field — no other resource.)

### UX
- [ ] N/A — server-only; no user-facing copy. The user-observable effect is faster repeat translations + slower quota burn, which the happy-path AC covers.

### i18n
- [ ] N/A — no new user-facing strings.

### Observability
- [ ] The existing `log.error('translate', 'Failed to cache translation', …)` path is unchanged; no new logging required (the fix removes the silent no-op, restoring the intended cache writes that are already logged on failure).

## BDD Scenarios

**Scenario: a conversation participant gets the cached translation instead of burning quota**
- **Given** a conversation whose participant list includes me
- **And** one of its messages already has a stored Spanish translation "hola"
- **And** I have already used up my free daily translations
- **When** I ask to translate that message into Spanish
- **Then** I receive "hola"
- **And** the response says it came from cache
- **And** I am not charged another translation against my daily limit

**Scenario: a room participant's repeat translation is a cache hit**
- **Given** a room whose participant list includes me
- **And** one of its messages already has a stored French translation
- **When** I ask to translate that message into French
- **Then** I receive the stored French translation flagged as cached

**Scenario: a first-time translation is cached for next time**
- **Given** a conversation message with no stored translation yet
- **And** I am a participant with quota remaining
- **When** I translate it into German
- **Then** the German translation is stored on that message
- **And** a second identical request returns it as a cache hit

**Scenario: a non-participant still gets a translation but no cache is used**
- **Given** a conversation whose participant list does NOT include me
- **When** I translate one of its messages
- **Then** I still receive a translation
- **And** nothing is read from or written to that message's cache

## Test Plan

**Framework:** Express/Jest against the **real Firebase emulator** (no mocks — the existing `translate.test.js` is grandfathered mock-based EPIC-0003 debt; this story adds a new real-services file rather than extending the mock pattern).

**New file:** `express-api/tests/routes/translate-cache.test.js` — `process.env.NODE_ENV='local'`, `assertEmulatorReachable()`, real `db`, real `authMiddleware`, `mintRealUser`. Deterministic + provider-free by exploiting route ordering (cache-read precedes the quota check): seed a pre-cached translation AND exhaust the caller's daily quota, so a verified participant short-circuits to `cached:true` while the bug falls through to a 429 — neither branch calls the external provider.

**RED (against current buggy code):**
- `conversation participant with a pre-cached translation + exhausted quota → cached:true + the cached text` → currently returns **429** (participantVerified false → cache skipped → quota exhausted). FAILS.
- `room participant with a pre-cached translation + exhausted quota → cached:true` → currently **429**. FAILS.
- `first-time translation by a participant is written to the message cache` (quota remaining; asserts the message doc gains `translations[lang]`) → currently the write is skipped → FAILS. (Uses the real provider; kept as a single provider-touching case, or asserts via a follow-up cache-read hit — see Risks.)

**GREEN:** `participantIds.map(String).includes(String(uniqueId))` in `verifyParticipant`.

**Regression:**
- `non-participant → still translated, no cache read/write` (id absent from participantIds → stays unverified even after coercion).
- Number-typed `participantIds` (legacy) → participant still verified (symmetry).
- Existing `translate.test.js` + `translate-public.test.js` stay green.
- `cd express-api && node --experimental-vm-modules node_modules/.bin/jest tests/routes/translate` + full suite.

## Out of Scope

- Migrating the existing mock-based `translate.test.js` to real services (that is EPIC-0003's mock-migration inventory, tracked separately).
- Any change to the translation provider chain, quota values, or the public-translation path (`translate-public.js`).
- Rooms-membership model changes — rooms already carry `participantIds` (confirmed), so the same coercion fixes both; no room-specific membership rework.

## Dependencies

- None. Self-contained one-function fix in `translate.js` + a new real-emulator test file. Requires the local Firebase emulator for the test (standard `local/start.sh`).

## Risks & Mitigations

- **Risk:** the first-time-translation cache-WRITE case needs the real external provider (Google Translate), which is non-deterministic in CI. **Mitigation:** prove the write via its *effect* on a subsequent cache-READ within the same test (participant, quota-exhausted second call → `cached:true`), OR assert the message doc's `translations` field after a single real translation and gate that one case so provider flakiness can't red the suite; the two primary AC (read-path) cases are fully provider-free.
- **Risk:** coercion accidentally widens access. **Mitigation:** explicit non-participant regression test proving a caller absent from `participantIds` stays unverified (strict superset).

## Definition of Done

- `verifyParticipant` coerces both sides to String; conversation AND room participants get cache hits; non-participants stay unverified.
- New `translate-cache.test.js` real-emulator tests green (RED-first proven); existing translate suites + full express-api Jest suite green; eslint/prettier clean, zero suppressions.
- `code-reviewer` 100% clean (loop to zero findings); `Reviewed-up-to` recorded.
- Status → In Review; PR to **develop**. Backend change ⇒ device/browser gauntlet applies at the develop→main promotion per the MVP sprint (this PR carries the real-emulator Jest proof; the translation surface is walked in the journey corpus at batch time). Done on the next release cut.

## Notes (running log)

- 2026-07-09 — Found while reviewing SHY-0060 (code-reviewer round 2, finding #3, confidence 72). Verified by reading `translate.js:127-216` + confirming both `conversations/{id}` and `rooms/{id}` store `participantIds` as Strings (`room-mutations.js:136` `callerId = String(req.auth.uniqueId)`; conversations via the app + `firestore.rules`) while `req.auth.uniqueId` is a Number. Same String/Number class as the SHY-0060 DM-gate Critical, fails safe (cache-only). Filed as its own SHY per 1-PR-1-SHY + [[feedback-fix-pre-existing-and-new-same]].
- 2026-07-09 — TDD: new real-emulator `translate-cache.test.js`; RED-proven (conv+room cache-hit → 429 pre-fix), fix = `.map(String)` coercion. Committed `d35bf602955`; full express-api suite **12,850 pass / 0 fail**.
- 2026-07-09 — **code-reviewer round 1 (reviewed `d35bf602955`): 1 Critical + 2 Important — all fixed.**
  - **[Critical FIXED] the cache-WRITE path (`translate.js:194`) was untested — and my "flag-sharing" descoping argument was WRONG.** My own Test Plan/AC/BDD named a write-path test I then silently dropped (no Notes rework record). The reviewer refuted the "needs the live provider / fragile shared state" excuse: `translate.js:44-46` builds its string cache from `TRANSLATION_CACHE_SEED_PATH`/`RUNTIME_PATH` env paths at require-time, so seeding it (the pattern `translate-public.test.js` already uses) drives a first-time translation with ZERO network. Added a WRITE test: seed the string cache → participant with quota remaining translates → assert the message doc **persisted** `translations.de` (fire-and-forget, polled) → and a re-request is a `cached:true` hit (the BDD "second identical request" clause). **RED-proven: reverting the fix → 3 failed / 2 passed** (conv + room + write red; non-participant + Number-legacy green).
  - **[Important FIXED] module-load-time date flake.** `quotaSpent.translationDate` was frozen at require-time; the route computes `today` per request, so a UTC-midnight straddle would desync → quota-reset → fall through to the LIVE provider (breaking the provider-free claim + writing to the shared `data/translation-cache.json`). Now `spentQuota()` computes the date fresh per call; the env-path override also isolates any stray write to a tmp dir.
  - **[Important FIXED] vacuous assertion** — `expect(res.body.cached).not.toBe(true)` on a 429 body that never has a `cached` key (always `undefined`, passes regardless — exactly the [[feedback-test-must-fail-if-logic-skipped]] trap). Now asserts the exact 429 contract `{error, limit, upgradePrompt}`.
  - 57/57 across all translate suites; lint clean. **Reviewed-up-to: <review-fix commit>.** Re-review before push.
- 2026-07-09 — **code-reviewer round 2 (tight confirm, reviewed `c60dcd220c2`): ZERO findings on the diff — merge bar cleared.** Reviewer independently re-derived the RED mapping (revert fix → 3 failed/2 passed), confirmed all 3 round-1 fixes genuinely resolved (write test non-tautological + RED-provable, env/tmp lifecycle ordered+cleaned with no cross-file leak, cache-key match, `spentQuota()` closes the date flake, exact 429 `toEqual`), real-only, no `==`/eslint-disable/`.only`, ids 68000001-5 collision-free. **Reviewed-up-to: c60dcd220c2.** Status → **In Review**; pushing → PR to develop.
  - **Pre-existing OUT-OF-SCOPE finding (own follow-up SHY):** `auth.js:351 clearSuspensionCache(uid)` lacks the "clear all" (`else suspensionCache.clear()`) branch its siblings `clearUniqueIdCache`/`clearAdminClaimCache` have, so `real-auth.js clearAuthCaches()` (calls it with no arg) does `suspensionCache.delete(undefined)` — a no-op, not a real clear. Harmless to SHY-0165 (all its users `isSuspended:false` → first-touch miss). Confidence ~90. → follow-up bug SHY (test-isolation helper correctness).
