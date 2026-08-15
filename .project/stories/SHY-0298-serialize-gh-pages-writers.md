---
id: SHY-0298
status: Draft
owner: claude
created: 2026-08-15
priority: P2
effort: M
type: infra
roadmap_ids: []
---

# SHY-0298: Serialize every gh-pages writer, and give PR branches their reports back

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

**Why serialization is the fix and a retry is not.** A retry loop makes each
writer eventually succeed while still doing redundant clone/push cycles under
contention, and it cannot fix the `gh-pages` history-cap step in
`allure-report.yml:234`, which re-reads the tip and skips when an outside writer
lands mid-cap. One queue removes the interleaving instead of surviving it —
[[feedback-close-the-door-not-just-the-holes]].

## Acceptance Criteria

### Happy path

- [ ] A single reusable workflow `.github/workflows/publish-gh-pages.yml` owns
      every `peaceiris/actions-gh-pages` invocation in the repo; `grep -c` for
      `^\s*uses:\s*peaceiris/` across `.github/workflows/` returns exactly 1.
- [ ] It declares workflow-level `concurrency: group: gh-pages-deploy` with
      `cancel-in-progress: false`, so every invocation from every caller queues
      on one lock (the mechanism `allure-report.yml` already proves works).
- [ ] `pr-checks.yml` and `test-backend.yml` publish by uploading the report as
      an artifact and calling the reusable workflow, not by invoking peaceiris.
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
- [ ] The `gh-pages` history-cap step keeps working: with one queue there is no
      "writer outside the group", so the cap's skip-on-race branch becomes
      unreachable rather than merely rare.
- [ ] Two PRs whose CI completes in the same minute both publish successfully,
      in some order — neither is rejected.

### Performance

- [ ] Serializing must not serialize the PRODUCING jobs. `Build & Test`
      (~15 min) and `Test Backend` (~5 min) keep running concurrently across
      PRs; only the seconds-long publish step queues. Verified by asserting the
      concurrency group appears on the publish job/workflow ONLY, never on a
      job that runs tests.

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
- `the publisher declares the shared concurrency group` — asserts
  `publish-gh-pages.yml` carries `group: gh-pages-deploy` and
  `cancel-in-progress: false` at workflow level.
- `no test-producing job carries the publish concurrency group` — walks each
  workflow's jobs and asserts `gh-pages-deploy` never appears on a job that also
  runs a test step, pinning the performance AC.
- `pr-checks.yml and test-backend.yml call the publisher` — asserts a
  `uses: ./.github/workflows/publish-gh-pages.yml` in each.
- `PR-branch Express reports are no longer skipped` — asserts the
  `report_env == 'dev'` restriction is gone from the publish condition while the
  `dependabot/` guard remains. RED today.
- `the dependabot guard lives in the publisher` — so a future caller cannot omit it.

**Green** — the above suite, plus the full `express-api/tests/scripts/` suite
(146 suites / 7475 tests as of `0496f74c835`) to prove no sibling pin regressed;
`actionlint` (with shellcheck present — a clean actionlint run with shellcheck
ABSENT proves nothing, [[feedback-verify-the-harness-not-just-the-result]]);
`eslint --max-warnings=0`; prettier.

**Mutation checks** — each new pin must be shown to fail against a mutant:
restore one peaceiris invocation (count pin RED); drop `cancel-in-progress:
false` (group pin RED); move `gh-pages-deploy` onto the `Test Backend` job
(performance pin RED). A pin that cannot fail is decoration
([[feedback-mutation-passed-means-investigate]]).

**Live proof** — the race is a concurrency defect, so a passing unit suite is
not evidence: two PRs must actually publish at once (see DoD).

## Out of Scope

- Shrinking the `gh-pages` branch itself (tracked by SHY-0128).
- Changing what the reports CONTAIN, or the reports site's layout.
- Moving off `peaceiris/actions-gh-pages` to a hand-rolled push.
- Publishing reports for forked-PR runs (their token cannot push at all).

## Dependencies

- None. `allure-report.yml`'s existing `gh-pages-deploy` workflow-level group is
  the pattern being generalised, and it is already proven in production.

## Risks & Mitigations

- **Risk:** a shared queue becomes a bottleneck if many PRs finish together.
  **Mitigation:** only the publish step queues (seconds), never the test jobs;
  the performance AC has its own pin. `cancel-in-progress: false` is required —
  cancelling would drop reports rather than delay them.
- **Risk:** artifact hand-off adds a failure mode the direct step did not have.
  **Mitigation:** an explicit missing-artifact error path (Error-paths AC #3)
  rather than publishing an empty directory over a good report.
- **Risk:** re-enabling PR-branch publishing grows `gh-pages` faster.
  **Mitigation:** `keep_files: false` already replaces each suite/env's
  `latest/` in place rather than accumulating, and the history cap in
  `allure-report.yml:234` still applies. If growth becomes a problem it is
  SHY-0128's scope, and the restriction can be re-applied as one line.
- **Risk:** nested reusable-workflow depth. **Mitigation:** GitHub allows 4
  levels; the deepest path here is caller → `allure-report.yml` → publisher = 3.

## Definition of Done

- [ ] New pin suite RED first, then green; full `tests/scripts` suite green;
      actionlint (shellcheck present), eslint `--max-warnings=0`, prettier clean
- [ ] Every new pin proven to fail against its mutant
- [ ] **Live proof of the actual defect:** two PRs' publishes dispatched to
      overlap deliberately, both succeeding, with the run logs showing one
      queued behind the other on `gh-pages-deploy` — a green unit suite does NOT
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
