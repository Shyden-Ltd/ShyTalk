---
id: SHY-0087
status: Draft
owner: claude
created: 2026-06-12
priority: P1
effort: S
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0087: Run the iOS boot smoke in parallel with the iOS App Store deploy

## User Story

As the ShyTalk operator releasing to prod,
I want the `smoke-test-ios` job to run in parallel with `deploy-ios-prod` instead of serially after it,
So that the post-approval iOS critical path drops from ~82 min to ~57 min with no new build cost and no loss of smoke signal.

## Why

- **SHY-0086 profiling (run 27388236740):** the post-approval critical path is `deploy-backend-prod (1m) → deploy-ios-prod (56m30s) → smoke-test-ios (~25–30m)` ≈ 82 min — entirely the iOS path. The iOS smoke runs **serially after** the deploy, adding its full ~25–30 min on top.
- **The serial chain is incidental, not real.** `smoke-test-ios` declares `needs: [validate-release, deploy-ios-prod]` but consumes **none** of the deploy's output: it checks out the same source commit (`needs.validate-release.outputs.commit-sha`), rebuilds the simulator framework + app from scratch (`linkDebugFrameworkIosSimulatorArm64` + `xcodebuild build`), and boots that freshly-built debug app in a simulator. There is **no artifact handoff** from `deploy-ios-prod`. The `needs: deploy-ios-prod` exists only as a logical gate (`if: needs.deploy-ios-prod.result == 'success'` — "don't smoke if the deploy failed").
- **Removing the data-less `needs` lets the two run concurrently** off `validate-release` + the gate, collapsing the iOS path from `56.5 + ~27 ≈ 82 min` to `max(56.5, ~30) ≈ 57 min` — **~25 min saved**, zero added build minutes.
- **Trade-off (accepted):** in parallel the smoke can start before the deploy's success is known, so a run where the deploy ultimately *fails* would still spend a macOS-runner on the smoke. That is cheap and rare, and the smoke still produces a *valid* boot signal (it builds from source, not from the deployed binary). The current "skip the smoke if the deploy failed" optimisation trades ~25 min off every *successful* release to save one runner on the rare failure — a bad trade for a release pipeline the operator waits on.

## Acceptance Criteria

### Happy path

- [ ] `smoke-test-ios`'s `needs:` no longer includes `deploy-ios-prod` — it becomes `needs: [validate-release]` so GitHub schedules it as soon as `validate-release` completes (concurrently with `deploy-ios-prod`).
- [ ] On a release where `inputs.ios` is true and both jobs succeed, the run graph shows `smoke-test-ios` and `deploy-ios-prod` with **overlapping** `started_at`/`completed_at` windows (verified via `gh api .../jobs`), and the run's total post-approval wall-clock is ≈ `max(deploy-ios, smoke-ios)`, not their sum.
- [ ] The iOS smoke still gates on `inputs.ios` (it must not run when iOS is deselected for the release).

### Error paths

- [ ] When `deploy-ios-prod` FAILS, `smoke-test-ios` is allowed to still run (it builds from source) — but its result is reported independently so a green smoke next to a red deploy is unambiguous in the UI (the existing per-surface split already does this). The release is still marked failed by the failed deploy job + `alert-desync`.
- [ ] `alert-desync` (which `needs:` every deploy + every smoke) still fires correctly when either the iOS deploy or the iOS smoke fails — the dependency on both is retained there.

### Edge cases

- [ ] iOS-deselected release (`inputs.ios == false`): `smoke-test-ios`'s `if:` still skips it (no orphan smoke when there was no iOS deploy).
- [ ] The `konan-${{ runner.os }}-…` cache key shared between `deploy-ios-prod` and `smoke-test-ios` must not race destructively when the two jobs run concurrently — both use `actions/cache/restore` (read) + a tail `actions/cache/save` gated on `cache-hit != 'true'`; concurrent saves to the same key are idempotent (last-writer-wins, same content). Confirm no `cache/save` step is promoted to a blocking dependency by this change.

### Performance

- [ ] Post-approval iOS critical path measured at **< 60 min** on a warm-cache run (down from ~82 min), confirmed against a real release run's `gh api .../jobs` timings recorded in `## Notes`.

### Security

- N/A — workflow scheduling change only; no secrets, signing material, or deploy target touched. The smoke job already had its own (non-signing) credential surface and that is unchanged.

### UX

