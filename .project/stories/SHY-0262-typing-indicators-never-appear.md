---
id: SHY-0262
status: Draft
owner: claude
created: 2026-07-31
priority: P2
effort: S
type: bug
roadmap_ids: []
---

# SHY-0262: Typing indicators never appear, because every typing write is rejected

## User Story

**As a** person in a direct conversation
**I want** to see when the other person is typing
**So that** the conversation feels live, instead of silently dropping a feature
the app appears to offer.

## Why

Found 2026-07-31 while fixing SHY-0261. Typing indicators carry the **identical
defect** that made rooms close themselves: the RTDB rule on
`conversations/{convId}/typing/{userId}` is

```
".write": "auth != null && auth.uid == $userId"
```

so the node may only be keyed by the writer's Firebase **Auth uid** — while both
clients key it by the Firestore **uniqueId**:

- `app/src/main/java/com/shyden/shytalk/data/repository/RtdbTypingRepository.kt:39`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/remote/IosRtdbServices.kt:42`

Every typing write is therefore rejected with `permission_denied`, and no typing
indicator has ever been shown. The failure is silent: the write is fire-and-forget,
so nothing surfaces the denial.

This is filed separately from SHY-0261 rather than fixed alongside it for two
reasons. First, SHY-0261 is a P0 on core functionality and should not absorb an
unrelated surface. Second, **the fix is genuinely different**: the room-presence fix
could key by uid and carry the uniqueId as the node's value, because readers consume
the whole presence set. Typing is read at a *named* path — `typing/{otherUserId}`,
where the observer knows the other party's uniqueId and not their Firebase uid — so
re-keying by uid would break the observer, which cannot resolve uid → uniqueId
client-side.

Severity is P2, not P0: unlike presence, nothing downstream of typing makes a
destructive decision. It is a missing nicety, not a room that destroys itself.

## Acceptance Criteria

### Happy path

- [ ] A person typing in a conversation causes the other party to see a typing
      indicator within the existing debounce window.
- [ ] The typing write is ACCEPTED by the RTDB rules (verified against the real
      emulator, not asserted structurally).
- [ ] The indicator clears when typing stops and when the conversation is left.

### Error paths

- [ ] A write attempted without a Firebase session is skipped and logged, never
      issued and silently denied.
- [ ] A rules rejection is surfaced in logs rather than swallowed by a
      fire-and-forget call.

### Edge cases

- [ ] `onDisconnect` still clears the typing node, so a crashed client cannot leave
      a permanent "is typing…" indicator.
- [ ] A conversation with a participant whose identity cannot be resolved shows no
      indicator rather than a wrong one.

### Performance

- [ ] No additional read per keystroke; any identity resolution needed is done once
      per conversation entry, not per typing event.

### Security

- [ ] A user cannot write a typing indicator that appears to come from someone else.
- [ ] A user cannot clear another user's typing node.
- [ ] Reads remain restricted to authenticated callers.

### UX

- [ ] The indicator appears and disappears without flicker at the existing debounce
      cadence; no change to the visual treatment is in scope.

### i18n

- N/A — no user-facing strings are added or changed.

### Observability

- [ ] A denied or skipped typing write is logged with enough context (conversation,
      reason) to tell "nobody is typing" apart from "we were not allowed to say so".

## BDD Scenarios

**Scenario: the other person sees that I am typing**

- **Given** two people in the same conversation
- **When** one of them starts typing
- **Then** the other sees a typing indicator
- **And** the indicator disappears shortly after they stop

**Scenario: a typing indicator cannot be forged**

- **Given** a signed-in person
- **When** they attempt to publish a typing indicator as somebody else
- **Then** the attempt is refused

**Scenario: a crashed app does not leave a stuck indicator**

- **Given** a person who is typing
- **When** their app loses its connection without a clean exit
- **Then** the typing indicator for them is cleared

**Scenario: no session, no silent failure**

- **Given** a client with no signed-in session
- **When** typing occurs
- **Then** no write is attempted
- **And** the reason is recorded in the logs

## Test Plan

**Red first:**

- `express-api/tests/rtdb-rules/typing-rules.test.js` (NEW) — REAL RTDB emulator,
  mirroring `room-presence-rules.test.js`: a write keyed by uniqueId is DENIED
  today; the chosen key is ALLOWED; cross-user write and cross-user clear are
  DENIED; unauthenticated is DENIED; value shape is bounded.
- Kotlin unit tests for whichever correlation helper the chosen design needs
  (mirroring `presenceUniqueId` / `roomPresenceContains` in
  `PresenceServiceTest.kt`).

**Green:**

- Android + iOS typing repositories updated together; `:app:testLocalDebugUnitTest`
  and `:shared:compileKotlinIosArm64` green.

**Mutation:** re-key the client write back to the uniqueId and confirm the rules
test fails; that mutant is the bug itself.

**Device:** two real devices in one conversation — typing on each is visible on the
other, and clears on app kill.

## Out of Scope

- Redesigning the typing UX, debounce timings, or the visual treatment.
- Group-conversation typing (the current surface is direct conversations).
- SHY-0261's room-presence fix, which is already delivered and merely revealed this.

## Dependencies

- SHY-0261 lands first: it establishes the presence-identity pattern, the
  rules-test shape to mirror, and the deployed `database.rules.json` this change
  will edit next.
- Local emulator stack for the real-services rules tests.

## Risks & Mitigations

- **Risk:** re-keying by Firebase uid breaks the observer, which reads a named
  `typing/{otherUserId}` path and cannot map uid → uniqueId client-side.
  **Mitigation:** decide the design before coding — either keep the uniqueId key and
  authorise it by proving ownership in the VALUE (`newData.val() === auth.uid`), or
  have the observer read the whole `typing` node and correlate by value as room
  presence now does. The first is the smaller change; the second is more consistent
  with SHY-0261. Record the decision in Notes.
- **Risk:** authorising by value lets a user forge a typing indicator for someone
  else.
  **Mitigation:** low impact (cosmetic, no destructive decision depends on it), but
  it must be a conscious, recorded trade rather than an accident — unlike presence,
  where the same trade would have been unacceptable.
- **Risk:** the fix looks trivial and skips device verification.
  **Mitigation:** typing is inherently a two-device behaviour; the DoD requires two
  real devices.

## Definition of Done

- [ ] Every AC met with a named test.
- [ ] Real-emulator rules tests green and mutation-verified.
- [ ] Android + iOS compile; Kotlin unit tests green.
- [ ] Two-real-device check: typing visible both ways, clears on app kill.
- [ ] `database.rules.json` deployed to dev and verified.
- [ ] Design decision (key-by-uid vs authorise-by-value) recorded in Notes.
- [ ] `code-reviewer` 100% clean.

## Notes

**2026-07-31** — Filed while fixing SHY-0261. Not speculative: the rule and both
client call sites were read directly, and the same class of write was proven denied
against the real emulator during the SHY-0261 investigation. Deliberately NOT fixed
in that change — a P0 on core room functionality should not carry an unrelated
surface, and the correct fix here is materially different because the typing
observer reads a named path rather than a whole set.
