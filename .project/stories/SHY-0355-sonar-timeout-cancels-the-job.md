---
id: SHY-0355
status: Done
owner: claude
created: 2026-08-19
priority: P1
effort: XS
type: infra
roadmap_ids: []
mvp: true
released_in: v0.99.0
---

# SHY-0355: SonarCloud runs out of time and cancels itself, failing pull requests that did nothing wrong

## User Story

As **anyone waiting on a pull request**, I want the SonarCloud job to have enough
time to finish, so that a green board does not sit behind a red gate for a reason
that has nothing to do with my change.

## Why

**P1. It blocked two device-proven MVP fixes today, repeatedly, and it looks like
a code failure when it is a stopwatch.**

`sonarcloud.yml` sets `timeout-minutes: 15` on the analysis job. The job is
routinely slower than that under load, so GitHub **cancels** it — and `PR Gate`
treats `cancelled` as `failure`. The pull request then shows every individual
check passing, including SonarCloud's own external
`SonarCloud Code Analysis … pass` from sonarcloud.io, while the gate is red.

**Measured, not inferred** — the two cancelled jobs on PR #1812:

| run | started | completed | duration | budget |
| --- | --- | --- | --- | --- |
| 32210369314 | 03:45:16Z | 04:00:34Z | **15m18s** | 15m |
| 32218316687 | 05:26:41Z | 05:41:44Z | **15m03s** | 15m |

Both land within twenty seconds of the ceiling, which is what a timeout looks
like rather than a failure. A **successful** run of the same job on the same PR
took **9m37s** — so the budget leaves roughly five minutes of headroom, and any
queueing, cache miss or larger diff spends it.

**Why it is worse than a slow job.** The failure is silent about its cause. The
Sonar analysis itself SUCCEEDS and reports pass; only the GitHub job wrapper dies.
So the natural reading is "Sonar found something", and the natural response is to
re-run — which costs another fifteen minutes and usually fails the same way. Two
merges were held up for hours today by exactly that loop.

**There is precedent, and this is the same bug.** SHY-0329 fixed an identical
shape on the driver-checks job: a budget of 10 minutes against a step that cost
9m53s, *"cancelled the job deterministically … and failing `PR Gate` (which
treats `cancelled` as `failure`)"*. The lesson taken there — give a measured cost
real headroom, and pin it with a test that reads the real workflow — was not
applied here.

## Acceptance Criteria

### Happy path

- [ ] The SonarCloud job completes within its budget on a normal pull request, with headroom over the measured cost.
- [ ] A pull request whose analysis passes shows a green gate.

### Error paths

- [ ] A genuine Sonar quality-gate failure still fails the job — the budget change must not turn a real failure green.
- [ ] If the job does exhaust its budget, the reason is legible as a timeout rather than as an analysis failure.

### Edge cases

- [ ] A cold scanner cache does not push the job over the budget.
- [ ] A large diff (many changed files) does not push it over.

### Performance

- [ ] The budget is set from the measured cost with stated headroom, not guessed.
- [ ] Raising it does not slow the normal path: a job that finishes in ten minutes still finishes in ten minutes.

### Security

- [ ] N/A — a workflow timeout value. No credential, network or deployment surface changes.

### UX

- [ ] N/A — no user-facing surface.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The budget carries a comment naming the measurement it came from, so the next person to touch it knows what it is protecting.

## BDD Scenarios

**Scenario: A passing analysis produces a green gate**

- **Given** a change whose code analysis passes
- **When** the checks run
- **Then** the gate is green, rather than red for a reason unrelated to the change

**Scenario: A real problem is still reported**

- **Given** a change that introduces a genuine code-quality problem
- **When** the checks run
- **Then** it is still reported as a failure

## Test Plan

**CI-config-only classification**: the change is confined to
`.github/workflows/sonarcloud.yml` and its meta-test. No app, backend or website
runtime surface, so the device/browser gauntlet would exercise nothing related to
it. The full non-device gauntlet still runs.

