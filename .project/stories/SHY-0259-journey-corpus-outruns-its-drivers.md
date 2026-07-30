---
id: SHY-0259
status: In Progress
owner: claude
created: 2026-07-30
priority: P1
effort: XL
type: infra
roadmap_ids: []
epic: EPIC-0003
---

# SHY-0259: The journey corpus asks for steps and driver methods that were never built

## User Story

**As a** developer using the gauntlet to decide whether a change is safe to merge
**I want** every step the journey corpus writes to be executable
**So that** a red cell means the product is broken, rather than meaning the harness cannot perform the step.

## Why

Surfaced 2026-07-30 from gauntlet run `20260730-130954-local`, the first run
able to report honestly (SHY-0255 fixed cells that hung being recorded as
passes, so this is the first complete picture of the corpus in a long time).

The chromium cell ran all 20 feature files — 226 scenarios — and produced 211
findings. Triaged:

| Cause | Count |
|---|---|
| Android app parked on its degraded screen (APK built without `-PlocalHost`) | 109 |
| `STEP_NOT_IMPLEMENTED` — the corpus uses a Gherkin step with no matcher | 42 |
| `ctx.webDriver.*` / `ctx.uiDriver.*` **not configured** | ~24 |
| `stub:web*` — a matcher exists but its driver method is a placeholder | 5 (64 occurrences) |
| OSA invariant violated (cross-cohort followingIds) | 6 |

The 109 were a real environment defect and are fixed. **The rest is harness
debt**: the corpus was written ahead of the drivers, so a large share of it can
never pass regardless of product state.

Concretely, the missing pieces fall into three groups:

- **Driver methods that are declared but not configured** — `iosOpenScreen`
  (7 uses), `iosTypeText`, `iosAcceptLegalAndContinue`, `iosTapUserCard`,
  `iosSearchIn`, `iosShowsNamedKind`, `iosNetworkLinkConditioner`,
  `iosNetworkDropFor`; `webSignIn`, `webAdminOpenTab`, `webAdminOpenSubtab`,
  `webOpenUserProfile`, `webSendGiftTo`, `webCloseModalViaX`, `webSetNetwork`,
  `webOpenWithNetwork`, `webGetFieldAlignment`, `webBalanceUsesLocaleSeparator`,
  `webAdminDetectLabelLanguage`, `injectApiLatency`,
  `injectApiFailureThenSuccess`; `androidSignupWithDOB`,
  `androidShowsTranslationOf`, `androidPickTestImageBySize`.
- **Placeholder `stub:` implementations** — `webAdminShowsDashboardCounters`
  (59 occurrences on its own), `webAdminIssueWarning`,
  `webShowsNonEmptyLocaleText`, `webOpenProfilePanel`, `webFallbackEnStrings`.
  These are worse than a missing method: the matcher resolves, so the step is
  reached and then announces it does nothing.
- **Gherkin steps with no matcher at all** — setup Givens dominate
  (`has the local-flavor APK installed on Android`, `is a participant in Bao's
  lesson room`, `has signed in with locale=de`, `is on the warning screen with
  hasActiveWarning=true`).

## Acceptance Criteria

### Happy path

- [ ] Every Gherkin step used anywhere in `journey-tests/*.feature` resolves to a matcher — zero `STEP_NOT_IMPLEMENTED` across the corpus.
- [ ] Every driver method a matcher calls is implemented on every surface the matrix runs it on — zero "not configured".
- [ ] Zero `stub:` placeholders remain; each drives its real surface.

### Error paths

- [ ] A step whose driver genuinely cannot run on a surface (a capability the platform lacks) is declared unsupported for that cell explicitly, with a reason, rather than failing as "not configured".
- [ ] A driver method that fails at runtime reports WHICH method and WHICH surface, so a red cell is attributable without opening a screenshot.

### Edge cases

- [ ] Setup `Given`s that describe prior state seed that state directly rather than replaying UI, so a broken UI step cannot cascade into dozens of unrelated failures.
- [ ] The corpus cannot grow a new unmatched step: a check enumerates every step and fails on any with no matcher.

### Performance

- [ ] The check that every step resolves runs in seconds and needs no device — it is a static pass over the corpus plus the matcher table, so it can gate a PR.

### Security

- [ ] N/A — test-harness only; no product surface, no credentials beyond the persona secrets already in use.

### UX

- [ ] N/A — developer-facing harness.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The matrix report distinguishes "product failed" from "harness could not perform the step", so the two are countable separately.

## BDD Scenarios

**Scenario: a red cell means the product is broken**
- **Given** a journey step the harness can perform
- **When** the product misbehaves
- **Then** the cell fails and names the product behaviour

**Scenario: the harness admits when it cannot act**
- **Given** a journey step whose driver method is not implemented on this surface
- **When** the cell runs
- **Then** it is reported as a harness gap, counted separately from product failures

**Scenario: the corpus cannot outrun the drivers again**
- **Given** a new feature file using a step with no matcher
- **When** the step-coverage check runs
- **Then** it fails before any device time is spent

**Scenario: setup does not cascade**
- **Given** a scenario whose Given establishes prior state
- **When** that state is seeded directly rather than driven through the UI
- **Then** a UI regression elsewhere cannot turn one failure into thirty

## Test Plan

