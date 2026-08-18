---
id: SHY-0348
status: Draft
owner: claude
created: 2026-08-19
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0348: Blocking someone does not stop them looking at your profile

## User Story

As **someone who has blocked another user**, I want them to be unable to open my
profile at all, so that blocking actually removes me from their reach instead of
only hiding them from mine.

## Why

**P0 on a minors-facing product. Blocking is the control a user reaches for when
someone is making them uncomfortable, and it does not do what they believe it
does.**

The server already gets this right. `GET /api/users/:uniqueId` refuses a blocked
viewer:

```js
if (!isSelf && viewerIsBlocked(req.auth.uniqueId, user)) {
  return res.status(403).json({ error: 'Cannot view content of users who have blocked you' });
}
```

`POST /users/:uniqueId/record-visit` carries the same gate, so a blocked viewer
should not even tick the profile-visit counter.

**The app never asks.** `ProfileViewModel` loads a profile through
`userRepository.getUser(profileUserId)`, and that reads **Firestore directly**
from the client — a single-document `get()` that the security rules allow for
any same-cohort user. The API's refusal is never consulted, so the block is
invisible to the one code path that matters.

So today: A blocks B; B opens A's profile and sees everything. The server would
have said no. Nobody asked it.

**This is the same class of defect as SHY-0338** — the client reading Firestore
directly instead of going through the API, and the operator's standing rule
against direct backend access existing precisely to prevent it. There the
consequence was empty lists; here it is a safety control that silently does
nothing.

**Operator decision, 2026-08-19:** a blocked person attempting to view the
blocker's profile must be **prevented and told they must be unblocked first**.
That also settles an open question on SHY-0338 — if a blocked user can never
reach the profile, they can never generate a visit, so the stalker list needs no
block filtering.

## Acceptance Criteria

### Happy path

- [ ] A blocked person opening the blocker's profile is stopped, and told they need to be unblocked first.
- [ ] Everyone else sees the profile exactly as before.
- [ ] Blocking takes effect immediately — an already-open profile does not keep working.

### Error paths

- [ ] If the check cannot be completed, the profile is NOT shown — the failure direction is refusal.
- [ ] The refusal is a clear message, not a blank screen or a generic error.

### Edge cases

- [ ] Unblocking restores access.
- [ ] A user always sees their own profile, whoever has blocked them.
- [ ] Reaching the profile by a different route — search, a room, a message thread, a deep link — is refused the same way.
- [ ] A blocked viewer does not tick the profile-visit counter, so they cannot appear in the blocker's stalker list.

### Performance

- [ ] Opening a profile costs no extra round trip for the ordinary, unblocked case.

### Security

- [ ] Enforcement is server-side. A modified client cannot read the profile it was refused.
- [ ] The refusal does not reveal anything about the blocker beyond the fact of the block.

### UX

- [ ] The message says what happened and what would change it, in plain words.
- [ ] Verified with eyes on real devices, both platforms.

### i18n

- [ ] The message ships in every launch locale, asserted on rendered text.

### Observability

- [ ] A refused profile view is distinguishable in logs from a network failure.

## BDD Scenarios

**Scenario: A blocked person cannot open the profile**

- **Given** someone who has been blocked
- **When** they try to open the profile of the person who blocked them
- **Then** they are stopped and told they need to be unblocked first

**Scenario: Unblocking gives access back**

- **Given** a person who was blocked and has since been unblocked
- **When** they open that profile
- **Then** it opens normally

**Scenario: A blocked person leaves no trace**

- **Given** someone who has been blocked
- **When** they try to open the blocker's profile
- **Then** they do not appear in that person's list of profile visitors

## Test Plan

**RED first.** Today a blocked viewer loads the profile through Firestore and
sees everything; the API's 403 is never reached.

### Express / Jest — `express-api/tests/routes/users-blocked-profile-view.test.js`

- `a blocked viewer is refused the profile` — pins the server contract that already exists
- `an unblocked viewer is served the profile`
- `the owner always sees their own profile`
- `a blocked viewer does not record a profile visit`

### Kotlin unit — `shared/src/commonTest/.../profile/`

- `a refused profile shows the unblock message, not an empty profile` — **the defect, in one assertion**
- `a transport failure is distinguishable from a refusal`
- `an unblocked profile loads unchanged`

### Journey tests — real devices

- `journey-tests/`: two personas, A blocks B, B opens A's profile from search AND from a room; both refused with the message. A unblocks; B opens it successfully.
- Walked on real Android (USB adb) AND real iPhone (USB devicectl), local then dev.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the profile view reverted to the direct Firestore read | `a refused profile shows the unblock message...` + the journey |
| the server's `viewerIsBlocked` gate removed | `a blocked viewer is refused the profile` |
| the refusal rendered as an empty profile | `a refused profile shows the unblock message...` |

## Out of Scope

- Routing EVERY `getUser` call through the API. **There is a trap here worth
  naming:** the API strips `cohort` before responding, and the follow lists rely
  on the viewer's own cohort for their defence-in-depth filter (SHY-0338). A
  blanket switch would empty those lists again from a new cause. This story
  changes the profile-view path only.
- Changing what blocking does elsewhere — messages, rooms, gifts.
- The wider direct-Firestore debt.

## Dependencies

- **SHY-0338** — shares the "client reads Firestore directly" root cause and the
  `cohort`-stripping hazard above. Land 0338 first so the interaction is settled.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Routing the profile through the API breaks the follow lists again | Explicitly out of scope to change `getUser` wholesale; the cohort hazard is named here so the next person does not walk into it. |
