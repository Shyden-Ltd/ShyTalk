---
id: SHY-0301
status: Draft
owner: claude
created: 2026-08-16
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0301: The stuck-run reaper cannot see the two states that actually block a PR

## User Story

As a **developer waiting on CI**, I want a run that will never start to be
cancelled automatically, so that **the next run in its concurrency group can
begin** instead of my PR sitting BLOCKED for hours with no failing check to
point at.

## Why

`.github/workflows/reap-stuck-runs.yml` exists to cancel runs that are stuck
and holding a queue. It finds them with a single API filter:

```
repos/${GITHUB_REPOSITORY}/actions/runs?status=queued&per_page=100
```

and its own comment says `status=queued` "is a single API filter that already
excludes in_progress, completed, etc." That is true, and it is the defect:
**`queued` is not the only non-running state.** GitHub's run `status` is one of
`queued`, `in_progress`, `completed`, `requested`, `waiting`, **`pending`** —
and the filter returns exactly one of them.

**Observed 2026-08-16, PR #1752.** Two runs of `PR Checks` on
`story/SHY-0143-persist-session-optimistic-coldstart`:

| run        | created | status        | note                                     |
| ---------- | ------- | ------------- | ---------------------------------------- |
| 31936812969 | 08:34Z  | `in_progress` | 16 jobs done, `Playwright (firefox)` hung |
| 31940113215 | 09:50Z  | `pending`     | **zero jobs**, never started              |

`pr-checks.yml` declares `concurrency: pr-checks-${{ github.head_ref }}` with
`cancel-in-progress: true`. The newer run could not start because the older one
held the group; `cancel-in-progress` did not evict it, because the newer run
never reached the point of starting. At 10:43Z — **53 minutes** after creation
and **2h09m** after the hung job began — neither had moved, and the reaper had
run four times without seeing either.

The cost is not a slow pipeline. `PR Gate` is a REQUIRED check, so the PR shows
`mergeStateStatus=BLOCKED` with **no failing check to investigate**. It looks
like CI is still working. It is not.

The `pending` half is the important one and the safe one: a run that has been
`pending` past the threshold has no jobs, so cancelling it destroys no work and
frees the group for the run that supersedes it. The `in_progress` half needs a
sharper predicate than age (see Out of Scope).

## Acceptance Criteria

### Happy path

- [ ] A run in status `pending` older than the threshold is cancelled, exactly
      as a `queued` one is today, and appears in the same audit output.
- [ ] A `queued` run older than the threshold is still cancelled — the existing
      behaviour is unchanged, not replaced.
- [ ] After the cancel, a superseded run in the same concurrency group starts
      without further intervention.

### Error paths

- [ ] A cancel that fails (permissions, run already finished) is logged with
      the run id and does not abort the sweep of the remaining runs.
- [ ] A run that transitions out of `pending` between the list and the cancel
      is a no-op, not a failure — the API's 409 is tolerated.
- [ ] If the API listing itself fails, the job fails loudly rather than
      reporting "no stuck runs found" ([[feedback-absence-of-work-reported-as-success]]).

### Edge cases

- [ ] A run created INSIDE the threshold window is left alone in every status —
      the sweep must never race a healthy run that is about to start.
- [ ] A `pending` run that is pending because it awaits a **deployment
      approval** or an environment gate is NOT cancelled; those are legitimately
      waiting on a human. Distinguished by the run carrying a pending
      deployment, not by age.
- [ ] Two statuses are queried, so a run cannot be cancelled twice by appearing
      in both result sets.

### Performance

- [ ] The sweep stays within its 5-minute `timeout-minutes` and its ~10s
      typical runtime. Two filtered list calls replace one; both are paginated
      and rate-limit friendly.

### Security

- [ ] No change to the workflow's permissions: it already holds
      `actions: write` to cancel.
- [ ] The cancel target is always a run id read from the API listing, never
      interpolated from a branch name or any other attacker-influenced field.

### UX

- [ ] The audit output names the STATUS of each run it cancels, so an operator
      reading the log can tell a `pending` reap from a `queued` one.

### i18n

- [ ] N/A — CI operator output, English-only by design.

### Observability

