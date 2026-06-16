---
id: SHY-0102
status: Draft
owner: claude
created: 2026-06-15
priority: P1
effort: M
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0102: Firestore `list` rules deny rooms & conversations queries (resource.data deref unsatisfiable for `list`)

## User Story

As a **signed-in member browsing the app**, I want **my rooms list and my direct-message (conversations) list to load**, so that **I can see available rooms and my existing DMs instead of empty screens**.

## Why

During the OkHttp-5 journey gauntlet (#1429) on a real Android device against the local stack, persona Raul (UID 50000050, cohort `adult`) hit `PERMISSION_DENIED` on two list queries:

- `rooms where state in [ACTIVE, OWNER_AWAY]` → `"false for 'list'"` at `firestore.rules` L192.
- `conversations where participantIds array_contains 50000050` → `"evaluation error at L327:22 for 'list'"`.

Root cause is **not** OkHttp (Firestore travels over gRPC; reproduces identically on OkHttp 4), **not** missing claims (Raul's token carries `{"uniqueId":50000050,"cohort":"adult"}`), and **not** an id type mismatch (the app model uses `Set<String>` consistently; seeded `participantIds` are strings). It is the Firestore **`list`-rule evaluation model**: for a `list` operation the rule is evaluated once against the *query* with `resource.data` unbound — not per-returned-document. Both rules dereference `resource.data` (`cohortMatchesCaller()` reads `resource.data.cohort`; the conversations rule reads `resource.data.participantIds`), which a `list` cannot satisfy from the query alone. Proof: the **empty** `rooms` collection (0 docs) is still denied, and a **valid** conversation where the caller genuinely appears in `participantIds` still throws. Result: rooms and DM lists silently fail to load (degraded UX; potential core-feature breakage for messaging).

Existing rule tests (`room-rules.test.js`) pass because they exercise `get`/`read` on individual docs, never a collection `list`/query — `get` and `list` are evaluated under different semantics, so the contract for `list` was never pinned.

## Acceptance Criteria

### Happy path
- [ ] An `adult` member can `list` rooms via the app's production query and receive the cohort-appropriate rooms (no `PERMISSION_DENIED`).
- [ ] A member can `list` their own conversations via the app's production query and receive their DMs (no `PERMISSION_DENIED`/evaluation error).
- [ ] The Rooms screen and Messages screen populate from real data on local, dev, and prod.

### Error paths
- [ ] A `minor` member listing `adult`-cohort rooms is still denied (age-segregation preserved).
- [ ] A user listing conversations they are NOT a participant of is still denied (DM-privacy preserved).
- [ ] A `list` query lacking the constraints the rules require fails CLOSED (deny), never opens access.

### Edge cases
- [ ] Empty result set (0 matching rooms/conversations) returns an empty list, NOT a `PERMISSION_DENIED`.
- [ ] A conversation doc missing `participantIds` (legacy/partial) does not cause the whole list to error for an authorised caller.
- [ ] `crossCohortAtMigration: true` conversations remain hidden from `list` (existing gate preserved).

### Performance
- [ ] N/A — rule change only; no added round-trips. (Confirm the fixed query does not require a client-side fan-out that worsens room-list render budget < 2s with 50 rooms.)

### Security
- [ ] Age-segregation (UK OSA #17) and DM-privacy invariants are unchanged: the fix must NOT widen read access. Verified by adversarial `assertFails` cases (minor→adult rooms, non-participant→DM, forged cohort claim).
- [ ] Decision recorded (in Notes) on the chosen fix shape — (a) client query adds rule-satisfying constraints, (b) rules rewritten to validate the query, or (c) reads routed server-side via Express — with the security rationale. **Rules change requires operator checkpoint per CLAUDE.md before apply.**

### UX
- [ ] No empty Rooms/Messages screens when data exists; no silent failure. If a genuine denial occurs, the UI shows an actionable state, not a blank screen.

### i18n
- [ ] N/A — no new user-facing strings (unless an error state is added; if so, all 20 locales updated).

### Observability
- [ ] The app logs a distinguishable warning when a list query is denied vs returns empty, so this class of failure is detectable in logcat/console without ambiguity.

## BDD Scenarios

**Scenario: adult member lists rooms successfully**
- **Given** an authenticated member with cohort claim `adult`
- **And** the rooms collection contains adult-cohort rooms in state ACTIVE/OWNER_AWAY
- **When** the app issues its production rooms-list query
- **Then** the query succeeds (no PERMISSION_DENIED)
- **And** only cohort-appropriate rooms are returned

**Scenario: empty rooms collection returns empty, not denied**
- **Given** an authenticated `adult` member
- **And** the rooms collection has zero matching docs
- **When** the app issues its rooms-list query
- **Then** the result is an empty list
- **And** no PERMISSION_DENIED is raised

**Scenario: member lists own conversations successfully**
- **Given** an authenticated member whose `uniqueId` is in a conversation's `participantIds`
- **When** the app issues its conversations-list query
- **Then** the query succeeds (no evaluation error)
- **And** the member's conversations are returned

**Scenario: minor cannot list adult rooms (segregation preserved)**
- **Given** an authenticated member with cohort claim `minor`
- **When** the member attempts to list adult-cohort rooms
- **Then** the query is denied

**Scenario: non-participant cannot list a conversation (privacy preserved)**
- **Given** an authenticated member NOT in a conversation's `participantIds`
- **When** the member attempts to list that conversation
- **Then** the query is denied

## Test Plan

**RED (write first, must fail against current rules):**
- `express-api/tests/firestore-rules/room-rules.test.js` — ADD `list`/query cases (the gap): `assertSucceeds(getDocs(query(rooms, where('state','in',[...]))))` for an adult listing adult rooms; `assertSucceeds` on empty result; `assertFails` for minor→adult. (Current `get`-only tests do NOT cover this.)
- NEW `express-api/tests/firestore-rules/conversations-rules.test.js` — `assertSucceeds(getDocs(query(conversations, where('participantIds','array-contains', myUniqueId))))` for a participant; `assertFails` for a non-participant; `crossCohortAtMigration` hidden.
- `tests/integration/10-firestore-cohort-rules.spec.ts` + `07-firestore-rules-enforcement.spec.ts` — add list-query enforcement coverage.

**GREEN:**
- Apply the chosen fix (query constraints / rule rewrite / server-mediated). All RED tests pass; all pre-existing rule tests stay green.

**Gauntlet (per Pre-Merge Protocol — this touches runtime behaviour):**
- Real Android + real iOS app journeys: Rooms screen populates, Messages/DM list populates, against local then dev. State-verify Firestore agrees.
- Web browsers per allowlist (rooms/messages surfaces).

## Out of Scope

- The OkHttp 5 adoption (#1429) — orthogonal; this finding does not block it.
- Broader rules refactor beyond rooms + conversations `list`.
- Seed-data redesign (unless the fix requires a participantIds/cohort shape change, captured here).

## Dependencies

- `firestore.rules` helpers `callerUniqueId()` (L9), `cohortMatchesCaller()` (L26-29), `isAdmin()` (L38-40).
- Server-side authz plan ("Room mutations → server-side authz", IN PROGRESS) — if rooms are intended to be read server-side, fix shape (c) aligns with it.
- `@firebase/rules-unit-testing` harness (already used by existing rule tests).

## Risks & Mitigations

- **Risk:** widening read access while fixing the denial (security regression on age-segregation / DM-privacy). **Mitigation:** adversarial `assertFails` cases first; operator checkpoint on the rule change; fail-closed default.
- **Risk:** the fix needs a client-query change that breaks other callers of the same collection. **Mitigation:** grep all rooms/conversations query call-sites; cover each in tests.
- **Risk:** behaviour differs local vs dev/prod (seed-data shape drift). **Mitigation:** AC requires confirming scope on dev/prod, not just local.

## Definition of Done

- All RED tests written and failing first, then green; existing rule + integration tests stay green.
- Chosen fix shape documented + operator-approved (rules change).
- Rooms + DM lists load on real Android + real iOS + browsers, local then dev; Firestore state agrees; segregation/privacy adversarial cases still deny.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-15 — Filed from OkHttp-5 journey gauntlet (#1429) finding. Root-caused to Firestore `list`-rule evaluation model (resource.data deref unsatisfiable for `list`); confirmed NOT OkHttp-related, NOT a claims gap, NOT an id-type mismatch. Observed on local with persona Raul (UID 50000050). Priority P1 pending dev/prod scope confirmation (AC: may downgrade to P2 if local-seed-only, escalate if prod messaging is broken). Security-sensitive (age-segregation + DM-privacy) → rule change needs operator checkpoint per CLAUDE.md. Evidence: rooms L192 `"false for 'list'"` on empty collection; conversations L327:22 `"evaluation error"` on a valid-participant doc.
- 2026-06-15 (later) — **DEV-CONFIRMED, not local-seed-only.** OkHttp-5 DEV gauntlet on real Android (`com.shyden.shytalk.dev` over `shytalk-dev` + `dev-api`) with persona Alice (P-02, UID 50000010, cohort adult) reproduced the rooms `list` denial: `Firestore: Listen for QueryWrapper(query=Query(rooms where state in[ACTIVE,OWNER_AWAY])) failed: Status{code=PERMISSION_DENIED}` → `RoomRepository: Failed to prefetch active rooms`. Confirms the finding is environment-wide (local + dev), NOT seed-specific → **priority stays P1, do not downgrade**. Conversations `list` path not re-reached on dev this cycle (room flow blocked upstream by a separate RTDB presence denial — see the sibling RTDB story to be filed). Evidence log: `/tmp/manual-qa-okhttp5-dev-cycle.md`.
