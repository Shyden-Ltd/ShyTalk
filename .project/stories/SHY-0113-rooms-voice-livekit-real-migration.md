---
id: SHY-0113
status: Draft
owner: claude
created: 2026-06-17
priority: P0
effort: XL
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0113: Migrate Rooms / Voice / LiveKit tests to real services — and pivot-fix the room-creation blocker it surfaces (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Rooms / Voice / LiveKit test (express room-mutations / rooms / livekit routes + Android RoomCreation / RoomBrowsing / GroupChat journeys) moved off in-process doubles and onto the real local emulator stack + real LiveKit, **with the room-creation bug the operator hit on the dev app treated as a real (likely BLOCKING) product bug**,
**So that** "can a user actually create and use a room?" is proven by the real surfaces — not by mocks that have been hiding a failure the operator can reproduce by hand.

## Why

The operator reported: *"I tried out the dev app yesterday and I still can't create rooms and perform basic core tasks, yet you said it was fixed already."* That is the canonical reason for the whole "no more faking" program — a mocked test went green while the real feature was broken. Rooms is sequenced **first among the migrations** ([[feedback-think-like-qa-real-fixes]], [[feedback-consumer-first-surface-design]]) because (a) it is core functionality, and (b) migrating it to real services is what will *surface* the bug honestly. Per the bug-handling workflow, a room-creation failure that stops the area's tests from running is **BLOCKING → pivot and fix it TDD-first** (a real failing test locks the fix), then resume the migration. It ties to the two open rules-bugs **SHY-0102** (Firestore room-list rule denial) + **SHY-0103** (RTDB presence uid mismatch), both Draft/unfixed and needing an operator rules-deploy checkpoint.

## Acceptance Criteria

### Happy path
- [ ] Every express Rooms/Voice/LiveKit test (`tests/routes/rooms*`, `room-mutations*`, `livekit*`, seat/presence/voice) runs against the real Firestore/RTDB emulator + real LiveKit (token mint + join verified for real); no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains in them.
- [ ] Android `RoomCreation` / `RoomBrowsing` / `GroupChat` journeys are proven on the **real device gauntlet** against the local stack: a persona creates a room, it appears in the real `rooms` collection, a second persona browses + joins it, and LiveKit audio connects — all asserted on real state.
- [ ] The room-creation flow **actually works end-to-end on the real dev app** (the operator's exact failing path), verified before this SHY is called done.

### Error paths
- [ ] Permission denials are induced for real (real `firestore.rules` denying a list/read for a non-member) — not mocked — and the UI/route surfaces the real error; this is where SHY-0102 is reproduced + (pivot) fixed.
- [ ] Real RTDB presence write/uid path is exercised (SHY-0103) — a real presence record under the real authed uid; a mismatch fails the real test.
- [ ] Creating a room while unauthenticated / over quota / with invalid input is rejected by the **real** backend (server-side contract), asserted on real state.

### Edge cases
- [ ] Concurrency: two real personas create/join the same room near-simultaneously; the real datastore converges (seat counts, membership) — no lost write (mirrors /manual-qa concurrency probe).
- [ ] Room lifecycle boundary: create → occupied → last-occupant-leaves → closed/archived is exercised against real state (ties to the cron area SHY-0120 for closedRooms).
- [ ] Any bug surfaced that is **non-blocking** is filed as its own `type: bug` SHY and its migrated real test tagged `@known-failure-SHY-NNNN` (assertion kept correct, never weakened); **blocking** bugs are pivot-fixed TDD-first.

### Performance
- [ ] Room-list render budget asserted on the real device (e.g. browse list < 2s with a seeded set); LiveKit join completes within a real, asserted window.

### Security
- [ ] Real-rules enforcement is the contract: a non-member cannot read/list a private room against real `firestore.rules`; LiveKit tokens are scoped to the real room. No secrets logged. Any `firestore.rules`/RTDB-rules change needs the **operator rules-deploy checkpoint** before deploy.

### UX
- [ ] The real create-room → enter-room flow is walked as the consumer (PM/UX/QA passes): the user reaches a working room, hears audio, sees other occupants — the operator's "basic core task" genuinely succeeds.

### i18n
- [ ] Room name / system strings render correctly in at least one RTL + one CJK locale on the real surface (spot-check per /manual-qa).

### Observability
- [ ] Real server/cron logs for room create/close run unmocked during tests (exercised, not asserted); LiveKit connection events observable on the real path.

## BDD Scenarios

**Scenario: a real user creates and enters a working room (the operator's failing path)**
- **Given** a real persona signed into the real dev app (or local stack on a real device)
- **When** they create a room
- **Then** a real document appears in the `rooms` collection, the user enters the room, and LiveKit audio connects — the task the operator could not complete now succeeds

**Scenario: a non-member is denied by real rules (SHY-0102 reproduced)**
- **Given** real `firestore.rules` deployed + a private room owned by persona A
- **When** persona B lists/reads it
- **Then** the real backend returns PERMISSION_DENIED and the migrated test asserts the real denial (not a mocked rejection)

**Scenario: presence is written under the real authed uid (SHY-0103)**
- **Given** a real persona joins a room
- **When** presence is written to RTDB
- **Then** the record key matches the real authed uid (a mismatch fails the real test)

**Scenario: a surfaced non-blocking room bug is catalogued, not silently fixed**
- **Given** a migrated real test exposes a non-blocking defect
- **When** it is triaged
- **Then** a `type: bug` SHY is filed and the test is tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each Rooms/Voice/LiveKit express test to require the real emulator (`NODE_ENV=local` + `assertEmulatorReachable()`) and a real LiveKit handle → they fail until seeded against real services; write/confirm a failing real test that reproduces the room-creation blocker on the real path (locks the pivot-fix).

**GREEN:** seed real state, run real flows, assert real outcomes; pivot-fix the blocking room-creation bug TDD-first (coordinating SHY-0102/0103 rules changes through the operator checkpoint); for each remaining surfaced bug, file a SHY + tag `@known-failure`. Full local gauntlet (all browsers + real Android/iOS) for the journey scenarios; canonical `npm test` green for the express layer.

**Frameworks:** express Jest (real emulator + real LiveKit), Android journey gauntlet (real device), Playwright web where applicable, frontmatter validator. **Real backend:** Firestore/RTDB emulator + real LiveKit + real device. **Gauntlet:** REQUIRED (room journeys are device/web surfaces) — operator-gated.

## Out of Scope
- The actual fixes for non-blocking surfaced bugs (each its own SHY, drained after EPIC-0003) — only the *blocking* room-creation bug is fixed here.
- Economy/gift-in-room flows (SHY-0118), messaging-in-room (SHY-0117), moderation-in-room (SHY-0116) — their own area SHYs.
- Sub-splitting: this XL area is delivered as several 1-SHY-1-PR slices at pickup (rooms-routes · seat/presence/voice · LiveKit · each Android journey).

## Dependencies
- **SHY-0112** (keystone) — the unit↔integration boundary + policy-aware ratchet must land first.
- **SHY-0102** (Firestore room-list rule) + **SHY-0103** (RTDB presence uid) — Draft/unfixed bug stories this work reproduces; rules changes gated on the **operator rules-deploy checkpoint**.
- **SHY-0109** (emulator-in-CI) + `tests/helpers/firebase-emulator.js`.
- Local stack (`local/start.sh`) incl. real LiveKit; real Android/iPhone for the journeys.

## Risks & Mitigations
- **Risk:** the room-creation bug needs a `firestore.rules`/RTDB-rules change (operator-gated) → migration stalls. **Mitigation:** prepare the rules diff + a real failing test, then request the operator checkpoint; meanwhile migrate the non-rules-blocked room tests ([[feedback-blocker-switch-not-halt]]).
- **Risk:** real LiveKit flakiness in tests. **Mitigation:** assert real connection state with bounded waits; the local LiveKit is the real backend, not a mock.
- **Risk:** XL scope balloons one PR. **Mitigation:** sub-split into vertical 1-SHY-1-PR slices ([[feedback-agile-user-stories]]).

## Definition of Done
- All Rooms/Voice/LiveKit tests double-free + asserting real state; baseline shrinks for each migrated file.
- The room-creation blocker is genuinely fixed + proven on the real dev app; every other surfaced bug filed + `@known-failure`-tagged with intact assertions.
- Full gauntlet + canonical `npm test` green; `code-reviewer` + `security-reviewer` zero findings; CI green by name.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P0, first migration after the keystone).** Sequenced first because it surfaces the operator's reproducible room-creation failure — the canonical evidence for "no more faking". Likely BLOCKING → pivot-fix TDD-first; ties to SHY-0102/0103 (operator rules-deploy checkpoint required). XL → sub-split at pickup.