### Jest — `express-api/tests/scripts/sonarcloud-timeout.test.js`

Modelled directly on `qa-runner-driver-checks-timeout.test.js` (SHY-0329), and
reading the **real** workflow file so it cannot drift from what CI runs.

- `the SonarCloud job declares a timeout` — a missing budget is its own hazard
- `the budget exceeds the measured cost with headroom` — **the defect, in one assertion**; fails at 15
- `the measured cost is named in the file, not inlined` — so the number states why it is what it is

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| budget returned to 15 | `the budget exceeds the measured cost with headroom` |
| `timeout-minutes` removed entirely | `the SonarCloud job declares a timeout` |

## Out of Scope

- Making the Sonar analysis itself faster. Worth doing, but a different piece of
  work; this story stops the job being cancelled while it is still working.
- The other reusable workflows' budgets. They are not currently failing; if one
  starts, it gets the same treatment.
- `PR Gate` treating `cancelled` as `failure` — that behaviour is correct and
  deliberate. A cancelled dependency genuinely is not a pass.

## Dependencies

- None. A one-value workflow change plus its test.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A larger budget hides a genuinely hung job | The budget stays finite and is set from a measurement with stated headroom, not removed. A hang still terminates, just not a job that was about to succeed. |
| The number drifts as analysis grows | The meta-test reads the real workflow and asserts against a named measured-cost constant, so outgrowing it fails on a developer's machine rather than as a cancelled job on somebody's PR. |
| The change masks a real Sonar failure | A genuine quality-gate failure is a job FAILURE, not a timeout; it is unaffected by the budget and is an explicit AC. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] The meta-test was observed failing at `timeout-minutes: 15` before the change.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `actionlint` clean; `eslint --max-warnings=0` and `prettier --check` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19 — diagnosed from timestamps, after three wrong guesses.** The
  failure was first taken for a flake, then for a concurrency-group collision,
  then for a self-inflicted `gh run rerun`. None of those held: the run had no
  competitor, the group is keyed on the PR head SHA, and a fresh SHA failed the
  same way. What settled it was measuring the job: **15m18s** and **15m03s**
  against a **15m** budget. Recorded because the first three theories were each
  plausible and each cost a cycle.

- **2026-08-19 — the tell is that Sonar itself PASSES.** The external
  `SonarCloud Code Analysis` check from sonarcloud.io reports **pass** on the
  same pull request whose `sonarcloud / SonarCloud Analysis` **job** is
  cancelled. Analysis completing while its wrapper is killed is the signature of
  a budget, not of a finding.

- **2026-08-19 — the fix proved itself on its own pull request.** #1823's own
  `sonarcloud / SonarCloud Analysis` job ran under the new 30-minute budget and
  **passed**, on the same infrastructure and at the same time of day that was
  cancelling #1800 and #1812 at fifteen minutes. That is the cleanest available
  evidence short of replaying the old value.

- **2026-08-19 — self-review (labelled as such, not an agent pass).** The change
  is one value plus a comment plus a test. Checked:
  - The budget is **finite** — raised, not removed — so a genuinely hung job
    still terminates. Only a job that was about to succeed stops being killed.
  - A real Sonar **quality-gate failure is a job FAILURE, not a timeout**, so it
    is unaffected by this value. The change cannot turn a red analysis green.
  - The meta-test anchors on the `sonarcloud:` job before reading
    `timeout-minutes`, so a timeout declared elsewhere in the file cannot
    satisfy it, and it reads the real workflow rather than a copy.

  **Not merged on the filing exemption.** This story is newly-added and Draft, so
  `pre-merge-check.sh` would have waved it through — the exact hole SHY-0353
  records. It ships a workflow change and a test, so it is moved to
  `In Review` and reviewed like any other implementation.

Reviewed-up-to: 29aa634b85b42ba31ad70c31488fdedacdbe8ccb
