---
id: SHY-0354
status: Draft
owner: claude
created: 2026-08-19
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: true
---

# SHY-0354: No automated journey ever opens a follow list and reads who is in it

## User Story

As **whoever owns the follow, following and stalker lists**, I want an automated
journey that opens each list and reads the names in it, so that the lists
breaking again is caught by a test run rather than by somebody noticing on a
phone.

## Why

**P1, and it is the reason SHY-0338 shipped on hand-walked evidence.**

SHY-0338 was a P0: the followers, following and stalkers lists **did not work at
all** — a document with 7 followers and 5 following rendered as
*"Loaded 1 followers, 0 following"*. It was found by a person looking at a phone.
Nothing in the automated corpus could have found it, and nothing can find it
today.

The corpus gets close and stops short. `j07` reaches a profile and asserts its
**counters** (`shows Alice's stats (followers, following, beans)`), and there is a
stalkers-counter step at `manual-qa-runner.js:15022`. **Nothing opens Followers /
Following / Stalkers and reads the NAMES.**

That distinction is the whole bug. During SHY-0338 **the counter was right while
the list was empty** — the count came from one field and the names from a
different read that was being refused. A counter assertion is exactly the test
that would have gone green while the feature was broken.

**What is missing is driver work, not scenario prose.** Per platform — Android,
iOS, Web:

| Needed step | Why |
| --- | --- |
| `opens the "<tab>" tab on the connections screen` | no navigation step exists at all |
| `UI lists exactly N people in the <tab> list` | a count taken from the LIST, which catches an all-or-nothing refusal |
| `UI shows "<displayName>" in the <tab> list` | the NAME assertion — the one that would have caught SHY-0338 |
| `UI does NOT show "<displayName>" in the <tab> list` | proves a per-member drop, e.g. a blocked or cross-cohort member |

Four steps across three platforms. That is the known missing-driver inventory in
miniature, and it is why it was not half-built at the end of the session that
fixed SHY-0338.

**Why it matters beyond one story.** These lists are where cohort segregation and
blocking become visible to a user, so they are exactly the surface where a
silent regression has a safety dimension rather than only a cosmetic one. They
are also now served by two endpoints added in SHY-0338 (`POST /users/batch`,
`GET /users/:uniqueId/stalkers`) whose per-member drop behaviour has server tests
but no end-to-end proof that the client renders the result.

## Acceptance Criteria

### Happy path

- [ ] A journey opens the Followers list and asserts the expected people are named in it.
- [ ] The same holds for Following and for Stalkers.
- [ ] The assertions read the names shown in the list, not a counter beside it.
- [ ] The journey runs on Android, iOS and Web from the same scenario text.

### Error paths

- [ ] A step that cannot find the list fails loudly rather than reporting a pass, per SHY-0330.
- [ ] A step naming a person who is absent fails, and says who was expected and who was found.

### Edge cases

- [ ] A list with nobody in it is distinguishable from a list that failed to load.
- [ ] A member who is cross-cohort is asserted ABSENT while same-cohort members are still listed — the per-member drop that SHY-0338's `POST /users/batch` performs.
- [ ] A member who has blocked the viewer is asserted absent from follow lists, and PRESENT in stalkers, which is deliberate.
- [ ] A list longer than one screen is scrolled far enough to assert on a member that starts off-screen.

### Performance

- [ ] The new steps add no fixed waits; they wait on a condition, per the no-sleeps rule.

### Security

- [ ] The scenarios use seeded test personas only, and no real user data.

### UX

- [ ] N/A — this is test automation; it asserts the existing UI and changes none of it.

### i18n

- [ ] Name assertions match on the rendered display name, so they do not silently depend on the interface language.

### Observability

- [ ] A failure reports the names actually rendered, so a run tells you what was wrong without a re-run.

## BDD Scenarios

**Scenario: The followers list names the people who follow you**

