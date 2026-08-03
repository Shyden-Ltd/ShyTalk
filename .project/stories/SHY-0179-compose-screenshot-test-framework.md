---
id: SHY-0179
status: Cancelled
owner: claude
created: 2026-07-12
priority: P2
effort: M
type: infra
roadmap_ids: []
---

# SHY-0179: Adopt a JVM screenshot-test framework for shared Compose UI (Roborazzi)

## User Story

As a ShyTalk maintainer, I want automated screenshot/layout tests for shared Compose composables, so that visual bugs like the PreviewWatermark badge rendering under the status bar are caught by a RED test instead of by a human on a phone.

## Why

SHY-0095's R4 review confirmed a repo-wide framework gap: NO visual-regression tooling exists (zero paparazzi/roborazzi/screenshot-test references), and the Android instrumented Compose-rule path is broken for shell-composables (`PreviewWatermark.kt`'s own docstring documents the unresolved "No compose hierarchies found" failure). Net effect: the 2026-07-12 watermark safe-area fix — a real user-reported bug — shipped with no automated test in ANY framework, verified only by on-device journey walks. Every future shared-UI layout fix has the same blind spot.

## Acceptance Criteria

### Happy path
- [ ] Roborazzi (or equivalent JVM-only Compose screenshot runner chosen at pickup after a short spike) runs from `./gradlew` with no device/emulator.
- [ ] A `PreviewWatermark` screenshot/layout test exists asserting the badge's rendered top offset is >= an injected safe-area top inset (the SHY-0095 regression).
- [ ] Baseline images (or inset-geometry assertions if baselines are rejected for repo-size reasons) are deterministic across macOS + ubuntu CI.

### Error paths
- [ ] A deliberate layout regression (remove the `windowInsetsPadding` chain) turns the suite RED — proven once in the PR as the revert-check.

### Edge cases
- [ ] Zero-inset (no-notch device) renders the badge at the legacy 4.dp offset — pinned.
- [ ] RTL layout direction does not move the badge off-screen — pinned.

### Performance
- [ ] The screenshot suite adds <= 2 min to the JVM test lane (measured in the PR).

### Security
- N/A — test-only tooling; no runtime surface, no data handled.

### UX
- N/A — developer tooling; no user-facing change.

### i18n
- [ ] At least one screenshot case renders a long-locale string (de) to catch text-overflow in the badge.

### Observability
- [ ] CI uploads failing-diff images as workflow artifacts so a red run is diagnosable without local repro.

## BDD Scenarios

**Scenario: watermark badge respects the safe area**

- **Given** a Compose host with a simulated 59px top safe-area inset
- **When** the PreviewWatermark screenshot test renders the badge
- **Then** the badge's top edge is at or below 59px and the test passes
- **And** reverting the `windowInsetsPadding` fix makes this exact test fail

**Scenario: no-notch device keeps the legacy offset**

- **Given** a Compose host with zero safe-area insets
- **When** the badge renders
- **Then** its top offset equals the legacy 4.dp margin

**Scenario: CI failure is diagnosable**

- **Given** a screenshot test failing on CI
- **When** the workflow completes
- **Then** the run's artifacts contain the expected/actual/diff images for the failing case

## Test Plan

- RED: `shared/src/androidHostTest` (or the runner's canonical host source set) `PreviewWatermarkScreenshotTest.kt` — `badge clears injected top inset`, `badge keeps legacy offset at zero inset`, `badge survives RTL`, `badge fits long de strings` — all written before the framework wiring is complete, watched fail, then green.
- Revert-check: temporarily revert commit b24a91314aa's modifier chain locally → `badge clears injected top inset` must go RED (recorded in Notes).
- Frameworks: Kotlin JVM host tests (new lane), detekt, ktlint, CI lint. No device gauntlet impact (test-only PR except CI wiring), but the PR still runs the full non-device gauntlet per protocol.

## Out of Scope

- iOS-side screenshot testing (XCTest snapshot tooling) — separate follow-up once the JVM lane proves value.
- Migrating existing instrumented Compose tests to the new lane.
- Any behavioural change to PreviewWatermark itself.

## Dependencies

- None hard. Soft: SHY-0095 (merges the watermark fix this story pins).

## Risks & Mitigations

- **Baseline-image repo bloat** → prefer geometry assertions or store baselines under Git LFS/CI cache; the repo already has a 5MB large-file gate — decide at pickup, document in Notes.
- **Cross-OS rendering drift (macOS dev vs ubuntu CI)** → pin the runner's font/render config; if drift persists, assert geometry not pixels.
- **Compose Multiplatform version coupling** → pin the framework version compatible with the current CMP BOM; add to the update-sweep checklist.

## Definition of Done

- Framework runs headless in CI + locally; the four RED tests exist and are green; the revert-check is recorded; docs snippet in CLAUDE.md's Build & Test Commands; release cut with `released_in:` set.

## Notes (running log)

- 2026-07-12 — Filed from SHY-0095 R4 finding I6 (watermark safe-area fix had zero automated coverage in any framework; instrumented Compose path documented-broken for shell composables). Reviewer's concrete suggestion: Roborazzi, JVM-only, bypasses the broken instrumented path.
- 2026-07-20 — **CANCELLED — superseded by SHY-0215** (EPIC-0008 visual regression). SHY-0215's `visual-compose` sub-framework adopts the exact same JVM Roborazzi approach for shared Compose UI, and explicitly absorbs this story's scope: the PreviewWatermark safe-area regression (SHY-0095 R4 I6) is folded in as a `visual-compose` baseline. Discovered during the EPIC-0008 architect review (2026-07-20) — SHY-0215 was filed without cross-referencing this pre-existing ticket (check-existing-ticket slip); reconciled by superseding here. No work lost — 0215 delivers a strict superset.
