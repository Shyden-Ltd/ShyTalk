---
id: SHY-0270
status: In Review
owner: claude
created: 2026-08-03
priority: P0
effort: S
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0270: Voice rooms close themselves seconds after opening on dev

## User Story

As someone opening a voice room,
I want the room to stay open once I have created it,
So that people can actually join me instead of arriving to find it already closed.

## Why

Found while walking the SHY-0268 device gauntlet on dev. Every room created from a real
device closed itself about two and a half seconds later — consistently: 2408ms, 2420ms,
2408ms across attempts. A timer, not a race.

The cause is an identity mismatch between the client and the realtime-database rule.

The client writes presence at `rooms/{roomId}/presence/{uniqueId}` — `RtdbPresenceService`
is handed the app's numeric uniqueId. The rule required `auth.uid == $userId`, which is the
*Firebase* uid. Those two are different values for the same person (50000030 vs
`t7BBRjbHXXPIvPAhzwhMKpRqRnt2`), so the comparison could never be true and every presence
write was denied:

```
setValue at /rooms/{roomId}/presence/50000030 failed: Permission denied
onDisconnect().setValue at /rooms/{roomId}/presence/50000030 failed: Permission denied
```

With no presence ever recorded, the room read as empty. On dev that ends in the room being
closed within seconds; the fix removes the denials and the room stays open (measured
before/after on the same device, below).

**What is proven vs what is inferred.** Proven: the denials were real, the fix removes them,
and the room then stays open. Inferred: the exact closing path. The same denials occur
LOCALLY — 85 local rooms, zero presence nodes — yet local rooms stay open indefinitely
(a local room from this session was still ACTIVE hours later). So denied presence is
necessary but not sufficient, and something dev-only completes the chain. The device log
shows the likely completer: `setValue at /ownerLeft/{roomId} failed: Permission denied`
alongside `connectionMonitor: state=DISCONNECTED`, i.e. the arm/cancel of the owner-left
signal is also broken, and the server-side owner-left handler acts on it. That path is
tracked separately rather than asserted here.

The uniqueId is the correct key, not a client bug: `ActiveRoomManager` computes
`absentUsers = participantIds - presentUserIds - currentUserId`, and `participantIds` are
uniqueIds. Keying presence by Firebase uid would make every participant permanently absent.

Rules cannot query Firestore, but they do not need to — `uniqueId` is already a custom claim
on the token (`{"uniqueId":50000030,"cohort":"adult"}`), so the rule can authorise the write
without weakening it.

It did not show up locally, and the reason is worth recording precisely because the obvious
explanation is wrong. The emulator DOES load these rules ("Rules updated" on start) and DOES
enforce them for an authenticated client — verified directly: with the fixed rule, writing
your own presence is ALLOWED and writing someone else's is DENIED. Two things hide it
locally: the emulator's REST API answers as admin, so a casual probe always succeeds; and
rules bind to the `<projectId>-default-rtdb` namespace, so anything pointed at a different
namespace sees no rules at all. Local rooms nonetheless stay open despite identical denials
— see the proven/inferred note above.

## Acceptance Criteria

### Happy path
- [ ] A room created on dev stays open, with the creator recorded as present

### Error paths
- [ ] A user still cannot write presence under someone else's id
- [ ] Typing indicators, which use the same identity, are authorised the same way

### Edge cases
- [ ] The uniqueId claim is a NUMBER and the path key is a STRING — the comparison must
      survive that, not silently never match

### Performance
- [ ] N/A — a rule expression change; no additional reads or round trips.

### Security
- [ ] Self-ownership is preserved: authenticated, and only for your own id
- [ ] No path becomes world-writable; the root deny is untouched
- [ ] The claim is server-issued, so it cannot be spoofed by the client

### UX
- [ ] Rooms no longer close underneath the person who just opened them

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The permission-denied warnings disappear from device logs

## BDD Scenarios

**Scenario: A newly created room stays open**
- **Given** a member has just created a voice room
- **When** they wait in it
- **Then** the room is still open and they are shown as present

**Scenario: Presence cannot be forged for someone else**
- **Given** a signed-in member
- **When** they try to mark a different member as present
- **Then** the write is refused

## Test Plan

**Red first** — `express-api/tests/rtdb-rules/presence-rules.test.js` (new): 3 of 6 assertions
failed against the old rule. It pins that presence is authorised by the uniqueId claim rather
than the Firebase uid, that self-ownership and authentication survive, that the numeric claim
is string-compared, and that typing uses the same identity.

`owner-left-rules.test.js` had pinned the literal `auth.uid == $userId` as the thing not to
regress — pinning the defect. Corrected to assert the security PROPERTY (authenticated +
self-owned) and to leave the identity contract to the new file.

**Green** — 14/14 rules tests pass.

**Device proof (real OnePlus over USB, dev backend):**
- before: `state=CLOSED`, closed 2.4s after creation, 4+ permission-denied warnings per room
- after: `state=ACTIVE` at 17.4s, `participantIds=["50000030"]`, RTDB presence
  `{"50000030": true}`, **zero** denials
- the SHY-0268 journey then completed on dev: gacha → age wall → "Verify now" → verification
  screen, app alive, zero exceptions

## Out of Scope

- The `/ownerLeft/{roomId}` denial seen in the same logs. Its rule signs with `auth.uid` and
  the client passes the Firebase uid, so it is a different question; it needs its own
  investigation rather than being swept in here.
- Why local rooms survive the SAME denials while dev rooms do not. That difference is real
  and unexplained, and it is the reason a local run gave false confidence. It needs its own
  investigation — most likely the owner-left arm/cancel path above, which only completes when
  the client actually reaches the realtime database.

## Dependencies

- None. The `uniqueId` custom claim already exists on issued tokens.

## Risks & Mitigations

- **Risk:** the claim is missing on an older token, so presence silently fails again.
  **Mitigation:** claims are set at sign-in and refreshed on cohort change; the failure mode
  is identical to today's (denied write), not worse, and the device walk confirms real tokens
  carry it.
- **Risk:** string/number coercion is fragile. **Mitigation:** pinned by its own test, and the
  device proof shows the write landing.

## Definition of Done

- [ ] 14/14 rules tests green
- [ ] Rules deployed to dev and a room verified to stay open on a real device
- [ ] iOS device walk of the same room-open path
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-03 15:4x BST** — Found during the SHY-0268 gauntlet. Quantified before diagnosing:
  three creations, closing at 2408/2420/2408ms. Ruled out the stale-room reaper (needs
  `OWNER_AWAY` plus a 5-minute grace) and a coincidental `delay(2600)` in RoomScreen (that is
  the gacha win animation). Root cause read from device logs, not inferred.
- **2026-08-03 16:0x BST** — Rules deployed to dev; before/after measured on the same device.
- **2026-08-03 22:3x BST** — Re-examined the causal claim rather than leaving it tidy. The
  first write-up said the emulator "was not enforcing these rules"; that is NOT established.
  The emulator loads them and enforces them for authenticated clients (proved by allowing an
  own-id write and denying an other-id write against the running emulator). The local silence
  is explained by the admin REST bypass plus namespace binding. Separately, local rooms stay
  open under the SAME denials, so presence-denial alone does not close a room — wording
  tightened to separate what is proven from what is inferred.
