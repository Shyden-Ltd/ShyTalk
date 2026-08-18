---
id: SHY-0351
status: Draft
owner: claude
created: 2026-08-19
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0351: The warning that someone in a room has blocked you never appears

## User Story

As **someone about to walk into a live voice room**, I want to be told when
somebody in there has blocked me, so that I can choose not to walk into a
conversation I have already been shut out of — instead of finding out by being
in the room.

## Why

**P1, MVP-blocking. The warning exists, is wired up, and can never fire.**

Joining a room runs a check: of the people already in there, has any of them
blocked me? If so the app raises `BlockedByUserInRoom` and asks the person to
confirm before entering. The check is `checkBlockedBy`, and the room-join path
calls it correctly (`RoomViewModel.kt:763`).

`checkBlockedBy` cannot return a block. **Three independent defects, each on its
own sufficient to make the answer always "nobody":**

**1. The query is refused outright.** It runs

```kotlin
firestore.collection("users").whereIn(FieldPath.documentId(), chunk)
```

with no cohort constraint. `/users/{uniqueId}` is gated on
`cohortMatchesCaller()`, which compares the caller's token claim against
`resource.data.cohort`. For a `documentId in [...]` query the rules engine
evaluates each named document, but the refusal is **all-or-nothing** — one
member of the chunk failing the gate denies the whole chunk. This is the same
root cause as SHY-0338 and SHY-0350.

**2. The refusal is then swallowed.** The `catch` around the chunk returns
`emptyList()` after a `Log.w`:

```kotlin
} catch (e: Exception) {
    Log.w(TAG, "Failed to batch-check blocks for ${chunk.size} users", e)
    emptyList()
}
```

So a `PERMISSION_DENIED` does not surface as a failure. It is converted into
the affirmative answer **"nobody in this room has blocked you"** and handed to
the caller as `Resource.Success`. The caller cannot tell a real "no blocks" from
a check that never ran.

**3. Even on success, every block is discarded.** The blocked list is read off
the raw document as

```kotlin
(data["blockedUserIds"] as? List<*>)?.filterIsInstance<String>()
```

`filterIsInstance` does not assert a type — it **drops** every element that
isn't a `String`, silently and without shortening anything the caller can see.
And the field genuinely holds both shapes, which this story verified rather than
assumed:

| writer | what it writes |
| --- | --- |
| the app's own block button (`UserRepositoryImpl:300`) | `arrayUnion(blockedUserId)` — a **String** |
| `PATCH /admin/users/:uniqueId` (`admin-users.js:251`) | validates only `Array.isArray`, never the element type, then `update(updates)` — so an admin edit carrying numeric ids writes **numbers** |
| `express-api/src/utils/block-check.js` (its own docstring) | documents the field as `blockedUserIds: number[]` |

Two live writers, two types, nothing normalising between them. The server copes
because `viewerIsBlocked` does `.map(String)` on both sides. The client does not.

**It reads the raw map, so the SHY-0338 fix does not cover it.** SHY-0338 made
`User.fromMap` parse id lists type-tolerantly via `asIdSet`. `checkBlockedBy`
never constructs a `User` — it reads `doc.data` directly — so it bypasses the
model and kept the defect.

**Both platforms, identically.** `IosUserRepositoryImpl` is the same code with
the same three defects; its `catch` additionally does not re-throw
`CancellationException`, so a cancelled join is also reported as "no blocks".

**Why it matters beyond the warning.** Every failure mode pushes the same
direction: **under-reporting blocks.** A block is a personal-safety decision,
and on a product with minors in its audience the acceptable direction to be
wrong in is not this one.

## Acceptance Criteria

### Happy path

- [ ] Someone joining a room that contains a person who has blocked them is warned before they enter.
- [ ] The warning names the situation plainly and lets them go in anyway or back out.
- [ ] Joining a room where nobody has blocked them proceeds with no warning and no extra delay.
- [ ] The block is recognised no matter which way it was recorded — through the app or by an administrator.

### Error paths

- [ ] If the check cannot be completed, that is reported as a failure — never as "nobody has blocked you".
- [ ] A cancelled join stops being a join, rather than resolving as a clean "no blocks" answer.
- [ ] A partial answer is never presented as a complete one.

### Edge cases

- [ ] A room with more people in it than fit in one lookup is still answered completely.
- [ ] A room containing somebody whose account has since been removed still answers for everyone else.
- [ ] Blocks recorded before this change are recognised without any migration.
- [ ] Someone the joiner has blocked, who has not blocked them back, does not trigger the warning.

### Performance

- [ ] The check adds no more than one round trip to joining a room, regardless of how many people are in it.

### Security

- [ ] The check is answered by the server, so a modified client cannot suppress the warning by lying about who is present.
- [ ] Asking about other people returns only whether each has blocked the caller — never their block lists, and nothing else about them.
- [ ] Someone can only ask this question about themselves.

### UX

- [ ] The warning is distinguishable from the existing "someone you blocked is in here" warning.
- [ ] Verified with eyes on real devices at the smallest supported resolution, both platforms.

### i18n

- [ ] Any new or changed string ships in all 20 locale files, with the rendered sentence asserted rather than the key.

### Observability

- [ ] A check that failed is distinguishable in logs from a check that ran and found nothing.

## BDD Scenarios

**Scenario: Someone who blocked me is already in the room**

