---
id: SHY-0132
status: Draft
owner: claude
created: 2026-06-20
priority: P1
effort: M
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0132: Conversations `list` leaks migrated cross-cohort thread metadata (OSA §17)

## User Story

As a **safeguarded user whose pre-segregation cross-cohort DMs/groups were frozen at migration**,
I want **those migrated cross-cohort threads to be invisible to me on the conversations list, not just on direct open**,
So that **an adult and a minor who were paired before age-segregation can no longer see any trace of each other — satisfying the UK Online Safety Act §17 read-segregation guarantee everywhere, not only on `get`**.

## Why

The conversations `list` security rule does **not** actually enforce its `crossCohortAtMigration != true` clause, so migrated cross-cohort threads — correctly hidden when opened (`get`) — are **returned on `list`**, leaking their metadata (participantIds, lastMessageAt; message content stays gated by the messages subcollection rules). This is a pre-existing OSA §17 read-segregation hole, **surfaced and proven during SHY-0130** and deliberately carved out of it (operator decision 2026-06-19: SHY-0130 = id-type contract only) so a focused id-type fix would not widen read access.

**Empirically proven this session against the live Firestore emulator** (throwaway probe, then reverted):

```
firestore.rules L324-329:
  allow get:  ... && resource.data.get('crossCohortAtMigration', false) != true;
  allow list: ... && resource.data.get('crossCohortAtMigration', false) != true;

PROBE-UNCONSTRAINED  array-contains(string(uid))                       → SUCCEEDED, 2 docs: [cross, normal]   ← LEAK
PROBE-WITHFIX        array-contains(string(uid)) + where(==false)      → SUCCEEDED, 0 docs                    ← needs backfill
```

The `!= true` clause is present in the `list` rule **text**, but Firestore does not apply a `resource.data` condition as a per-document **filter** on a `list` query — it authorises the query against the returned set and does not silently drop docs that fail the data condition. So an unconstrained `array-contains` list query returns the caller's `crossCohortAtMigration: true` threads (fail-**open**), even though `get` on the very same doc is correctly denied (fail-closed). **No rule change can fix this** — a rule cannot enforce a field the query does not constrain. The fix must live in the query + the data.

## Acceptance Criteria

### Happy path
- [ ] After the fix, a participant's conversations list (`getConversations` + `prefetchConversations`, Android **and** iOS) returns **only** threads with `crossCohortAtMigration == false`; a seeded `crossCohortAtMigration: true` thread the caller participates in is **absent** from the returned set.
- [ ] A normal (non-migrated) thread the caller participates in **still appears** in the list (the fix must not hide legitimate threads) — verified after the backfill stamps `crossCohortAtMigration: false` on it.
- [ ] The engine harness proves: `array-contains(string(uid))` alone returns BOTH docs (the leak); `array-contains(string(uid)) + where(crossCohortAtMigration == false)` returns ONLY the non-migrated doc (the fix), against the real rules engine.

### Error paths
- [ ] The backfill script is idempotent: a second run reports 0 updated; it **never** overwrites an existing `crossCohortAtMigration: true` (only stamps `false` where the field is **absent**).
- [ ] A `getConversations` listen that is denied/fails surfaces via `close(error)` (already fixed in SHY-0130) — the added equality constraint must not silently empty the list on a missing composite index; a missing-index error must surface, not be swallowed.

### Edge cases
- [ ] A doc that **already** has `crossCohortAtMigration: false` is left unchanged by the backfill (skip, not rewrite).
- [ ] A doc with `crossCohortAtMigration: true` is excluded from the list **and** left untouched by the backfill.
- [ ] A brand-new thread created **after** the fix (DM via `getOrCreateConversation`, group via `createGroupConversation`, and the Express `conversations.js` create path) is stamped `crossCohortAtMigration: false` at write time, so it matches the `== false` filter without needing a re-backfill.
- [ ] An empty conversations collection → backfill reports `{ total: 0, updated: 0, skipped: 0 }`.

### Performance
- [ ] The `array-contains(participantIds) + where(crossCohortAtMigration == false) + orderBy(lastMessageAt DESC)` query has a backing **composite index** in `firestore.indexes.json` (array-contains + equality + orderBy requires one); the list query does not regress to a client-side scan or fail with `FAILED_PRECONDITION`.
- [ ] The backfill batches writes at 500/commit (Firestore limit) and completes a full `conversations` scan in one pass.

### Security
- [ ] **OSA §17 read-segregation: a migrated cross-cohort thread is unreachable on BOTH `get` (already) and `list` (this fix).** An adult cannot enumerate a minor's id, or vice-versa, via the migrated thread's metadata.
- [ ] The fix does not **widen** any read access: a non-participant still cannot list another user's threads; an unauthenticated caller still cannot list; the id-type contract from SHY-0130 (string `participantIds`) is preserved.
- [ ] No message **content** was ever exposed (gated by the `messages` subcollection rules) — this story closes the metadata leak; the harness asserts content remained inaccessible throughout.

