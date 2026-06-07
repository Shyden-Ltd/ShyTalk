---
id: SHY-0030
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: XS
type: feature
roadmap_ids: [G039]
pr:
---

# SHY-0030: ios_parity_navigation.feature freshness check + update

## User Story

As the ShyTalk operator, I want **`app/src/androidTest/assets/features/ios_parity_navigation.feature` cross-checked against the current `SharedNavGraph.kt` route set and updated to reflect every route on both platforms**, so that the iOS-Android navigation parity BDD scenarios cover the current state of nav (not a stale snapshot from before recent feature additions).

## Why

The `ios_parity_navigation.feature` file exists but may be stale — it may not include routes added since it was last updated (e.g. `AgeVerificationSubmit` route added in commit `3345af70cb8` for the age-verif PR cluster; potentially others).

Roadmap row G039 (line 117 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟡 Polish. Journey — `ios_parity_navigation.feature` freshness. Location: `app/src/androidTest/assets/features/ios_parity_navigation.feature`. Gap: May not be updated post-SharedNavGraph. Fix: Read + cross-check against current SharedNavGraph destinations. Scope: XS.

P2 Tier-3 (kept at original priority). XS effort — quick audit + sync.

**Dependency**: ideally sequenced AFTER SHY-0024 (Android→SharedNavGraph migration) so the parity baseline IS that both platforms now use `SharedNavGraph` and the .feature reflects the unified route set.

## Acceptance Criteria

### Happy path

- [ ] Audit completed: a comparison table in PR description showing:
  - Column 1: every `Screen.X.route` declared in `Screen.kt`.
  - Column 2: whether it appears in `SharedNavGraph.kt`.
  - Column 3: whether it appears in `ios_parity_navigation.feature`.
- [ ] For every route present in `SharedNavGraph.kt` but missing from the .feature, a new BDD scenario is added covering: navigate to the route → assert screen renders → navigate back.
- [ ] For every route in the .feature but no longer in `SharedNavGraph.kt`, the scenario is removed (or marked obsolete with explanation).
- [ ] BDD scenarios use existing step-defs.
- [ ] `./gradlew connectedDevDebugAndroidTest --tests "*IosParityNavigation*"` passes on dev device.
- [ ] Manual run via `manual-qa-runner.js --feature ios_parity_navigation --device android` passes.

### Error paths

- [ ] If a route is reachable via deep-link only (not via nav): the .feature notes this explicitly OR omits with comment.
- [ ] If a scenario fails due to nav drift (route renamed): test failure surfaces the rename; fix at PR time.

### Edge cases

- [ ] Routes that take parameters (e.g. `Screen.Room.createRoute(roomId)`) covered with sample parameter values.
- [ ] Routes with conditional rendering (only shown if user is in a specific state) documented with the precondition in the scenario.
- [ ] Routes that are only Android-specific or iOS-specific noted (this .feature is for parity; non-parity routes excluded).

### Performance

- [ ] Full .feature runs in <10 minutes.
- [ ] Each scenario <60s.

### Security

- [ ] Navigation does not require any auth-token leakage in test logs.
- [ ] Test personas only.

### UX

- [ ] Navigation transitions asserted observable.
- [ ] Back-button behaviour asserted consistent.

### i18n

- [ ] Scenarios run against `en` default.

### Observability

- [ ] Allure attachments per scenario.
- [ ] Job summary lists pass/fail per scenario.

## BDD Scenarios

(Embedded examples; actual scenarios in .feature file.)

**Scenario: Navigate to AgeVerificationSubmit (newly added route)**

- **Given** test persona signed in
- **When** they trigger the age-verification flow (e.g. via Gacha gate, per SHY-0007's flow)
- **Then** navigation lands on `Screen.AgeVerificationSubmit.route`
- **And** the `AgeVerificationSubmitScreen` composable renders
- **And** back-nav returns to the prior screen

**Scenario: Every Screen.X.route is reachable**

- **Given** the comparison table in the PR description
- **When** every reachable route is exercised in the .feature
- **Then** all scenarios pass
- **And** no route is silently un-covered

**Scenario: Removed routes are removed from the .feature**

- **Given** a route was removed from `SharedNavGraph.kt` (hypothetical: `Screen.OldFeature.route` deleted)
- **When** the .feature is audited
- **Then** any scenario referencing it is removed
- **And** PR description notes the removal

## Test Plan (TDD)

### Red

1. Read `Screen.kt` and enumerate every `Screen.X.route`.
2. Read `SharedNavGraph.kt` and enumerate every `composable(...)` block.
3. Read `ios_parity_navigation.feature` and enumerate every navigation scenario.
4. Build the 3-column comparison table.
5. Identify gaps (routes missing from .feature) → those are the RED scenarios to add.

### Green

1. Add missing scenarios using existing step-defs (`navigate to "<route>"` etc.).
2. Remove obsolete scenarios.
3. Run on dev device → GREEN.

## Out of Scope

- **Refactoring nav graph structure** — only feature freshness.
- **Adding step-defs** — only reuse existing.
- **iOS-side instrumented tests** — out of scope.

## Dependencies

- **SHY-0024** — NavGraph migration (ideally lands first so both platforms use same graph).
- **SHY-0007** — gacha + age-verif features (provides flow for testing AgeVerificationSubmit route).
- Existing step-defs.

## Risks & Mitigations

- **Risk:** SHY-0024 hasn't landed; Android nav state is still split. **Mitigation:** can land independently of SHY-0024 by testing routes that exist on both NavGraph and SharedNavGraph today; defer SharedNavGraph-only routes (like AgeVerificationSubmit on Android) until SHY-0024 ships.
- **Risk:** Some routes require complex preconditions (e.g. owner state); scenarios become long. **Mitigation:** use shared persona setup in `Background:`.

## Definition of Done

- [ ] Comparison table in PR description.
- [ ] .feature file updated with all gaps closed.
- [ ] All scenarios pass on dev device.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`feature` → auto-merge + dev smoke).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; final route count in Notes.

## Notes (running log)

- 2026-06-07 ~21:25 BST — Refined under SHY-0032. Tier 3 freshness check.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I8` (G039).
