---
id: SHY-0095
status: Draft
owner: claude
created: 2026-06-13
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0095: Extend `ios-appium-driver` to full real-iPhone native-journey coverage

## User Story

**As** the Pre-Merge gauntlet's canonical real-iPhone native cell,
**I want** `ios-appium-driver.js` to implement every method the designated native-iOS journey corpus invokes — starting with the 6 `iosShows*` presence-checks that today fall through to the fail-loud stub,
**So that** native-iOS user journeys run for real on a real iPhone via Appium + WebDriverAgent (no `return false` placeholders), giving the matrix a genuinely-operational iOS-native cell instead of a partial one.

## Why

EPIC-0003's evidence pass found `ios-appium-driver.js` (419 lines) has **5 real methods** (`iosLaunchApp`, `iosUiDump`, `iosTap`, `iosTapByTag`, `iosPersonaSignIn` + `close`) but its **6 `iosShows*` presence-checks fall through the stub-registration loop** (line 394: "any iosShows* that doesn't have a real [impl]" → `return false`). The header even claims they *"delegate to iosUiDump + iosTapByTag … regex over the XCUITest XML tree"* — aspirational, not real (the inverse-stub hazard that SHY-0092 flags and this story actually resolves by making it true). The operator chose Appium + WebDriverAgent as the canonical real-iPhone native path (2026-06-13), so this driver — not devicectl/simctl — must reach full journey coverage. `android-adb-driver.js` (2560 lines, ~79 methods) is the parity reference for what "real" looks like.

## Acceptance Criteria

### Happy path
- [ ] Each of the 6 `iosShows*` checks (`iosShowsRoomScreen`, `iosShowsParticipantsList`, `iosShowsSeatGrid`, `iosShowsMicIcon`, `iosShowsToast`, `iosShowsRoomClosedSummary`) is a **real** implementation that reads the live `iosUiDump()` XCUITest XML and returns the correct boolean for the on-device UI — no fall-through to the `return false` stub.
- [ ] Every native-iOS journey designated for the iOS-native cell **passes on a real iPhone** via Appium against the real ShyTalk app + real backend (local stack).
- [ ] `listMethods()` reports **no journey-required method as unimplemented** — i.e. every method the designated journey corpus invokes has a real override (not the fail-loud fallback).

