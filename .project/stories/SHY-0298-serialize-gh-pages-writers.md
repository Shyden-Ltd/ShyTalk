---
id: SHY-0298
status: In Review
owner: claude
created: 2026-08-15
priority: P2
effort: M
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1751
---

# SHY-0298: Make every gh-pages writer concurrency-safe, and give PR branches their reports back

## User Story

- **As the** ShyTalk operator reviewing a PR
- **I want** the test reports for that PR branch published like every other report
- **So that** I can read a failing suite's Allure/coverage output from the PR
  itself, instead of only from `main`

## Why

Three workflows push to the `gh-pages` branch, all via
`peaceiris/actions-gh-pages@84c30a8` (v4.1.0), which clones `--depth=1`, commits
and pushes with **no retry**. Only ONE of them is serialized:

| workflow            | writer (`uses:` line) | concurrency group                  | serialized      |
| ------------------- | --------------------- | ---------------------------------- | --------------- |
| `allure-report.yml` | :219                  | `gh-pages-deploy` (workflow-level) | **yes**         |
| `pr-checks.yml`     | :315 (Kotlin report)  | `pr-checks-${{ github.head_ref }}` | no — per BRANCH |
| `test-backend.yml`  | :144 (Express report) | `test-backend-${{ inputs.ref … }}` | no — per REF    |

Two writers in different groups can interleave between clone and push, and the
loser gets `! [rejected] … (fetch first)`. Two distinct races exist: Kotlin×Kotlin
across two PRs (different `head_ref` ⇒ different groups) and Kotlin×Express×Allure.

