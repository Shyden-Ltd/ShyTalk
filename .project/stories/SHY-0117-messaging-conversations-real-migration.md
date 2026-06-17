---
id: SHY-0117
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: L
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0117: Migrate Messaging / Conversations tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Messaging / Conversations test (express `conversations` / `notifications`, ~10 files) moved off in-process doubles and onto the real Firestore/RTDB emulator + real FCM path,
**So that** "a message a real user sends is actually delivered and persisted" is proven against real state, not mocked sends.

## Why

Messaging is core social functionality and a frequent source of integration regressions (delivery, ordering, unread counts, notifications) that unit-level mocks cannot catch. The current tests fake the datastore + the notification send, so a broken real conversation write or a dropped notification would pass. ~10 files makes this a tractable L-sized area to migrate fully after the higher-stakes P0/safety areas.

## Acceptance Criteria

### Happy path
- [ ] Every conversations/notifications test runs against the real Firestore/RTDB emulator; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] A real message sent persona-A→persona-B is written to real conversation state and read back by B; unread/ordering reflect real state.
- [ ] A real notification path is exercised against the real FCM emulator/sandbox (delivery attempted, not mocked).

### Error paths
- [ ] Sending to a non-existent/blocked conversation is rejected by the **real** backend contract.
- [ ] Unauthorised read of another user's conversation is denied by **real** rules (not a mocked guard).
- [ ] A real empty-state (no conversations) is exercised as a genuine clean slate.

### Edge cases
- [ ] Concurrency: two real personas writing the same conversation converge in real state (no lost message).
- [ ] Adversarial message content (empty, max-length+1, zero-width/RLO, emoji, CJK) is handled by the real backend (server-side contract) — mirrors /manual-qa negative-input probe.
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Conversation-list/message-load budgets asserted on the real surface; migrated suite completes in a few seconds against a warm emulator.

### Security
- [ ] Real-rules enforcement (only participants read a conversation); no secrets logged; FCM sandbox keys only.

### UX
- [ ] The real send → receive → unread-clears flow is walked as the consumer.

### i18n
- [ ] Message + notification strings render in ≥1 RTL + ≥1 CJK locale on the real surface (spot-check).

### Observability
- [ ] Real messaging/notification logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a real message is delivered and persisted**
- **Given** real personas A and B
- **When** A sends B a message on the real path
- **Then** real conversation state holds the message and B reads it back with correct ordering/unread

**Scenario: a non-participant is denied by real rules**
- **Given** a conversation between A and B
- **When** C tries to read it
- **Then** the real backend denies it (no mocked guard)

**Scenario: adversarial content is handled by the real backend**
- **Given** a message containing zero-width + RLO + emoji + max-length+1
- **When** A sends it
- **Then** the real server enforces its contract (accept-sanitised or reject) — asserted on real state

**Scenario: a surfaced messaging bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each conversations/notifications test to require the real emulator + real FCM path → fails until seeded real.

**GREEN:** seed real personas + conversations; exercise real send/read/notify/negative paths; file + `@known-failure`-tag surfaced bugs. Canonical `npm test` green; journey spot-check on the real device where a messaging UI path is involved.

**Frameworks:** express Jest (real Firestore/RTDB emulator + FCM sandbox), frontmatter validator; device gauntlet only where a messaging journey UI is touched. **Real backend:** Firestore/RTDB emulator + FCM sandbox.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- The androidTest message/PM/typing domain (rides SHY-0115's harness — its own slice).
- Gift/economy-in-message flows (SHY-0118).

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0114** (auth) — real signed-in personas.
- **SHY-0109** + `firebase-emulator.js`; FCM sandbox path.

## Risks & Mitigations
- **Risk:** real FCM delivery is hard to assert deterministically. **Mitigation:** assert the real send path + sandbox acceptance; escalate to operator escape-hatch if a specific delivery condition is genuinely un-inducible (never silently mock).
- **Risk:** concurrency flakiness. **Mitigation:** bounded real waits + converge assertions.

## Definition of Done
- All messaging tests double-free + asserting real state; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` zero findings; CI green by name; gauntlet where a UI path is touched.
- Judgment-merge per slice. Story → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, ~10 files, tractable L).** Core social functionality; migrated after the safety areas. FCM delivery proven against the real sandbox path, not mocked.
