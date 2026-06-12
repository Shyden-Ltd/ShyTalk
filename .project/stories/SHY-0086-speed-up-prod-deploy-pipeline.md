---
id: SHY-0086
status: Draft
owner: claude
created: 2026-06-12
priority: P0
effort: M
type: spike
roadmap_ids: []
pr:
mvp: false
---

# SHY-0086: Investigate + speed up the ENTIRE prod-deploy pipeline (currently multiple hours)

## User Story

As the ShyTalk operator releasing to prod,
I want the whole `deploy-prod.yml` pipeline (not just the iOS build) profiled end-to-end so I know exactly where the multiple-hour wall-clock goes,
So that targeted follow-up fixes cut a prod release from "several hours" to something that doesn't gate every MVP iteration.

## Why

- **Operator escalation (2026-06-12):** a prod deploy is taking *several hours*; this now blocks MVP velocity ("otherwise everything is going to take too long"). The scope is widened from just the iOS *build* to the **entire prod-deploy process**.
- **Measured baseline (run 27388236740, v0.97.12 — per-job wall-clock):**
  - Validate Deploy Ref — **1 min**
  - Build Android — **7 min**
  - Deploy Backend to Prod — **1 min**
  - Deploy Web to Prod — **<1 min**
  - Deploy Android to Play Store — **<1 min**
  - **Deploy iOS to App Store — 56 min** ← dominant single job
  - Smoke Test (API / Web / Android) — **0–2 min** each
  - **Smoke Test (iOS Boot) — long** (builds the KMP framework + xcodebuild + boot; was hitting the 45-min ceiling — the SHY-0084 stop-gap)
  - (NOT counted above: the manual **approval wait**, which is operator-controlled, and is separate from pipeline cost.)
- **Conclusion to validate:** the wall-clock is dominated by the **iOS path** — `Deploy iOS to App Store` (56 min) **plus** the iOS smoke's own framework build, run serially — while backend/web/Android are already fast (<8 min each). The iOS framework is plausibly built **twice** (once in `deploy-ios-prod`'s archive, once in `smoke-test-ios`). This is a **spike**: profile, find the long poles, recommend fixes, file follow-ups. No prod behaviour change here.

## Acceptance Criteria

### Happy path

