---
id: SHY-0534
status: Draft
owner: unassigned
created: 2026-09-19
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0534: Every develop merge reaches dev without anyone dispatching it

## User Story

As **Shyden, the operator**, I want every merge to `develop` to reach the dev
environment and the tester apps on its own, so that dev always shows what
`develop` contains and a change has run on dev before a promotion carries it to
production.

## Why

**Operator standing rule:** *"Deploy After Every Develop Merge: Once a merge to
`develop` completes and all checks pass, deploy the `develop` branch to the dev
environment. This is part of the merge, not an optional follow-up."*

`deploy-dev.yml` has one trigger, `workflow_dispatch` (line 5), and nothing in
`.github/workflows/` or `scripts/` dispatches it. A dev deploy happens only when a
session remembers to start one, so a merge that no session follows never reaches
dev. Dependabot's auto-merges are exactly those merges.

Measured on 2026-09-19, when run 35432105289 became the first dev deploy since
2026-09-06:

- The 11 dev deploys before it, back to 2026-09-01, were all `workflow_dispatch`.
  Then there were none for 13 days.
- In those 13 days `develop` gained 15 commits (`cf52450c3b8..1d9a21d`):
  **12 dependabot merges**, 2 release-bot board syncs and 1 session merge
  (#2204, docs only).
- Classified one commit at a time with `scripts/deploy-scope.sh`: **6 touch the
  apps** (android and ios, all dependabot, five on 09-07 and one on 09-14),
  5 are backend-only and 4 deploy nothing.

For 13 days six app dependency bumps, among them AGP and the GitLive Firebase
SDK, sat on `develop` without a tester build. A promotion in that window would
have shipped them to production without their ever having run on dev.

**Operator decision, 2026-09-19**, asked with the measurements above: deploy on
**every push to `develop`, plus a daily net** that deploys whatever a push
missed. Two options were declined:

- **A daily batch only.** It would have made 2 tester builds in those 13 days
  instead of up to 6, but dev would lag `develop` by up to 24 hours.
- **Server per merge, apps daily.**

## Acceptance Criteria

### Happy path

- [ ] A push to `develop` starts Deploy To Dev with no session action.
- [ ] That run deploys exactly the areas `scripts/deploy-scope.sh` derives from
      the diff since the last successful dev deploy. The classification stays
      in that one script: no `paths:` filter on the trigger duplicates it.
- [ ] Once a day, a scheduled run deploys `develop`'s head **only if** it differs
      from the last successful dev deploy's SHA.
- [ ] `workflow_dispatch` works unchanged, with its `ref` and `release-notes`
      inputs. Hand-written notes and deploying a specific SHA stay possible.

### Error paths

- [ ] When the baseline cannot be resolved, both new triggers keep the existing
      fail-safe and deploy everything (`deploy-dev.yml:74`).
- [ ] A failed automatic deploy leaves the baseline where it was, so the next
      push or daily run deploys the same changes again. A test pins this.
- [ ] A failed automatic deploy is reported without anyone watching Actions:
  - The run opens one tracking issue naming the run, the SHA and the failed
    jobs, or comments on that issue if it is already open.
  - The next green automatic run closes the tracking issue.
  - Today `deploy-dev.yml` reports failures nowhere, and nothing watches its
    runs. That is tolerable only while a session watches every dispatch.

### Edge cases

- [ ] **The default branch is `main`.** GitHub runs a `schedule:` trigger from
      the default branch's copy of the workflow, and checks out that branch
      unless told otherwise. The daily run must name `develop` explicitly,
      following the pattern in `playwright-nightly.yml:49`
      (`ref: ${{ inputs.ref || 'develop' }}`). A test fails if the scheduled
      path could deploy `main`.
- [ ] **The daily net only takes effect after the next promotion.** Until
      `deploy-dev.yml` reaches `main`, the schedule does nothing. The push
      trigger works as soon as this story merges to `develop`. Say so in the
      PR, rather than implying the net is live on merge.
- [ ] **Measure whether dependabot's merges fire the push trigger at all.**
      This is unmeasured today:
  - `dependabot-auto-merge.yml` enables auto-merge with `GITHUB_TOKEN`
    (`gh pr merge --auto --squash`). GitHub does not start workflow runs from
    events caused by that token, so a dependabot merge may start no `push` run.
  - The only push-triggered workflow on `develop` today,
    `sync-stories-to-issues.yml`, runs only when story files change. Its zero
    runs on dependabot commits therefore cannot answer the question.
  - After this story merges, find the first dependabot merge's run by matching
    `headSha` in `gh run list --branch develop --event push`. Never use
    `gh run list --commit`, which has returned empty for runs that exist.
  - This story's own merge is the positive control.
  - Record the result in Notes. If dependabot merges do not fire the trigger,
    the daily net is what delivers them. Changing the identity the auto-merge
    runs as is then its own story, raised with Shyden.
- [ ] **A burst of merges loses nothing.** Dependabot's weekly batch landed five
      app bumps on 09-07.
  - The `deploy-dev` concurrency group keeps `cancel-in-progress: false`, pinned
    by `express-api/tests/scripts/deploy-dev-concurrency.test.js`.
  - When a newer run replaces a pending one, nothing is lost, because the next
    run's diff starts from the last *successful* deploy.
  - A test proves it.
- [ ] **A successful run means everything it selected was deployed.** For each
      single-area change set (backend only, web only, apps only):
  - The selected jobs run. None is skipped because a job it `needs` was
    skipped for scope.
  - A run that concluded `success` with a selected job skipped would move the
    baseline past a change that never deployed.
  - Asserted from the workflow's `needs`/`if` graph in a test, and read on one
    real run.
- [ ] **A push with nothing to deploy stays quiet.** This covers the release
      bot's `board-items.json` sync, docs and story files (4 of the 15 measured
      commits). The push runs the scope job only: nothing is built and no tester
      is notified.
