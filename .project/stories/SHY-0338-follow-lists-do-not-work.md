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
