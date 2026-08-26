---
id: SHY-0469
status: Draft
owner: unassigned
created: 2026-08-26
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0469: The stuck-run reaper cannot say why it failed to reap

## User Story

As **whoever is waiting on a workflow that will not start**, I want the reaper
to say what it could not do and why, so that a run it cannot clear does not
look exactly like one it cleared.

## Why

`reap-stuck-runs.yml` exists because of the 2026-04-29 incident (PR #370):
runs sat `queued` for four hours and blocked the queue. It runs every fifteen
minutes and cancels queued runs older than thirty.

On 2026-08-26 a `Deploy To Dev` run reached a state it cannot clear, and the
reaper ran twice against it — 15:51 and 16:43 — reporting only:

```
Cancelling run 32984228689 (Deploy To Dev on develop, queued since 15:09)...
##[warning]Failed to cancel run 32984228689 (may already be completed/cancelled)
Cancelled 0 stuck run(s).
```

"may already be completed/cancelled" is a guess, and it was wrong. The real
answer was one HTTP call away:

```
409  Cannot cancel a workflow run that has not been queued yet.
```

The run is in limbo: the list API reports it `queued`, the cancel endpoint says
it was never enqueued, and it has **zero jobs**. Deleting it is refused too —
`403 Could not delete the workflow run`, because it is not completed. It is
uncancellable and undeletable, and it will sit in the queued list for as long
as GitHub keeps it, which means **the reaper will fail on it every fifteen
minutes, for ever**, while reporting a warning that says it probably already
succeeded.

The cost was not the run — a fresh dispatch of the same workflow scheduled
immediately, so it was blocking nothing. The cost was the diagnosis. Reading
`Cancelled 0` and a warning that guesses, with a deploy that would not start,
the reasonable conclusion is "Actions is broken", and acting on that means
waiting for a platform to recover that was never down.

`gh api ... >/dev/null 2>&1` is what threw the answer away. This is the same
shape as every other silent guard: the failure path is the one with no
information in it.

## Acceptance Criteria

### Happy path

- [ ] A run the reaper CAN cancel is still cancelled, and still counted.

### Error paths

- [ ] A cancel that fails reports the status code and the message the API gave,
      not a guess about what might have happened.
- [ ] A run that is uncancellable AND undeletable is named as such, so a reader
      knows it needs no further attention rather than wondering each run.

### Edge cases

- [ ] A run that has genuinely completed between listing and cancelling is
      distinguished from one that never enqueued — both fail the cancel, for
      opposite reasons.
- [ ] A run the reaper cannot clear does not make the job red every fifteen
      minutes for ever, and does not make it green either. It is reported.

### Performance

- [ ] No extra API calls in the common case: the error body is already in the
      response the reaper discards.

### Security

- [ ] No change to the token's scope. `actions: write` is what cancelling
      needs and all it needs.

### UX

- [ ] The job summary distinguishes "cancelled", "already finished" and
      "cannot be cleared", so the Actions list answers the question without
      opening the run.

### i18n

- [ ] None: operator tooling.

### Observability

- [ ] The reason a reap failed appears in the log verbatim. The whole defect is
      that it did not.

## BDD Scenarios

**Scenario: A run cannot be cleared**

- **Given** a workflow run stuck in a state the API refuses to cancel
- **When** the reaper runs
- **Then** it says which run, and what the API said about it

**Scenario: A run can be cleared**

- **Given** a workflow run queued past the threshold
- **When** the reaper runs
- **Then** it is cancelled and counted, as before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Script | The failure path prints the API's status and message rather than a fixed sentence. Driven with a real non-2xx response, not a patched console. |
| Script | A successful cancel is still counted, so the fix does not turn every reap into a report. |
| Workflow | The job summary separates cancelled, already-finished and unclearable. |

## Out of Scope

- Making GitHub cancel an unenqueued run. It refuses by design; the fix is to
  say so.
- The wedged run itself — a fresh dispatch of the same workflow scheduled
  immediately, so it blocks nothing and needs no intervention.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A permanently unclearable run makes the reaper red for ever | The AC requires it to be REPORTED rather than to fail the job, so a real regression is still visible. |
| Printing API errors leaks something | The bodies are workflow-run metadata on a public repository. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Run against the wedged run above and shown to print the 409 and its
      message.

## Notes

- Filed 2026-08-26. Found while investigating a deploy that would not start.
  The investigation cost far more than the fix, which is the argument for it.
- The wedged run is `32984228689`. It is a useful fixture while it lasts:
  uncancellable and undeletable, and therefore a real example of the case the
  reaper cannot currently describe.
