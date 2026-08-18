---
id: SHY-0338
status: Draft
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0338: The followers, following and stalkers lists do not work at all

## User Story

As **any user**, I want my followers, following and stalkers lists to show the
right people, so that I can see who I am connected to and act on it.

## Why

**P0, MVP-blocking.** Operator-reported 2026-08-18: the followings, followers
and stalkers lists are **not working at all**.

These lists are not a secondary screen — they are how a social product makes its
graph visible. With them broken:

- a user cannot tell whether following someone worked;
- they cannot find people they already follow, so the graph they have built is
  unreachable;
- they cannot see who follows them, which is the feedback loop that makes
  posting worth doing;
- **stalkers is a safety surface** — a user who cannot see who is watching them
  cannot act on it. That elevates this above an ordinary feature bug.

"Not working at all" covers several possible failures — empty when populated,
erroring, never loading, or showing the wrong people. The first task is to
establish WHICH, per list, per platform, because the fix differs completely.

## Acceptance Criteria

### Happy path

- [ ] Following shows exactly the accounts the user follows, and nobody else.
- [ ] Followers shows exactly the accounts following the user.
- [ ] Stalkers shows exactly the accounts defined as stalkers, and the definition is stated in the story before any code changes.
- [ ] Each list reflects a change (follow/unfollow) without needing an app restart.

### Error paths

- [ ] A list that fails to load says so and offers a retry — it never shows an empty list, which is indistinguishable from "you have none".
- [ ] A genuinely empty list shows an empty state that is clearly different from a failure.
- [ ] A partial failure while paging does not silently truncate the list.

### Edge cases

- [ ] A user with zero entries, exactly one, and a large number all render correctly.
- [ ] Paging to the end terminates and does not loop or duplicate entries.
- [ ] A blocked, banned or deleted account is handled per policy rather than rendering broken.
- [ ] Cohort rules are respected: an adult must not appear in a minor's list, or vice versa, where the segregation rules say so.

### Performance

- [ ] The first page appears within 1 second on a normal connection; paging does not block the UI.

### Security

- [ ] A user can only read their OWN followers/following/stalkers, enforced server-side, not by the client asking nicely.
- [ ] Cohort segregation is enforced on the server for these lists, consistent with the wider age-segregation rules.
- [ ] Stalkers, being a safety surface, is verified to expose no more about the watcher than policy allows.

### UX

- [ ] Empty, loading, error and populated states are all visually distinct.
- [ ] Verified on real devices at the smallest supported resolution.

### i18n

- [ ] Every string, including empty and error states, ships in all 20 locale files.

### Observability

- [ ] A failing list logs which list, for which user, and the failing layer — so "not working at all" can never again be the level of detail available.

## BDD Scenarios

**Scenario: The people I follow are listed**

- **Given** someone who follows several accounts
- **When** they open their following list
- **Then** they see exactly those accounts

**Scenario: Following someone updates the list straight away**

- **Given** someone viewing a profile they do not yet follow
- **When** they follow that person
- **Then** that person appears in their following list without restarting the app

**Scenario: A list that fails to load says so**

- **Given** someone whose connection is failing
- **When** they open their followers list
- **Then** they are told it could not be loaded and can retry, rather than seeing an empty list

## Test Plan

**Diagnose before fixing.** The first commit records, per list and per platform,
what actually happens today — empty, error, hang, or wrong data — with evidence.
A fix aimed at the wrong layer is the likeliest way to burn this ticket.

### Express/Jest — `express-api/tests/routes/`

- each endpoint returns exactly the expected set for a seeded persona
- a user requesting ANOTHER user's lists is refused
- cohort segregation is enforced server-side
- paging terminates, does not duplicate, and does not silently truncate on partial failure

### Kotlin unit — `shared/src/commonTest/.../social/`

- each list's view state maps loading, empty, error and populated distinctly
- an error state is NEVER rendered as an empty list
- a follow action updates the list without a restart

### Playwright — `public/`

- the web surface shows the same three lists correctly

### Journey tests (REQUIRED — real devices)

- `journey-tests/` scenario: persona A follows persona B; **A's following list
  contains B, and B's followers list contains A** — asserted from BOTH sides,
  because a one-sided assertion cannot tell a working list from a cached one.
- A scenario covering the empty state and the error state.
- Walked on real Android + real iPhone, local THEN dev.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the error state falls back to rendering an empty list | `an error state is NEVER rendered as an empty list` |
| the server-side ownership check removed | `a user requesting ANOTHER user's lists is refused` |
| cohort filtering removed | the segregation test |

## Out of Scope

- Redesigning the lists, adding search or sorting within them.
- Changing what "stalkers" means — the definition is to be RECORDED here, not revised.

## Dependencies

- The stalkers definition must be confirmed with the operator before implementation, since the AC asserts exactness and the term is product-specific.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| "Not working at all" hides three different bugs | Diagnose per list, per platform, and record it before any fix. |
| An error renders as empty and looks fixed | Explicitly asserted against, and in the mutation table. |
| A client-side fix leaves the data wrong | Assertions from BOTH sides of the follow relationship in the journey. |