- N/A — CI-facing. Consumer = operator waiting on the release; the win is a shorter wait with identical pass/fail semantics.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The GitHub Actions run graph still shows `Smoke Test (iOS Boot)` as a distinct, correctly-named status check; a failure there is still attributable to the iOS surface (no merge of smoke into deploy status).

## BDD Scenarios

**Scenario: iOS smoke overlaps the iOS deploy on a successful release**
- **Given** a prod deploy with `inputs.ios == true`
- **When** `validate-release` completes and the approval gate is cleared
- **Then** `deploy-ios-prod` and `smoke-test-ios` both start without one waiting on the other
- **And** `gh api .../jobs` shows their time windows overlapping, with total post-approval wall-clock ≈ the longer of the two, not the sum

**Scenario: a failed iOS deploy does not silently hide a smoke regression**
- **Given** `deploy-ios-prod` fails (e.g. signing error)
- **When** `smoke-test-ios` runs in parallel and the app fails to boot
- **Then** both jobs report failure independently and `alert-desync` fires
- **And** the release is marked failed

**Scenario: iOS deselected — no orphan smoke**
- **Given** a deploy dispatched with `inputs.ios == false`
- **When** the pipeline runs
- **Then** both `deploy-ios-prod` and `smoke-test-ios` are skipped (the smoke's `if:` still checks `inputs.ios`)

## Test Plan

- **RED:** extend `express-api/tests/scripts/deploy-prod-single-gate-and-smoke.test.js` (the existing YAML-assertion suite) with cases asserting: (a) `smoke-test-ios.needs` does **not** contain `deploy-ios-prod`; (b) `smoke-test-ios.needs` **does** contain `validate-release`; (c) `smoke-test-ios.if` still references `inputs.ios`; (d) `alert-desync.needs` still contains both `deploy-ios-prod` and `smoke-test-ios`. These fail against the current YAML (which has `needs: [validate-release, deploy-ios-prod]`).
- **GREEN:** edit `.github/workflows/deploy-prod.yml` `smoke-test-ios.needs` → `[validate-release]`; adjust its `if:` to drop the `needs.deploy-ios-prod.result == 'success'` data-gate while keeping `inputs.ios`. Re-run the suite → green.
- **Live verification:** on the next real prod release, capture `gh api .../jobs` timings into this story's `## Notes` proving overlap + < 60 min iOS path.
- No app code, no Kotlin/Swift, no unit-test framework beyond the YAML assertions.

## Out of Scope

- Speeding up the iOS *build itself* (K/N link, xcodebuild archive, pod compile) — that is SHY-0088 / SHY-0089. This story only removes the serial dependency.
- Changing what the smoke verifies (boot + crash-check) — behaviour identical, only scheduling changes.
- The Android smoke chain (`smoke-test-android needs: deploy-android-prod`) — Android deploy is <1 min so there is no serial-chain pain to fix; leave as-is.

## Dependencies

- Builds directly on SHY-0086 (the profiling that identified the data-less `needs`). No blocker. Independent of SHY-0088 / SHY-0089 (can ship in any order; all three compose).

## Risks & Mitigations

- **A green smoke next to a red deploy looks contradictory to a reader.** *Mitigation:* the per-surface split already makes each job's status independent; the smoke builds from the same source commit so a green smoke is a *true* "the app boots" signal even if the App Store upload failed. Document this in the job comment.
- **Concurrent `~/.konan` cache saves race.** *Mitigation:* both jobs use split restore/save with `if: cache-hit != 'true'`; saves are content-identical and idempotent (GitHub last-writer-wins). No save is on the critical path.
- **Wasted macOS runner when the deploy fails.** *Mitigation:* accepted — macOS-minutes on a rare failure are far cheaper than ~25 min added to every successful release; the operator explicitly prioritised release speed (SHY-0086 escalation).

## Definition of Done

- `smoke-test-ios.needs` no longer depends on `deploy-ios-prod`; YAML-assertion tests updated and green; iOS-deselect + alert-desync paths preserved.
- A real release run recorded in `## Notes` shows the iOS smoke overlapping the iOS deploy and the post-approval iOS path < 60 min.
- PR merged; `released_in: vX.Y.Z` set once the release that carries the change is cut (this is an `infra` change to a prod workflow — verify it on a real deploy before flipping Done).

## Notes (running log)

- 2026-06-12 — Filed by SHY-0086 (prod-deploy profiling spike). Origin: the iOS smoke runs serially after the iOS deploy despite sharing no data with it; parallelising saves ~25 min off the post-approval critical path. Highest-ROI / lowest-risk of the three SHY-0086 follow-ups — do first.
