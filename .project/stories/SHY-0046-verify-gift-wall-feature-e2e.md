---
id: SHY-0046
status: Draft
owner: claude
created: 2026-06-08
priority: P1
effort: XS
type: chore
roadmap_ids: [G018]
pr:
---

# SHY-0046: Verify `gift_wall.feature` covers loading/populated/empty states + GiftWallScreen test tags

## User Story

As a quality-conscious ShyTalk maintainer, I want **`app/src/androidTest/assets/features/gift_wall.feature` cross-checked against `GiftWallScreen.kt`'s test tags AND extended to cover the 3 UI states (loading / populated / empty) if any are missing**, so that the gift-wall journey suite catches regressions in any of the legitimate render paths rather than only the happy-path.

## Why

Roadmap row (line 48, 2026-06-05): `G018 | 🟠 Important | Journey — gift_wall not verified end-to-end | app/src/androidTest/assets/features/gift_wall.feature | Exists but state coverage (loading/populated/empty) not verified against test tags | Cross-check feature vs GiftWallScreen test tags, ensure 3 states covered | XS`.

This is a verification + targeted extension SHY, not a from-scratch authoring task. Most XS-scope SHYs are like this: a focused audit + a small fix if the audit surfaces a gap.

## Acceptance Criteria

### Happy path

- [ ] Read `gift_wall.feature` + `GiftWallScreen.kt` + any associated step definitions; produce a state-coverage matrix in this SHY's `## Notes` (3 rows × 2 cols: state × covered?).
- [ ] For each uncovered state (typically loading + empty if populated is the happy-path): add a new `Scenario:` block to the `.feature` file naming the state's testTag + observable behaviour.
- [ ] Test tags in `GiftWallScreen.kt`: verify each state has a unique testTag (`gift_wall_loading`, `gift_wall_populated`, `gift_wall_empty` or similar); add missing tags.
- [ ] `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@gift-wall'` passes with all 3 state scenarios.
- [ ] State-coverage matrix in Notes is updated after the work — all 3 states marked ✓.

### Error paths

- [ ] **`gift_wall.feature` doesn't exist** (audit surfaces): file becomes a feature-creation task; out of scope for THIS XS SHY — file a follow-up SHY (e.g. `SHY-NN-add-gift-wall-feature`).
- [ ] **`GiftWallScreen.kt` doesn't have a populated-state test tag at all**: add it as part of this SHY (one-line change).
- [ ] **The 3 states are actually 4+** (e.g. error state, refreshing state): scope-expand and document in Notes; still XS if scope grows by 1.
- [ ] **A state's behaviour is not deterministic** (e.g. animation timing): use Espresso `onIdle()` + state assertion, not hard sleeps.

### Edge cases

- [ ] **Loading state may be too fast to observe** in tests (Cucumber + Espresso settle within ms): use a fake repository with controlled delay or assert via test-only flag.
- [ ] **Empty state may require a fresh-user fixture** with no gifts received: use a test persona that explicitly has zero gifts.
- [ ] **Populated state's data scale** — use a fixed-count fixture (e.g. 5 gifts) for deterministic snapshot, not the random-count default seed.
- [ ] **Animation completion check** — gift-wall items have entry animations; assertions must wait for `onIdle()` post-animation.

### Performance

- [ ] Each scenario <30s on emulator. Loading-state scenario specifically should NOT add an artificial delay just to make the state observable; if needed, use a controlled fake.

### Security

- [ ] N/A — UI test, no security surface.

### UX

- [ ] Catches regressions in any of the 3 documented render states.
- [ ] Empty-state UX (e.g. "No gifts yet — invite friends!") gets explicit coverage.

### i18n

- [ ] If new scenarios assert text content, they use `R.string` resource lookups (not hardcoded English).

### Observability

- [ ] State-coverage matrix in Notes is the audit trail.
- [ ] Allure tags scenarios with `@gift-wall` + the state name for filtering.

## BDD Scenarios

**Scenario: Loading state visible at first render**

- **Given** a fresh user with `loading-controlled-fake` GiftRepository
- **When** the user navigates to the gift-wall screen
- **Then** the `gift_wall_loading` test tag is visible
- **And** the populated + empty tags are NOT visible

**Scenario: Populated state visible when gifts exist**

- **Given** a test persona with 5 received gifts (deterministic fixture)
- **When** the user navigates to the gift-wall screen
- **And** loading settles
- **Then** the `gift_wall_populated` test tag is visible
- **And** 5 gift items render

**Scenario: Empty state visible when user has no gifts**

- **Given** a fresh user with 0 received gifts
- **When** the user navigates to the gift-wall screen
- **And** loading settles
- **Then** the `gift_wall_empty` test tag is visible
- **And** the empty-state copy is shown (verified via R.string lookup)

## Test Plan

**Red:**
- Current state: read `gift_wall.feature` + `GiftWallScreen.kt` test tags + count `Scenario:` blocks for state coverage. Document gap.
- `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@gift-wall'` — currently passes with whatever scenarios exist; should NOT pass-by-passing-too-little.

**Green:**
- Add missing state scenarios to `gift_wall.feature`.
- Add missing test tags to `GiftWallScreen.kt`.
- Add fixture fakes for loading + empty states (probably in `app/src/androidTest/java/.../FakeGiftRepository.kt` if not present).
- Re-run BDD with `@gift-wall` filter — 3 state scenarios pass.

**Coverage gate:** 3 scenarios + 3 test tags verified by Cucumber + Espresso assertions.

## Out of Scope

- Refactoring `GiftWallScreen.kt` itself beyond test-tag additions.
- Adding new gift-wall feature work (filter/sort/etc.) — that's product scope.
- iOS XCUITest parity (file separate SHY if needed).
- Web parity — no gift-wall web equivalent.

## Dependencies

- Existing `gift_wall.feature` file (audit confirms exists per roadmap row).
- `GiftWallScreen.kt` composable in `shared/src/commonMain/.../feature/wallet/` or similar.
- Existing fake-repository infrastructure for controlled state injection.
- Cucumber-Android BDD runner config.

## Risks & Mitigations

- **Risk: feature file doesn't actually exist** despite roadmap claim. Mitigation: audit step first; pivot to feature-creation SHY if needed.
- **Risk: GiftWallScreen has no current test tags** (only id-based or text-based locators). Mitigation: add tags as part of this SHY; tiny one-liners.
- **Risk: loading state can't be observed without controlled fake.** Mitigation: extend FakeGiftRepository with `loadingDelay` parameter; default 0, scenarios set to 100ms.
- **Risk: scenarios become flaky due to animation timing.** Mitigation: explicit `onIdle()` after navigation.

## Definition of Done

- [ ] State-coverage matrix audit done + recorded in Notes.
- [ ] Missing scenarios added + test tags added.
- [ ] BDD runs pass.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:08 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 48 (G018). Reserved ID SHY-0046.
