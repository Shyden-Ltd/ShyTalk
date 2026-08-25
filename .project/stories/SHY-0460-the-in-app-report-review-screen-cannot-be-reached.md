---
id: SHY-0460
status: Draft
owner: unassigned
created: 2026-08-25
priority: P3
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0460: The in-app report-review screen cannot be reached

## User Story

As **whoever maintains this codebase**, I want screens that exist to be
reachable, so that nobody spends a day writing a test for a surface no person
can open.

## Why

`ReportReviewScreen` is fully built, carries testTags (`reportReview_list`,
`reportReview_emptyState`, `reportReview_backButton`), is registered as a
`composable` in **both** nav graphs, and has a unit test asserting its route
string. Nothing navigates to it. Searched across `shared/src` and `app/src`:

```
Screen.kt:45                 data object ReportReview : Screen("report_review")
SharedNavGraph.kt:753        composable(Screen.ReportReview.route) { ... }
NavGraph.kt:868              composable(Screen.ReportReview.route) { ... }
ScreenTest.kt:29,238         asserts the route string
```

There is no `navigate(Screen.ReportReview.route)` anywhere, and no deep link.
The moderation queues a human actually uses are the **web** admin console
(`public/admin/js/tabs/appeals.js`, `audit-log.js`, `reports.js`).

Found on 2026-08-25 while converting J12 to a real device journey under
[[SHY-0457]]. It could not be converted, because there is no way to open the
screen it would drive. J12 is now declared `api-contract` and says so in its
title rather than implying a device walk it cannot perform.

The route being registered in two graphs and pinned by a unit test is what made
this invisible: everything about it looks alive.

## Acceptance Criteria

### Happy path

- [ ] Either an admin can reach the review screen from inside the app, or the
      screen, its route, its nav registrations and its test are removed.

### Error paths

- [ ] If it is kept, a non-admin reaching the route is refused.

### Edge cases

- [ ] If it is removed, no dangling `Screen` entry or nav registration is left
      behind — the leftovers are what made this look reachable.

### Security

- [ ] If it is kept, the queue is admin-gated server-side, not merely hidden.

### UX

- [ ] Decide deliberately whether in-app moderation is wanted at all, given the
      web console already does it.

### i18n

- [ ] `report_review` is translated in 21 locales. If the screen goes, so do
      they.

### Observability

- [ ] No change.

## BDD Scenarios

**Scenario: A moderator wants the queue on their phone**

- **Given** somebody signed in as an admin
- **When** they look for the moderation queue in the app
- **Then** they can either open it or it is not advertised at all

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | No `Screen` entry exists without a navigation path to it. |
| Device | If kept: an admin opens the queue; a non-admin cannot. |

## Out of Scope

- Building a full in-app moderation console. This story is about the
  contradiction, not a new feature.

## Dependencies

- [[SHY-0457]] — the conversion work that found it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Removing it loses work someone intended to finish | The decision is the story; if it is wanted, the AC allows wiring it up instead. |
| Another orphaned screen exists | Worth a guard: a `Screen` with no navigation path is dead by definition. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Either reachable and device-proven, or gone with no leftovers.

## Notes

- Filed 2026-08-25. The screen has testTags for a journey that could never run.