- [ ] An end-to-end **per-job + per-step wall-clock breakdown** of a full prod deploy is recorded in `## Notes` (job durations via `gh run view --json jobs` step timestamps; the baseline above is the starting point), with the **critical path** identified (the chain of jobs that sets total wall-clock, not just the slowest job).
- [ ] The **`Deploy iOS to App Store` 56 min** is broken down INTO its steps: KMP framework link (`linkReleaseFramework…`), `pod install`, `xcodebuild archive`, `-exportArchive` (IPA), and the **App Store upload** — quantifying how much is OUR build vs Apple-side upload/processing we can't control.
- [ ] The **iOS double-build hypothesis** is confirmed/refuted: does `smoke-test-ios` rebuild the same framework `deploy-ios-prod` already built? If yes, recommend sharing the artifact/cache (or gating the smoke on the deploy's output) to remove one full framework build.
- [ ] The **pipeline shape** is assessed: which jobs are serial only because of `needs:` (every deploy `needs: deploy-backend-prod`) vs genuinely dependent — i.e. can more run in parallel after the single gate so total wall-clock ≈ the longest single path, not the sum?
- [ ] Each candidate fix has a **feasibility + estimated wall-clock saving**; ≥1 fully-refined **follow-up implementation SHY** is filed per recommended fix.

### Error paths

- [ ] A rejected candidate (e.g. "the App Store upload is Apple-side and unfixable", or the K/N parallel-link deadlock still reproduces) is recorded with evidence + reason, so it isn't re-investigated.

### Edge cases

- [ ] **Cold vs warm caches** (`~/.konan`, CocoaPods, gradle) are distinguished — cold is the worst case the pipeline must tolerate.
- [ ] The **iOS build sub-suspects from the original ticket** are retained inside this broader scope: serial K/N link (`--max-workers=1` deadlock workaround, commit 1b788059cb0), cold `~/.konan` cache, no CocoaPods cache.
- [ ] The **approval-to-completion** clock (post-approval pipeline time) is reported separately from the **dispatch-to-approval** wait (operator-controlled) so the fixable pipeline cost is clear.

### Performance

- [ ] The spike QUANTIFIES the current post-approval wall-clock + sets a target for the follow-ups (e.g. "iOS path < 60 min total / whole deploy < 90 min post-approval"); the spike itself adds no pipeline cost.

### Security

- N/A — investigation/measurement only; no code path, no secrets handled.

### UX

- N/A — operator/CI-facing. (Consumer = the operator waiting hours on a release; deliverable = a clear critical-path breakdown + actionable, estimated follow-ups.)

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The profiling methodology is repeatable (documented `gh run view` queries / gradle `--profile` / `xcodebuild -showBuildTimingSummary`) so wall-clock can be re-measured after each follow-up to confirm the saving.

## BDD Scenarios

**Scenario: the multi-hour deploy is attributed to a critical path**
- **Given** a full prod-deploy run
- **When** the spike profiles every job + the iOS deploy's internal steps
- **Then** `## Notes` shows the critical-path breakdown summing to ~the total, naming the dominant step(s) (expected: the iOS App Store deploy + the iOS smoke build)

**Scenario: the iOS App Store 56 min is split into our-build vs Apple-side**
- **Given** the `Deploy iOS to App Store` job
- **When** its steps are timed
- **Then** the framework-link / xcodebuild-archive / export / upload shares are recorded, separating fixable build time from Apple-side upload/processing

**Scenario: the iOS double-build is confirmed or refuted**
- **Given** `deploy-ios-prod` and `smoke-test-ios` both invoke gradle to build the KMP framework
- **When** their gradle task execution is compared
- **Then** the spike states whether the framework is built twice, and (if so) files a follow-up to share it

**Scenario: parallelism opportunities are identified**
- **Given** the `needs:` graph (every deploy needs deploy-backend-prod)
- **When** the spike assesses true vs incidental dependencies
- **Then** it recommends which jobs can run in parallel post-gate to shrink total wall-clock, with an estimated saving

**Scenario: each recommended fix becomes a follow-up SHY**
- **Given** the profiling identifies actionable wins
- **When** the spike concludes
- **Then** a fully-refined follow-up SHY exists per fix (with estimated saving), and the spike closes with the decision recorded in `## Notes`

## Test Plan

Spike — the deliverable is the measurement methodology + the evidentiary record + follow-up SHYs, not code.

- **Whole-pipeline timing:** `gh run view <id> --json jobs` step timestamps for ≥2 full runs (the v0.97.12 baseline above + the v0.97.13 run once approved); compute per-job + per-step minutes + the critical path.
- **iOS App Store job breakdown:** read the `Deploy iOS to App Store` job log step timings; separate framework link / `pod install` / `xcodebuild archive` / `-exportArchive` / `xcrun altool`/Transporter upload.
- **Double-build check:** compare gradle task lists in `deploy-ios-prod` vs `smoke-test-ios` (does the xcodebuild `Compile Kotlin Framework` build phase re-run the link the explicit step already did?).
- **Local instrumented build:** `./gradlew :shared:linkReleaseFrameworkIosArm64 --profile`, `time pod install`, `xcodebuild archive … -showBuildTimingSummary`; cold vs warm `~/.konan`.
- **Deadlock re-test:** link WITHOUT `--max-workers=1` on a throwaway branch with a tight `timeout-minutes` (deadlock evidence from commit 1b788059cb0).
- **Deliverable:** breakdown + recommendations in `## Notes`; follow-up SHYs filed. No automated test added (investigation story).

## Out of Scope

- IMPLEMENTING the speed-ups — each becomes its own follow-up SHY (this story measures + recommends + sequences them).
- Self-hosted / paid runners (forbidden by policy) — quantify the GitHub-hosted `macos-latest` baseline, don't change the runner class.
- Apple-side App Store *processing* time we cannot control (measure + exclude it from the fixable budget; if the workflow needlessly WAITS on it, that IS in scope to remove).

## Dependencies

- None to start. Builds on SHY-0084 (which raised the iOS smoke timeout 20→45 as a stop-gap) + the historic `--max-workers=1` K/N-link-deadlock fix (commit 1b788059cb0). UNBLOCKS the follow-up speed-up SHYs.

## Risks & Mitigations

- **GitHub-hosted runner timing is noisy.** *Mitigation:* ≥2 runs per case, report ranges.
- **The dominant cost is Apple-side upload/processing (unfixable).** *Mitigation:* quantify + exclude it; pivot the follow-ups to the fixable share (double-build, parallelism, caches, not-waiting-on-processing).
- **Re-testing the K/N parallel-link deadlock burns CI / reintroduces a hang.** *Mitigation:* throwaway branch + tight `timeout-minutes`; never merge a parallel-link change without the deadlock evidence.

## Definition of Done

- End-to-end critical-path breakdown (incl. the iOS App Store job's internal steps + cold/warm) recorded in `## Notes`, with the dominant fixable cost(s) named.
- Feasibility + estimated-saving per candidate fix (double-build removal, post-gate parallelism, K/N parallel link, konan/pods caches, not-waiting-on-App-Store-processing).
- ≥1 fully-refined follow-up implementation SHY filed per recommended fix; rejected candidates recorded with evidence.
- Spike closed (status Done) with the decision summary in `## Notes` (spikes ship findings, not code — no `released_in`; the follow-up SHYs carry the implementation + release).

## Notes (running log)

- 2026-06-12 ~11:55 BST — **Scope EXPANDED (operator escalation)** from "iOS build is slow" to "the entire prod-deploy pipeline takes several hours; pick this up as the NEXT ticket." Bumped P1→**P0**, renamed `…-investigate-slow-ios-build` → `…-speed-up-prod-deploy-pipeline`. Baseline already captured (run 27388236740): `Deploy iOS to App Store` **56 min** dominates; the iOS smoke build is separately slow (likely a second framework build); backend/web/Android all <8 min. The fixable wall-clock is the **iOS path** (App Store deploy + iOS smoke build, serial) — the rest is already fast. NEXT ENGINEER: start from the baseline table, break the 56-min iOS job into steps, confirm the double-build, assess post-gate parallelism, file follow-ups. `mvp: false` retained (dev-velocity/CI-efficiency, not a launch feature — flag to flip).
- 2026-06-12 ~11:32 BST — Originally filed (iOS-build-only scope) at operator request; superseded by the 11:55 expansion above.