### Error paths
- [ ] A presence-check against a UI that genuinely **lacks** the element returns `false` because the element is truly absent in the real XML — induced by a **real seeded state** (e.g. a seeded empty participants list, a room not yet entered), NOT a mocked dump (per CLAUDE.md § No Stubs).
- [ ] A journey step that fails surfaces a real finding carrying the failing locator + an XCUITest XML excerpt (and the framework's screenshot-on-fail), not a silent false.
- [ ] If `iosUiDump()` itself fails (WDA session lost), the presence-checks surface that root error loudly rather than returning a misleading `false`.

### Edge cases
- [ ] **Enumeration (first, evidence-first):** the exact set of iOS methods the designated native-iOS journey corpus invokes is derived from the runner's iOS matchers + journey corpus and recorded; the 6 known stubs are the confirmed floor. Any method a designated journey needs **beyond** the current `IOS_METHOD_NAMES` (11) is added to the constant **and** implemented — no journey is silently skipped for a missing method.
- [ ] The header's aspirational "delegates to iosUiDump … regex over the XCUITest XML tree" comment becomes **true** (the implementation matches the claim — closing the inverse-stub hazard for this file).
- [ ] Presence-check regexes match the iOS app's **actual** XCUITest accessibility labels/types (verified against a real dump), and are resilient to benign attribute ordering (not brittle to whitespace/attribute order).
- [ ] If the enumeration reveals the surface is dramatically larger than the 11-method contract (approaching android-adb's ~79), the story **splits** with operator visibility rather than silently ballooning (recorded in Notes; per [[feedback-no-skeleton-stories-fully-refined]] a right-sized follow-up beats an unbounded one).

### Performance
- [ ] `iosUiDump()` (XCUITest source) is reused within a single matcher step where multiple presence-checks run against the same UI state (the XML source dump is the expensive call) — bounded per-cell wall-clock comparable to the Android native cell's per-journey timing.

### Security
- [ ] `iosPersonaSignIn` uses **real test personas** (`PERSONAS_PASSWORD` from `~/.shytalk/dev-personas.env`) with no credential values logged; the Appium/WDA channel is localhost-only.

### UX
- [ ] The "consumer" is a QA reader of the iOS-native cell result: a journey result is a real pass/fail with the failing element + XML context — never an empty stub-`false` that looks like a real check but proves nothing.

### i18n
- [ ] Presence-check matching is validated against the app's labels in the test locale; any reliance on a specific localized string is documented (so a locale switch does not silently break a check) — the iOS app's accessibility identifiers are preferred over visible text where available, to stay locale-stable.

### Observability
- [ ] Per-journey iOS results are recorded with the XCUITest XML excerpt on failure (the framework's existing screenshot-on-fail + per-cell log), so a reader diagnoses a failure without re-running.

## BDD Scenarios

**Scenario: a presence-check is real (true case)**
- **Given** a real iPhone in a room with a populated seat grid
- **When** `iosShowsSeatGrid()` runs
- **Then** it reads the real `iosUiDump()` XML and returns `true`
- **And** it does not fall through to the `return false` stub

**Scenario: a presence-check is real (false case, real induced absence)**
- **Given** a real seeded state where the participants list is empty
- **When** `iosShowsParticipantsList()` runs against the real UI
- **Then** it returns `false` because the element is truly absent
- **And** the `false` came from a real dump, not a mock

**Scenario: full designated journey passes on a real iPhone**
- **Given** the local stack is healthy and a real iPhone is connected (Appium auto-started per SHY-0094)
- **When** a designated native-iOS journey runs end-to-end
- **Then** every invoked iOS method has a real implementation
- **And** the journey passes against the real app + real backend

**Scenario: a journey-required method beyond the 11 is added, not skipped**
- **Given** the enumeration finds a designated journey needs a method not in `IOS_METHOD_NAMES`
- **When** the driver is extended
- **Then** that method is added to the constant and really implemented
- **And** no journey is silently skipped for a missing method

## Test Plan

Touches `ios-appium-driver.js` (+ possibly the runner's iOS matchers) → **runs the FULL Pre-Merge Testing Protocol** on a **real iPhone** (Appium + WebDriverAgent). Real app + real backend (local stack) per CLAUDE.md § No Stubs — the `false` paths are induced by real seeded UI states, never mocked dumps.

**Red → Green (framework by framework):**
- **Express/Node (Jest)** `cd express-api && npm test`:
  - **Value matrix per `iosShows*`** in `tests/scripts/drivers/ios-appium-driver.test.js`: for each of the 6 checks, a true-case (real XML fixture captured from a real device exhibiting the element) and a false-case (real XML from a seeded-absent state) → assert the **exact boolean** each way. RED before implementation (the stub returns `false` for the true-case). (Fixtures are real captured dumps, used as the deterministic input to the pure regex layer; the live-device proof is the gauntlet leg below — no synthetic/mocked UI.)
  - **Coverage assertion:** `listMethods()` ∩ {methods the designated journey corpus invokes} has **no fall-through stub** — every journey-required name has a real override (the AC-traceability "no silent skip" guard).
  - `driver-contract.test.js`, `driver-interface-pin.test.js` updated for any added `IOS_METHOD_NAMES` entries and green.
- **eslint** `npm run lint` → 0 warnings.
- **Device gauntlet (Phase 1 LOCAL):** the designated native-iOS journeys run **green on the real iPhone** via Appium (server auto-started per SHY-0094); the true/false presence behaviour is confirmed live against real seeded states; full-corpus iOS-native run at the gate.
- **Phase 2:** `code-reviewer` 100% clean → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate). The pure regex layer is CI-testable from captured fixtures; the live-iPhone journeys are local-only (no real device in CI — noted in PR).
- **Phase 3 (DEV):** re-run the iOS-native journeys on dev against the real iPhone (web = Chrome).

## Out of Scope
- `ios-devicectl` / `ios-simctl` UI inspection (non-canonical per EPIC-0003 — SHY-0092 documents them as such; they are not completed here).
- The runner's Appium server lifecycle (SHY-0094 — this story assumes a healthy server).
- Web-mobile iOS cells (Safari/WebKit) — already operational; this is the **native app** path.

## Dependencies
- **SHY-0094** (runner Appium auto-start + health-check) — this story's journeys assume a healthy Appium server.
- A **real iPhone** connected + trusted, `WDA_TEAM_ID` set + WebDriverAgent signed (SHY-0026 `setup-ios-wda.sh`); Appium + `@appium/xcuitest` installed.
- The local stack (`local/start.sh` + `npm run local`) as the real backend; real test personas (`~/.shytalk/dev-personas.env`).
- `android-adb-driver.js` as the parity reference for journey coverage shape.

## Risks & Mitigations
- **Risk:** the journey surface is far larger than 11 methods → unbounded scope. **Mitigation:** the enumeration AC bounds it up front; if it balloons toward android-adb's ~79, the story splits with operator visibility rather than silently growing.
- **Risk:** presence-check regexes are brittle to localized text or attribute order. **Mitigation:** prefer accessibility identifiers over visible text; validate against a real dump; assert order-insensitivity in the value-matrix tests.
- **Risk:** captured XML fixtures drift from the real app over time. **Mitigation:** the fixtures feed only the pure regex layer for fast RED/GREEN; the binding proof is the live-iPhone gauntlet leg, which re-validates against the real app every run.
- **Risk:** `false` cases accidentally tested via a mocked dump (No-Stubs violation). **Mitigation:** false cases use **real seeded-absent states** on the device for the gauntlet leg; fixtures are real captures, never fabricated.

## Definition of Done
- [ ] All 6 `iosShows*` checks real (live XCUITest XML); enumeration complete; every journey-required iOS method implemented (no fall-through stub for a designated journey); header comment now accurate.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): per-check value-matrix Jest RED→GREEN + coverage assertion + contract/pin tests green + eslint 0 → LOCAL gauntlet runs the designated native-iOS journeys **green on the real iPhone** (true/false presence confirmed against real seeded states) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green on the real iPhone → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-13 — Filed under EPIC-0003 (child build-order item **C**, the substantive one). Evidence at filing: `IOS_METHOD_NAMES` has 11 names; real overrides exist for `iosLaunchApp`/`iosUiDump`/`iosTap`/`iosTapByTag`/`iosPersonaSignIn`/`close` (lines 203/231/245/278/322/406); the 6 `iosShows*` fall through the stub loop (line 394) → `return false`; header lines 60–64 claim a delegation that doesn't exist yet. android-adb (2560 lines, ~79 methods) is the parity reference. The exact "full coverage" method set is **evidence-derived in the enumeration AC**, not guessed — the 6 stubs are the confirmed floor.
