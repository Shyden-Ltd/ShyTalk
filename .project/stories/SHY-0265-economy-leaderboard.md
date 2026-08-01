---
id: SHY-0265
status: In Progress
owner: claude
created: 2026-08-01
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: false
---

# SHY-0265: Economy leaderboard — cohort-scoped ranking of gift spend

## User Story

- **As a** ShyTalk user who spends on gifts
- **I want** to see where I rank against others in my own cohort
- **So that** the spending has visible standing, and I am never ranked against — or shown to — users in a different age cohort

## Why

The journey corpus has asserted this feature since j05 was written:

```gherkin
When Alice on Web opens "/leaderboard"
Then within 3000ms Alice's Web UI shows her own rank in the top 100 (rank <= 100)
Then the response from /api/economy/leaderboards has cohort="adult" in every row
```

**The tests exist and the feature does not.** There is no `/api/economy/leaderboards`
route, no `/leaderboard` page, and no ranking UI in the app — `GiftWallViewModel`
holds a `ranking: List<GiftRankEntry>` field that no screen renders. So the
scenario has failed on every run since it was written, and the failure pointed at
the app rather than at the absence of a plan.

Operator 2026-08-01: *"if we have tests written for them then that means they
should have been built already, because of TDD… which is another failure we need
to fix."*

The cohort scoping is not a nicety. ShyTalk segregates minors from adults
everywhere else — rooms, discovery, PMs — and a leaderboard that mixes them would
re-open that boundary through a back door, exposing minors' display names and
activity to adults who cannot otherwise see them.

## Acceptance Criteria

### Happy path

- [ ] `GET /api/economy/leaderboards` returns the top 100 spenders in the CALLER's cohort, ranked by gift spend, highest first.
- [ ] Every row carries `uniqueId`, `displayName`, `rank`, `amount`, and `cohort`.
- [ ] The caller's own row is included in the response as `me`, even when their rank is outside the top 100.
- [ ] `/leaderboard` on the web renders the returned rows in rank order, with the caller's own row visually distinguished.
- [ ] The app's gift-wall surface renders the same ranking through the existing `GiftWallViewModel.ranking` field.

### Error paths

- [ ] An unauthenticated request returns 401 and no rows.
- [ ] A banned or suspended caller receives 403 — a leaderboard is a social surface, and a suspended user is removed from social surfaces.
- [ ] A backend failure renders an error state on the page, never an empty leaderboard that reads as "nobody has spent anything".

### Edge cases

- [ ] A cohort with fewer than 100 spenders returns only the rows that exist, and the page renders them without padding.
- [ ] A caller who has spent nothing appears in `me` with `amount: 0` and no rank, rather than being omitted — the absence of a rank is information.
- [ ] Ties in spend are broken deterministically by `uniqueId` ascending, so two equal spenders do not swap places between requests.
- [ ] A user whose display name is empty renders their `uniqueId`, never a blank row.

### Performance

- [ ] The endpoint answers within 500 ms at p95 for a cohort of 10 000 users.
- [ ] The ranking is computed from a single indexed query; no per-user reads in a loop.

### Security

- [ ] The cohort is taken from the caller's VERIFIED claim, never from a query parameter — otherwise any adult could request the minor leaderboard.
- [ ] No row for a user outside the caller's cohort appears in any response, asserted by the journey step `has cohort="adult" in every row`.
- [ ] Banned users are excluded from rows, so a ban does not leave a name on public display.

### UX

- [ ] The caller's own row is reachable without scrolling when they are outside the visible window.
- [ ] Amounts are formatted for the caller's locale.

### i18n

- [ ] All new user-facing strings exist in ALL 21 locale files.
- [ ] Rank and amount formatting follows the caller's locale conventions.

### Observability

- [ ] Leaderboard requests log cohort and row count, never display names.

## BDD Scenarios

**Scenario: A spender sees their own rank**

- **Given** Alice is signed in on the web with cohort adult
- **And** Alice has sent a crown
- **When** Alice opens the leaderboard
- **Then** she sees her own rank within the top 100

**Scenario: The leaderboard never crosses cohorts**

- **Given** Marcus is signed in with cohort minor
- **When** Marcus opens the leaderboard
- **Then** every row shown has cohort minor
- **And** no adult-cohort user appears

**Scenario: A suspended user is refused**

- **Given** Raul is suspended
- **When** Raul requests the leaderboard
- **Then** the response is 403 and no rows are returned

**Scenario: A user who has spent nothing still learns where they stand**

- **Given** Ines has never sent a gift
- **When** Ines opens the leaderboard
- **Then** she sees the ranked rows
- **And** her own entry shows an amount of zero and no rank

**Scenario: Equal spenders do not swap places**

- **Given** two users have spent exactly the same amount
- **When** the leaderboard is requested twice
- **Then** the two users appear in the same order both times

## Test Plan

**Red first, in this order:**

1. `express-api/tests/routes/economy-leaderboards.test.js` — real Firestore emulator. Cohort scoping, 401, 403 for suspended, tie-breaking, `me` for a zero-spend caller, banned-user exclusion.
2. `journey-tests/j05-alice-monetization.feature` — the existing scenario stops being a permanent failure and becomes a real pass.
3. Playwright web E2E for `/leaderboard` — renders rows in order, marks the caller's row, shows an error state rather than an empty list on failure.
4. Kotlin `:shared:jvmTest` for the ranking mapper.

**Green:** the journey step `the response from /api/economy/leaderboards has cohort="adult" in every row` passes on the real stack, on both devices and the web.

## Out of Scope

- Historical or time-windowed leaderboards (all-time only for now).
- Rewards or prizes attached to rank.
- Cross-region leaderboards.

## Dependencies

- Existing gift-spend transactions in `users/{uid}/transactions`.
- The verified-cohort claim already carried on the ID token.

## Risks & Mitigations

- **Risk:** a cohort taken from a request parameter would let an adult enumerate minors. **Mitigation:** cohort is read from the verified claim only; a test asserts a forged parameter is ignored.
- **Risk:** a full-collection scan makes the endpoint slow as the user base grows. **Mitigation:** single indexed query, capped at 100 rows, with the p95 budget asserted.
- **Risk:** ranking a suspended or banned user leaves their name on public display. **Mitigation:** excluded at query time, asserted.

## Definition of Done

- All AC met; the j05 leaderboard scenario passes on local and dev.
- Express, Playwright and Kotlin tests green; `npm test` and lint clean.
- Strings present in all 21 locales.
- `:shared:compileKotlinIosArm64` green.
- Full journey matrix green on both devices and all browsers.

## Notes (running log)

- **2026-08-01** — Created while closing the app-testing gaps in SHY-0259. Discovered the corpus has asserted this feature since j05 was authored while no story, route, page or screen ever existed: the test was written and the implementation never followed. Filed at the operator's instruction that "if the tests are there then that means the feature should have been built already".
