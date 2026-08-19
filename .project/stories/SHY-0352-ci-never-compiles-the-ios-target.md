---
id: SHY-0352
status: Draft
owner: claude
created: 2026-08-19
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: true
---

# SHY-0352: A change can break the iOS app completely and every check still goes green

## User Story

As **whoever picks up the next story**, I want CI to tell me when my change has
broken the iOS build, so that I find out from a red check in two minutes rather
than from a failed Xcode build an hour later — or from an iOS release that
cannot be cut at all.

## Why

**P1, MVP-blocking, and it already happened today.**

`grep -rl compileKotlinIosArm64 .github/workflows/` returns **nothing**. No pull
request check compiles the iOS target. So any change under
`shared/src/commonMain` or `shared/src/iosMain` can leave the iOS app unable to
build, and the PR will show every check green.

**This is not hypothetical — it was caught by hand on 2026-08-19.** PR #1808
(SHY-0348) reported all checks passing while:

```
IosUserRepositoryImpl.kt:79:25: Unresolved reference 'jsonToMap'.
:shared:compileKotlinIosArm64 FAILED
```

The iOS implementation referenced a helper that existed only on a different
branch. The break was found only because somebody built the app for a real
iPhone; nothing in CI would ever have said so.

**The repository already declares this rule and does not enforce it.**
`CLAUDE.md`'s Tri-Platform Policy says, in as many words: *"Every feature
implemented in shared/commonMain must compile for both Android and iOS. Verify
with `./gradlew :shared:compileKotlinIosArm64` after any shared code change."*
That is a documented obligation with nothing behind it — the exact shape of a
rule that gets skipped under time pressure, because skipping it is invisible.

**Why it matters more here than in most projects.** Android has `Build & Test`
compiling it on every PR; the web has Playwright; the backend has 14k Jest
tests. **iOS is the one platform whose compiler never runs on a pull request.**
It is also the platform with the slowest feedback loop — the current route to
finding out is a ~50-minute dev deploy or a local Xcode build — so the cost of
learning late is highest exactly where the safety net is missing. That asymmetry
is how a platform quietly rots.

## Acceptance Criteria

### Happy path

- [ ] A pull request that changes shared code compiles the iOS target, and the result is visible as a named check.
- [ ] A pull request that leaves the iOS build broken cannot report success.
- [ ] The check runs on the same pull requests that already run the Android build.

### Error paths

- [ ] A compile failure names the offending file and line in the check output, not only in a downloadable log.
- [ ] An infrastructure failure (toolchain fetch, cache miss) is distinguishable from a genuine compile failure.

### Edge cases

- [ ] A change touching only the backend, the website or documentation does not pay for an iOS compile it cannot affect.
- [ ] A change touching only `androidMain` likewise does not trigger it.
- [ ] The check still runs when the shared change arrives as part of a larger pull request.

### Performance

- [ ] The check reuses the Kotlin/Native cache so a warm run does not add materially to pull-request wall-clock time — this matters more than usual, because it runs on a paid-rate macOS runner.
- [ ] It runs in parallel with the existing checks rather than extending the critical path.

### Security

- [ ] N/A — a compile check, no credentials and no deployment surface. It uses no signing identity and produces no installable artefact.

### UX

- [ ] N/A — no user-facing surface; the audience is whoever reads the pull request.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The check appears by name in the pull request, so its absence is as visible as its failure.

## BDD Scenarios

**Scenario: A change that breaks the iOS build is caught**

- **Given** a change that stops the iOS app compiling
- **When** it is proposed for review
- **Then** the checks report a failure, naming the file that broke

**Scenario: A healthy shared change passes**

- **Given** a change to shared code that compiles everywhere
- **When** it is proposed for review
- **Then** the checks pass without extra manual work

**Scenario: An unrelated change is not slowed down**

- **Given** a change that touches only documentation
- **When** it is proposed for review
- **Then** it is not made to wait for an iOS compile

## Test Plan

**This is a CI-config change, and it is classified as such**: `.github/workflows/**`
plus its structure test. No app, backend or website runtime surface changes, so
the device/browser gauntlet would exercise nothing related to it (per the
CLAUDE.md exemption). It still runs the full non-device gauntlet.

### Meta-test — `express-api/tests/scripts/pr-checks-ios-compile.test.js`

