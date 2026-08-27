---
id: SHY-0347
status: Done
owner: claude
created: 2026-08-19
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: false
released_in: v0.99.0
---

# SHY-0347: Deploying a documentation change rebuilds and ships the iOS app

## User Story

As the **ShyTalk operator trying to move faster**, I want a deploy to touch only
the areas whose code actually changed, so that a merge which alters no shipping
code costs nothing instead of an hour.

## Why

**Measured, not estimated.** PR #1794 merged **five markdown files** — story
documents. Nothing else. The deploy that followed ran `Distribute iOS to
TestFlight`, which spent **53 minutes** in `Build, archive, and export iOS app`
and then **timed out and failed**. An hour of macOS runner time, a red run to
investigate, and a failure notification — for text.

**Every deploy input defaults to `true`.** `deploy-dev.yml` is a
`workflow_dispatch` whose `backend`, `web`, `android-testers`, `ios-testers`,
`playwright` and `seed-personas` inputs all default `true`. A bare
`gh workflow run deploy-dev.yml` therefore deploys everything, always, whatever
the merge contained. The routing knobs exist; nothing consults the diff.

**The caches are NOT the problem, and it is worth saying so plainly.** The
obvious hypothesis was that caching had silently stopped working. It has not.
On that same run every cache HIT:

| Cache | Result |
| --- | --- |
| `~/.konan` (Kotlin/Native) | hit, 430 MB restored |
| Xcode derived data | hit, 811 MB restored |
| CocoaPods spec repos | hit |
| `iosApp/Pods` | hit |
| SwiftPM packages | hit |
| Gradle home / dependencies / transforms | all hit |

The archive is simply slow and always full. A restored derived-data tarball does
not make `xcodebuild` incremental — mtimes and absolute paths do not survive the
round trip — so the caches shorten *setup*, never the *archive*. Chasing "fix the
cache" would have burned time on something already working.

**Android already solves this and iOS does not.** `distribute-android` has a
`Try download cached APK` step that reuses a previously built artifact.
`distribute-ios` has no equivalent: it archives from scratch every single time.

**Why P1 and not P0.** It costs time and noise, not correctness. But it is the
single largest avoidable delay in the release loop, on a project whose stated
problem is that the MVP is late.

## Acceptance Criteria

### Happy path

- [ ] A merge that changes no shipping code deploys nothing and finishes in seconds.
- [ ] A backend-only change deploys the backend and nothing else.
- [ ] A change to shared or app code still deploys the app, exactly as today.
- [ ] The operator can still force any area to deploy regardless of the diff.

### Error paths

- [ ] If the changed-area detection cannot determine a baseline, it fails SAFE by deploying everything rather than silently skipping.
- [ ] A skipped area is visibly reported as skipped-and-why, never as a silent pass.

### Edge cases

- [ ] The first deploy after a long gap compares against the last SUCCESSFUL deploy, not merely the previous commit.
- [ ] A re-run of the same commit deploys the same areas, not fewer.
- [ ] A change touching several areas deploys all of them.
- [ ] A revert is treated as a change, not as "nothing happened".

### Performance

- [ ] A documentation-only merge costs no macOS runner minutes.
- [ ] No added latency on a full deploy — detection is one diff.

### Security

- [ ] Detection reads the diff only; it grants no new permission and touches no secret.
- [ ] It cannot be used to SKIP a deploy that a protected path requires.

### UX

- [ ] The run summary states which areas were deployed and which were skipped, with the reason.

### i18n

- [ ] N/A — CI only.

### Observability

- [ ] The baseline SHA used for comparison is printed, so a surprising skip can be explained afterwards.

## BDD Scenarios

**Scenario: A text-only change costs nothing**

- **Given** a merge that changes only documentation
- **When** the deploy runs
- **Then** it finishes without rebuilding the apps

**Scenario: A backend change still ships**

- **Given** a merge that changes the server
- **When** the deploy runs
- **Then** the server is updated

**Scenario: The operator can still force a full deploy**

- **Given** an operator who wants everything redeployed
- **When** they ask for it explicitly
- **Then** every area deploys regardless of what changed

## Test Plan

**RED first.** The failing state is recorded: run `32141821650`, `.md`-only
merge, iOS archive 53 minutes, timed out.

### Node / Jest — `express-api/tests/scripts/deploy-scope.test.js`

