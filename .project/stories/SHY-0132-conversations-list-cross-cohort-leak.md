---
id: SHY-0132
status: Done
owner: claude
created: 2026-06-20
priority: P1
effort: M
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1542
released_in: v0.98.0
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
- 2026-06-20 — **ARCHITECT: APPROVE → In Progress (operator-directed 2026-06-20).** Validated the proven fix against the live code on the SHY-0130 branch. Confirmed: (1) the leak mechanic is empirically established (emulator probe — unconstrained `array-contains` returns crossCohort:true docs; `where(==false)` excludes them; `==false` also excludes absent-field docs ⇒ backfill mandatory) — the fix can NOT rely on the rule (which doesn't enforce the field on `list`); it must be query + data. (2) Scope = `getConversations`/`prefetchConversations` filter (Android `PrivateMessageRepositoryImpl:71/46`, iOS `IosPrivateMessageRepositoryImpl:70/47`) + stamp `crossCohortAtMigration:false` at create sites (`getOrCreateConversation:112`, `createGroupConversation:489`, Express `conversations.js` create) + a new Admin-SDK backfill + extend the EXISTING composite index `firestore.indexes.json:4-8` (`participantIds CONTAINS + lastMessageAt DESC`) to add a `crossCohortAtMigration` equality field (3-field composite). (3) NO-WIDEN: the filter strictly NARROWS the result set (excludes migrated cross-cohort threads) — segregation is strengthened, never loosened; no `firestore.rules` change. (4) ORDERING (hard): backfill dev→prod to 0-remaining-absent + deploy the index BEFORE the client filter ships, else legitimate threads vanish. (5) Cross-ref: `getOwnedGroupCount` (SHY-0134) will ALSO need the crossCohort guard once it adds `array-contains`, but it's a COUNT not a metadata-display list → tracked under SHY-0134, out of SHY-0132 scope. **Implementation STACKED on `story/SHY-0130` (#1485 unmerged) — same query lines; merge after #1485, rebase if it changes.**
- 2026-06-20 — **Implementation complete + locally green across all layers (stacked on story/SHY-0130).** (1) Harness `conversations-rules.test.js` — added the `crossCohortAtMigration segregation` describe: LEAK proof (unconstrained list returns the migrated cross-cohort thread), FIX proof (`+ where(==false)` returns only the non-migrated), `==false`-excludes-absent-then-backfill-reveals, non-participant-still-denied. 15/15. (2) NEW `express-api/scripts/backfill-cross-cohort-flag.js` + test (real emulator) — stamps `false` ONLY where the field is absent (hasOwnProperty), never overwrites true/false, idempotent, batched 500. 6/6. (3) Android `PrivateMessageRepositoryImpl` — `.whereEqualTo("crossCohortAtMigration", false)` on getConversations+prefetchConversations; stamp `false` in getOrCreateConversation + createGroupConversation; tests assert the filter (io.mockk.verify) + the stamps. 44/44. (4) iOS `IosPrivateMessageRepositoryImpl` — `where { all("participantIds" contains uid, "crossCohortAtMigration" equalTo false) }` on both queries; stamp false in both create sites; `:shared:compileKotlinIosArm64` green. (5) `firestore.indexes.json` — added the 3-field composite (participantIds CONTAINS + crossCohortAtMigration ASC + lastMessageAt DESC). **SCOPE CORRECTION:** Express `conversations.js` does NOT create conversation docs (it creates message subcollection docs + reads conversations) — no Express stamping needed; conversation creation is entirely client-side. ktlint/detekt/eslint/prettier/no-stubs all clean.
- 2026-06-20 — **code-reviewer pass 1: 2 Critical + 4 Important.** The reviewer's security-COMPLETENESS hunt found TWO conversation-doc sites I missed — both FIXED: **C1** `express-api/src/utils/system-pm.js` created system-PM conversation docs without the flag (→ invisible after the filter ships) — now stamps `crossCohortAtMigration:false` on create (+ tests assert create-stamps, existing-path-doesn't-overwrite). **C2** `express-api/src/utils/data-export-builder.js` GDPR export (Admin SDK, rules-BYPASSING) listed conversations with no filter AND its message loop iterated the RAW docs → migrated cross-cohort thread metadata AND message content leaked into the export — now a `_isExportableConversation` (`!== true`) predicate filters BOTH the metadata map and the message loop (+ 4 unit tests, plain fixtures, no new mocks). **⚠️ GDPR-vs-OSA§17 policy flag for operator/legal:** applied the conservative OSA §17 exclusion (a migrated thread reveals the other party's id = re-identification risk); if legal requires GDPR Art.15 full-access inclusion, revisit. **DECISION (operator 2026-06-20): EXCLUDE migrated cross-cohort threads from the GDPR data export (as implemented) + FLAG FOR LEGAL REVIEW AT LAUNCH** — a lawyer must confirm the GDPR Art.15-vs-OSA§17 trade-off before go-live. Captured in the [[project-gdpr-export-osa17-legal-review]] memory (no standalone launch-checklist doc exists yet). Dismissed: I1 (mockk — unit-test exemption applies, ratchet clean), I2 (currentUserId verified = uniqueId per AuthRepository doc, not Firebase UID), I4 (index ASCENDING confirmed correct). I3 (backfill unbounded read) — documented as acceptable for the one-time pre-launch op + paginate-if-scale note. All 112 SHY-0132 JS tests green via the CANONICAL runner (`node --experimental-vm-modules ... jest` — my earlier `npx jest` lacked the flag → false archiver-ESM failures; [[feedback-reproduce-via-canonical-runner]]). REMAINING: re-review the C1/C2/I3 fix commit → (gauntlet) → backfill dev→prod + deploy index BEFORE the filter ships → operator real-device journey → merge AFTER #1485 (rebase onto merged main).
- 2026-06-20 — **code-reviewer re-review (commit d2fa5fe189b): ZERO Critical — both prior leaks confirmed fixed + an EXHAUSTIVE repo completeness sweep found NO third leaking PRODUCTION site** (admin-cleanup/admin-users moderation reads are intentionally unfiltered + admin-gated; the migration writer that sets `true` is correct; firestore.rules defence-in-depth intact on get/list/subcollections). 2 Important (test-side): **I1** — a `buildDataExport` integration regression-test (assert the migrated thread's `/messages` is NOT queried) would PIN a future revert of the message-loop to the raw docs, BUT the reviewer's suggested shape uses `mockResolvedValueOnce` which the no-stubs ratchet regex counts (`/\.mock(Resolved|Rejected|Return)Value(Once)?\b/`) → would violate the tightening-only ratchet. Covered instead by the 4 plain-fixture `_isExportableConversation` predicate tests (incl. the absent→include regression guard) + the single-filtered-list wiring (one `visibleConvDocs`, no raw-docs ref after it) + a code comment. **I2** — journey/device test-seed helpers create conversations without the flag → seeded threads go invisible once the mobile filter ships. FIXED the automated route seed `test-helpers.js` (stamps false, override-able). The DEVICE-JOURNEY seeds (`manual-qa-runner.js` ~7 sites + `device-journey-runner.js` L1149) are a PREREQUISITE for the SHY-0132 operator device journey (which runs AFTER #1485 merges + the filter ships) — track + stamp `crossCohortAtMigration: false` on those seeds before that gated phase (the j19 OSA seed at manual-qa-runner.js:11777 deliberately sets `true` — leave it). **GDPR decision: operator chose EXCLUDE + flag legal at launch ([[project-gdpr-export-osa17-legal-review]]).**
- 2026-06-20 — **I2 device-journey seed remainder COMPLETE (commit `e4dd3b5f615`).** Stamped `crossCohortAtMigration: false` on all 7 conversation seeds in `manual-qa-runner.js` (seedDirectConversation, seedSystemPmFromOfficia, past-message, frozen Wake-66, "in a conversation with", system-webhook PM, pre-existing-direct) + the Alice↔Lena seed in `device-journey-runner.js:1149`; the lone j19 OSA seed (`manual-qa-runner.js:11783`) keeps `true` (that journey verifies the migrated thread stays hidden). prettier + eslint + no-stubs ratchet all clean; runner seed-helpers have no unit test by design (journey-apparatus, proven by the real device journey). This completes every autonomous code layer of SHY-0132.
- 2026-06-20 — **Pre-push re-review of the I2 delta (`d2fa5fe189b..94d11440473`): CLEAN — zero Critical, zero Important.** `code-reviewer` verified the §17-critical invariants: j19 OSA seed (`manual-qa-runner.js:11783`) still carries `crossCohortAtMigration:true` and was untouched (migrated thread stays hidden); all 9 non-migrated seed sites across `test-helpers.js`(1) + `manual-qa-runner.js`(7) + `device-journey-runner.js`(1) correctly carry `false`; no conversation-root-doc seed site was missed (message-subcollection writes correctly omit the field); object shapes valid; no new stubs. `Reviewed-up-to: 94d11440473`. **Operator (2026-06-20) approved pushing the implementation as a DRAFT stacked PR (base = SHY-0130 branch) for backup + CI; stays unmerged until #1485 lands, then rebase onto merged main.**
- 2026-06-20 — **Pushed → DRAFT PR #1494** (base `story/SHY-0130-conversations-list-cohort-id-type-fix`, head `story/SHY-0132-impl-cross-cohort-list-fix`). Pre-push gauntlet green: full Express Jest **12543/12543** + SonarCloud quality gate passed. **CI is DORMANT by design** — `pr-checks.yml`/`codeql.yml` trigger on `pull_request: branches:[main]`, and this PR's base is the SHY-0130 story branch, so no run fires (and a base-retarget alone is type `edited`, not in `[opened,synchronize,reopened]`). CI (Analyze JavaScript / android-e2e / PR Gate) will fire on the **rebase-onto-main `synchronize`** after #1485 merges. Status held at **In Progress** (draft + stacked + device-journey pending ⇒ not yet truly in the merge-review phase); flip to In Review at the rebase point.
- 2026-07-08 — **Rebased onto develop + flipped to In Review.** #1485 (SHY-0130) landed on develop (`a4388b5ea4e`), so `git rebase --onto origin/develop 83e9ecdfc97` replayed only SHY-0132's 7 own commits onto develop with **zero conflicts** (the branch's SHY-0130 base matched develop's squash exactly, so nothing was dropped). Verified: all **15** code/config files are byte-identical to the reviewed `94d11440473` (only a review-neutral Notes line differs) ⇒ the clean `code-reviewer` pass **still holds**; `Reviewed-up-to: d5a69117a8e` (rebased equivalent of the reviewed code — the commits after it are `.md`-only Notes, review-neutral). Affected fast-layer re-run **GREEN on develop** via the canonical `--experimental-vm-modules` runner: firestore-rules conversations + backfill-cross-cohort-flag + migrate-participant-ids + data-export-builder + system-pm = **119/119**. **Force-push was infeasible for this account** — ruleset `16058327` (`no-force-push-anywhere`) enforces `non_fast_forward` on `~ALL` refs with only two Integration-app bypasses (no user bypass), and the local pre-push guard blocks it too — so the clean-rebased history was pushed as a NEW branch `story/SHY-0132-conversations-list-cross-cohort-leak` (a branch creation → no `--no-verify`), **superseding #1494**. Operator authorised a force-push; delivered the identical clean-rebased outcome via a new branch since the literal force-push is server-blocked. Device journey (real-device OSA §17 walk) remains the final gate at the develop→main promotion batch.