- `the PR workflow contains a job that runs compileKotlinIosArm64` — **the defect, in one assertion**; fails today
- `the iOS compile job is gated on the shared/ios change detector, not run unconditionally`
- `the iOS compile job is named, so a missing check is visible`
- `the job restores the konan cache` — otherwise every run pays a cold Kotlin/Native fetch

### Proof it actually catches the real thing

- Reproduce SHY-0348's exact break on a scratch branch (delete the `jsonToMap`
  import) and confirm the new check goes **red**, then restore. A meta-test that
  only reads YAML proves the job is *configured*, not that it *works*.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the compile step removed from the job | `contains a job that runs compileKotlinIosArm64` |
| the job made unconditional | `gated on the shared/ios change detector` |
| the konan cache step dropped | `restores the konan cache` |

## Out of Scope

- Running iOS **unit** tests (XCTest) or **UI** tests (XCUITest) in CI — those need
  a signing identity and a simulator or device, which is a different and much
  larger problem. This story is the compiler alone.
- Building or archiving the iOS app for distribution; `deploy-dev.yml` already does that.
- Fixing SHY-0348's specific break — already fixed on its own branch.
- The related but separate gate hole recorded on SHY-0350, where `pre-merge-check.sh`
  applies its newly-added-Draft "filing exemption" to pull requests that ship code.

## Dependencies

- None. The Gradle task already exists and already runs locally; this only wires
  it into a workflow.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Kotlin/Native toolchain download makes pull requests slow | Cache `~/.konan`, as `deploy-dev.yml` already does; assert the cache step in the meta-test so it cannot be dropped later. |
| The job runs on every pull request and wastes minutes | Gate it on the existing change detector, the same way the other suites are scoped (SHY-0339, SHY-0284). |
| It passes vacuously — configured but not actually compiling | The real-break reproduction above: the check must be observed RED against SHY-0348's actual failure before being trusted. |
| **macOS runner cost — the real trade-off of this story** | Kotlin/Native cannot produce Apple targets from Linux, so this needs a **macOS runner**. Confirmed in this repo: `deploy-dev.yml`'s "Build KMP shared framework for iOS" step lives in the `runs-on: macos-latest` job, while every other job is Ubuntu. GitHub bills macOS minutes at a multiple of Linux, so this is not free. Mitigation is to make it *rare and warm*: gate it strictly on `shared/**` and `iosApp/**` changes, and reuse the konan + Gradle caches. If the cost is still judged too high, the honest fallback is a scheduled compile on `develop` rather than per-PR — later feedback than a PR check, but far earlier than a release. That is an operator call, not a silent one. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] The meta-test was observed failing before the workflow change.
- [ ] The check was observed RED against SHY-0348's actual break, then green once restored.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `actionlint` clean; `eslint --max-warnings=0` and `prettier --check` clean.
- [ ] The story's Test Plan states the CI-config-only classification (it does).
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19 — filed from a real miss, not from an audit.** Building SHY-0348
  for a real iPhone failed with `Unresolved reference 'jsonToMap'` while PR #1808
  showed every check green. `grep -rl compileKotlinIosArm64 .github/workflows/`
  then returned nothing, which is the whole story: the tri-platform rule is
  written in `CLAUDE.md` and enforced nowhere.

- **2026-08-19 — the asymmetry is the argument.** Android is compiled on every
  pull request by `Build & Test`, the web has Playwright, the backend has ~14k
  Jest tests. iOS is the only platform whose compiler never runs on a pull
  request, and it is also the one with the slowest alternative feedback loop —
  a ~50-minute dev deploy or a local Xcode build. Cheapest signal missing exactly
  where late feedback costs most.

- **2026-08-19 — CORRECTION, made before this story was opened.** I first wrote
  that `compileKotlinIosArm64` would run on a Linux runner and therefore cost
  nothing. **That is wrong.** Kotlin/Native cannot build Apple targets from
  Linux, and this repository already demonstrates it: in `deploy-dev.yml` every
  job is Ubuntu except the one containing "Build KMP shared framework for iOS",
  which is `runs-on: macos-latest`.

  So this story is **not** free, and that changes what it is really asking for:
  not "wire up an obviously-cheap check" but "decide what an iOS compile signal
  is worth in macOS minutes". Left in the story rather than quietly corrected,
  because the optimistic version would have had somebody start building it under
  a false premise. The proposed shape — strictly gated on `shared/**` and
  `iosApp/**`, caches warm, with a scheduled develop-only compile as the fallback
  if per-PR is too expensive — follows from the corrected premise, not the
  original one.