## Definition of Done

- [ ] Every AC met; every named test written RED first and now green.
- [ ] A recorded per-list, per-platform diagnosis in Notes BEFORE the fix.
- [ ] Every mutation killed its named test, reverted with a git-verified clean tree.
- [ ] Journey walked on real Android + real iPhone, local THEN dev, asserting both sides.
- [ ] Strings present in all 20 locales.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Reported by the operator as an MVP blocker, verbatim: "the
  followings, followers, stalkers lists are not working at all."
- **2026-08-18** — Raised to P0 rather than P1: stalkers is a SAFETY surface, and
  a user who cannot see who is watching them cannot act on it.
- **2026-08-18** — OPEN QUESTION for the operator: the exact definition of
  "stalkers" (who qualifies, and what the watched user may see about them). The
  AC asserts the list is exactly right, which cannot be tested until the
  definition is written down here.

- **2026-08-18 — ROOT CAUSE, proven against the live rules engine.**
  The story asked for WHICH failure, per list. The answer is one mechanism for
  followers and following, and that same mechanism plus two more for stalkers.

  **The lists are refused by `firestore.rules`, and the refusal is swallowed.**

  1. Both platforms read the list members by querying Firestore **directly from
     the client** — `UserRepositoryImpl.getUsers()` (Android) and
     `IosUserRepositoryImpl.getUsers()` (iOS) each issue
     `collection("users").whereIn(FieldPath.documentId(), chunk)` in chunks of 30.
     That is already a breach of the no-direct-backend rule; here it is also the
     bug.
  2. `firestore.rules:66` gates a `users/{uniqueId}` read on
     `cohortMatchesCaller()`, which compares the caller's token claim against
     `resource.data.get('cohort', 'minor')`.
  3. **The refusal is all-or-nothing.** A `documentId() in [...]` query names
     exact paths, so the engine evaluates the gate per document — an
     all-same-cohort batch genuinely SUCCEEDS. But if ONE document in the chunk
     fails, Firestore denies the **entire query**, and the other 29 readable
     users are lost with it.
  4. `cohort` arrived with UK OSA #17. Any user document written before it — or
     by any path that does not stamp it — reads as the `'minor'` default. **One
     legacy follower empties a whole page of the list for an adult viewer.**
  5. Both clients catch the exception and return `emptyList()`
     (`Log.w` / `logW`, nothing else). So the screen shows an empty list with no
     error, which is exactly "not working at all".

  The profile itself still loads because `getUser()` is a single-document `get()`
  covered by the own-doc carve-out — which is why the screens open and only the
  lists are blank.

  **Stalkers has two further, independent faults**, so fixing the above alone
  would leave it dead:

  - `getStalkers()` runs an ORDERED query over `users/{id}/stalkers`. That one
    IS the classic "rules are not filters" case — the rule's second clause reads
    `resource.data`, so the query is refused outright regardless of contents.
  - A stalker document carries no `cohort` field at all, so
    `cohortMatchesCaller()` compares an adult caller's `'adult'` claim against
    the `'minor'` default and **never matches, even on a single-document read**.

- **2026-08-18 — Why it shipped.** Every suite in
  `express-api/tests/firestore-rules/` tests single-document `get()`/`set()`.
  **Not one of them issues a query** — grepped for `whereIn`, `documentId` and
  `orderBy` across the directory, zero hits. The rule was verified for an
  operation the app never performs, and never for the one it does. There is also
  no rules suite for `users` at all.

- **2026-08-18 — First theory was WRONG, and the emulator said so.** I expected
  a blanket "rules are not filters" denial of the batch query. The CONTROL test
  proves an all-same-cohort batch succeeds. Recorded because the wrong theory
  leads to the wrong fix: stamping `cohort` everywhere would look like a cure
  and would still leave every genuinely cross-cohort follower emptying the list.

- **2026-08-18 — Characterisation suite added**,
  `express-api/tests/firestore-rules/users-follow-lists-rules.test.js`, 8 tests
  against the live emulator. **These pin the CURRENT, BROKEN behaviour on
  purpose.** A green run is evidence the lists are still broken in exactly the
  way described, not that they work. Every `assertFails` in it must be replaced
  when the fix lands.

- **2026-08-18 — The fix follows the operator's own rule.** These reads belong
  on the API, where the Admin SDK can apply the cohort filter **per user** —
  dropping the people a viewer may not see and returning the rest — instead of
  a client-side query that refuses wholesale. That removes the direct-Firestore
  breach and the silent `emptyList()` in the same change.

