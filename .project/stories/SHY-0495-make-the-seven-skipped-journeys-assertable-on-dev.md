---
id: SHY-0495
status: Draft
owner: claude
created: 2026-08-30
priority: P1
effort: M
type: chore
roadmap_ids: []
---

# SHY-0495: Make the seven local-only journeys assertable on dev

## User Story

As **the person who has to believe a green dev matrix**,
I want **every journey to actually assert something on dev**,
So that **"8/8 passed" means the product works there, rather than that seven journeys declined to look**.

## Why

The dev matrix reports **8/8 passed, 7 SKIPPED**. Those seven — **J04, J05,
J07, J09, J11, J12, J38** — carry `requiresLocalState: true` and are skipped
outright, so seven user journeys have **zero coverage on dev**. Among them are
room lifecycle (J09), a real coin purchase (J05), moderation queues (J12),
support ticketing (J38) and messaging (J07) — none of them peripheral.

SHY-0488 made the dev leg walkable and named this remainder explicitly:
*"Converting them is its own piece of work, not this one."* That is this piece.

They read Firestore **directly** through `ctx.db`, which only exists against
the local emulator. Verified 2026-08-30 — an earlier guess that five of them
used no local state was **wrong**: they use `ctx.db` rather than the
`ctx.state.*` helpers, which is why a grep for the latter missed it.

What each still needs:

| Journey | Reads directly | API surface today |
| --- | --- | --- |
| J07 | `conversations/{id}/messages` | **exists** — `GET /api/conversations/:id/messages` |
| J38 | `supportTickets/{id}` | partial — `GET /api/support-tickets/mine/open`, no by-id read |
| J05 | `users/{id}` coin balance | **exists** — `GET /api/users/:id` |
| J09 | `rooms` where `ownerId` | needs a lookup |
| J12 | a moderation-queue query | admin routes exist; needs checking |
| J04, J11 | `ctx.state.waitUserField` on `cohort` | blocked: the API reader refuses `cohort`/`cohortOverride` |

So most of this is mechanical, and the honest blocker is narrow: two journeys
assert on a field the product API deliberately does not expose.

## Acceptance Criteria

### Happy path

- [ ] Every journey that runs on local also runs on dev — the matrix reports **zero** skipped-for-target.
- [ ] Each converted journey asserts the same PROPERTY it asserted locally, through the product API rather than a direct database read.
- [ ] A dev matrix run passes with no journey silently declining to assert.

### Error paths

- [ ] A journey whose assertion cannot be made on a target **fails loudly** naming the field and the target, instead of skipping.
- [ ] An API read that returns 403/404 fails the journey with the status and route in the message.

### Edge cases

- [ ] A journey converted to the API still passes on **local**, so the two targets do not drift apart.
- [ ] Where a property genuinely cannot be exposed (cohort — see Out of Scope), the journey asserts the observable BEHAVIOUR instead, or is retired with a reason recorded on the story.

### Security

- [ ] No new endpoint exposes another user's data to a non-admin caller.
- [ ] The runner gains no admin credential it does not already hold; anything admin-only goes through the existing admin token.
- [ ] Nothing added here weakens cohort segregation (UK OSA #17) to make a test easier.

### Performance

- [ ] The dev matrix does not take materially longer than today; API reads replace database reads one for one.

### Observability

- [ ] The run summary distinguishes "asserted and passed" from "could not assert", so a skip can never again read as a pass.

### UX

- N/A — test infrastructure only; no product surface changes.

### i18n

- N/A — no user-facing strings are added or changed.

## BDD Scenarios

**Scenario: a green dev run means the journeys actually ran**
- **Given** the journey matrix runs against dev
- **When** it finishes
- **Then** no journey is reported as skipped for that target

**Scenario: an assertion that cannot be made is reported, not hidden**
- **Given** a journey needs a value dev will not expose
- **When** it runs against dev
- **Then** it fails and names the value it could not read

**Scenario: converting a journey does not break it locally**
- **Given** a journey converted to read through the API
- **When** the matrix runs against local
- **Then** that journey still passes

## Test Plan

**Classification: test-infrastructure.** No product runtime changes unless a
read endpoint is added, in which case the FULL protocol applies to that
endpoint.

### Red (must fail first)

- A guard test asserting **no journey carries `requiresLocalState`** — RED while any does.
- For each new endpoint, a route test with the real emulator before the handler exists.

### Green

- `cd express-api && npm test`; full matrix on a real Android device **local then dev**; both green with zero skips.

### Mutation proof

- Point a converted assertion at the wrong id → that journey fails.
- Make a new endpoint return an empty body → the journey that reads it fails rather than passing vacuously.

## Out of Scope

- **Exposing `cohort` / `cohortOverride` through the product API.** The dev
  state reader refuses those two fields deliberately, and widening it to make a
  test convenient would weaken the segregation boundary the tests exist to
  protect. J04 and J11 assert on cohort, so they either move to a behavioural
  assertion or stay local-only with the reason recorded — a decision this story
  must make explicitly rather than by default.
- prod. The target list stays `local|dev`.
- Giving the runner broader Firestore access on dev.

## Dependencies

- **SHY-0488** (In Review) built the dev state reader this extends.
- A real Android device and dev Firebase.

## Risks & Mitigations

- **Risk: a converted assertion silently asserts less than the direct read did**, so the journey passes while proving less. **Mitigation:** each conversion is mutation-tested — point it at the wrong id and it must fail.
- **Risk: adding read endpoints purely for tests bloats the API.** **Mitigation:** prefer existing endpoints; a new one must be justified as something a real client would also want.
- **Risk: cohort journeys get "fixed" by weakening the API.** **Mitigation:** explicitly out of scope above.

## Definition of Done

- [ ] Zero journeys skipped on dev, or any remaining exception recorded here with its reason.
- [ ] Full matrix green on a real device, local then dev.
- [ ] Guard test prevents `requiresLocalState` returning unnoticed.
- [ ] Status flipped to `In Review` before merge; `released_in:` set at release.

## Notes (running log)

- **2026-08-30** — Filed after a dev matrix reported 8/8 with 7 skipped. SHY-0488
  scoped this out by name. Grounded by reading the runner: all seven use
  `ctx.db` directly. Correcting an earlier wrong guess of my own — five of them
  looked clean because they use `ctx.db` rather than `ctx.state.*`.