| A network failure looks like a block | Asserted separately, and in the mutation table. |
| The block is enforced only in the UI | Server-side gate already exists and is pinned by its own test. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Journey scenarios walked on real Android AND real iPhone, local then dev.
- [ ] Screenshots of the refusal on both platforms, in at least two locales.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Filed at operator instruction: *"if a person is blocked and
  they attempt to view that person's profile, we must prevent and inform the
  user they must be unblocked first. this avoids the need for this filtering."*
  The last clause settles SHY-0338's open question: with the profile
  unreachable, a blocked user can never generate a visit, so the stalker list
  needs no block filter.

- **2026-08-19** — Verified before writing: the SERVER already refuses
  (`users.js:729`), and `record-visit` carries the same gate. The gap is
  entirely client-side — `ProfileViewModel` calls `userRepository.getUser`,
  which reads Firestore directly and never consults the API.

- **2026-08-19** — The hazard that shapes the scope: the API strips `cohort`,
  and the follow lists need the viewer's cohort for their client-side filter.
  Switching every `getUser` to the API would empty those lists again from a
  fresh cause — exactly the trap SHY-0338 hit. Recorded so it is not rediscovered
  the expensive way.

- **2026-08-19 — the block filter is DEVICE-PROVEN in the lists (SHY-0338's
  half).** Set Theo to block Alice with a NUMERIC id — the shape
  `block-check.js:4` documents — then opened Alice's connections on the real
  OnePlus: **Followers 6 → 5 and Following 5 → 4, with Theo gone from both.**
  `POST /api/users/batch` drops a member who has blocked the viewer, and it does
  so per member: the other five survived. So the list half of blocking works on
  real hardware.

- **2026-08-19 — what that leaves for THIS story.** The profile screen already
  has a blocked state (`ProfileScreen.kt:491`, driven by
  `uiState.isBlockedByTarget`), and the view model already computes
  `blockedByTarget = user.blockedUserIds.contains(currentUid)`
  (`ProfileViewModel.kt:181`). The UI and the check both exist. What is missing
  is that the profile DATA still arrives from a direct Firestore read, so:
  - the server's 403 is never consulted — defence in depth is absent, and a
    client that ignored the flag would still receive the whole profile;
  - the message says "blocked", not the operator's requirement — *told they must
    be unblocked first*.

- **2026-08-19 — a correction worth recording.** I initially reasoned that
  `blockedUserIds` was always empty on the client because blocks are stored as
  numbers and `filterIsInstance<String>()` dropped them. Half right: the CLIENT
  writes blocks as STRINGS (`UserRepositoryImpl.blockUser` →
  `arrayUnion(blockedUserId)`, a String), so app-created blocks survived the old
  parser. Only blocks written numerically — by the server or an admin path, which
  is what `block-check.js` describes — were dropped. SHY-0338's `asIdSet` fix
  closes that case; it was never the whole story, and saying so avoids
  overclaiming what that fix repaired.

- **2026-08-19 — implemented (server consultation).** `UserRepository` gains a
  TYPED result — `ProfileAccess.Visible / BlockedByOwner / NotFound` — because
  the block case must be told apart from "not found" and from a transport
  failure, and the only thing that reliably does that is the status code. An
  error-message match would work until somebody reworded it.
  `getProfileForViewing` goes through `GET /api/users/:id` on both platforms and
  maps 403/404; anything else rethrows, so a 500 cannot masquerade as a block.
  `ProfileViewModel` keeps the document check as the fast path and lets the
  server's answer win when it says no.

- **2026-08-19 — the failure DIRECTION is asserted, not assumed.** A transport
  failure is explicitly NOT a block. Telling somebody "you have been blocked"
  because the network hiccuped is a worse lie than the bug being fixed, so it has
  its own test.

- **2026-08-19 — Gradle told me it compiled when it had not.** After adding the
  interface member, all four compile targets reported success; `--rerun-tasks`
  failed instantly on a fake that no longer implemented the interface. Codified
  as [[feedback-gradle-up-to-date-hides-a-broken-compile]]. Everything here was
  re-verified with `--rerun-tasks`.

- **2026-08-19 — 97 tests green, mutation-proven.** Dropping the server answer
  (`blockedByDoc || blockedByServer` → `blockedByDoc`) kills exactly
  `the SERVER's block is honoured even when the document does not show it`.

- **2026-08-19 — STILL OWED:** the wording change (the screen says "blocked",
  the operator asked for *"must be unblocked first"*) and its locale files; the
  journey scenarios; and the device walk. The enforcement half is done; the
  telling-the-user half is not.

- **2026-08-19 — device finding: the block bites EARLIER than this story assumed.**
  With Theo blocking Alice, on the real OnePlus Alice cannot reach Theo at all:
  - he is absent from her Followers and Following (the `/users/batch` block
    filter, SHY-0338),
  - and he is absent from **search** — `shapeForViewer` drops anyone who has
    blocked the searcher, so `GET /users/search` never returns him.

  So through the ordinary UI a blocked person cannot navigate to the blocker's
  profile in the first place. **That is stronger than showing a message**, and it
  is worth stating plainly rather than leaving the story implying the message is
  the primary control.

- **2026-08-19 — what the message is actually for, then.** It covers the routes
  that do NOT go through a list or a search: an existing conversation thread, a
  seat in a room, a deep link, a stale back-stack entry. Those are exactly the
  cases where the profile screen opens directly, and where the server's 403 —
  now consulted — is the only thing standing between a blocked person and the
  profile.

- **2026-08-19 — STILL OWED, stated honestly.** The message itself has NOT been
  witnessed rendering on a device. Reaching it needs one of those non-list
  routes set up (a pre-existing conversation is the easiest), which is a
  scenario-building job rather than a walk. The enforcement half is unit-tested
  and mutation-proven; the rendering is verified only in code and in the 21
  locale files. Not claiming more than that.
