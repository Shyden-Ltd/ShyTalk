---
id: SHY-0360
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: L
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0360: A change on the project board never reaches the roadmap pages

## User Story

As **the owner of ShyTalk**, I want any change I make to a ticket — wherever I
make it — to show on the dev and live roadmap pages straight away, so that the
roadmap is a truthful picture of the product without anyone remembering to
refresh it.

## Why

**Operator, 2026-08-20:** *"any changes to the tickets on the GitHub project
board must be immediately reflected on the dev and live roadmap pages. i don't
think this is currently happening... it should be autonomous so you don't need
to remember to do it in future."*

That is correct. Today the wiring is one-directional and half-connected:

```
.project/stories/SHY-*.md   ← the single source of truth
        │
        ├─ push to develop ──► sync-stories-to-issues.yml ──► issues + project board
        │
        └─ push to MAIN ─────► sync-roadmap-data.yml ─────► roadmap-data.json ──► pages
```

Two independent defects fall out of that shape:

1. **The roadmap only rebuilds on `main`.** `sync-roadmap-data.yml` triggers on
   `push: branches: [main]`. Story truth lands on `develop` and only reaches
   `main` at a release cut, so between cuts the roadmap is stale **by design**.
   The **dev** roadmap page is worst affected: dev deploys from `develop`, and
   that sync never runs there at all — so the dev roadmap can never be current.

2. **The board is downstream, not upstream.** `sync-stories-to-issues.yml` pushes
   story files → issues → board. Nothing reads back. So a status changed **on the
   board UI** (dragging a card to Done) exists only on the board: it is not in a
   story file, so it cannot reach `roadmap-data.json`, so it cannot reach either
   page. The operator's most natural action is the one that silently does nothing.

The operator explicitly chose the **full two-way** scope over the smaller
"rebuild on develop" fix.

## Acceptance Criteria

### Happy path

- [ ] Editing a story file and merging to `develop` updates the **dev** roadmap
      page without any manual step.
- [ ] A ticket's status changed **on the GitHub project board** is written back
      into its story file, and from there reaches the roadmap pages.
- [ ] The **live** roadmap page updates on the release path, unchanged in
      timing from today unless the operator asks otherwise.
- [ ] `SHY-INDEX.md` is **generated** from the story files, not hand-maintained,
      so its rows cannot drift from the stories they describe.

### Error paths

- [ ] A board edit that cannot be mapped to a story file fails **loudly** with
      the item named, rather than being dropped.
- [ ] A failed write-back does not leave the story file half-written.
- [ ] Sync failures are visible without opening Actions logs.

### Edge cases

- [ ] **Conflict rule (proposed, confirm at pickup):** when a story file and the
      board disagree, the **story file wins**, because it is the reviewed
      artefact and carries the AC. The board edit is reported, not silently lost.
- [ ] The write-back cannot re-trigger the forward sync into a loop. Both
      existing syncs already guard on `github.actor`; the new arm needs the same.
- [ ] A board item with no matching `SHY-NNNN` story is reported, not invented.
- [ ] Index generation preserves the hand-written prose around the tables (the
      header, status legend, sort-order note and footer) and regenerates only the
      rows — those paragraphs are curated, not derived.
- [ ] The generated index sorts by the documented rule (priority, then created),
      and the Active/Done split follows `status`, so a story moving to Done moves
      section without anyone touching the file.
- [ ] Deleting a card on the board does **not** delete a story file.
- [ ] Two edits in quick succession do not race; the sync serialises.

### Performance

- [ ] A single ticket change reaches the dev page in minutes, not at the next
      release cut. Measured and recorded, not estimated.

### Security

- [ ] The write-back uses the existing Release App token path and its
      `bypass_actors` registration. No new secret and no widened permission.
- [ ] No board field containing personal data is copied to a public page.

### UX

- [ ] The dev roadmap page visibly reflects a change made minutes earlier —
      confirmed in a real browser, not only in JSON.
- [ ] Nothing unreleased leaks onto the **public** page as a side effect.

### i18n

- [ ] A synced entry keeps its translations. A new entry without translations
      degrades to English rather than rendering blank.

### Observability

- [ ] Each sync run states what changed, in which direction, and for which
      story ids.
- [ ] A no-op run says so, so silence is never ambiguous.

## BDD Scenarios

**Scenario: A ticket update reaches the dev roadmap on its own**

- **Given** a ticket has been updated
- **When** the update is accepted into the project
- **Then** the dev roadmap page shows it without anyone refreshing anything

**Scenario: A change made on the board is not lost**

- **Given** someone changes a ticket directly on the project board
- **When** the next sync runs
- **Then** the change is carried into the project's own records

## Test Plan

**RED first.** The failing state is demonstrable today: change a story on
`develop`, observe the dev roadmap page unchanged.

1. A test asserting `sync-roadmap-data.yml` triggers on the branch that feeds dev.
2. A test for the board→story write-back mapping, including the unmappable case.
3. A loop-guard test: the write-back's own commit must not re-fire the sync.
4. A conflict test proving the documented winner actually wins.
5. Real-browser confirmation on the dev roadmap page.

## Out of Scope

- Backfilling `SHY-INDEX.md` by hand. The operator chose generation over a manual
  catch-up precisely so it cannot drift again — the first generated run IS the
  backfill.
- Redesigning the roadmap page itself.
- Changing **when** the public page publishes (operator kept release-gated).
- Migrating `features[]` → `items[]`. The legacy hand-curated array stays.

## Dependencies

- Touches `sync-roadmap-data.yml`, `sync-stories-to-issues.yml`,
  `scripts/sync-shy-to-roadmap-data.mjs`, and the Release App token path.
- Should land **after** SHY-0359 (#1858), which edits `roadmap-data.json`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Two-way sync loops | Both directions guard on `github.actor`, as the existing syncs already do; a test pins it. |
| Board becomes an unreviewed edit path into a reviewed artefact | Story file wins on conflict; board edits are reported, and the story file stays the AC-bearing artefact. |
| Unreleased plans leak to the public page | The public page stays release-gated; only the dev page gains immediacy. |
| A partial write corrupts a story file | Write-back is atomic per file and validated by `check-story-frontmatter.sh` before commit. |

## Definition of Done

- [ ] Both defects fixed; dev roadmap current within minutes of a ticket change.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Scope extended by operator decision: `SHY-INDEX.md` is **31
  stories behind** (newest row SHY-0328; the corpus is at SHY-0362). It is
  hand-maintained and feeds no automation — `sync-stories-to-issues.yml` reads the
  story files directly — so nothing is broken by the drift, but it is no longer a
  truthful catalogue. The operator chose to **generate** it here rather than
  backfill it by hand, on the reasoning that a third hand-kept copy is what
  drifted in the first place.
- **2026-08-20** — Filed after the operator noticed the roadmap was not tracking
  ticket changes. Diagnosis above is from reading the two workflows' triggers,
  not from inference. Operator chose full two-way sync over the smaller
  rebuild-on-develop fix. The conflict rule is a **proposal** — confirm at pickup.
