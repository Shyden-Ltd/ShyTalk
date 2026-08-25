---
id: SHY-0429
status: Draft
owner: claude
created: 2026-08-22
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0429: The app is killed for leaving a sync service running too long

## User Story

As **somebody using ShyTalk on Android**, I want the app to stay running while I
use it, so that I do not lose what I was doing to a crash I did nothing to cause.

## Why

Observed on a real OnePlus CPH2653 on 2026-08-22, during journey J38:

```
20:36:53  ForegroundServiceDidNotStopInTimeException:
          A foreground service of type dataSync did not stop within its timeout
          -> com.shyden.shytalk.dev KILLED
20:45:31  Stop FGS timeout: com.shyden.shytalk.local/...PmSyncService
```

Android imposes a **6-hour daily budget** on `dataSync` foreground services, and
throws `ForegroundServiceDidNotStopInTimeException` when a service does not stop
itself in time. That exception **kills the process**. It is not catchable in the
ordinary sense: the platform is terminating the app deliberately.

The `.dev` build was killed outright. The `.local` build hit the same timeout
nine minutes later and survived only because the run ended first — so this is
timing, not a difference between the two builds.

### Why this matters more than one crash

- It presents as a **random crash** with no user action behind it, so it will be
  reported as "the app just closes".
- It is **more likely the longer somebody uses the app**, i.e. it targets the
  most engaged people.
- `dataSync` is the wrong service type for anything long-lived; the budget exists
  precisely to stop apps holding it open.

## Acceptance Criteria

### Happy path

- [ ] `PmSyncService` stops itself well inside its foreground-service budget.
- [ ] Message sync still completes while the app is foregrounded.

### Error paths

- [ ] A sync that cannot finish stops the service and retries later rather than
      holding it open.
- [ ] The app is never killed by `ForegroundServiceDidNotStopInTimeException`.

### Edge cases

- [ ] Holds across a long session that exceeds the daily `dataSync` budget.
- [ ] Holds when the app is backgrounded and returned to repeatedly.
- [ ] Holds on Android 14+, where the timeout is enforced most strictly.

### Performance

- [ ] No regression in how quickly messages appear.

### Security

- [ ] No change to what is synced or to whom.

### UX

- [ ] Nobody sees the app close by itself.
- [ ] If sync is deferred, nothing in the interface claims it is still running.

### i18n

- [ ] No user-facing copy changes; any new notification text is translated for
      every MVP locale.

### Observability

- [ ] The service logs when it starts and when it stops itself, so a run that
      finishes early is distinguishable from one that never completed.
- [ ] A `ForegroundServiceDidNotStopInTimeException` is alertable rather than
      being lost among ordinary crashes.

## BDD Scenarios

**Scenario: A long session is not interrupted**

- **Given** somebody using ShyTalk for a long stretch
- **When** they carry on using it
- **Then** the app keeps running and never closes on its own

**Scenario: Messages still arrive**

- **Given** somebody waiting on new messages
- **When** the app syncs in the background
- **Then** the messages appear without the app being killed for it

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | The sync service stops itself, and the work that outlives it is scheduled rather than held open. |
| Device | A long session on a real handset logs no `ForegroundServiceDidNotStopInTimeException` and no `Stop FGS timeout`. |
| Regression | Messages still arrive as promptly as before the change. |

## Out of Scope

- Any other foreground service. This ticket covers `PmSyncService`.

## Dependencies

- None known. Needs the service's current lifecycle established first.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Shortening the service's life delays message delivery | Move long-lived sync to `WorkManager`, which is designed for it, and keep the foreground service for genuinely user-visible short work. |
| The crash is rare enough to be dismissed | It was seen twice in nine minutes on one handset during a single journey run. |
| Fixing the timeout hides a sync that never completes | Log completion explicitly, so a service stopping early is distinguishable from one finishing. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A long device session shows no `ForegroundServiceDidNotStopInTimeException`
      and no `Stop FGS timeout` for `PmSyncService`.

## Notes

- Found while re-running the SHY-0396 device journeys with screen recording. The
  crash is unrelated to support tickets; it surfaced because a recorded walk runs
  the app for minutes at a time rather than seconds.
- Investigation should start with `PmSyncService`'s service type and who calls
  `startForeground` / `stopSelf`, and whether the work belongs in `WorkManager`.