- **Given** somebody in a voice room has blocked me
- **When** I try to join that room
- **Then** I am warned before I go in, and can choose to enter anyway or step back

**Scenario: A room nobody has blocked me from**

- **Given** a voice room where nobody has blocked me
- **When** I try to join that room
- **Then** I go straight in with no warning

**Scenario: The check cannot be completed**

- **Given** my connection fails while I am joining a room
- **When** the app tries to work out whether anyone there has blocked me
- **Then** it reports that it could not check, rather than telling me nobody has

## Test Plan

**RED first, on every framework this touches.** Every test below is observed
failing against today's build before any production line changes.

### Express / Jest — `express-api/tests/routes/users-blocked-by.test.js`

Against the **real** local emulator stack, per the real-only rule.

- `returns the ids of members who have blocked the caller`
- `recognises a block stored as a NUMBER` — **defect 3, in one assertion**
- `recognises a block stored as a STRING`
- `omits members who have not blocked the caller`
- `does not leak block lists or any other field of the members queried`
- `a member in another cohort still answers` — **defect 1: no all-or-nothing refusal**
- `a member who does not exist is skipped, and the rest still answer`
- `rejects a request asking on behalf of somebody else`
- `rejects a malformed or over-long id list`
- `an empty list answers empty without a read`

### Kotlin unit — `app/src/test/.../data/repository/` + `shared/src/commonTest/.../room/`

- `checkBlockedBy surfaces a transport failure as an error, not an empty set` — **defect 2**
- `checkBlockedBy returns the blocker when the block is stored numerically`
- `a room join whose block-check FAILED does not claim the room is clear`
- `RoomViewModel raises BlockedByUserInRoom when the check reports a blocker`

### Journey tests — real devices

- `journey-tests/` scenario: persona A blocks persona B; B attempts to join a
  room A is sitting in; **B's device shows the warning**. Asserted on B's screen,
  which is the surface that is broken today.
- Walked on real Android (USB adb) AND real iPhone (USB devicectl), local then
  dev, per the Pre-Merge Testing Protocol. Backend change ⇒ FULL gauntlet.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| server compares ids without coercing both sides | `recognises a block stored as a NUMBER` |
| client falls back to an empty set on failure again | `surfaces a transport failure as an error` |
| endpoint returns the whole member document | `does not leak block lists` |
| caller identity taken from the request body | `rejects a request asking on behalf of somebody else` |
| chunking removed so only the first 30 are asked about | `a room with more people than fit in one lookup` |

## Out of Scope

- The reverse warning (`BlockedUserInRoom` — somebody **I** blocked is in here).
  It reads my own document, which I can always read, so it is not affected.
- Changing what blocking itself does, or the block/unblock write path.
- Normalising the stored `blockedUserIds` type across existing documents. This
  story makes every reader tolerant of both shapes, which fixes the bug without a
  migration; typing the field at the write path is worth its own story.
- Preventing the join outright rather than warning. Today's product decision is a
  warning with a confirm, and this story restores it rather than redesigning it.

## Dependencies

**None — this story is independent and can land in any order.**

- **SHY-0338** is the *diagnostic* ancestor, not a code dependency. It established
  the all-or-nothing refusal and introduced `asIdSet` for type-tolerant id
  parsing on the client. This story needs neither: moving the question to the
  server means the client stops parsing ids altogether, and the comparison is
  done once, server-side, where both sides are coerced. Checked rather than
  assumed — `asIdSet` is not on `develop` yet, and nothing here reaches for it.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A new endpoint becomes a way to enumerate who blocked whom | It answers only about the CALLER, returns a bare id list, and is asserted not to leak any member field. Three ACs plus a mutation. |
| Failing loudly makes joins fail that used to succeed | The caller decides what to do with an errored check; the join path keeps its current behaviour. What changes is that "no blocks" is no longer manufactured. |
| The fix lands on one platform only | Journey walked on real Android AND real iPhone; the iOS twin is named explicitly in the Test Plan. |
| Old documents hold the other id type | Both shapes are asserted directly, and the number case is the named mutation target. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; lint clean at `--max-warnings=0` including `format:check`.
- [ ] Two more direct-Firestore client sites removed; the no-direct-backend ratchet moves DOWN.
- [ ] Journey scenario walked on real Android AND real iPhone, local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19 04:1x WIB** — Found by the sweep SHY-0350 recommended, not by a
  bug report. SHY-0350's Notes asked for a pass over remaining client-side
  filtered Firestore queries; 24 sites were enumerated and cross-referenced
  against the four rule paths that gate on cohort. Every other site was clean —
  the room queries all carry `.whereEqualTo("cohort", cohort)`, which is exactly
  what makes a content-gated rule decidable for a query, and `giftRankings` is
  read as a single document. `checkBlockedBy` was the one that was not.

- **2026-08-19** — The three defects were each confirmed by reading, and the type
  question was settled rather than assumed. `admin-users.js:251` validates
  `Array.isArray` and nothing about the elements, then writes the array straight
  through — so numeric ids from an admin edit land as numbers, while the app's
  own block button writes strings via `arrayUnion`. `block-check.js`'s docstring
  documents the field as `number[]`. Two live writers, two types, no normaliser.

- **2026-08-19** — Severity comes from the DIRECTION of the failure, which is the
  same for all three defects: blocks are under-reported, never over-reported.