### UX
- [ ] No user-visible change for legitimate threads: a normal conversation list looks identical pre/post fix. Migrated cross-cohort threads simply never appear (consistent with the existing `get` 404).

### i18n
- N/A — server-side rule/data + client query change; no new user-facing strings.

### Observability
- [ ] The backfill logs `{ total, updated, skipped }` counts; a post-run audit query reports **0** conversation docs lacking the `crossCohortAtMigration` field (the verification gate before prod).
- [ ] A list listener error (e.g. a missing composite index) is surfaced via the SHY-0130 `close(error)` path and logged, not swallowed as an empty list.

## BDD Scenarios

**Scenario: migrated cross-cohort thread is hidden on list (the fix)**
- **Given** an adult caller participates in a normal thread `T1` (`crossCohortAtMigration: false`) and a migrated thread `T2` (`crossCohortAtMigration: true`) seeded via admin
- **When** the client lists conversations with `array-contains(participantIds, string(uniqueId))` **and** `where(crossCohortAtMigration == false)`
- **Then** the query succeeds and returns exactly `[T1]`
- **And** `T2` is absent (no participantIds/lastMessageAt metadata leaked)

**Scenario: the leak is real without the fix (regression guard)**
- **Given** the same `T1` + `T2` seeded
- **When** the client lists with `array-contains(participantIds, string(uniqueId))` and **no** `crossCohortAtMigration` constraint
- **Then** the query returns BOTH `[T1, T2]` (proves the rule does not filter on `list` — this test documents the vulnerability and must be updated/removed only alongside the query fix)

**Scenario: the `== false` filter needs the backfill**
- **Given** `T1` seeded **without** any `crossCohortAtMigration` field (legacy normal thread)
- **When** the client lists with `where(crossCohortAtMigration == false)`
- **Then** `T1` is **absent** (an `== false` equality excludes docs where the field is absent)
- **And** after the backfill stamps `crossCohortAtMigration: false` on `T1`, the same list returns `[T1]`

**Scenario: backfill is idempotent and never widens**
- **Given** `T1` (no field), `T2` (`true`), `T3` (`false`) seeded
- **When** `backfillCrossCohortFlag(db)` runs, then runs a second time
- **Then** the first run stamps `T1 → false`, skips `T2` and `T3`; the second run updates 0
- **And** `T2.crossCohortAtMigration` is still `true` (never overwritten)

**Scenario: a new thread is born stamped**
- **Given** the fix is deployed
- **When** a user creates a new DM (`getOrCreateConversation`) or group (`createGroupConversation`)
- **Then** the new doc has `crossCohortAtMigration: false` at creation
- **And** it appears in the creator's `where(crossCohortAtMigration == false)` list without a re-backfill

## Test Plan

**RED (failing-first):**
- `express-api/tests/firestore-rules/conversations-rules.test.js` — re-add the leak-proof + fix-proof `describe('crossCohortAtMigration list segregation')` block (written + proven 14/14 this session, then trimmed out of SHY-0130): (a) unconstrained list returns BOTH docs (leak); (b) `+ where(== false)` returns ONLY the non-migrated doc; (c) `== false` excludes an absent-field doc until backfilled. Real emulator.
- `express-api/tests/scripts/backfill-cross-cohort-flag.test.js` (NEW) — real emulator via `withSecurityRulesDisabled`: numeric/absent → stamped `false`; `true` skipped + untouched; `false` skipped; mixed-collection counts; empty collection `{0,0,0}`; >500-doc batch boundary.
- `app/src/test/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImplTest.kt` — value-level capture that `getConversations` + `prefetchConversations` issue `whereEqualTo("crossCohortAtMigration", false)` in addition to the string `array-contains`; that `getOrCreateConversation` + `createGroupConversation` writes include `crossCohortAtMigration: false`.
- iOS host test (`iosApp/iosAppTests` or the shared iOS test set) — assert `IosPrivateMessageRepositoryImpl` query includes `"crossCohortAtMigration" equalTo false` and the create writes stamp the flag.