- [ ] **A daily run that finds dev current does nothing.** Its summary says so
      (`dev already at <sha>`), and no build job starts.
- [ ] **A push during a manual dispatch waits.** It queues behind the dispatch
      in the same concurrency group rather than running alongside it.

### Performance

- [ ] A push that touches no app code starts no macOS or Android build. The
      scope gating already does this.
- [ ] A daily run where `develop` has not moved finishes in under 2 minutes.

### Security

- [ ] The push trigger lists `develop` only. No `main`, no tags, no pull-request
      heads, and no `pull_request_target`. An automatic run executes only code
      already merged to `develop`, so a dependabot PR cannot reach deploy
      secrets before it merges.
- [ ] Triggering adds no new secret, token or permission. In particular, no
      personal access token is used to route around the `GITHUB_TOKEN` rule.

### UX

- [ ] Tester notes belong to **SHY-0361**. An automatic run has no human to pass
      `release-notes`, so until SHY-0361 lands:
  - The Android note falls back to `Dev build from develop (<sha>)`.
  - The iOS build carries no "What to Test" text at all. Its Upload to
    TestFlight step runs only `xcrun altool --upload-app`.

  See Dependencies for the ordering this forces.
- [ ] An automatic build's note says it is an automatic deploy of `develop` and
      names the trigger (push or daily). A tester can tell it from a
      hand-dispatched build.

### i18n

- [ ] N/A: there are no user-facing strings. Tester notes are English, matching
      SHY-0361.

### Observability

- [ ] Every run's summary states:
  - the trigger (push, schedule or dispatch);
  - the baseline SHA and the target SHA;
  - the scope decision.

  `deploy-dev.yml:145` already writes the baseline and its reason; the trigger
  is new.

## BDD Scenarios

**Scenario: A dependency bump reaches dev without anyone deploying it**

- **Given** a dependabot pull request has merged into `develop`
- **When** the merge lands
- **Then** the dev environment and the tester apps receive it without anyone
  starting a deploy

**Scenario: The daily net catches a merge nothing deployed**

- **Given** `develop` is ahead of the last successful dev deploy
- **When** the daily run starts
- **Then** it deploys `develop`'s head

**Scenario: The daily net stays quiet when dev is current**

- **Given** the last successful dev deploy is `develop`'s head
- **When** the daily run starts
- **Then** nothing is built or sent to testers, and the run says dev is current

**Scenario: A burst of merges loses nothing**

- **Given** several merges land while a deploy is running
- **When** the queued deploys run
- **Then** the next successful deploy contains every change since the last
  successful one

**Scenario: A failed automatic deploy is noticed**

- **Given** an automatic deploy fails
- **When** nobody is watching the run
- **Then** a tracking issue names the run and the failed jobs, and the next run
  deploys the same changes again

## Test Plan

