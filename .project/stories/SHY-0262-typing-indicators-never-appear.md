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
clients key it by the Firestore **uniqueId**. Every typing write is therefore
rejected with `permission_denied`, and no typing indicator has ever been shown. The
failure is silent: the write is fire-and-forget, so nothing surfaces the denial.

**The live write path is NOT the one first recorded here (corrected 2026-07-31 —
see Notes).** `PrivateChatViewModel` prefers `conversationWs` and only falls back to
`TypingRepository` when it is null — and `conversationWs` is injected unconditionally
on both platforms (`ViewModelModule.kt:71` resolving a Koin `single` bound in
`AppKoinModule.kt:135` and `IosPlatformModule.kt:167`). It is therefore **never**
null, which makes `RtdbTypingRepository` dead code. Despite its interface name
(`ConversationWebSocketService`), the live implementation is RTDB-backed, not a
WebSocket to the Express API. The call sites that actually run are:

- `app/src/main/java/com/shyden/shytalk/data/remote/RtdbConversationService.kt:135`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/remote/IosRtdbServices.kt:412`

Tracing that live path surfaced **three** defects where one was recorded:

1. **Key mismatch (both platforms)** — the node is keyed by uniqueId; the rule
   demands `auth.uid`. This is the originally-filed defect and it is real.
2. **iOS value-type mismatch** — iOS writes `currentTimeMillis()` (a number) while
   the rule validates `newData.isBoolean()`. iOS typing is refused on validation as
   well as on the key, so fixing only the key would leave iOS still broken.
3. **iOS never observes typing at all** — `IosConversationWebSocketServiceImpl.connect`
   registers no listener (its comment defers to "when observing the events flow",
   but nothing anywhere attaches one). The events flow can never emit `Typing`, so
   iOS would show nothing even if every write were accepted.

This is filed separately from SHY-0261 rather than fixed alongside it because
SHY-0261 is a P0 on core functionality and should not absorb an unrelated surface.
The *design* concern originally recorded here — that re-keying by uid would break an
observer reading a named `typing/{otherUserId}` path — **applies only to the dead
`RtdbTypingRepository`**. The live Android observer subscribes to the whole `typing`
node and correlates by child key (`RtdbConversationService.kt:65-73`), which is the
same shape as room presence, so SHY-0261's proven fix transfers directly.

Severity is P2, not P0: unlike presence, nothing downstream of typing makes a
destructive decision. It is a missing nicety, not a room that destroys itself.

## Acceptance Criteria

### Happy path

- [ ] A person typing in a conversation causes the other party to see a typing
      indicator within the existing debounce window.
- [ ] The typing write is ACCEPTED by the RTDB rules (verified against the real
      emulator, not asserted structurally).
- [ ] The indicator clears when typing stops and when the conversation is left.
- [ ] Both platforms write a value the rules accept — iOS no longer writes a
      timestamp against a rule that permits only the agreed value shape.
- [ ] iOS actually subscribes to the typing node, so an indicator can reach the
      screen at all; the observer emits for the other party and never for self.
- [ ] Android→iOS and iOS→Android both work, not merely same-platform pairs.

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
  today; the uid key is ALLOWED; cross-user write and cross-user clear are DENIED;
  unauthenticated is DENIED; the value is bounded at BOTH ends (empty rejected,
  65 chars rejected, 64 accepted); a non-string value is DENIED, which is the test
  that pins iOS's timestamp write as a defect rather than a style difference.
- Kotlin unit tests for the correlation helper (mirroring `presenceUniqueId` /
  `roomPresenceContains` in `PresenceServiceTest.kt`): a typing set is matched by
  VALUE, self is excluded, and an unresolvable identity yields no indicator.
- An iOS-observer test that fails while `connect` registers no listener — the
  absence of a subscription must be a RED test, not something a compile hides
  ([[feedback-absence-of-work-reported-as-success]]).

**Green:**

- Both live services updated together — `RtdbConversationService` (Android) and
  `IosConversationWebSocketServiceImpl` (iOS); `:app:testLocalDebugUnitTest` and
  `:shared:compileKotlinIosArm64` green.
- Decide explicitly whether the dead `RtdbTypingRepository` /
  `IosTypingRepositoryImpl` fallback is deleted or fixed alongside. Leaving a second,
  differently-broken typing implementation in the tree is how this defect stayed
  invisible; record the call in Notes.

**Mutation:** three mutants, each must redden a NAMED test — (1) re-key the client
write back to the uniqueId; (2) restore the iOS timestamp value; (3) remove the iOS
listener registration. Mutant 3 is the one most likely to pass a weak test, because
"no indicator" is also what a quiet conversation looks like.

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

- **Risk (RESOLVED by investigation, 2026-07-31):** re-keying by Firebase uid was
  thought to break the observer, on the belief that it reads a named
  `typing/{otherUserId}` path. **It does not** — that is the dead
  `RtdbTypingRepository`. The live observer reads the whole `typing` node and
  correlates by child key, so keying by `auth.uid` and carrying the uniqueId in the
  VALUE — exactly SHY-0261's presence shape — is available and is the chosen design.
  The rejected alternative (keep the uniqueId key, authorise by asserting ownership
  in the value) is smaller but lets any signed-in user forge a typing indicator
  attributed to someone else; there is no reason to accept a forgery hole when the
  consistent, non-forgeable option costs the same.
- **Risk:** fixing only the key leaves iOS broken, because iOS fails validation
  independently (writes a number against a boolean rule) and registers no listener
  at all. **Mitigation:** the AC and Test Plan below cover all three defects; iOS is
  not considered done on a compile alone.
- **Risk:** the value-carrying rule change loosens `.validate` from `isBoolean()` to
  a string. **Mitigation:** bound it exactly as presence does (non-empty, ≤64 chars)
  and pin both bounds in the rules test, so "is a string" cannot degrade into
  "is anything".
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

**2026-07-31 14:4x WIB — pickup re-validation: the filing was right about the bug
and wrong about the code.** Before writing a test I traced which typing code
actually executes. It is not `RtdbTypingRepository`: `PrivateChatViewModel` uses it
only when `conversationWs` is null, and `conversationWs` is injected unconditionally
on both platforms, so that whole class is dead. The live services are
`RtdbConversationService` and `IosConversationWebSocketServiceImpl`. Consequences:

- The **design decision this story asked to be made is now settled by evidence**, not
  preference: key by `auth.uid`, carry the uniqueId in the value, bounded string —
  identical to SHY-0261's presence fix. The objection that blocked this option
  (a named-path observer) was a property of the dead class only.
- **Two further defects** were found on the live path and folded into the AC: iOS
  writes a number against a boolean `.validate`, and iOS registers no typing
  listener whatsoever. Fixing only the key would have shipped a story that still
  showed nothing on iOS, and the device check would have caught it late.
- Severity stays P2. Nothing destructive depends on typing; the correction changes
  the work, not the urgency.

Lesson worth keeping: a defect filed from reading a rule plus a plausible call site
is a hypothesis about the runtime, and dead code reads exactly like live code
([[feedback-never-guess-always-investigate]]).