**RED first** — a step-coverage check (`scripts/check-journey-step-coverage.js`,
new) that parses every `journey-tests/*.feature`, resolves each step against the
matcher table exported by `manual-qa-runner.js`, and fails listing any
unmatched step. It starts RED with the ~42 unmatched steps as its baseline and
ratchets DOWN, exactly like `check-test-defects.js`.

A companion check enumerates every driver method the matchers call and fails on
any that is absent or `stub:`-prefixed for a surface the matrix runs.

Then, per driver method, a real test against the real surface — the emulator
stack for web, the real Android device and the real iPhone for the app
surfaces. No doubles.

**GREEN:** implement the missing matchers and driver methods, converting
`stub:` placeholders to real drivers.

**Mutation checks:** removing a matcher must fail the coverage check; renaming a
driver method must fail the driver check; re-introducing a `stub:` prefix must
fail.

## Out of Scope

- The 109 degraded-app failures — an environment defect, already fixed by
  rebuilding with `-PlocalHost=localhost` and now prevented by a launcher
  precondition.
- The 6 OSA cross-cohort `followingIds` findings — a data/product issue with its
  own diagnosis.
- Rewriting the corpus. The journeys are the specification; this story makes
  them executable.

## Dependencies

- SHY-0255 (honest cell exit codes) — without it the corpus could not be
  measured at all, because hung cells reported as passes.

## Risks & Mitigations

- **Risk:** the work is large enough to stall behind a single hard driver method.
  **Mitigation:** the ratcheting baseline means partial progress lands and
  holds; the corpus cannot regress while the backlog is worked down.
- **Risk:** implementing a driver method badly makes a cell pass without really
  exercising the surface — trading a visible gap for an invisible one.
  **Mitigation:** each method gets a real test against the real surface, and
  `check-test-defects.js` already refuses assertion-free tests.
- **Risk:** the count moves as more of the corpus becomes reachable — steps
  beyond a previously-failing one surface new gaps.
  **Mitigation:** expected; the baseline is re-taken from the first fully
  honest run rather than from this triage.

## Definition of Done

- [ ] Step-coverage and driver-coverage checks exist, run in CI, and are at 0.
- [ ] No `stub:` placeholders remain in the driver surface.
- [ ] A full local matrix distinguishes product failures from harness gaps.
- [ ] Mutations killed.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-30 — **Step coverage reached 0.** `scripts/check-journey-step-coverage.js`
  (new, CI-gated) resolves every step in `journey-tests/*.feature` against the
  runner's own exported matcher table and annotation-stripper. It started at 68
  distinct unmatched steps / 94 occurrences and now reports 0 of 1,244 steps
  across 20 feature files. The baseline ratchets down only.

  The earlier estimate of "~42 unmatched" was a floor, not a total: 109
  scenarios died on their first step in run `20260730-130954-local`, so
  anything behind them was never reached. Measured statically, the real figure
  was 68.

- 2026-07-30 — Setup Givens drive the **real production routes** rather than
  mirroring their writes. Mirroring creates a second implementation that
  drifts, and j11 was the proof: it asserts `users/<id>.suspendedUntil`, a
  field the product has never written (production uses `isSuspended` +
  `suspensionEndDate`). Driving the route makes the state correct by
  construction and self-verifying — `POST /api/appeals` returns 400 unless the
  caller is genuinely suspended, so the appeal Given passing is independent
  evidence that the suspension Given did real work.

- 2026-07-30 — **Driver coverage is the remaining half, and it is larger than
  this story estimated.** `scripts/check-driver-coverage.js` (new, CI-gated)
  parses each driver with acorn and finds **178** methods declared in
  `listMethods()` but never implemented, of which **169** have a call site in
  the runner. The story guessed ~24 because it counted only what the last run
  reached before dying. Split: web-playwright 70, ios-simctl 64,
  ios-devicectl 34, ios-appium 1. Ratchets down only; target 0.

  A stubbed method is worse than a missing one: missing fails loudly as "not
  configured", whereas a stub RESOLVES and returns `false`, which reads as
  "the product did not do the thing".

- 2026-07-30 — j03 re-pointed from German to Chinese. The MVP ships four UI
  locales (en, zh, id, vi — SHY-0194, still Draft), so a German journey could
  never pass. The language was incidental to what j03 proves. The corpus still
  contains `ja` (5) and `ar` (4) references, notably j13 (`locales-rtl-cjk`),
  where dropping RTL is a **coverage** decision rather than a locale swap —
  flagged for the operator, not changed unilaterally.

- 2026-07-30 — Two platform asymmetries are now encoded rather than assumed:
  Android flavours carry distinct `applicationIdSuffix`es and coexist on one
  device (so the Given selects a package, no reinstall); iOS ships ONE bundle
  id for every build config, so the installed flavour is undetectable and is
  DECLARED via `IOS_FLAVOR`, with a mismatch refused by name.

- 2026-07-30 — Counts above come from the chromium cell of run
  `20260730-130954-local`. They are a floor, not a total: 109 scenarios died on
  their first step, so any gap hiding behind those steps was never reached. The
  baseline will be re-taken from the first run where the app is healthy.
- 2026-07-30 — `stub:webAdminShowsDashboardCounters` alone accounts for 59 of
  the 64 stub occurrences; implementing that one method is the single largest
  lever in this story.
