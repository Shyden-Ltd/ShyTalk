---
id: SHY-0339
status: In Progress
owner: claude
created: 2026-08-18
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0339: Every PR waits on five browser suites to learn what one would tell it

## User Story

As **anyone waiting on a PR**, I want the per-PR web tests to run one browser and
the full five to run nightly, so that feedback arrives in minutes instead of an
hour without losing cross-browser coverage.

## Why

**The dominant cost in the delivery pipeline is waiting for CI, and this is the
largest single item in it.**

Measured 2026-08-18 across the last twelve `pr-checks.yml` runs:
`1m, 65m, 147m, 184m, 72m, 8m, 7m, 1m, 22m, 11m, 44m, 82m` — with several
**cancelled at timeout**. Four of the last six ran the full five-project
Playwright matrix (`pr-checks.yml:447` passes `web: 'all'`).

The five projects run **in parallel but each pays the full setup cost** —
checkout, JDK/Gradle, node, npm ci, browser install, apt system deps, local
services, Firebase emulators, seeding, Express start. Five times, per PR.

The consequence compounds with the MVP backlog: 61 stories at roughly an hour of
CI each is 61 hours of pure waiting, before anyone writes a line of code.

**What this is NOT.** It is not a reduction in cross-browser coverage. Today
there is no scheduled run at all — the five projects run **only** on PRs. So the
honest change is two-sided: PRs get chromium, and a **nightly** run gets all
five. A regression that only shows in WebKit is currently found on the next PR
that happens to touch web; afterwards it is found within a day, by a run whose
whole purpose is to find it.

## Acceptance Criteria

### Happy path

- [ ] A PR runs the web suite on chromium only.
- [ ] A scheduled nightly run exercises all five projects on develop.
- [ ] The release path still runs all five before anything reaches production.

### Error paths

- [ ] A nightly failure is visible — it does not fail silently into a log nobody reads.
- [ ] A chromium failure on a PR still blocks that PR exactly as today.

### Edge cases

- [ ] The nightly can be dispatched manually for a specific ref, so a suspected cross-browser issue can be checked without waiting for the schedule.
- [ ] A PR can opt into the full matrix when it is genuinely cross-browser work.

### Performance

- [ ] Per-PR web-suite wall-clock drops by roughly the cost of four parallel setups; measured before and after and recorded in Notes.

### Security

- [ ] N/A — changes which browsers run and when. No credential, permission or artefact-publication change.

### UX

- [ ] N/A — CI-internal. The developer-facing outcome is a PR that answers in minutes.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The nightly names itself clearly in the Actions list so a cross-browser failure is attributable at a glance.

## BDD Scenarios

**Scenario: A change gets fast feedback**

- **Given** a developer opens a pull request touching the website
- **When** the automated checks run
- **Then** the web tests report back on one browser within a few minutes

**Scenario: A browser-specific problem is still caught**

- **Given** a change that breaks the site only in Safari
- **When** the nightly full-browser run happens
- **Then** the failure is reported against that browser

## Test Plan

### Node / Jest — `express-api/tests/scripts/pr-checks-playwright-scope.test.js`

- **`the PR path requests ONE browser, not all`** — the defect in one assertion
- `a scheduled nightly run exists and requests ALL browsers`
- `the nightly is dispatchable manually with a ref`
- `the release path still requests all browsers`

Reads the real workflow files, so it cannot drift from what CI does.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the PR path reverted to `web: 'all'` | `the PR path requests ONE browser` |
| the nightly's schedule removed | `a scheduled nightly run exists` |
| the nightly narrowed to chromium | `...and requests ALL browsers` |

### Real-run proof

- The next PR's `playwright-web` shows one project, and its wall-clock is
  recorded against the before-figure in Notes.
- The nightly is dispatched once manually and observed running five projects.

### CI-config-only classification

Touches `.github/workflows/**` and a meta-test under `express-api/tests/scripts/**`.
No app, backend or website runtime surface → **CI-config-only**.

## Out of Scope

- Reducing what any single project runs. The suite's content is unchanged.
- The device (Android/iOS) journey matrix — a different gate, unaffected.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| **A cross-browser regression reaches develop unnoticed** | The nightly closes the window to one day, where today there is NO scheduled run at all — this strictly increases scheduled coverage. |
| The nightly is red for weeks and nobody looks | It names itself clearly and fails loudly; if that proves insufficient it needs an alert, filed separately rather than assumed. |
| Someone reverts the PR path to `all` for convenience | Asserted by a named test, and in the mutation table. |

## Definition of Done

- [ ] Every AC met; every named test written RED first and now green.
- [ ] Every mutation killed its named test, reverted with a git-verified clean tree.
- [ ] Before/after wall-clock recorded in Notes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Raised after the operator asked how to speed delivery up. The
  measurement came first: twelve recent `pr-checks.yml` runs, median around an
  hour, several cancelled at timeout, four of the last six running all five
  browser projects.
- **2026-08-18** — Checked BEFORE proposing the cut: there is no scheduled
  browser run anywhere in the repo, so removing four projects from PRs without
  adding a nightly would have deleted that coverage rather than moved it.