- **Given** somebody with a known set of followers
- **When** they open their followers list
- **Then** each of those people is named in the list

**Scenario: An empty list is not the same as a broken one**

- **Given** somebody nobody follows
- **When** they open their followers list
- **Then** they are told it is empty, rather than shown a list that failed to load

**Scenario: Somebody who cannot be shown is left out, and the rest still appear**

- **Given** a follower the viewer is not allowed to see
- **When** the viewer opens their followers list
- **Then** that person is missing and everybody else is still listed

## Test Plan

**This story IS test infrastructure**, so the deliverable and the test are the
same artefact. The meaningful question is whether the new steps can fail.

### Driver work — `express-api/scripts/drivers/`

- `android-adb-driver.js`, the iOS driver, and the web driver each gain the four
  steps in the table above, with the matcher wired in `manual-qa-runner.js`.
- Per the established convention, each new driver method gets its input-rejection
  cases (`''`, `'   '`, `null`, `undefined`) and runner-routing tests for every
  platform branch.

### Journey corpus — `journey-tests/`

- A scenario extending `j07`: seed a persona with a known follower set, open each
  tab, assert the names.
- A second scenario for the per-member drop: one cross-cohort follower asserted
  ABSENT while same-cohort followers are asserted present.

### Proof the steps can actually fail

- Point a name assertion at somebody who is **not** in the list and confirm it
  goes RED. A step that has never been seen red is not evidence — this is the
  SHY-0330 lesson, and it applies to the steps written here before they are
  trusted anywhere.
- Re-run the new journey against the **pre-SHY-0338** client (the
  `filterIsInstance<String>()` version) and confirm it goes RED. That is the
  real acceptance test for this story: it must catch the bug that motivated it.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the name assertion reduced to a count | the pre-SHY-0338 replay above |
| the "does NOT show" step always passing | the per-member-drop scenario |
| the tab-navigation step reporting success without navigating | the SHY-0330 no-op guard |

## Out of Scope

- Changing the follow/stalker product behaviour, or the endpoints SHY-0338 added.
- The other missing driver methods in the wider inventory — this story is the
  four steps for these three lists, not the backlog behind them.
- Web parity work beyond these steps.

## Dependencies

- **SHY-0338** — provides the endpoints these journeys exercise, and is the bug
  that must be replayed as the acceptance test. It merges first; this story
  exists because it shipped on hand-walked evidence.
- **SHY-0330** — a journey step must throw rather than silently pass; the proofs
  above rely on that already being true.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| The steps are written and never seen red | Two explicit RED proofs are required by the DoD: a wrong-name assertion, and a replay against the pre-SHY-0338 client. |
| A count assertion creeps back in as "close enough" | The mutation table makes reducing a name assertion to a count a named failure; the story's whole premise is that the count was right while the list was empty. |
| Three platforms is a lot of driver work | It is scoped to four steps and stated as such, rather than being folded into a product story where it would be pressured to shrink. |
| The scenarios depend on seeded state that drifts | They use the persona registry, which is the test contract, and the registry is updated in the same PR if the shapes change. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] The four steps exist on Android, iOS and Web, with input-rejection and runner-routing tests.
- [ ] A name assertion was observed RED against somebody absent from the list.
- [ ] The journey was observed RED against the pre-SHY-0338 client, and green against the fixed one.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] The journey ran on real Android AND real iPhone, local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19 — filed as the follow-up that makes SHY-0338's merge decision
  honest.** SHY-0338 shipped a P0 fix on hand-walked device evidence because the
  journey automation to cover it does not exist. Recording that as a story rather
  than a promise is the difference between a deliberate trade and a dropped
  thread.

- **2026-08-19 — the counter/name distinction is the whole point.** During
  SHY-0338 the follower COUNT rendered correctly while the LIST was empty,
  because the count and the names come from different reads and only the second
  was being refused. Any test asserting the counter would have been green
  throughout. That is why every AC here insists on the rendered names.
