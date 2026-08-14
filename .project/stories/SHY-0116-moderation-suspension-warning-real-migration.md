---
id: SHY-0116
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: XL
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0116: Migrate Moderation / Suspension / Warning tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Moderation test (express `admin-users` / `bans` / `warn` / `appeal` + cohort segregation, ~65 files) moved off in-process doubles and onto the real emulator stack, **with SHY-0101's j11 real-Android moderation journey as the leading slice**,
**So that** safety-critical behaviour (suspensions actually block, warnings actually surface, appeals actually route) is proven against real state — where a faked pass is most dangerous.

## Why

Moderation is the largest express fake cluster (~65 files) **and** the highest-stakes: a suspended user wrongly able to post, or a warning that never shows, is a Blocker-class safety defect that mocked tests happily hide. The MVP go-live parameters put Safety & Compliance first ([[project-mvp-golive-parameters]]). SHY-0101 already drove the real-device j11 harassment-moderation journey on the OnePlus and surfaced 3 real apparatus/product gaps (sign-in moderation-state leak; warning reason fetched async + not seeded; appeal field) — those are the **leading slice** of this area and must now be proven REAL (real Firestore/Auth emulator, self-seeded personas) rather than with `makeStatefulFakeDb` (the fake test that was reverted).

## Acceptance Criteria

### Happy path
- [ ] Every express moderation test (admin-users/bans/warn/appeal/segregation) runs against the real Firestore/Auth emulator; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] An admin warning/suspension action writes real moderation state, and the **real** app/device surfaces it: a suspended persona is genuinely gated; a warned persona genuinely sees the warning (with its real reason) — proven on the real-device j11 journey (SHY-0101 retired here).
- [ ] An appeal submitted on the real surface routes to real appeal state visible to the admin path.

### Error paths
- [ ] A suspended user attempting a gated action is **blocked by the real backend/rules** (not a mocked guard); asserted on real state (the Blocker-class safety contract).
- [ ] Invalid/duplicate/over-limit moderation actions are rejected by the real backend contract.
- [ ] Moderation-state isolation: per-persona reset means no leftover `isSuspended`/`hasActiveWarning` leaks between scenarios (the real-state fix for SHY-0101's scenario-2/3/5 sign-in leak; assertion kept correct).

### Edge cases
- [ ] Warning reason is sourced from the **real** fetch path (`WarningScreen` reads it async via Resource.Success) — the migrated test seeds the real fetch source, proving SHY-0101 scenario-1 (no more silently-missing reason).
- [ ] Cross-platform propagation: an admin action propagates to the app within the real cache window (mirrors /manual-qa cross-platform-is-king principle).
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first. SHY-0111 (suspension countdown jitter) already filed — its real test asserts no layout shift.

### Performance
- [ ] Moderation list/admin render budgets asserted on the real surface; migrated express suite completes in a few seconds against a warm emulator.

### Security
- [ ] Real-rules enforcement is the contract (a suspended user genuinely cannot act); admin-only routes enforced by real auth; no secrets logged. Any rules change → operator rules-deploy checkpoint.

### UX
- [ ] The real warned/suspended/appeal screens are walked as the consumer (PM/UX/QA) — countdown stable (SHY-0111), reason present, appeal reachable.

### i18n
- [ ] Warning/suspension/appeal strings render in ≥1 RTL + ≥1 CJK locale on the real surface (spot-check).

### Observability
- [ ] Real moderation/audit logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a suspended user is genuinely blocked (real safety contract)**
- **Given** an admin suspends a real persona (real moderation state written)
- **When** that persona attempts a gated action on the real surface
- **Then** the real backend/rules block it — asserted on real state, not a mocked guard

**Scenario: a warned user sees the real reason (SHY-0101 scenario-1)**
- **Given** a first-strike warning issued with a reason via the real fetch source
- **When** the persona opens the warning screen on the real device
- **Then** the real reason is displayed (the migrated test seeds the real fetch path)

**Scenario: moderation state does not leak between scenarios (SHY-0101 A)**
- **Given** the per-persona real reset runs before each scenario
- **When** scenario N seeds suspension and scenario N+1 expects a clean persona
- **Then** N+1 starts un-suspended (no leaked `isSuspended`) and signs in cleanly

**Scenario: a surfaced moderation bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each moderation test (incl. SHY-0101's 11 `makeStatefulFakeDb` lines + the reverted isolation test) to require the real Auth/Firestore emulator with self-seeded P-08/P-09 → fails until seeded real; the real isolation/reset test fails until the runner resets moderation fields for real.

**GREEN:** implement the real moderation-field reset in the runner's shared sign-in (real path, not fake), seed real fetch sources, exercise real gates/appeals; retire `@known-failure-SHY-0097` (j11) once the real journey is green; file + `@known-failure`-tag remaining surfaced bugs. Full real-device j11 gauntlet; canonical `npm test` green for the express layer.

**Frameworks:** express Jest (real Auth + Firestore emulator), Android journey gauntlet (real device, j11), frontmatter validator. **Real backend:** Firebase Auth + Firestore emulator + real device. **Gauntlet:** REQUIRED (j11) — operator-gated.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs incl. SHY-0111, drained post-epic).
- The androidTest moderation/report domain migration (rides SHY-0115's harness — its own slice).
- Sub-splitting: ~65 files delivered as several 1-SHY-1-PR slices (admin-users · bans · warn · appeal · segregation · j11 journey) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0101** (j11 real-Android apparatus) — its journey is the leading slice; its reverted fake test is re-authored REAL here.
- **SHY-0096** (real signed-out reset) + **SHY-0109** + `firebase-emulator.js`.
- Real Android device; real Auth/Firestore emulator.

## Risks & Mitigations
- **Risk:** safety gates depend on `firestore.rules` (operator-gated). **Mitigation:** prepare rules diff + real failing test → operator checkpoint; migrate non-rules-blocked moderation tests meanwhile ([[feedback-blocker-switch-not-halt]]).
- **Risk:** async warning-reason fetch is flaky. **Mitigation:** seed the real fetch source + bounded real waits.
- **Risk:** XL + highest-stakes. **Mitigation:** vertical 1-SHY-1-PR slices; safety scenarios assert real state, never relaxed ([[feedback-think-like-qa-real-fixes]]).

## Definition of Done
- All moderation tests double-free + asserting real safety state; baseline shrinks per file; `@known-failure-SHY-0097` retired with the real j11 green.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Gauntlet + canonical `npm test` green; `code-reviewer` + `security-reviewer` zero findings; CI green by name.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, highest-stakes).** Safety-first per MVP parameters; SHY-0101's j11 journey leads. The reverted `makeStatefulFakeDb` isolation test is re-authored REAL here (real Auth/Firestore emulator, self-seeded personas). XL → sub-split at pickup.
