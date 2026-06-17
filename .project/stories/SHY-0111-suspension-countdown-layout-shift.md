---
id: SHY-0111
status: Draft
owner: claude
created: 2026-06-17
priority: P2
effort: S
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1449
mvp: false
---

# SHY-0111: Suspension-screen countdown clock jitters horizontally on each tick (layout instability)

## User Story

**As** a suspended user staring at the suspension screen waiting for my ban to end,
**I want** the countdown clock to stay visually still while it counts down,
**So that** the screen feels stable and trustworthy rather than twitchy — a jittering safety/compliance screen reads as broken.

## Why

Operator-reported (2026-06-17, real device): on the account-suspended screen the countdown clock's elements "move left and right on the screen as it's counting down." Elements must not move around. This is a visible UX defect on a Safety & Compliance surface (the suspension screen), which makes the moderation experience look unpolished/unreliable.

The clock is `CountdownClock` in `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/suspension/SuspensionScreen.kt` (rendered at `:195`, defined `:370-406`; per-segment rendering in `ClockSegment` `:408+`). It already *attempts* width stability — `ClockSegment` uses `FontFamily.Monospace` (`:419`) plus an invisible `"000"/"00"` placeholder `Text` (`:432`) to reserve each segment's width — so the regression is in the surrounding layout, not the digit glyph width. Three concrete suspects (the fix must confirm which apply; likely more than one):

1. **Conditional days segment (`:387` `if (days > 0)`).** The days `ClockSegment` + its `ClockSeparator` only render while `days > 0`. The parent `Row` uses `Arrangement.Center` (`:384`), so the moment `days` ticks to `0` the whole row loses two children and re-centres → a one-off horizontal jump (every day boundary, and immediately for sub-day suspensions).
2. **`AnimatedContent` per-tick size animation (`:436-442`).** Animated segments (`animate=true` for days/hours/minutes/seconds) wrap the digit in `AnimatedContent`, whose default `SizeTransform` animates the container size during each swap; if the animated content is measured outside the placeholder's fixed box, neighbours reflow every tick.
3. **Millisecond segment (`:397-404`).** `millis` (`animate=false`) is repainted ~every frame by the update loop (`:168-178`); any width instability there drives constant horizontal churn, and millisecond granularity on a multi-day countdown is itself questionable UX (flicker/noise) worth reconsidering as part of the fix.

## Acceptance Criteria

### Happy path
- [ ] While the suspension countdown is actively ticking (seconds + milliseconds updating), every clock segment and the whole `Row` stay at a **constant horizontal position** — no left/right movement of any element between ticks, on the real OnePlus CPH2653.
- [ ] The fix keeps the existing monospace digits + reserved-width placeholders; segment widths remain fixed regardless of the digit value (e.g. `1`→`0`, `09`→`10`, `099`→`100`).

### Error paths
- [ ] N/A — purely presentational; the countdown introduces no error states. (The existing `countdownExpired`/banned branches at `:120/:145/:282/:292` are unchanged; switching into the expired state must itself not jitter — covered under Edge cases.)

### Edge cases
- [ ] **Day boundary:** when `days` transitions to `0` and the days segment is removed (`:387`), the remaining segments do not jump — the layout reserves stable space (e.g. the row is anchored start/fixed-width, not re-centred), OR the days segment is always rendered/space-reserved while a suspension is active.
- [ ] **Digit-count change:** hours/minutes/seconds crossing `9→10` and milliseconds `99→100` cause no reflow (placeholder already reserves the max width — assert it holds after the fix).
- [ ] **Expiry transition:** when `remainingMs` reaches 0 and the UI swaps to the expired/"sign in" state (`:178-179`, `:282`, `:354`) there is no horizontal jump of surrounding content.
- [ ] **Long suspensions:** `days > 99` (3-digit day count) renders without shifting neighbours.

### Performance
- [ ] The per-tick recomposition (1s for seconds, sub-second for millis) does not trigger a re-measure/re-layout of sibling segments — only the changed digit's own content recomposes; no visible jank or width animation on neighbours.

### Security
- [ ] N/A — presentational only; no data, auth, or PII involved.