**This is documented and was verified.** `test-backend.yml:122-131` describes
the mechanism and records _"Verified with PR #901's two consecutive failures
despite the test step itself passing."_ `allure-report.yml:245` separately names
the same hazard ("if a writer outside the group — the kotlin deploy in
pr-checks.yml — lands mid-cap the cap skips").

**The cost is not flaky CI — it is a disabled feature.** The mitigation chosen
was avoidance: `test-backend.yml:143` skips the report deploy unless
`report_env` is `dev` or `prod`, i.e. **PR-branch Express reports are never
published**, on the rationale that they are "nice-to-have". So the race no
longer fires because the racy path was switched off. Serializing properly is
what allows it back on.

**Why a retry loop and NOT a shared lock — amended R3, see the Notes.** The
story was filed to serialize every writer behind one `gh-pages-deploy`
concurrency group, and that was measured to work. It was still the wrong
answer, for a reason measurement could not surface:

**a concurrency group holds exactly ONE pending entry.** A third contender does
not queue behind the second — it CANCELS it. This repo has been bitten by that
before (incidents #568/#570). A cancelled publish job is a failed job, and
`allure-report.yml` is reachable from the required **PR Gate** check, so the
lock would have red-gated innocent PRs in order to protect a report. It also
cannot serialize against anything outside GitHub Actions.

The retry loop takes the opposite approach: no writer excludes any other, a
lost race costs one extra attempt against the moving tip, and the history cap
uses a `--force-with-lease` compare-and-swap so the SERVER refuses it if a
publisher landed first. Nothing is cancelled and nothing is queued.

The door being closed is "a writer's report can be silently discarded"
([[feedback-close-the-door-not-just-the-holes]]) — a lock is one way to close
it, and on this platform a worse one.

## Acceptance Criteria

### Happy path

- [ ] A single composite action `.github/actions/publish-gh-pages/` owns every
      `peaceiris/actions-gh-pages` invocation in the repo — exactly 1 repo-wide,
      counted at the `uses:` definition site (a substring count over-reports,
      because a comment explains the race). _Amended at pickup from "a reusable
      workflow": see the Notes — the reusable route hits GitHub's 4-level
      nesting limit exactly and deadlocks against `allure-report.yml`'s existing
      workflow-level hold on the same group._
- [ ] NO gh-pages writer declares a concurrency group. _Amended R3: the
      original criterion demanded a shared `gh-pages-deploy` group; a group
      holds one pending entry and cancels the rest, and a cancelled publish
      propagates into the required PR Gate check._
- [ ] The action retries a lost push against the tip that beat it, re-applying
      its own content each time rather than force-overwriting, and reports
      which attempt won.
- [ ] `pr-checks.yml` and `test-backend.yml` publish from separate jobs that
      take the report as an artifact, so a retrying publish never holds a
      ~15-minute test job open.
- [ ] PR-branch Express reports publish again: the
      `report_env == 'dev' || report_env == 'prod'` restriction at
      `test-backend.yml:143` is removed, leaving only the dependabot guard.

### Error paths

- [ ] If the publish job fails, the calling workflow still reports its own test
      result — a publishing failure must not be reported as a test failure, and
      must not be swallowed either (the publish job's own conclusion is visible).
- [ ] A dependabot-authored run still skips publishing (read-only `GITHUB_TOKEN`
      cannot push); the guard moves into the reusable workflow so it cannot be
      forgotten by a future caller.
- [ ] A caller that uploads no artifact fails with a message naming the expected
      artifact, rather than publishing an empty directory over a good report.

### Edge cases

- [ ] `keep_files: false` semantics are preserved per destination (peaceiris
      cleans only `destination_dir`), so sibling suites, the root landing page
      and `CNAME` are untouched — the SHY-0128 invariant.
- [ ] The `gh-pages` history-cap step keeps working under concurrency. Its ref
      move is a `--force-with-lease` compare-and-swap, so a publisher that lands
      mid-cap makes the SERVER refuse the move; the cap skips quietly and a
      later run caps again. _Amended R3: the original criterion expected the
      skip branch to become unreachable under one queue. Without the queue it
      is reachable and load-bearing, so it is tested rather than assumed._
- [ ] The cap's orphan commit is built LOCALLY (`git commit-tree`), never
      through the Git Data API. _Added R4: an API-created commit is referenced
      by no ref and is therefore absent from the `--depth=1` clone that has to
      push it — `fatal: bad object`, then `! [remote rejected] … (unpacker
      error)`, on every capped run._
- [ ] Two PRs whose CI completes in the same minute both publish successfully,
      in some order — neither is rejected.

### Performance

- [ ] Publishing must not hold the PRODUCING jobs. `Build & Test` (~15 min)
      and `Test Backend` (~5 min) keep running concurrently across PRs; the
      publish is its own job, fed by an artifact. _Amended R3: this used to be
      phrased as "only the seconds-long publish step queues" — nothing queues
      now, so the property is that a retrying publish cannot extend a test
      job._
- [ ] The retry backoff grows with the attempt and never follows the LAST
      attempt (which would delay the failure without retrying it). Asserted on
      the schedule the loop requests, not on elapsed wall-clock.

### Security

- [ ] The reusable workflow requests the minimum permissions it needs
      (`contents: write` for the gh-pages push) and callers do not need to widen
      their own top-level `permissions:` beyond what they already hold.
- [ ] No secret is passed to the reusable workflow; it uses the caller's
      `GITHUB_TOKEN` via `secrets: inherit` or an explicit token input.

### UX

- [ ] The PR's report URL is discoverable — the publish job's summary states the
      published path so a reviewer can reach it without guessing the URL scheme.

### i18n

- [ ] N/A — CI operator output, English-only by design.

### Observability

- [ ] A rejected push can no longer be silent: the publish job's outcome is a
      check on the PR, so a failure to publish is visible without expanding logs
      ([[feedback-absence-of-work-reported-as-success]]).

## BDD Scenarios

**Scenario: two PRs finishing together both publish**

- **Given** two pull requests whose test suites finish in the same minute
- **When** each one publishes its report
- **Then** both reports appear on the reports site and neither run reports a
  failed publish

**Scenario: a PR branch gets its Express report back**

- **Given** a pull request that is not from dependabot
- **When** its backend test suite finishes
- **Then** the Express coverage report for that branch is published and linked

**Scenario: publishing cannot masquerade as a test result**

- **Given** a run whose tests all pass but whose publish step fails
- **When** the run finishes
- **Then** the test job reports success and the publish job reports failure,
  distinguishably

**Scenario: a dependabot run does not attempt to publish**

- **Given** a pull request authored by dependabot
- **When** its suites finish
- **Then** no publish is attempted and the run is not failed for it

## Test Plan

**CI-config-only classification:** the change is confined to
`.github/workflows/**` and its pin tests in `express-api/tests/scripts/` — no
app, backend or website runtime surface — so the device/browser gauntlet is
exempt under the protocol's exemption 2. Verification is a REAL concurrent
dispatch (see DoD).

**Red first**, in `express-api/tests/scripts/gh-pages-publisher.test.js` (new):

- `exactly one peaceiris invocation exists repo-wide` — counts
  `^\s*uses:\s*peaceiris/` across `.github/workflows/*.yml`, expecting 1. RED at
  3 today. Counts at the DEFINITION site, not by substring: `test-backend.yml`
  contains the string `peaceiris/actions-gh-pages` inside a COMMENT, and a naive
  `grep -c` scores it 2 ([[feedback-substring-is-not-existence]]).
- `no gh-pages writer declares a concurrency group` — _amended R3_: asserts
  `gh-pages-deploy` appears in no `concurrency:` block anywhere. The original
  pin asserted the opposite; a group holds ONE pending entry and cancels the
  rest, and a cancelled publish propagates into the required PR Gate check.
- `pr-checks.yml and test-backend.yml call the publisher` — asserts a
  `uses: ./.github/actions/publish-gh-pages` in each.
- **The loop, EXECUTED** —
  `express-api/tests/scripts/gh-pages-publisher-loop.unit.test.js` runs the
  REAL extracted push loop against REAL local bare repos, with a genuine second
  clone pushing between this loop's clone and its push. The ONE substitution is
  a git `insteadOf` rewrite pointing the hardcoded GitHub URL at the local bare
  repo; the script is byte-for-byte what CI runs. Added because the regex pins
  next door are satisfied by a loop that retries zero times, resets to the wrong
  commit, or force-pushes on attempt three.
- `the backoff grows with the attempt, and never follows the last one` —
  `sleep` is shimmed to RECORD its argument rather than wait, so the schedule
  is asserted directly. A wall-clock bound would be slow and flaky
  ([[feedback-tests-must-not-depend-on-wall-clock]], [[feedback-never-use-sleeps-condition-based-waits]]).
- **The cap, against REAL git** —
  `express-api/tests/scripts/allure-report-gh-pages-cap-script.unit.test.js`
  executes the real cap block against a real bare repo and asserts the capped
  branch's tree is the SAME OBJECT as the tip's, that the commit is an orphan,
  and that a racing publisher's report survives the lease refusal.
- `PR-branch Express reports are no longer skipped` — asserts the
  `report_env == 'dev'` restriction is gone from the publish condition while the
  `dependabot/` guard remains. RED today.
- `the dependabot guard lives in the publisher` — so a future caller cannot omit it.

**Green** — the above suite, plus the full `express-api/tests/scripts/` suite
(146 suites / 7475 tests as of `0496f74c835`) to prove no sibling pin regressed;
`actionlint` (with shellcheck present — a clean actionlint run with shellcheck
ABSENT proves nothing, [[feedback-verify-the-harness-not-just-the-result]]);
`eslint --max-warnings=0`; prettier.

**Mutation checks** — each new pin must be shown to fail against a mutant. A
pin that cannot fail is decoration ([[feedback-mutation-passed-means-investigate]]).
Verified: restore one peaceiris invocation; reintroduce a `gh-pages-deploy`
group; remove the failure CLASSIFICATION so every failure retries;
`MAX_ATTEMPTS=1`; chain a parent onto the cap's orphan; swap the lease for an
unconditional `--force`; run `commit-tree` outside the clone; drop the
empty-`$NEW` guard; make the backoff constant; sleep after the last attempt;
hardcode `BACKOFF_BASE`; remove `continue-on-error` from `generate-report`.

**Live proof** — the race is a concurrency defect, so a passing unit suite is
not evidence: two PRs must actually publish at once (see DoD).

## Out of Scope

- Shrinking the `gh-pages` branch itself (tracked by SHY-0128).
- Changing what the reports CONTAIN, or the reports site's layout.
- Moving off `peaceiris/actions-gh-pages` to a hand-rolled push.
- Publishing reports for forked-PR runs (their token cannot push at all).

## Dependencies

- None. _Amended R3: this used to name `allure-report.yml`'s `gh-pages-deploy`
  group as "the pattern being generalised, already proven in production". It
  was proven to serialize; it was never proven safe to contend on, and it is
  not. The group is removed rather than generalised._

## Risks & Mitigations

- **Risk:** under heavy contention a writer exhausts its six attempts and
  fails. **Mitigation:** each attempt re-applies onto the winner's tip, so
  progress is real rather than optimistic; six attempts with a growing backoff
  is far beyond observed contention, and the exhaustion message says so
  explicitly ("check whether something is pushing to gh-pages in a loop") so
  the failure reads as a diagnosis and not a flake. The publish job is
  `continue-on-error`, so even exhaustion cannot red-gate a PR.
- **Risk:** `continue-on-error` makes a genuinely broken publisher invisible.
  **Mitigation:** the job's own conclusion is still shown on the run, and the
  exhaustion path emits an `::error title=…::` annotation. It is
  non-GATING, not silent ([[feedback-absence-of-work-reported-as-success]]).
- **Risk:** artifact hand-off adds a failure mode the direct step did not have.
  **Mitigation:** an explicit missing-artifact error path (Error-paths AC #3)
  rather than publishing an empty directory over a good report.
- **Risk:** re-enabling PR-branch publishing grows `gh-pages` faster.
  **Mitigation:** `keep_files: false` already replaces each suite/env's
  `latest/` in place rather than accumulating, and the history cap in
  `allure-report.yml:234` still applies. If growth becomes a problem it is
  SHY-0128's scope, and the restriction can be re-applied as one line.
- **Risk:** nested reusable-workflow depth. **Mitigation:** moot — the
  publisher is a composite ACTION, and composite actions add no nesting level.
  This risk is what drove the reusable-workflow route to be abandoned at
  pickup.

## Definition of Done

- [ ] New pin suite RED first, then green; full `tests/scripts` suite green;
      actionlint (shellcheck present), eslint `--max-warnings=0`, prettier clean
- [ ] Every new pin proven to fail against its mutant
- [ ] **Live proof of the actual defect:** two PRs' publishes dispatched to
      overlap deliberately, both succeeding, with the run logs showing the
      loser RETRYING onto the winner's tip — a green unit suite does NOT
      close a concurrency story ([[feedback-workflow-verify-by-running]])
- [ ] A PR-branch Express report is confirmed published and reachable
- [ ] `code-reviewer` 100% clean; merged to develop; `released_in:` at the next
      release cut

## Notes

- **2026-08-15 08:2x WIB — filed.** Surfaced while working the autonomous queue
  after #1614/#1687 merged. The inherited note said "the job has no lock or
  retry"; that was wrong — `allure-report.yml:48` has had the lock since
  SHY-0128. The real defect is that only 1 of 3 writers is inside it.
- Counting the writers is itself a worked example of measuring at the definition
  site: `grep -c peaceiris/actions-gh-pages` reports 4 writers repo-wide, but
  one of `test-backend.yml`'s two matches is a comment explaining the race. The
  `uses:`-anchored count reports the true 3.
- The reusable-workflow route was chosen over adding job-level
  `concurrency: gh-pages-deploy` to the two offending jobs, because the latter
  depends on job-level and workflow-level groups of the same name sharing one
  queue across workflows. That is probably true, but it is an assumption, and a
  single reusable workflow makes serialization true **by construction** using a
  mechanism this repo already runs in production.

- **2026-08-15 08:4x WIB — pickup. The assumption above was MEASURED, and it
  holds, so the design is simplified.** Two throwaway probe workflows on a
  scratch branch (deleted local + remote afterwards), both claiming
  `group: shy0298-probe`, one declaring it at WORKFLOW level and one at JOB
  level, each sleeping 75s, both triggered by a single push:

  ```
  A-START 01:38:08   (workflow-level group)
  A-END   01:39:23
  B-START 01:39:28   (job-level group, DIFFERENT workflow)
  B-END   01:40:43
  ```

  **Zero overlap** — B started 5s after A ended. A workflow-level group and a
  job-level group of the same name share ONE queue across workflows. Measured,
  not read off the docs ([[feedback-workflow-verify-by-running]]).

  **Revised design, and why it is better:**

  - Serialize by putting `concurrency: group: gh-pages-deploy` on each publish
    **job** in `pr-checks.yml` and `test-backend.yml`. `allure-report.yml` keeps
    its existing WORKFLOW-level group and is otherwise untouched — the probe
    proves all three then share one queue.
  - Keep "exactly one peaceiris invocation" via a **composite action**
    (`.github/actions/publish-gh-pages/`), not a reusable workflow. Composite
    actions add no nesting level and carry no concurrency of their own, so they
    cannot deadlock.

  This drops two hazards the reusable-workflow route carried:

  1. **Nesting depth.** `pr-checks` → `playwright-tests` → `allure-report` → a
     publisher workflow is **exactly 4 levels**, GitHub's hard limit, with zero
     headroom for a future caller.
  2. **Self-deadlock.** `allure-report.yml` already HOLDS `gh-pages-deploy` at
     workflow level; a reusable workflow it calls that wants the same group
     would wait on a lock its own run holds.

  Happy-path AC #1/#3 are amended accordingly: "a single reusable workflow
  `publish-gh-pages.yml`" becomes "a single composite action
  `.github/actions/publish-gh-pages/`", and callers `uses:` the action rather
  than calling a workflow. Every other AC stands unchanged, including the
  one-invocation count and the restored PR-branch Express reports.

- **Follow-up, deliberately not in scope:** `allure-report.yml` holds
  `gh-pages-deploy` at WORKFLOW level, so the lock covers its history restore
  and report generation too, not just the push. Measured at ~1m33s in practice
  (the 20-min `timeout-minutes` is a safety net, not the norm), so queueing
  behind it is acceptable and this story does not touch it. Narrowing that lock
  to a publish-only job would need the same artifact hand-off and is worth its
  own story if allure generation ever grows.

- **2026-08-15 09:0x–10:2x WIB — implemented, and the DoD's live proof is
  done on the REAL code path.**

  TDD: `gh-pages-publisher.test.js` written first, observed RED — 9 failing.
  Instructively, the 3 that passed at RED passed **vacuously**: with no
  publishing jobs in existence, three "never" assertions cannot fail. The
  paired necessity assertion ("at least one workflow publishes") failed
  correctly, which is the only reason the vacuity was visible.

  **Mutation matrix — every pin proven to fail** (baseline 28/28):

  | mutant                                      | caught by |
  | ------------------------------------------- | --------- |
  | drop the publish job's concurrency group    | 2 tests   |
  | `cancel-in-progress: true`                  | 1         |
  | restore the dev/prod publishing restriction | 5         |
  | remove the `keep_files: false` line         | 1         |
  | `keep_files: true` (the REAL setting)       | 1         |
  | remove the dependabot guard                 | 1         |
  | drop the empty-directory refusal            | 1         |
  | re-add a direct `peaceiris` use             | 3         |

  **Mutation found two real defects in my own pins**, both fixed:

  1. A `keep_files` assertion that **PASSED with the setting deleted**, because
     `toMatch(/keep_files:\s*false/)` matched the neighbouring COMMENT that
     explains the flag. Now reads the PARSED input
     (`step.with.keep_files === false`). Third instance this session of
     [[feedback-substring-is-not-existence]] — this time in a test I wrote to
     enforce that very lesson.
  2. The invocation count missed `- uses: peaceiris/...` entirely: `^\s*uses:`
     matches only the second of YAML's two legal step forms. A re-added writer
     in the first form was invisible. Now a string predicate that strips an
     optional leading `- ` (also avoids the `sonarjs/slow-regex` backtracking
     that both regex attempts tripped).

  **Two sibling suites went red and were FOLLOWED, not deleted.**
  `allure-report-gh-pages-cap.test.js` and `allure-report-restore-perf.test.js`
  pinned the old per-workflow structure. The invariant they protect —
  `keep_files: false` **plus** per-suite/env scoped destinations — is still
  true; the scoped-destination half is precisely what makes `keep_files: false`
  safe, since it cleans `destination_dir` before copying. The pins now assert
  it at its new home, and a new test asserts the `keep_files` invariant still
  has an owner, so it cannot be quietly dropped
  ([[feedback-tests-can-pin-the-bug-as-the-contract]]).

  Two now-false comments were corrected rather than left: both
  `allure-report.yml`'s cap step and the cap test's header stated that the
  kotlin deploy sits OUTSIDE the group and can land mid-cap. It no longer can.

  ### DoD evidence

  | DoD item                                                             | evidence                                                                                                                                                                                                                                                                                |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | pins RED first, then green                                           | 9 RED → 12 green; full suite **147 suites / 7488 tests**                                                                                                                                                                                                                                |
  | gates                                                                | `actionlint` clean with **shellcheck present** (verified — a clean run without it proves nothing), `eslint --max-warnings=0`, prettier                                                                                                                                                  |
  | every pin fails against its mutant                                   | matrix above, 8 mutants, all caught                                                                                                                                                                                                                                                     |
  | **two publishes overlap, both succeed, one queued behind the other** | run pair on `tmp/shy0298-contention` (deleted): two workflows using the REAL composite action and the REAL group, one push → `ENTER-b 03:17:08 / LEAVE-b 03:17:59 / ENTER-a 03:18:08 / LEAVE-a 03:18:59` — **zero overlap**, A entered 9s after B released; both published successfully |
  | a PR-branch Express report is published and reachable                | `express/pr/latest` now exists on `gh-pages` with real coverage content (`index.html`, `base.css`, `metadata.json`, …) — the report the old avoidance-mitigation had switched off                                                                                                       |

  PR [#1751](https://github.com/Shyden-Ltd/ShyTalk/pull/1751): **26/26 checks
  green**, including the two new publish jobs
  (`Publish Kotlin Report`, `test-backend / Publish Express Report`).

  **Scratch cleanup:** the contention probe wrote `scratch/shy0298-{a,b}/latest`
  to `gh-pages`. Removed via the Git Data API (base-tree + `sha: null` on that
  one entry, then a fast-forward ref update — `force: false`), NOT by cloning:
  `gh-pages` is ~7 GiB. Verified afterwards that the branch holds exactly its
  seven real entries (`.nojekyll CNAME android-e2e express index.html kotlin
playwright`) and both probe branches are gone local and remote.

  **Not done:** no `code-reviewer` agent was dispatched — this session is
  configured not to invoke agents unless asked. The diff was self-reviewed
  instead, and the mutation matrix is the substantive check. Flag for the
  operator if a formal agent review is wanted before merge.

- **2026-08-16 — R4, and a design reversal recorded in the spec itself.**

  The R3 note above records a contention probe in which one publish queued
  behind another with **zero overlap**, and reads as a success. It was a
  successful measurement of the wrong design. A concurrency group holds exactly
  ONE pending entry: a third contender does not queue, it CANCELS the second
  (this repo's incidents #568/#570). A cancelled publish is a failed job, and
  `allure-report.yml` is reachable from the required PR Gate, so the lock
  would have red-gated innocent PRs to protect a report. The probe used TWO
  contenders and so could not have seen it. **Two is not enough contenders to
  test a queue.**

  The spec above has been amended in place — title, Why, four AC bullets, Test
  Plan, Dependencies, Risks, DoD — rather than left describing a design the
  code no longer implements ([[feedback-stories-epics-and-two-surface-sync]]).

  **R4 findings, all reproduced before being fixed:**

  1. *The cap could never have capped.* It created the orphan through
     `gh api -X POST .../git/commits`, which exists only server-side and is
     referenced by no ref, so the `--depth=1` clone that must push it does not
     contain the object: `fatal: bad object`, then `! [remote rejected] …
     (unpacker error)`. That stderr also matched the lost-race pattern
     `\[rejected\]`, so the step would have reported "tip moved" on every
     capped run, forever, while never capping once. Now built locally with
     `git commit-tree "HEAD^{tree}"`, and the pattern is anchored to
     `! \[rejected\]`.
  2. *A publish failure could red-gate a PR.* `allure-report.yml` is reachable
     from `gate.needs` through `playwright-web → playwright-tests.yml`, and a
     reusable workflow's conclusion aggregates its jobs recursively.
     `generate-report` is now `continue-on-error`, with a test that walks
     `uses:` transitively from the gate asserting every reachable publisher is
     non-gating.
  3. *The retry loop's failure paths had never executed.* `BACKOFF_BASE` is
     overridable and `sleep` is shimmed to RECORD rather than wait, which made
     the schedule assertable and dropped the suite from ~43s to ~8s.

  **Also fixed:** an empty `$NEW` would have made the cap's refspec
  `:refs/heads/gh-pages` — git's spelling of *delete the branch* — from a step
  whose purpose is to preserve what it compacts; now refused explicitly.
  `check-action-shell.sh` no longer reads `SHELLCHECK_OPTS` from the
  environment (shellcheck reads it natively, so an inherited `--severity=error`
  silenced the check while it still printed "clean"), and now finds
  `action.yaml` as well as `action.yml`.

  **Five tests that pinned the old API design as the contract were rewritten,
  not deleted** — each one's intent survives, and the `gh` shim now REFUSES any
  Git Data API call so the old design cannot creep back
  ([[feedback-tests-can-pin-the-bug-as-the-contract]]).

  **Twelve mutants verified.** The cap's content-identity claim is now proven
  against REAL git: the same extracted block executing against a real bare repo
  via an `insteadOf` rewrite, asserting the capped branch's tree is the SAME
  OBJECT and that a racing publisher's report survives.

  **Known-uncovered, stated rather than papered over:** the loop's re-fetch
  failure branch. Reaching it needs a push that fails with a non-fast-forward
  (a reachable remote) and then a fetch that fails (an unreachable one), with
  no injection point in between. It is pinned structurally instead.

  **Not done:** no `code-reviewer` agent dispatched — this session does not
  invoke agents unless asked. Self-reviewed; the mutation matrix is the
  substantive check.

  **Follow-up filed (not folded in):** `express-api/scripts/gauntlet/lib.sh:61`
  tests `[ -d "$REPO/.git" ]`, which is false in a linked worktree (`.git` is a
  FILE there), so every gauntlet command dies "repo not found". Four tests in
  `50-matrix-cmd-stop.test.js` fail for this reason when run from a worktree
  and pass in the main checkout — confirmed pre-existing and unrelated to this
  diff. Out of SHY-0298's scope.

- **2026-08-16 — CI found a third production defect, and it was the tests
  working.** The two real-git tests failed on CI with `fatal: empty ident
  name`. Not a harness problem: `git commit-tree` runs in a fresh clone under
  `$RUNNER_TEMP` with no local identity, and a GitHub runner has no global one.
  It passed locally only because macOS git could build a fallback from the
  account. **The cap would have failed on its first real run**, which is the
  second time in this PR that executing the block found something no
  structural pin could ([[feedback-verify-the-harness-not-just-the-result]]).

  Fixed by declaring `GIT_AUTHOR_*`/`GIT_COMMITTER_*` on the step. The harness
  now reads the step's literal `env:` from the workflow rather than hardcoding
  it, so a deletion reddens these tests. Step env applies FIRST and harness
  values win — the step also declares `MAX_GH_PAGES_COMMITS: 25`, which would
  otherwise have silently disabled the cap for the 5-commit fixture (caught by
  the test, not by reading).

  `sonarcloud` failed for the same root cause; it runs the Jest suite for
  coverage. Fifteen mutants verified in total.

Reviewed-up-to: 4c2c8d01a188885d97d7a67b874894b5dc60c7b8
