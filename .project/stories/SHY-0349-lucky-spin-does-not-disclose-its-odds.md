---
id: SHY-0349
status: Draft
owner: claude
created: 2026-08-19
priority: P0
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0349: The Lucky Spin never tells you your chances

## User Story

As **someone deciding whether to spend ShyCoins on a spin**, I want to see my
odds before I pay, so that I know what I am buying rather than guessing.

## Why

**P0 and store-blocking. Google Play requires it, and we do not do it.**

Play's policy on apps offering randomised paid items is explicit: the odds must
be **disclosed to the user before purchase**, in the app. The Lucky Spin is
exactly such a mechanic — pay ShyCoins, receive a randomised reward — and
nothing anywhere states a probability.

**The randomisation is real and weighted.** `express-api/src/routes/economy.js`:

- `rollWeightedGift(weights, winnableGifts)` — a weighted draw, not a uniform one
- `applyLuckBoost(weights, luck, winnableGifts)` — per-user weighting on top
- `dropRateExponent: 1.5` in config — the curve shaping how steeply rarer
  rewards fall away

So the odds exist, are computed, and are non-obvious. The only thing the UI says
is a `boostedDrop` flag on the 100× tier (`LuckySpinOverlay.kt:774`,
`LuckySpinSummaryPopup.kt:120`) — "boosted" relative to *what*, by how much, is
never stated. That is a hint, not a disclosure.

**Grepped for `odds`, `probability`, `chance`, `drop rate`, `percent` across
`feature/gacha` and the economy route. Nothing.**

**Why it matters beyond the store rule.** The audience includes 13-year-olds,
who can reach this mechanic — the gacha age gate was deliberately dropped and
that decision stands. A paid randomised reward aimed partly at minors, with the
odds hidden, is the exact pattern regulators have been moving against. Showing
the numbers costs us nothing we should want to keep.

**It also protects the age rating.** SHY-0342's answer sheet declares simulated
gambling honestly. A declaration that says "yes, randomised paid items" while
the app hides the odds is a weaker position than one where the odds are on
screen.

## Acceptance Criteria

### Happy path

- [ ] Before spending, a player can see the chance of each reward tier from the spin screen.
- [ ] The odds shown are the odds the server actually uses — not a separately maintained number.
- [ ] The disclosure is reachable in at most one tap from the spin, and stays reachable.
- [ ] Where a tier is boosted, the disclosure says boosted from what, to what.

### Error paths

- [ ] If the odds cannot be loaded, the spin is not offered as if they were known — the player is told, not silently given a spin with hidden odds.
- [ ] Stale odds are never shown as current.

### Edge cases

- [ ] A per-user luck boost is reflected, or the disclosure states plainly that a personal modifier applies and what its range is.
- [ ] Each tier (1×, 10×, 100×) shows its own odds where they differ.
- [ ] A change to the server weighting changes the displayed odds without an app release.

### Performance

- [ ] Opening the disclosure does not delay the spin screen.

### Security

- [ ] Disclosing odds reveals no other player's data and no server secret.
- [ ] The client cannot alter the odds it displays to something the server did not send.

### UX

- [ ] The numbers are readable by a young teenager: percentages, not weights or exponents.
- [ ] Verified with eyes on real devices, both platforms, at the smallest supported resolution.

### i18n

- [ ] The disclosure ships in every launch locale, asserted on rendered text, including number formatting.

### Observability

- [ ] It is possible to tell, from logs, which odds a given spin was offered under.

## BDD Scenarios

**Scenario: A player can see the chances before paying**

- **Given** a player looking at the Lucky Spin
- **When** they ask what their chances are
- **Then** they are shown the chance of each reward before they spend anything

**Scenario: The odds shown are the odds used**

- **Given** the chances shown to a player
- **When** the reward is decided
- **Then** it is decided by those same chances

**Scenario: Unknown odds mean no silent spin**

- **Given** a player whose device cannot load the chances
- **When** they open the Lucky Spin
- **Then** they are told the chances are unavailable rather than being offered a spin as normal

## Test Plan

**RED first.** Today nothing in the app states a probability — the first
assertion fails immediately.

### Express / Jest — `express-api/tests/routes/economy-gacha-odds.test.js`

- `the gacha endpoint publishes the odds it will roll against` — **the defect, in one assertion**
- `published odds sum to 100% within rounding`
- `the odds served match the weights actually used by rollWeightedGift`
- `a per-user luck boost is reflected in what is published`
- `odds are published per tier where tiers differ`

### Kotlin unit — `shared/src/commonTest/.../gacha/`

- `the spin screen offers a way to see the odds`
- `odds that fail to load block the spin rather than hiding the failure`
- `odds render as percentages, not raw weights`

### Journey tests — real devices

- `journey-tests/`: a persona opens the Lucky Spin, opens the odds, and the
  rendered percentages are asserted as TEXT; then spins. Walked on real Android
  and real iPhone, local then dev.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the odds endpoint removed | `the gacha endpoint publishes the odds...` |
| published odds decoupled from the real weights | `the odds served match the weights actually used...` |
| the failure path made to spin anyway | `odds that fail to load block the spin...` |
| percentages rendered as raw weights | `odds render as percentages, not raw weights` |

## Out of Scope

- Changing the odds themselves, or the luck-boost mechanic.
- The age rating declaration (SHY-0342) — this strengthens it but is separate.
- Apple's equivalent requirement, which is satisfied by the same disclosure.

## Dependencies

- **SHY-0342** — the answer sheet declares randomised paid items; this makes that
  declaration defensible. Neither blocks the other.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Displayed odds drift from real odds | They are served from the same source the roll uses, and a test asserts they match rather than comparing two hardcoded lists. |
| The disclosure is technically present but unfindable | One tap from the spin, and the journey asserts a real user path to it. |
| Percentages confuse rather than inform | Rendered as percentages with the boost stated in the same units. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Journey walked on real Android AND real iPhone, local then dev.
- [ ] Screenshots on both platforms in at least two locales.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Found while writing SHY-0342's age-rating answer sheet. The
  questionnaire asks whether the app offers randomised paid items; answering
  "yes" honestly surfaced the obligation that comes with it, which nothing in
  the app meets.

- **2026-08-19** — Verified rather than assumed: `rollWeightedGift`,
  `applyLuckBoost` and `dropRateExponent: 1.5` in `economy.js` confirm the draw
  is weighted and non-obvious. Grepped `feature/gacha` and the economy route for
  `odds|probability|chance|drop rate|percent` — the only hits are a `boostedDrop`
  BOOLEAN in two UI files, which says a tier is boosted but never by how much.

- **2026-08-19** — Deliberately NOT scoped as "add a static odds table". The odds
  are computed server-side from weights plus a per-user luck boost, so a
  hardcoded client table would be wrong the first time anyone tuned the config —
  and wrong odds disclosed confidently is worse than none.
