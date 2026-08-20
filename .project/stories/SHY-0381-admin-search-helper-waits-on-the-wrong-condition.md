---
id: SHY-0381
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0381: The admin search helper waits for the wrong thing, so specs flake

## User Story

As **someone relying on the test suite to tell the truth**, I want a search
helper that waits for the search it asked for, so that a green run means the
product works and a red run means it does not.

## Why

`tests/web/admin-users-profile.spec.ts:36` — "search shows correct seeded user
data" — was **flaky on two consecutive pre-push runs** in the same session, both
times on the same assertion:

```
Error: expect(locator).toHaveValue(expected) failed
```

Twice in a row on the same assertion is not randomness; it is a race with a
fixed cause.

### Root cause

`searchUser()` (`tests/web/helpers/admin-auth.ts:79`) fills the ID, clicks
Search, and then waits for this:

```ts
const subtab = page.locator('.user-subtab[data-subtab="profile"]');
await expect(subtab).toBeVisible({ timeout: 10_000 });
```

That subtab is a **tab control, not a result**. Once any user has been searched,
it stays visible. So the wait can be satisfied by state left over from an earlier
search — including the helper's own **retry**, where the tab is guaranteed
already visible from attempt one. `doSearch()` returns `true` while the search
for *this* `uniqueId` is still in flight, or has failed outright.

The caller then asserts against a form that may still hold the **previous
user's** data, or none at all. The 15-second timeouts on those assertions are
generous, which is exactly why this presents as a flake rather than a
consistent failure.

### Why it matters beyond one spec

`searchUser` is a shared helper. Any spec that calls it inherits the same race,
and the retry makes it *more* likely to pass wrongly, not less — a retry that
cannot fail is worse than no retry.

## Acceptance Criteria

### Happy path

- [ ] The helper returns only once the searched-for user's data is actually on
      screen.
- [ ] Specs using it pass consistently across repeated runs.

### Error paths

- [ ] A search that genuinely fails still fails, with the existing diagnostics.
      The fix must not make failures quieter.
- [ ] A search for a user that does not exist is distinguishable from a search
      that has not finished.

### Edge cases

- [ ] The retry cannot succeed on state left by the first attempt.
- [ ] Searching for a second, different user after a first search waits for the
      **second** user, not the first.

### Performance

- [ ] No fixed sleeps. The wait is condition-based and returns as soon as the
      condition holds.

### Security

- [ ] No change to what the tests can reach; this is a test-helper fix only.

### UX

- [ ] Not user-facing.

### i18n

- [ ] No copy changes.

### Observability

- [ ] The existing two-attempt diagnostic (API responses, network errors,
      console errors) is preserved.

## BDD Scenarios

**Scenario: The helper waits for the user it asked for**

- **Given** an admin has already looked at one person's record
- **When** the tests search for a different person
- **Then** the helper waits until that second person's details are shown

**Scenario: A genuine failure is still a failure**

- **Given** a search that the backend refuses
- **When** the tests run
- **Then** they fail, with the diagnostics they produce today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Repeat runs | The affected spec passes N consecutive runs, where it previously flaked. |
| Mutation | Point the helper at a user whose data never loads; the helper must fail, not return early. This is the check that proves the wait is real. |
| Back-to-back search | Search user A then user B; assert the helper does not return on A's leftover state. |

## Out of Scope

- The admin profile UI itself, which is not at fault.
- The wider question of whether the two-attempt retry should exist at all.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A tighter wait turns a flake into a consistent red | That would be correct, not a regression — a real failure is the desired outcome. Diagnostics are preserved so the cause is visible. |
| Other specs depend on the loose behaviour | The helper is shared; run the full web suite, not just the one spec. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The affected spec proven stable over repeated runs.
- [ ] Mutation check demonstrates the new wait can actually fail.

## Notes

- Found while pushing SHY-0378 and SHY-0372; flaky on **both** pre-push runs,
  same spec, same assertion.
- Waiting on a container rather than on the specific result is the same shape as
  SHY-0372, where recovery was keyed on a value the failure path never changed.
