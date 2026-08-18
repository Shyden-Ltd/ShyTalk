---
id: SHY-0339
status: In Review
owner: claude
created: 2026-08-18
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0339: CI runs test suites that the change cannot possibly affect

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

- [x] A PR runs the web suite on chromium only.
- [x] A change confined to `express-api/tests/**` runs the backend suite but does NOT force the client matrix.
- [x] A change to backend RUNTIME code still forces the full client matrix, exactly as today.
- [x] A scheduled nightly run exercises all five projects on develop.
- [x] The release path still runs all five before anything reaches production.

### Error paths

- [x] A nightly failure is visible — it does not fail silently into a log nobody reads.
- [x] A chromium failure on a PR still blocks that PR exactly as today.

### Edge cases

- [x] The nightly can be dispatched manually for a specific ref, so a suspected cross-browser issue can be checked without waiting for the schedule.
- [x] A PR can opt into the full matrix when it is genuinely cross-browser work.

### Performance

- [x] Per-PR web-suite wall-clock drops by roughly the cost of four parallel setups; measured before and after and recorded in Notes.

### Security

- [x] N/A — changes which browsers run and when. No credential, permission or artefact-publication change.

### UX

- [x] N/A — CI-internal. The developer-facing outcome is a PR that answers in minutes.

### i18n

- [x] N/A — no user-facing strings.

### Observability

- [x] The nightly names itself clearly in the Actions list so a cross-browser failure is attributable at a glance.

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
| `github.base_ref == 'main' &&` removed from the release-path `web:` | `the RELEASE path still requests all browsers` |
| the `express-api/tests/scripts/drivers/*` arm removed | `driver TEST files are treated as tests, not as the shared core` |
| the nightly's `contents: write` reverted to `read` | `the nightly can WRITE contents...` |

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
| **A cross-browser regression reaches develop unnoticed** | Two independent mitigations, because the first has a gap. (1) The develop→main promotion PR runs ALL FIVE — `base_ref == 'main'` gated, mirroring android-e2e/ios-e2e — so nothing reaches production on one browser regardless of the nightly. (2) The nightly closes the develop-side window to a day. |
| **The nightly does not fire until this file reaches `main`** | **Real, and not hand-waved.** GitHub registers `schedule:` triggers ONLY from the DEFAULT branch. This repo's default is `main`, and everything reaches main via the develop→main promotion, which is currently backlogged. So between merging to develop and the next promotion, the nightly is INERT and this change is a coverage cut rather than a deferral. Mitigated by (1) above — the promotion PR itself runs all five — which is the ONLY active mitigation during the window. **`workflow_dispatch` does not help either**: it carries the same default-branch precondition, so a brand-new workflow file is not dispatchable from any ref until GitHub indexes it off `main`. Review round 1 corrected my earlier claim that it did. **Fix by including this in the next promotion**, and confirm with a manual dispatch attempt against `develop` right after merge — if it does not even appear, that is expected, not a fault. |
| The nightly is red for weeks and nobody looks | It names itself clearly and fails loudly; if that proves insufficient it needs an alert, filed separately rather than assumed. |
| Someone reverts the PR path to `all` for convenience | Asserted by a named test, and in the mutation table. |

## Definition of Done

- [x] Every AC met; every named test written RED first and now green.
- [x] Every mutation killed its named test, reverted with a git-verified clean tree.
- [x] Before/after wall-clock recorded in Notes.
- [x] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [x] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [x] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Raised after the operator asked how to speed delivery up. The
  measurement came first: twelve recent `pr-checks.yml` runs, median around an
  hour, several cancelled at timeout, four of the last six running all five
  browser projects.
- **2026-08-18** — Checked BEFORE proposing the cut: there is no scheduled
  browser run anywhere in the repo, so removing four projects from PRs without
  adding a nightly would have deleted that coverage rather than moved it.

- **2026-08-18** — Operator: *"you also need to be smart when to run certain test
  suites. for example, a story edit does not require you to run the full
  playwright suite. no functionality was changed."*

  Investigating that found the real cause, which was not the story file. Story
  edits ARE already excluded (`.project/*` and `*.md` set no flags). But
  `detect-changes` classifies the WHOLE PR diff, and this PR contained
  `express-api/tests/scripts/...`, which matched the generic `express-api/*` arm
  and set `BACKEND=true` — which the SHY-0127 rule reads as "the shared core
  changed, retest every client", forcing five browser suites and the device
  matrix and overriding the E2E skip markers.

  So five browser suites ran because a TEST file changed. Operator approved
  narrowing the rule to runtime paths only; `express-api/tests/**` now sets its
  own flag. Deliberately narrow — src, scripts, package.json and the rules files
  keep the full forcing, because a dependency or config change genuinely can
  reach a client. CLAUDE.md updated so the documented rule and the code agree.

- **2026-08-18** — `code-reviewer` round 1: two Criticals, both real, both mine.

  **The nightly would not have fired.** GitHub registers `schedule:` triggers
  only from the DEFAULT branch. The nightly lives on develop; the default is
  main; everything reaches main via a backlogged promotion. So for that whole
  window this change was exactly what the story claimed it was not — a coverage
  cut — while the Risk table asserted the mitigation unconditionally. Recorded
  above as its own risk row rather than softened.

  **The release-path AC was unmet and its own named test had been dropped.** The
  Test Plan named `the release path still requests all browsers`; the shipped
  file contained a different fourth test instead, with no note. And the
  behaviour did not exist: `web:` was unconditional, so the develop→main
  promotion PR — the last gate before production — would have got chromium like
  any feature PR. Before this story, "the release runs all five" was true only
  by ACCIDENT of every PR defaulting to `all`. Now `base_ref == 'main'` gated,
  mirroring android-e2e/ios-e2e, and the promised test exists.

  That is the "written up as done, never landed" pattern SHY-0328 documented,
  committed by me in the same session I wrote it down.

  Also fixed: `express-api/tests/scripts/drivers/*` was matched by the EARLIER
  drivers arm and inherited `BACKEND=true`, so a driver test still forced the
  full matrix — contradicting this story's own principle on one of the most
  frequently edited paths in the repo. And the nightly's `permissions:
  contents: read` would have 403'd the Allure publish every night, quietly,
  since allure-report has `continue-on-error` and only the report would have
  stopped updating.

  9 → 12 tests.

Reviewed-up-to: 449eb2e2976
