---
id: SHY-0516
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: S
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0004
---

# SHY-0516: A mandatory update is drawn first, from a verdict the app already has

## User Story

As **somebody whose app version is no longer allowed**, I want the update
screen to be the first thing I see when I open the app, so that I am not
shown my rooms for a moment and then interrupted, and so that I see it even
when I am offline.

## Why

SHY-0500 made cold start draw the room list before any network call and
confirm afterwards. The minimum-version check kept its old place: the version
and health calls start alongside the draw (`MainActivity.kt`, the
`versionDeferred` / `healthDeferred` pair) and `ForceUpdateScreen()`
(`MainActivity.kt:605`) is laid over the app when the answer arrives. Two
consequences:

- A phone below the minimum shows the room list for the round-trip's length,
  then the wall. The wall is right; the flash before it is not.
- Offline, the answer never arrives, so a version the server has already
  refused keeps running on cached content until it can reach the server —
  the exact opposite of what a mandatory update is for.

The server's answer is small and slow-moving (`GET /api/config/version` →
`{ minVersionCode, latestVersionCode, latestVersionName }`,
`express-api/src/routes/config.js:632`), and the app knows its own version code
without asking anybody. So the verdict can be **cached** and applied at draw
time: a phone that was told yesterday that its version is below the minimum is
still below it today.

Recorded as a follow-up in SHY-0500's review record (2026-09-04): the
"a mandatory update is a server verdict the shell cannot know locally" line in
that story's UX criterion is true only until the verdict has been cached once.

## Acceptance Criteria

### Happy path

- [ ] The last version answer is persisted locally (`minVersionCode`,
      `latestVersionCode`, `latestVersionName`, `checkedAt`) through the
      existing settings store on both platforms.
- [ ] Cold start reads the cached verdict synchronously (no I/O beyond the
      preference read) and, if the installed version code is below the cached
      minimum, draws `ForceUpdateScreen` **first** — nothing else is drawn or
      fetched for the room list.
- [ ] The live check still runs on every cold start and updates the cache; a
      live answer that lifts the wall (minimum lowered) removes it.
- [ ] iOS parity in `MainViewController`.

### Error paths

- [ ] No cached verdict (first launch, cleared data): behaviour is today's —
      draw, then check.
- [ ] A corrupt or unparseable cached value is ignored and overwritten by the
      next live answer; a warning is logged.
- [ ] The live check fails: the cached verdict stands, whichever way it points.

### Edge cases

- [ ] The installed version code changed since the cache was written (the
      person updated): the comparison uses the *current* code, so the wall
      lifts immediately without waiting for the server.
- [ ] A cached minimum higher than the server's current minimum (the operator
      lowered it): the live answer overwrites and the wall lifts on that
      launch, never later than one cold start.
- [ ] The cache is per environment: a dev build never reads a prod verdict
      (the store key carries the environment, as the API base URL does).

### Performance

- [ ] The synchronous read adds under 5 ms to the draw on both phones,
      measured by the existing cold-start journey timing.

### Security

- [ ] The cached value can only make the app **more** restrictive on its own; a
      forged low minimum in local storage gains nothing the live check would
      not immediately correct, and a forged high one only shows the update wall
      to the person who forged it.

### UX

- [ ] No room-list flash before the wall; offline below-minimum phones see the
      wall with its existing "update" action.

### i18n

- [ ] N/A — `ForceUpdateScreen`'s strings already exist in all locales; no new
      copy.

### Observability

- [ ] Log `coldstart:version cached=<min> installed=<code> verdict=<wall|ok>`
      at draw, and `coldstart:version live=<min>` when the answer lands, on
      both platforms (public `os_log` on iOS).

## BDD Scenarios

**Scenario: An out-of-date app opens straight to the update screen**

- **Given** somebody whose app was told yesterday that it must be updated
- **When** they open the app
- **Then** the update screen is the first and only thing they see

**Scenario: The update screen shows even without signal**

- **Given** somebody whose app must be updated and who has no connection
- **When** they open the app
- **Then** they see the update screen

**Scenario: Updating lifts the wall at once**

- **Given** somebody who has just installed the required update
- **When** they open the app
- **Then** they see their rooms with no update screen

**Scenario: A first launch behaves as today**

- **Given** somebody opening the app for the first time on a phone
- **When** the app starts
- **Then** they see their rooms and the update check happens in the background

## Test Plan

### Red

- `shared/src/jvmTest/.../CachedVersionVerdictTest.kt` — cached below-minimum
  draws the wall first; no cache draws rooms; installed code above cached
  minimum draws rooms; corrupt cache ignored and logged; environment-keyed
  store.
- Sequencer ordering test: with a cached wall, `immediateDestination()` is the
  update screen and the claim gate is never engaged.
- Journey `J42` on both phones: set a high minimum on the local stack, cold
  start twice (second is the cached path), then airplane mode and a third cold
  start; assert the wall each time and the log lines.

### Green

- Store read and write around the existing version call; the draw-time
  comparison in the sequencer's destination cascade; iOS parity.

## Out of Scope

- Changing what the server's minimum is or how the operator sets it.
- Soft "an update is available" prompts.

## Dependencies

- SHY-0500 (PR #2129) merged.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A stale high minimum locks people out after the operator lowers it | The live check on the same launch overwrites the cache; the negative case is a named test. |
| Cross-environment verdicts | Store key includes the environment; tested. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven on both phones with J42; evidence page signed off.

## Notes

- **2026-09-04** — Filed as a SHY-0500 follow-up from that story's review
  record.
