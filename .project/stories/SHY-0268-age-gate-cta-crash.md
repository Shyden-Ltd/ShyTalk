---
id: SHY-0268
status: In Progress
owner: claude
created: 2026-08-03
priority: P0
effort: M
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0268: The 18+ "Verify now" button closes the app on Android

## User Story

As a member who is old enough to use ShyTalk but has not had an ID approved yet,
I want the "verify now" offer on every blocked feature to actually open verification,
So that I am never dead-ended — or closed out of the app entirely — at the moment I try to comply.

## Why

Reported by the operator during manual testing on 2026-08-03: opening a room worked, but
spinning the gacha raised the age-verification message and *continuing from it closed the app
entirely*.

Root cause is structural, not behavioural. ShyTalk carries two coexisting navigation graphs
(SHY-0024 tracks collapsing them): `SharedNavGraph.kt` drives iOS, and
`app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt` drives Android — `MainActivity`
mounts the latter. Commit `5ab732a6c3f` wired the gacha age gate's CTA into **both** graphs but
registered the destination in **one**. Navigation-Compose throws `IllegalArgumentException` for
an unregistered route; uncaught on the main thread, the process dies.

The same drift produced a second, quieter defect: `RoomScreen` and `PrivateChatScreen` declared
`onNavigateToAgeVerification` with a `= {}` default, so the call sites that never passed it
compiled cleanly and shipped a button that does nothing. Three surfaces were affected — the
full-screen private chat on Android, the group chat, and the in-room PM bottom sheet on both
platforms.

This is launch-blocking: the age gate is a UK OSA / App Store 18+ compliance surface, and its
only escape hatch was crashing or inert.

## Acceptance Criteria

### Happy path
- [ ] Tapping "verify now" on the gacha age wall opens the verification flow on Android and iOS
- [ ] The same offer in a private chat, and in the room's message panel, opens the same flow
- [ ] A member can complete a submission started from the wall, without returning to their profile

### Error paths
- [ ] No navigation destination is ever reachable-but-unregistered in either navigation graph
- [ ] Dismissing the wall returns the member to where they were, with no coins spent

### Edge cases
- [ ] A member under 18 is offered support and is never routed into the verification flow
- [ ] The wall appearing does not charge coins, on any surface, before it is resolved

### Performance
- [ ] N/A — no new work on any hot path; the change registers one destination and passes one
      callback. Navigation cost is unchanged.

### Security
- [ ] The spin is still refused by the server when the on-screen wall is bypassed — the message
      is UX over a real server-side gate, not the gate itself
- [ ] No age-gate decision moves to the client as part of this fix

### UX
- [ ] The member is never shown a button that does nothing
- [ ] The app never closes as a result of accepting a compliance prompt

### i18n
- [ ] N/A — no new user-facing strings. The verification screen and wall reuse the existing
      `age_restriction_*` / `age_verif_*` keys already present in all 20 locales.

### Observability
- [ ] A future graph drift fails a host-JVM test by name, before any device is involved

## BDD Scenarios

**Scenario: Accepting the age offer opens verification instead of closing the app**

- **Given** a member is old enough but has never had an ID approved
- **When** they try to spin the gacha and choose to verify now
- **Then** the start of the age-verification flow opens
- **And** the app stays open

**Scenario: The same offer in private messages leads to the same place**

- **Given** a member has been stopped by the age wall in a private chat
- **When** they choose to verify now
- **Then** the start of the age-verification flow opens

**Scenario: Declining the offer costs nothing**

- **Given** a member has been stopped by the age wall on the gacha
- **When** they dismiss it
- **Then** they are back in the room with their coins untouched

**Scenario: A member under 18 is never routed into verification**

- **Given** a member is under 18
- **When** they try to spin the gacha
- **Then** they are told they cannot spin and are offered support
- **And** they are never offered the chance to verify

**Scenario: The spin is refused even when the wall is bypassed**

- **Given** a member is old enough but has never had an ID approved
- **When** a spin is requested without passing the wall
- **Then** the spin is refused and their coins are untouched

## Test Plan

**Red first** (all authored before the fix; 7 of 9 failed for the exact defect):

