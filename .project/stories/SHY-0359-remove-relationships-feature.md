---
id: SHY-0359
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P1
effort: S
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0359: Remove the Relationships feature, and every mechanism that could bring it back

## User Story

As **the owner of ShyTalk**, I want no trace of paid relationship tiers anywhere
in the product or its plans, so that ShyTalk cannot be read as a dating app by a
learner, a parent, a moderator, or an app store reviewer.

## Why

The public roadmap advertises, under **Revenue & Status**:

> **Relationships** — paid tiers (friend→partner→family), perks, seat connections

A paid **partner** tier is the mechanic that reframes a language-exchange
platform as a dating platform. It is listed as a monetisation surface, which
makes the reading stronger, not weaker.

ShyTalk is a language and cultural learning platform, and it has a **minor
cohort** — which is precisely why cohort segregation (UK OSA §17) exists. A
romantic-pairing feature sold for money, on a platform where minors are present,
is a safeguarding and compliance exposure as well as a positioning error.

**Operator decision 2026-08-19:** *"I want to avoid this app from being used
specifically for dating."* Reaffirmed 2026-08-20, with scope "the roadmap card
AND a codebase sweep of anything already built".

### What the sweep actually found

Nothing was ever built. The paid-tier mechanics (`seatConnection`,
`relationshipTier`, `partnerId`, `intimacy`, `soulmate`, `cpRank`) return
**exactly one** hit across `app/`, `shared/`, `iosApp/`, `express-api/src/`,
`public/` and `functions/` — the roadmap card's own description.

Every other `relationship` hit in product code is **cohort segregation**, where a
"relationship" is an adult↔minor follow-edge that
`express-api/scripts/migrate-segregation-relationships.js` **severs**. That is a
child-safety feature that shares a word and **must not be touched**.

### The trap this story exists to avoid

The prior handover recorded the fix as "edit `public/roadmap-data.json`
`phases[2].features[1]` — hand-curated, so a direct edit is safe."

That is right by luck, not by reasoning, and it names only **one** of four
surfaces. The real picture:

| Surface | Role |
| --- | --- |
| `public/roadmap-data.json` `phases[2].features[1]` | The card the page renders. `roadmap-app.js:761` renders `features` **concatenated with** `items`, and this phase has `features: 3, items: 0` — so all three cards come from the legacy hand-curated array. |
| `.project/plans/2026-03-29-feature-roadmap.md:168` | The internal planning row the card was written from. |
| `scripts/roadmap-translations.json:40` | The **translation source**, keyed by the literal name `"Relationships"`, carrying all 19 locales. |
| `express-api/tests/scripts/generate-roadmap-json.test.js:59` | A test fixture that hard-codes the real row as sample input. |
| `scripts/generate-roadmap-json.js` | **Dead code with a stale docstring.** It claims it is "called automatically by deploy workflows before deploying public/". It is not — SHY-0066 removed the pre-commit and pre-push calls and nothing invokes it today. But it still parses the planning markdown, merges the translations, and **writes `public/roadmap-data.json`**. Anyone who runs it resurrects the card. |

`sync-shy-to-roadmap-data.mjs` is the live generator, and it spreads the phase and
overwrites only `items` (line 316), which is why `features` survives — that is the
real reason a direct edit holds.

## Acceptance Criteria

### Happy path

- [ ] The Relationships card is gone from `public/roadmap-data.json`, with all 19
      translations and the English name/description.
- [ ] The internal planning row is gone from the feature-roadmap markdown.
- [ ] The `"Relationships"` key is gone from `scripts/roadmap-translations.json`.
- [ ] The roadmap page renders **Revenue & Status** with its two remaining cards
      (Decorations, Nobility system) and no gap or broken card.

### Error paths

- [ ] Removing the entry does not break the roadmap page's rendering when a phase
      has fewer features than before.
- [ ] `sync-shy-to-roadmap-data.mjs` run against the edited file does not put the
      card back (it must preserve the shortened `features` array).

### Edge cases

- [ ] **Cohort-segregation code is untouched.** No file under the UK OSA §17
      segregation work is modified. Verified by diff review, not by intent.
- [ ] The word "partner" is not treated as forbidden. "Language partner" is
      standard language-exchange vocabulary and legitimate future wording.
- [ ] Historical records (`.project/handoff/**`) keep their references — they are
      a log of what happened and must stay accurate.

### Performance

- [ ] N/A — removes one entry from a static JSON file.

### Security

- [ ] Removes a resurrection vector (the dead generator). No credential,
      permission or dependency change.

### UX

- [ ] A visitor browsing Revenue & Status sees two coherent cards. Checked on a
      real browser at mobile and desktop widths, not asserted only in JSON.

### i18n

- [ ] All 19 locale translations are removed with the entry. No orphaned
      translation key is left behind in either file.
- [ ] No other feature's translations are disturbed.

### Observability

- [ ] N/A — no runtime behaviour.

## BDD Scenarios

**Scenario: A visitor sees no relationship tiers on the roadmap**

- **Given** a visitor opens the public roadmap
- **When** they read the Revenue and Status section
- **Then** they see nothing offering paid relationship or partner tiers

**Scenario: The removed feature cannot come back from an internal document**

- **Given** the internal planning document no longer lists the feature
- **When** the roadmap data is rebuilt
- **Then** the feature does not reappear on the page

## Test Plan

**No permanent re-introduction guard.** The operator chose the standing rule in
the project `CLAUDE.md` over an automated denylist/allowlist, on the reasoning
that a rule a human reads beats a test that only fires after someone has already
written the feature. Recorded here so a later session does not "helpfully" add
one back.

### Verification

1. `sync-shy-to-roadmap-data.mjs --dry-run` against the edited data proves the
   shortened `features` array survives a sync.
2. The existing generator test suite passes with the neutral fixture.
3. The roadmap page is walked in a real browser at mobile and desktop widths —
   Revenue & Status renders two cards, and the page has no console error.

## Out of Scope

- **Cohort-segregation code (UK OSA §17).** `migrate-segregation-relationships.js`
  and the `age_seg_*` strings use the word "relationship" for an adult↔minor
  follow-edge and are child-safety machinery. Explicitly not touched.
- **Any re-introduction guard** (denylist, allowlist, snapshot test). The operator
  chose a standing rule in the project `CLAUDE.md` instead. Do not add one.
- **The wider dating-drift audit** of existing shipped features. This story removes
  a planned feature; it does not re-review Gifts, Rooms or Follows for framing.
- **Fixing the board↔roadmap sync gap** found while investigating this — the
  roadmap only rebuilds on `main`, so the dev roadmap page is never refreshed.
  That is its own ticket.

## Dependencies

- None. No open PR touches `public/roadmap-data.json`,
  `.project/plans/2026-03-29-feature-roadmap.md`, or
  `scripts/roadmap-translations.json`.
- Independent of the EPIC-0004 boot/login work and of the open PR queue.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Touching cohort-segregation code by word-match | The sweep separated the two meanings before any edit; the diff is reviewed for segregation paths explicitly. |
| Deleting the dead generator breaks something unseen | Nothing invokes it (verified across the repo); its own test file goes with it, and the live generator is a different script. |
| The card returns via the dead generator | The generator is removed, so the resurrection path goes with it. |

## Definition of Done

- [ ] All four surfaces cleared; dead generator removed.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Operator chose "just delete it, no automation", plus a standing
  rule in the project `CLAUDE.md` to stay alert to dating drift on every surface.
  That rule is written and includes the reasoning and this story as precedent.