**GREEN:**
- `app/src/main/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImpl.kt` — add `.whereEqualTo("crossCohortAtMigration", false)` to the `prefetchConversations` (L46) + `getConversations` (L71) queries; stamp `"crossCohortAtMigration" to false` in `getOrCreateConversation` (L112) + `createGroupConversation` writes.
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosPrivateMessageRepositoryImpl.kt` — add `"crossCohortAtMigration" equalTo false` to `prefetchConversations` (L47) + `getConversations` (L70); stamp the flag in `getOrCreateConversation` (L101) + the group create (L479/L519).
- `express-api/src/routes/conversations.js` — the create path stamps `crossCohortAtMigration: false` on new docs.
- `express-api/scripts/backfill-cross-cohort-flag.js` (NEW) — Admin-SDK backfill: stamp `crossCohortAtMigration: false` on every conversation doc where the field is **absent**; idempotent; batched 500; logs `{ total, updated, skipped }`; standalone (run dev → prod). A companion audit query asserts 0 remaining absent-field docs.
- `firestore.indexes.json` — composite index for `participantIds array-contains` + `crossCohortAtMigration ==` + `lastMessageAt DESC`.

**Gauntlet (per Pre-Merge Protocol — backend + client, touches segregation):**
- Backend = FULL gauntlet (firestore.rules adjacent + Express + scripts). Kotlin JVM unit + iOS compile (`:shared:compileKotlinIosArm64`) + detekt + ktlint + eslint + prettier + no-stubs ratchet.
- Real-device: a migrated cross-cohort thread does NOT appear in the Messages list on real Android + real iOS (local then dev); a normal thread still appears; new threads created post-fix appear. Operator-gated device journey.
- Run the backfill on dev then prod; verify 0 remaining absent-field docs **before** flipping the client filter live (ordering: backfill first, then the `== false` filter, else legitimate threads vanish).

## Out of Scope

- The conversations **id-type** contract (string `participantIds`) — that is **SHY-0130** (this is its security companion; same query lines → sequential/stacked).
- `getOwnedGroupCount` (`PrivateMessageRepositoryImpl:762`) likely-denial — its own separate functional-denial SHY.
- The rooms `list` cohort fix — **SHY-0102**.
- Any change to message-**content** access (already correctly gated) or to how `crossCohortAtMigration: true` is **set** at migration time (PR 8 segregation writer is correct).
- Hard-deleting or unwinding migrated cross-cohort threads — they remain stored, just unreadable (forensic/audit need per `segregation-audit.js`).

## Dependencies

- `firestore.rules` `match /conversations/{conversationId}` `allow list` (L327-329) — **unchanged** by this story (the rule already names the field; the fix is query + data, not rule). If the harness shows a rule change is unavoidable, STOP and operator-checkpoint (security-sensitive).
- SHY-0130 (the string `participantIds` query + the `getConversations` `close(error)` listener) — this fix adds a second constraint to the same Android/iOS query sites; **stack on SHY-0130** to avoid a conflicting edit of the same lines.
- `@firebase/rules-unit-testing` harness pattern (`conversations-rules.test.js`, established by SHY-0130).
- The PR 8 migration writer that sets `crossCohortAtMigration: true` (`segregation-audit.js` references it) — the canonical producer of the `true` flag this fix filters against.
- A new Firestore composite index must be deployed before the filtered query runs in dev/prod.

## Risks & Mitigations

- **Risk:** flipping the `== false` filter live **before** the backfill stamps existing normal threads → every legitimate thread vanishes from the list (proven: `== false` excludes absent-field docs). **Mitigation:** strict ordering — backfill dev/prod to 0-remaining-absent FIRST, deploy the composite index, THEN ship the client filter; the story's DoD encodes this order.
- **Risk:** missing composite index → the filtered+ordered query throws `FAILED_PRECONDITION` and (via SHY-0130 `close(error)`) surfaces as an error/empty list. **Mitigation:** add the index to `firestore.indexes.json` and deploy it in the same change; test the query shape against the emulator (which enforces indexes when configured).
- **Risk:** a new thread created between backfill and filter-deploy lacks the flag. **Mitigation:** stamp `crossCohortAtMigration: false` at every create site (Android + iOS + Express) as part of GREEN, so new docs always match.
- **Risk:** P0 vs P1 mis-triage. **Mitigation:** first task is an audit query — count `conversations` with `crossCohortAtMigration == true` on dev **and** prod; if > 0 real cross-cohort pairs exist, escalate to P0 (active leak) and prioritise accordingly.

## Definition of Done

- Engine harness proves the leak (unconstrained → both) and the fix (`+ where(== false)` → only safe doc), real emulator, failing-first then green; rule + existing tests stay green.
- Android + iOS conversations list queries carry `crossCohortAtMigration == false`; all create sites (DM + group, both platforms + Express) stamp `false`; composite index added; `:shared:compileKotlinIosArm64` green.
- Backfill script real-emulator-tested (idempotent, batched, counts); run on dev then prod with **0 remaining absent-field docs** verified before the filter goes live.
- `code-reviewer` 100% clean before push; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Real-device verification: migrated cross-cohort thread absent from Messages list on real Android + real iOS, normal threads present, local then dev.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-20 — **Filed from the SHY-0130 implementation (operator chose "separate security SHY" 2026-06-19).** The leak + the fix were **empirically proven against the live emulator this session** (probe captured above; harness tests written 14/14 green earlier, then trimmed from SHY-0130's commit to keep that PR id-type-only — re-add them here). Root mechanism: Firestore does not enforce a `resource.data` condition as a per-doc filter on `list`, so the `crossCohortAtMigration != true` clause present in the `list` rule text is bypassed; an unconstrained `array-contains` query returns migrated cross-cohort threads (metadata leak; content stays gated). Proven fix = client `where(crossCohortAtMigration == false)` on both list queries + a **mandatory** Admin-SDK backfill (since `== false` excludes absent-field docs) + stamping the flag on all new writes + a composite index. **Severity P1; escalate to P0 if a dev/prod audit finds real `crossCohortAtMigration: true` docs (first task).** Strong **MVP / Safety & Compliance** candidate — flag in the MVP classification pass. Stack on SHY-0130 (same query lines).