- [ ] The summary line reports counts per status ("cancelled 1 pending, 0
      queued"), so a zero is distinguishable from "the filter matched nothing
      because the query was wrong" ([[feedback-declared-list-can-lie-measure-definitions]]).

## BDD Scenarios

**Scenario: a pending run that will never start is reaped**

- **Given** a workflow run that has been `pending` for longer than the threshold
- **When** the reaper sweeps
- **Then** that run is cancelled and named in the audit output

**Scenario: the superseding run then starts**

- **Given** a pending run was reaped and another run waits on its concurrency
  group
- **When** the group is released
- **Then** the waiting run starts without anyone intervening

**Scenario: a young run is never touched**

- **Given** a run created two minutes ago in any status
- **When** the reaper sweeps with a thirty-minute threshold
- **Then** the run is left alone

**Scenario: a run awaiting human approval is not reaped**

- **Given** a run pending on a deployment approval for longer than the threshold
- **When** the reaper sweeps
- **Then** the run is left alone and the reason is logged

## Test Plan

**CI-config-only classification:** confined to `.github/workflows/**` and its
pin tests in `express-api/tests/scripts/` — no app, backend or website runtime
surface — so the device/browser gauntlet is exempt under the protocol's
exemption 2.

**RED first**, in `express-api/tests/scripts/reap-stuck-runs.test.js` (new):

- `the sweep queries the pending status as well as queued` — extracts the
  step's shell and asserts BOTH filters are issued. RED today: only
  `status=queued` appears.
- `a pending run past the threshold is selected` and `a queued run past the
  threshold is still selected` — execute the REAL extracted block against a
  canned `gh` shim returning a two-status fixture, asserting which run ids
  reach the cancel call. Executing rather than pinning, because a regex over
  the query string cannot tell a correct selection from an empty one — the
  lesson from SHY-0298, where the pinned block had never run.
- `a run inside the window is not selected`, per status.
- `a run with a pending deployment is not selected`.
- `a failed cancel does not abort the remaining cancels`.
- `a failed LISTING fails the job` — the absence-reported-as-success guard.

**Mutation checks** — each pin shown to fail against a mutant: drop the
`pending` query (selection pin RED); invert the `created_at < CUTOFF`
comparison; remove the deployment-approval exclusion; make a failed listing
exit 0.

**Green** — the new suite plus the full `express-api/tests/scripts/` suite;
`actionlint` with shellcheck present; `eslint --max-warnings=0`; prettier.

**Live proof** — the defect is an omission in a query, so the honest proof is a
real reap: leave a genuinely pending run in place and observe the scheduled
sweep cancel it, with the superseded run then starting.

## Out of Scope

- **Reaping hung `in_progress` runs.** The other half of the 2026-08-16
  incident was a `Playwright (firefox)` job running for over two hours inside
  an otherwise-complete run. Age alone cannot distinguish that from a healthy
  long job, and cancelling a real run mid-flight destroys work — it needs a
  predicate like "the run's other jobs are all complete AND this job has
  exceeded its own `timeout-minutes`". Worth doing, and worth doing on its own
  evidence rather than folded in here.
- Adding or lowering `timeout-minutes` on the Playwright jobs. That would have
  prevented this specific incident and is a sensible companion change, but it
  is a different decision with its own cost (a real slow run being killed).
- Changing any workflow's concurrency configuration.

## Dependencies

- `.github/workflows/reap-stuck-runs.yml` — the sweep being fixed.
- GitHub's run-status vocabulary. The `pending` status is the premise, so the
  test fixture must use a real recorded API response, not an invented one.

## Risks & Mitigations

- **Risk:** cancelling a `pending` run that was about to start anyway.
  **Mitigation:** the threshold is 30 minutes and a superseded run is by
  definition redundant; the run can be re-dispatched, and a cancelled run is
  visible in the audit output.
- **Risk:** the deployment-approval exclusion is wrong and a legitimate waiting
  run gets reaped. **Mitigation:** it has its own AC and its own test, and the
  exclusion fails CLOSED — anything the check cannot classify is left alone.
- **Risk:** the fix is written and pinned but never actually runs, which is how
  this gap survived in the first place. **Mitigation:** the tests EXECUTE the
  extracted block against a shimmed `gh`, and the DoD requires an observed live
  reap.

## Definition of Done

- [ ] RED tests written and observed failing before the fix.
- [ ] Both statuses swept; the existing `queued` behaviour unchanged.
- [ ] Every new pin proven to fail against its mutant.
- [ ] Full `tests/scripts` suite green; actionlint (shellcheck present), eslint
      `--max-warnings=0`, prettier clean.
- [ ] A real pending run observed being reaped, and the superseded run observed
      starting afterwards.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-16 — filed** from a live incident on PR #1752, not from reading.
  The PR sat `BLOCKED` with no failing check for over two hours; the cause was
  a `pending` run behind a hung `in_progress` one, and the reaper's
  `status=queued` filter is blind to both. The manual cancel that would have
  unblocked it required an operator permission this session does not hold, so
  the automated path is the one worth fixing.
- The reaper's comment — "`status=queued` is a single API filter that already
  excludes in_progress, completed, etc." — shows the narrowing was deliberate.
  It is correct about what it excludes and wrong about what that leaves out:
  `pending` is neither queued nor running, and it is the state a superseded run
  sits in.
