---
id: SHY-0351
status: In Progress
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

- **2026-08-19 — server side done, RED first, mutation-proven.** 16 real-services
  tests written against a 404 before a line of route code existed. The RED run
  had to be repeated: the first attempt used a bare `npx jest` and died with
  `SyntaxError: Unexpected token 'export'` from the google-gax ESM chain — a
  BROKEN harness, not a red test. Re-run through the canonical `npm test` it
  failed 15/16 with `Expected 200, Received 404`, which is the right reason. The
  one passing test was the unauthenticated case, which the auth middleware
  rejects before routing is consulted at all.

- **2026-08-19 — 8 mutations, 8 kills, each by its named test.**

  | Mutation | Killed |
  | --- | --- |
  | `viewerIsBlocked` stops coercing the stored side | `recognises a block stored as a NUMBER` (+ the mixed-cohort test, which also stores numerically) |
  | respond with the whole member document | `returns only ids` |
  | take the subject from the request body | `answers about the CALLER only` |
  | re-introduce a 30-id cap | `answers completely for more members than fit in one chunk` |
  | drop the numeric-id validation | `rejects an id that is not a plain numeric id` |
  | swallow the failure again | `surfaces a transport failure as an error, not an empty set` |
  | ignore the response body | `asks the API and returns the ids it reports` |
  | send an empty id list | `sends every id it was asked about` |

- **2026-08-19 — the first mutation loop was itself defective, and that is the
  more useful finding.** It reverted with `git checkout --`, which restores to
  **HEAD** — and the implementation was still uncommitted, so the first revert
  DELETED it. The remaining three mutations then reported
  `SKIPPED — anchor matched 0x` rather than pretending to pass, because every
  anchor carried a `count(old) == 1` assertion. Without that assertion the loop
  would have reported all five as KILLED, since the still-broken state kept the
  suite red. Two failure modes fired at once: prettier had also reformatted the
  inserted code, shifting the anchors. Fixed by committing before mutating and
  restoring from an in-memory copy instead of git. Codified as
  `feedback-commit-before-mutation-testing`.

- **2026-08-19 — why one test existed and it was the wrong one.**
  `UserRepositoryImplTest` carried exactly ONE `checkBlockedBy` test —
  `returns empty set for empty input` — which returns at the guard clause before
  any of the three defects execute. The only tested path was the only path that
  could not fail.

- **2026-08-19 — the parameter was REMOVED, not ignored.** With the subject
  derived from the auth token, `targetUserId` could no longer change the answer.
  Leaving it would have invited a caller to ask about somebody else and quietly
  receive an answer about themselves — the same confusion the endpoint itself
  refuses. `checkBlockedBy(userIds)` now states the contract, and the KDoc says
  plainly that an `Error` is not an empty set.

- **2026-08-19 — verification.** `:shared:compileKotlinIosArm64` exit 0.
  `UserRepositoryImplTest` 30 tests / 0 failures, with all five `checkBlockedBy`
  cases confirmed **present in the JUnit XML**, not merely reported up-to-date by
  Gradle. `RoomViewModelTest` + `:shared:jvmTest` green. `ktlintCheck` and
  `detekt` exit 0, detekt 0 findings. eslint `--max-warnings=0` and
  `prettier --check` both exit 0. `check-no-direct-backend` clean at 33 remaining
  — both touched files stay in the baseline legitimately, since each still has
  other direct Firestore use, so no baseline entry went stale.

- **2026-08-19 — full Express suite: 14210 passed, 10 failed, and the 10 are NOT
  from this change.** All ten are `50-matrix.sh` process-reaping tests failing on
  `FAIL repo not found at <path> (set SHYTALK_REPO)`. Root cause:
  `express-api/scripts/gauntlet/lib.sh:61` tests `[ -d "$REPO/.git" ]`, and in a
  git **worktree** `.git` is a FILE, not a directory. Proven rather than
  asserted: the same suite passes 9/9 from the main clone, which has a real
  `.git` directory. Filed separately — it means the gauntlet library cannot run
  from a worktree at all, while this project's workflow is worktree-per-branch.

- **2026-08-19 — proven end-to-end over real HTTP against the real local stack**,
  not only through supertest. The API was restarted from this worktree (the
  running one was serving a different branch and would have "passed" without the
  route existing — checked via `lsof -d cwd` rather than assumed), and an
  unauthenticated probe returned **401, not 404**, confirming the route was
  actually mounted. Then a real emulator-minted token drove one request
  representing a four-person room:

  ```
  room members : 51360002 (blocked me, stored NUMERIC)
                 51360003 (blocked me, stored STRING)
                 51360004 (has not blocked me)
                 51360005 (blocked me, and in the OTHER cohort)
  HTTP 200
  blockedBy    : ["51360002","51360003","51360005"]
  response keys: ["blockedBy"]
  ```

  Every previously-impossible case now answers: the numeric block is seen, the
  cross-cohort member is answered for instead of denying the whole request, the
  non-blocker is excluded, and the response carries nothing but the id list.
  Before this change that same room returned "nobody has blocked you".

- **2026-08-19 05:0x WIB — ANDROID DEVICE-PROVEN on the real OnePlus (CPH2653,
  Android 16), as a controlled A/B rather than a single happy-path tap.** Build
  `93d656d` of this branch, confirmed by the in-app debug overlay showing
  `fix/SHY-0351…never-fires`. The staged fixture put the block in the shape that
  used to be invisible — `blockedUserIds: [50000010]` written as a **number**,
  verified `typeof === 'number'` after the write — on a non-owner participant, so
  the join path's `otherParticipantIds` filter would actually include them.

  | leg | condition | result |
  | --- | --- | --- |
  | **A** | API up | **"A user in this room has blocked you. You may have a limited experience. Enter anyway?"** with *Choose Another Room* / *Enter* |
  | **B** | API stopped, nothing else changed | **no warning — straight into the room**, which rendered normally with the blocker visible in a seat |

  Leg B is the part that makes this proof rather than a screenshot. Firestore
  stayed up throughout (the emulator was never stopped), so the OLD code path
  would have been unaffected by killing the API. The warning tracking the API's
  availability is what shows it is now produced by `/api/users/blocked-by`. Leg B
  also confirms the deliberate failure behaviour: the check errors, and the join
  proceeds unwarned exactly as before — what changed is that the app no longer
  *manufactures* the answer "nobody has blocked you".

- **2026-08-19 — an unrelated local-fixture observation, recorded but NOT
  claimed as a product defect.** A third replication with the seeded
  harasser/victim pair could not be completed: signed in as Raul (50000050), the
  room card would not open. `users/50000050` held a **stale `firebaseUid`** that
  did not match the Auth emulator's uid for `harasser@shytalk.dev`, which
  surfaced as `ApiException: User profile not found` from the LiveKit token call.
  Repairing the linkage cleared that error, but the card still would not
  navigate, and the cause was not established. It could be further local seed
  drift or something real about that persona; either way it is not this change —
  the same room, same build and same tap worked for the other account minutes
  earlier. Worth its own look, because a persona that cannot enter a room would
  silently weaken any journey test that relies on it.

- **2026-08-19 — STILL OWED: the iOS device leg**, and the journey scenario
  named in the Test Plan. Android is proven; iOS is not, so this is **not**
  ready for `In Review`.