- `shared/src/jvmTest/.../navigation/NavGraphDestinationCompletenessTest.kt` — whole-graph
  invariant over BOTH graphs: every `navigate(Screen.X)` target must be registered in the same
  graph. RED reported `navigates to destination(s) it never registers: [AgeVerificationSubmit]`.
  Includes a parser self-guard (≥20 destinations) so a regex drift cannot make it vacuously green.
- `shared/src/jvmTest/.../navigation/AgeVerificationCtaWiringPinTest.kt` — pins that neither
  `RoomScreen` nor `PrivateChatScreen` re-introduces a `= {}` default for the CTA, and that the PM
  bottom sheet declares and forwards it to both of its chat views.
- `app/src/androidTest/.../journey/AgeVerificationNavigationTest.kt` — device-level: the
  destination resolves as a start destination, AND a live `NavController.navigate(...)` at runtime
  reaches the screen (the exact call the CTA makes; start-destination resolution and runtime
  navigate are different code paths and only the latter crashed).
- `journey-tests/j21-age-gate-cta.feature` — cross-platform journey covering every surface that
  renders the wall, on Android and iPhone, plus the sub-18 cohort and the server-side refusal.

**Green** — `./gradlew :shared:jvmTest` (9/9 new tests pass, 0 skipped), `:app:compileDevDebugKotlin`,
`:shared:compileKotlinIosArm64`, detekt, ktlint.

**Device gauntlet** — OWED. Both devices were unavailable when this was written; the Android and
iOS journey walks must run before this leaves In Review.

## Out of Scope

- Collapsing the two navigation graphs into one — that is SHY-0024 (P0, Draft), of which this
  crash is one symptom. This story fixes the defect and installs the invariant that makes the
  remaining coexistence safe.
- Making `j21` executable end-to-end: the journey corpus runner has no matchers for its
  declarative steps yet, and no way to assert "the app is still open". Tracked as follow-up.
- The wider Gherkin-shape sweep of the existing corpus (6-step cap) — same-branch, tracked in
  Notes, not part of this defect's fix.

## Dependencies

- None. The verification screen, its ViewModel, the repository and all 20 locales' strings
  already shipped (PR 9); only the Android graph registration and the callback wiring were missing.

## Risks & Mitigations

- **Risk:** removing the `= {}` defaults breaks an unknown call site.
  **Mitigation:** the compiler is the enforcement — `:app:compileDevDebugKotlin` and
  `:shared:compileKotlinIosArm64` both pass, which proves all six host call sites are wired.
- **Risk:** the source-parsing invariant test drifts from the source format and goes green
  vacuously. **Mitigation:** it asserts a minimum parsed-destination count and strips comments
  before matching, so a commented-out `navigate(...)` cannot manufacture either verdict.
- **Risk:** the crash exists on other unregistered routes.
  **Mitigation:** the invariant was run across both graphs — `AgeVerificationSubmit` was the only
  one, on either platform.

## Definition of Done

- [ ] All nine host-JVM tests green; both compile targets clean; detekt + ktlint clean
- [ ] Android journey walked on the real device: gacha wall → verify now → flow opens, app alive
- [ ] iOS journey walked on the real iPhone: same route
- [ ] DM and in-room PM sheet walls walked on Android
- [ ] Dev gauntlet green on the unmerged branch, then judgment-merge
- [ ] `released_in:` set at the next release cut

## Notes (running log)

- **2026-08-03 07:0x BST** — Operator report during manual QA of the dev deployment: room opens
  and stays connected; spinning the gacha raises the age dialog; continuing closes the app.
- **2026-08-03 07:1x BST** — Root cause established mechanically, not by inspection: diffing
  navigated-vs-registered routes gave Android 28 registered / 26 navigated with exactly one
  unregistered (`AgeVerificationSubmit`), and shared 30 / 26 with none. Defect confirmed present
  on `develop`, introduced by `5ab732a6c3f`.
- **2026-08-03 07:2x BST** — RED confirmed for the right reason before any fix (assertion message
  named `[AgeVerificationSubmit]`); the two shared-graph tests passed throughout, which proves the
  parser was not failing everything indiscriminately.
- **2026-08-03 07:5x BST** — Fix + tests green. Device gauntlet OWED (devices unavailable).
- Deferred to follow-up: journey-runner support for `j21`'s declarative steps and an
  "app is still open" liveness assertion; the corpus-wide 6-step Gherkin sweep.