- `a docs-only diff routes to no app or backend deploy` — **the defect, in one assertion**
- `a backend-only diff routes to backend and not to the apps`
- `a shared-code diff routes to BOTH apps`
- `an explicit operator override still forces an area on`
- `an unresolvable baseline fails safe by routing everything on`
- `every deploy job's condition consults the detection output`

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| a job's `if:` reverted to `inputs.X` alone | `every deploy job's condition consults the detection output` |
| the fail-safe branch inverted to skip-all | `an unresolvable baseline fails safe...` |
| the shared-code path removed from the app arms | `a shared-code diff routes to BOTH apps` |

### Real-run proof

- A documentation-only dispatch completes without running the app jobs.
- A backend change still reaches dev and passes the existing sanity check.

## Out of Scope

- **Making the iOS archive itself faster**, or giving iOS an artifact-reuse path
  like Android's `Try download cached APK`. That is the other half of the cost
  and deserves its own story — this one stops the build happening when it is not
  needed at all, which is the larger and simpler win.
- Changing what any deploy job DOES once it runs.
- The 50-minute timeout value.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A needed deploy is skipped | Detection fails SAFE — an unresolvable baseline deploys everything — and every skip is reported with its reason. |
| The baseline is wrong after a gap | Compare against the last SUCCESSFUL deploy, not the previous commit. |
| Someone assumes the cache is broken again | The story records that every cache HIT on the failing run, with sizes. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] A real docs-only dispatch runs no app job; a real backend change still deploys.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Filed at operator request: *"you should only deploy to areas
  with deployed code. so backend = only deploy the backend."*

- **2026-08-19** — The operator also suspected the build cache had stopped
  working and that it was "the majority of the wasted time". **Checked, and it
  is not.** Every cache hit on run `32141821650` — konan 430 MB, Xcode derived
  data 811 MB, Pods, SwiftPM, and the whole Gradle set. The archive is slow and
  always full because a restored derived-data tarball does not make `xcodebuild`
  incremental. Recording this so nobody spends a day "fixing" a working cache.

- **2026-08-19** — The knobs already exist. Every `workflow_dispatch` input
  (`backend`, `web`, `android-testers`, `ios-testers`, `playwright`,
  `seed-personas`) defaults to `true`, so a bare dispatch deploys everything.
  This story makes a bare dispatch change-aware, because that is the form that
  gets used at 2am.

- **2026-08-19 — implemented.** A `detect-deploy-scope` job resolves a baseline
  (the head SHA of the last SUCCESSFUL deploy-dev run — not `HEAD~1`, because
  several merges can land between deploys) and classifies the diff through
  `scripts/deploy-scope.sh`. Each deploy job now requires the operator's input
  AND a touched area, so an explicit `false` still wins: this narrows, never
  widens.

- **2026-08-19 — the tests caught a real bug in my own script.** `while read`
  silently DISCARDS a final line with no trailing newline, so a single-path diff
  classified as "no input" and fell through to the fail-safe all-true. It looked
  correct in manual testing because `printf 'x\n'` supplies the newline that
  `git diff --name-only` does not always end with. Fixed with
  `|| [ -n "$path" ]`, and the case is now covered.

- **2026-08-19 — mutation-proven.** Reverting `distribute-ios` to `inputs.ios-testers`
  alone kills `distribute-ios is gated on the detected scope` and nothing else.
  18 tests; actionlint and shellcheck clean.

- **2026-08-19 — review round 1: FOUR Criticals, all real, all applied.**

  1. **`functions/*` was classified as backend. It is WEB.** Cloudflare PAGES
     middleware — `functions/_middleware.js` says so in its own docstring,
     `firebase.json` has no `functions` key at all, and `wrangler pages deploy
     public` picks the directory up from the repo root. A fix to the dev-site
     auth lockdown would have run a pointless API deploy and **never reached the
     site**: a protected path silently skipped, which this story's own security
     AC forbids. Moved to the web arm and covered by a test.
  2. **`gh --jq '.[0].headSha'` prints the literal string `"null"`** on an empty
     array, so a first-ever run set `BASE="null"`. It reached the fail-safe only
     because `git cat-file -e "null^{commit}"` happens to fail — correct today by
     accident, and one plausible cleanup away from `git diff null HEAD` aborting
     the job and skipping every deploy. Now `// empty`, the idiom this same file
     already uses in its cached-APK step.
  3. **The wiring test proved "is referenced somewhere in", not "is gated on".**
     Swapping the joining `&&` for `||` — deploy if EITHER the operator asked OR
     the scope matched, destroying the whole "requires both" property — left the
     asserted substring untouched and the test green. Now anchored as one
     contiguous `inputs.X && needs...outputs.Y == 'true'` sequence, and
     mutation-proven: the `||` swap reddens it.
  4. **Deploy-support scripts were unclassified.** `scripts/stamp-build-meta.mjs`
     (run by the web job) and `scripts/ensure-testflight-auto-distribution.js`
     (run by the iOS job) fell to the catch-all, so a fix to either would not
     redeploy the job it changes.

  Plus: `express-api/scripts/*` folded into backend (it ships in the deploy
  tarball); `.github/actions/*` marks EVERY area, since a fix there must not be
  able to skip one — least of all when the operator explicitly asked for it; and
  the step now traps unanticipated errors and emits the all-true fallback rather
  than going red, because a red detector job makes every gated `if:` read `''`
  and skips everything — the precise direction this story exists to prevent.

- **2026-08-19 — 22 tests, mutation-proven on both headline fixes.** Removing
  `functions/*` from the web arm kills its named test; swapping `&&` for `||`
  kills the wiring test that previously could not see it.

Reviewed-up-to: 0d41587ad8c