- **2026-08-18 — FIX LANDED (server + both clients). Device walk still owed.**

  | Layer | Change |
  | --- | --- |
  | API | `POST /api/users/batch` — profiles resolved through the Admin SDK, cohort-filtered **per user**. 12 tests. |
  | API | `GET /api/users/:uniqueId/stalkers` — owner-only; visits AND visitor profiles in one response. 9 tests. |
  | Android | `getUsers` / `getStalkers` moved onto both endpoints; the swallowing `catch`es deleted. |
  | iOS | Same, identically. |
  | Shared | `UserRepository.getStalkers` now returns `StalkerPage(visitors, users)` — one round trip instead of two, and the second was the one that always failed. |
  | Shared | `FollowListViewModel` carries the failure to `uiState.error` instead of mapping it to `emptyMap()`. |

  **Ten mutations, each killing its own named test**, reverted with a verified
  clean tree every time. The one that matters: reinstating all-or-nothing cohort
  refusal on the batch endpoint kills three tests, headed by
  `ONE cross-cohort member does not empty the batch`.

- **2026-08-18 — A test was passing for the wrong reason, and mutation found it.**
  `a visitor whose account is gone is dropped rather than returned hollow`
  survived deleting the `!userSnap.exists` guard: a missing document has no
  `cohort`, so it defaulted to `'minor'` and the ADULT owner's cohort check
  dropped the row anyway. Fixed the TEST — it now runs against a MINOR owner so
  the default cohort MATCHES and only the exists guard can drop the row.

- **2026-08-18 — Two existing tests broke, and they were right to.** Neither
  stubbed `getStalkers`, so the relaxed mock returned a dummy `Resource.Error("")`
  that the old `else -> Unit` ate. `getStalkers error keeps empty list` has been
  renamed and INVERTED: keeping the empty list silently was the defect.

- **2026-08-18 — STILL OWED before this can go to In Review:**
  1. **The device walk** — real Android and real iPhone, local then dev. Devices
     are unreachable while the operator is away, so this is the blocker.
  2. **Journey scenarios** for all three lists, asserting rendered names rather
     than element counts.
  3. The characterisation rules suite must have its `assertFails` cases replaced
     now that the clients no longer issue those queries.

- **2026-08-18 — Deliberately NOT dragged in.** `getUser`, `getBlockedUserIds`
  and `getAliases` also read Firestore directly from the client — the same
  no-direct-backend breach — but they are single-document `get()`s covered by
  the own-doc carve-out, so they WORK. Fixing them here would widen a P0 bug fix
  into a migration. Worth its own story.

- **2026-08-18 — One decision for the operator.** The stalkers endpoint is
  **not** block-filtered, unlike `/users/batch`: if somebody has blocked you and
  is still opening your profile, that is precisely what this screen exists to
  tell you. Hiding them would turn a safety surface into a blind spot. Say if
  you read it the other way.

- **2026-08-19 — iOS DEVICE WALK DONE, on the real iPhone.** Sean's iPhone
  (iPhone Air, iOS 27.0), driven with Appium/XCUITest per the proven recipe,
  against the local stack over the LAN. Signed in as Alice (P-02 adult power),
  `UID: 50000010 · adult`, route `follow_list/{userId}/{tab}`:

  ```
  Following (5)      Followers (6)      Stalkers (0)
  [SEED] Lena (P-05 lapsed)
  [SEED] Hayato (P-06 DOB mismatch)
  [SEED] Theo (P-10 voice host)
  [SEED] Layla (P-13 ar)
  [SEED] Kenji (P-14 ja)
  [SEED] Vexa (P-07 cross-cohort prober)
  ```

  **7 followers in Firestore, 6 rendered** — the legacy follower with no
  `cohort` field is dropped on its own and the other six survive. Identical to
  the Android result. Names asserted, not counts.

- **2026-08-19 — what the iOS walk needed first.** It was blocked by two
  problems that are not this story's:
  1. **SHY-0345** (filed, PR #1804) — `Local.xcconfig` had no
     `KOTLIN_FRAMEWORK_BUILD_TYPE`, so `Debug-Local` could not build at all.
  2. **SHY-0275** (PR #1696, open) — the Local build hardcodes `localhost` and
     the Firebase emulators bind `127.0.0.1`, so a physical iPhone cannot reach
     the stack. #1696 plumbs a build-time `LOCAL_HOST` through Info.plist and
     binds the emulators to `0.0.0.0`.

  The walk was therefore run on a throwaway verification branch —
  #1696 + this story's fix + SHY-0345 — built with `LOCAL_HOST=192.168.1.9`.
  **That branch is never merged.** It exists only to prove this fix on real
  hardware while #1696 is still in review. Recorded so the next reader knows
  the evidence is real and how to reproduce it.

- **2026-08-19 — a simulator was used briefly and that was WRONG.** The operator
  caught it: verification is real-devices-only. The simulator was deleted and
  the walk redone on the iPhone. Codified in
  [[feedback-never-substitute-a-simulator-for-a-real-device]] — a blocked device
  path means FIX THE BLOCKER, which is exactly what SHY-0345 turned out to be.