### UX
- [ ] The clock is visually stable (the operator's core ask: "elements shouldn't move around").
- [ ] Decide + document whether the **millisecond segment** belongs on a days-scale countdown; if retained it must be flicker-free and width-stable, if removed the layout stays balanced.

### i18n
- [ ] Time-unit labels (`time_unit_day/hour/minute/second/millisecond`) stay localised; the fix anchors on layout/width, not on any English-specific assumption.
- [ ] **RTL** (Arabic) and locales with **Arabic-Indic / wide digit shaping** keep the clock width-stable and correctly mirrored — no horizontal drift introduced by the fix.

### Observability
- [ ] N/A — pure UI presentation; no new logging/metrics warranted.

## BDD Scenarios

**Scenario: countdown stays horizontally fixed while ticking**
- **Given** Raul is on the suspension screen with an active multi-day suspension (`endDate` in the future)
- **When** the countdown ticks across several seconds (and milliseconds repaint continuously)
- **Then** the on-screen x-position of every clock segment (days/hours/minutes/seconds/millis blocks + separators) is unchanged between frames
- **And** no element moves left or right

**Scenario: crossing a day boundary does not jump the layout**
- **Given** the countdown shows `days = 1` with the days segment + separator visible
- **When** the remaining time crosses below 24h and `days` becomes `0` (days segment removal path, `:387`)
- **Then** the remaining hours/minutes/seconds/millis segments do not shift horizontally

**Scenario: expiry transition is stable**
- **Given** the countdown is at a few seconds remaining
- **When** `remainingMs` reaches 0 and the screen swaps to the expired state (`:178-179`, `:282`)
- **Then** surrounding content does not jump horizontally during the swap

**Scenario: RTL locale countdown is layout-stable**
- **Given** the device locale is Arabic (RTL) on the suspension screen
- **When** the countdown ticks
- **Then** the clock is correctly mirrored and every segment stays at a fixed position (no per-tick horizontal drift)

## Test Plan

Touches `shared/.../feature/suspension/SuspensionScreen.kt` (Compose, commonMain) → **full Pre-Merge Testing Protocol** (Kotlin layers + real-device). Real device/stack only (No Stubs / Real Only).

**Red (before):**
- A Compose UI test (`shared/src/android... ` / `app/src/androidTest/.../suspension/SuspensionScreenLayoutStabilityTest.kt`) that renders `CountdownClock`/`SuspensionScreen` with a fixed `endDate`, advances the clock across ticks (including a day-boundary and a 9→10 digit change), and asserts each segment's `onNode(...).getBoundsInRoot().left` is **constant** — fails today because the day-segment removal and/or `AnimatedContent` size animation shift positions.
- Manual real-device repro: open the suspension screen on the OnePlus CPH2653 and observe the horizontal jitter while counting down.

**Green (after — per framework):**
- **Kotlin/Compose UI** — the layout-stability test passes: segment x-positions constant across ticks, day-boundary, digit-count change, and expiry transition.
- **Kotlin unit** (`./gradlew :shared:jvmTest`) + **iOS shared compile** (`./gradlew :shared:compileKotlinIosArm64`) green (the screen is commonMain → must compile for iOS too).
- **detekt / ktlint / lint** clean.
- **THE REAL PROOF (device gauntlet)** — the suspension screen on the real OnePlus CPH2653 shows a visually-still countdown while ticking (operator-confirmable), across an RTL locale spot-check.

## Out of Scope

- Any change to suspension *logic* (durations, appeal flow, eviction cascade) — those are SHY-0105/0106/0107 / `admin-users.js`. This is presentation-only on `SuspensionScreen.kt`.
- The separate warning-screen / appeal-field apparatus work (SHY-0101).
- Restyling the countdown beyond what's needed for layout stability (colour/typography redesign is not requested).

## Dependencies

- None functional. Touches only `SuspensionScreen.kt` (+ a new Compose UI test). Verified on the real OnePlus CPH2653 + local stack ([[reference-local-stack-runner-setup]]); persona P-08 seeded into a suspended state to reach the screen.

## Risks & Mitigations

- **Risk:** a fixed-width row breaks on small/low-res screens or long localized unit labels (German/Russian) by clipping. **Mitigation:** reserve width per *digit block* (not the labels) and let labels wrap/scale; test a long-word locale + low-res per the project's proportional-sizing constraint.
- **Risk:** removing the days segment at the boundary still re-centres. **Mitigation:** anchor the row layout (fixed slots / always-reserve the days slot while suspended) rather than `Arrangement.Center` over a variable child count.
- **Risk:** disabling `AnimatedContent` size animation removes the digit roll effect. **Mitigation:** keep the vertical slide but constrain it to the placeholder's fixed box (no size transform), preserving the animation without reflow.

## Definition of Done

- All AC checkboxes verified; the 4 BDD scenarios pass at the appropriate layer.
- New Compose layout-stability test added (asserts constant segment positions across ticks/boundary/expiry) — RED before, GREEN after.
- Full local gauntlet green (`:shared:jvmTest`, `:shared:compileKotlinIosArm64`, detekt, ktlint, lint) → `code-reviewer` 100% clean → push → CI green → DEV gauntlet on the real OnePlus showing a still countdown → judgment-merge.
- `released_in:` set on the release that ships it.

## Notes

- 2026-06-17 ~09:55 BST — Filed from an operator real-device observation during the SHY-0101 j11 supervised device session: "on the account suspended screen the countdown clock's elements move left and right as it's counting down; elements shouldn't move around." Grounded against the live `SuspensionScreen.kt` `CountdownClock`/`ClockSegment` (file:line refs above) at file time. Classified `bug` / P2 / S (visual layout-stability fix on a compliance screen; countdown still functions, so not functionally blocking — operator to bump priority/`mvp:true` if it's launch-blocking under the Minimum-Lovable bar). Not yet picked up (Draft); separate `.md`-only PR, independent of SHY-0101.