**RED first.** Today's file is `workflow_dispatch` only, so a workflow test
asserting that `on.push.branches` is `['develop']` and that `on.schedule` exists
fails against it.

1. Workflow-structure tests, alongside
   `express-api/tests/scripts/deploy-dev-concurrency.test.js`:
   - the triggers are push to `develop`, the daily schedule and dispatch;
   - there is no `pull_request_target` and no branch other than `develop`;
   - the concurrency pin is unchanged;
   - the `needs`/`if` graph runs every selected area on its own.
2. The "has `develop` moved?" decision lives in a script, testable without
   dispatching a workflow. This is the same principle as `deploy-scope.sh`'s
   header. Cases: moved, current, baseline unresolved, and a baseline missing
   from the checkout.
3. The net's decision is also reachable from `workflow_dispatch` through an
   input. That lets it be read on a real run before the promotion makes the
   schedule live.
4. The scheduled path's target ref resolves to `develop`, never the default
   branch.
5. Failure reporting:
   - a failed run opens a tracking issue;
   - it comments on one that is already open;
   - the next green run closes it.
6. Mutations, each seen going red, with the whole suite run for every mutation:
   - drop the push trigger;
   - make the net deploy when dev is current;
   - point the scheduled ref at the default branch;
   - make a selected area skip when its `needs` job is skipped for scope;
   - swallow a failed deploy without reporting it.
7. Real runs, each read by job name:
   - this story's own merge, which is the first push-triggered run and the
     positive control;
   - the next dependabot merge, which is the measurement;
   - the net through dispatch, once when `develop` has moved and once when dev
     is current;
   - after the next promotion, the first scheduled run.

## Out of Scope

- What tester notes say: SHY-0361.
- What counts as deployable: `scripts/deploy-scope.sh` (SHY-0347) is reused
  unchanged.
- Production deploys and promotions, which stay Shyden-triggered.
- Changing the identity dependabot's auto-merge runs as. If the measurement
  shows it is needed, that becomes its own story, raised with Shyden.

## Dependencies

- **SHY-0361 (tester notes name the ticket) merges first, or together with this
  story.** Without it, every automatic build reaches testers with no ticket in
  its notes. That breaks the operator's 2026-08-20 rule on every build, not just
  on an occasional forgotten dispatch. SHY-0361 is filed as P2; this ordering
  makes it effectively P1.
- **The next promotion to `main`**, for the daily net only (see Edge cases).
- A sibling in the same class: SHY-0519, the dev roadmap page that lags
  `develop` until a promotion. In both, a `develop` change waits on a person.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Too many tester builds | Measured at up to 6 app builds per platform in 13 days, all dependency bumps, bunched on dependabot's weekly day. A push with no app changes builds nothing, and SHY-0361 names the bump in the notes. |
| Dependabot merges never fire the push trigger (`GITHUB_TOKEN`) | The daily net delivers them within a day. The measurement after merge settles the question, using this story's own merge as the positive control. |
| The daily run deploys `main` (it checks out the default branch) | Name `develop` explicitly, as `playwright-nightly.yml` does, and add a test that goes red if the scheduled path could deploy `main`. |
| A run reports `success` with a selected area skipped | The `needs`/`if` graph test, and one real run per area. |
| An automatic deploy fails and nobody notices | A tracking issue, and the next run retries from the unchanged baseline. |
| A bad bump breaks dev for testers | That is what dev is for. Each push carries one bump, so the culprit is one commit, and dispatching the previous SHA restores dev. |
| An automatic run collides with a manual dispatch | Both share one concurrency group with `cancel-in-progress: false`, already pinned. |

## Definition of Done

- [ ] A push to `develop` deploys with no session action, read by job name on
      this story's own merge.
- [ ] The net read by job name on real runs, both when `develop` has moved and
      when dev is current, and the first scheduled run read after the next
      promotion.
- [ ] The dependabot measurement recorded in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.
- [ ] `released_in:` set on the next release cut.

## Notes

- **2026-09-19**: Filed from the gap found while dispatching Deploy To Dev run
  35432105289 on `develop` `1d9a21d`, the first dev deploy since 2026-09-06.
  Its notes were written by hand. The measurements are in *Why*.
  - Shyden chose every merge plus a daily net, via AskUserQuestion, over a
    daily batch only and over server per merge with apps daily.
  - Placed in EPIC-0001, beside its sibling SHY-0519.
