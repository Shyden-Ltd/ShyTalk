---
id: SHY-0079
status: In Progress
owner: claude
created: 2026-06-11
priority: P1
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0001
public: false
---

# SHY-0079: Draft-dedup sidecar — a consistent board-items.json oracle overlaying the laggy Projects v2 query

## User Story

As the operator, I want the story→board mirror to never duplicate a DRAFT card when GitHub's Projects v2 `items` query transiently returns a stale/empty result, so that every sync — including the ones a release or a story merge triggers — converges, and the merge-hold imposed after the duplication incident can be lifted permanently.

## Why

[[SHY-0078]] gave bug ISSUES a strongly-consistent backstop (the Issues search API), proven in production: a stale-empty items read still skipped all 26 existing bug issues (26 dedup-guard hits, zero duplicate issues). But DRAFT cards have no title-searchable consistent source, so the same stale-empty read on the first guarded sync (run 27299365086, 2026-06-10 19:03Z) **re-created all 47 drafts** (board hit 121). Cleaned via `--rebuild`; the residual was documented in SHY-0078 as an operator decision. Operator chose the **sidecar id-map** (2026-06-11): a committed file the sync trusts as a consistent oracle.

Root cause recap: the Projects v2 `items(first:100)` query is eventually consistent and lagged for an extended window after a large mutation (aggravated by the 2026-06-10 GitHub auth incident's replica recovery); [[SHY-0078]]'s 3s empty-read retry was insufficient. A git-committed file IS strongly consistent, so it can heal exactly the case where the API lies.

## Acceptance Criteria

### Happy path
- [ ] **Sidecar file:** `.project/board-items.json` maps each SHY ID → `{ backing: "DRAFT"|"ISSUE", itemId, contentId, issueNumber }`. It is a derived mirror of the board (source of truth remains the `.md` corpus + the live board); committed to the repo so it is strongly consistent across sync runs.
- [ ] **Overlay read:** `load_items_map` queries the Projects v2 API as today, then OVERLAYS the sidecar: for any SHY ID present in the sidecar but ABSENT from the API result, the entry is filled in from the sidecar (the API read was stale for that item). API-present entries always win (freshest live state, e.g. issue open/closed). The merged map is what create-vs-update decisions use.
- [ ] **Write-back:** after a run performs any board mutation (create/update/delete/type-flip/rebuild), the sync regenerates `.project/board-items.json` from the post-run merged map and the workflow commits it to `main` via `createCommitOnBranch` with the Release App token (the only signed-commit path from CI; reuses the [[SHY-0063]] mechanism). No-diff ⇒ mutation skipped (fast path).
- [ ] **No loop:** `.project/board-items.json` is NOT in the sync workflow's `paths:` trigger list, so committing it does not re-fire the sync; the `github.actor != release-bot` guard is also present as defense-in-depth.
- [ ] **Bootstrap:** on a run where the sidecar is absent/empty (true first sync, or post-`--rebuild`), the overlay is a no-op and the run behaves as [[SHY-0078]] (issue-guard + retry); the write-back then populates the sidecar so every subsequent run is protected. A `--rebuild` always rewrites the sidecar from the freshly-created set.

### Error paths
- [ ] Malformed/unparseable `board-items.json` → `::warning::` naming the file + fall back to the API-only map (degrade to SHY-0078 behavior, never abort the whole sync); the next clean write-back repairs it.
- [ ] Write-back `createCommitOnBranch` failure (e.g. `expectedHeadOid` conflict because main moved) → fail the step LOUD (non-zero); the board mutations already happened and are correct, the sidecar is merely stale until the next run rewrites it — so the run's exit reflects the write-back failure without corrupting the board.
- [ ] Release App token unavailable (secret unset) → `::warning::` + skip the write-back (sidecar not updated this run); the sync's board mutations still complete.

### Edge cases
- [ ] **The duplication reproduction is fixed:** an items API read returning stale-empty while the sidecar lists the 47 drafts → the overlay fills all 47 back → zero draft `addProjectV2DraftIssue` calls (the exact 2026-06-10 failure, now prevented).
- [ ] A draft DELETED on the board (type-flip or rebuild teardown) is removed from the sidecar on write-back (no stale entry that would later suppress a legitimate recreate).
- [ ] A SHY in the sidecar but whose `.md` was deleted from the corpus → the sidecar entry is dropped on write-back (sidecar only ever contains SHY IDs that still have a story file AND a live board item).
- [ ] API returns MORE items than the sidecar (sidecar stale-behind, e.g. items added out-of-band) → API wins; the write-back reconciles the sidecar to include them.
- [ ] `--dry-run` performs ZERO mutations and ZERO write-back; it previews the overlay decision (would-create vs would-skip) using the sidecar.

### Performance
- [ ] Reading + parsing `board-items.json` is one local file read (no API cost). The overlay is an in-memory jq merge. The write-back is one `createCommitOnBranch` mutation per run that mutated (zero on a clean no-op run).

### Security
- [ ] The write-back uses the Release App token (already provisioned for [[SHY-0063]]); no new secret. No secret values logged. The sidecar contains only public board item IDs + SHY IDs (no sensitive data).

### UX
- [ ] Operator-facing: the run summary reports `sidecar overlay fills: N` (how many stale-API gaps the sidecar healed) and whether the sidecar was rewritten, so a lag event is visible rather than silent.

### i18n
- [ ] N/A — operator-facing tooling, English-only.

### Observability
- [ ] Structured log line per overlay fill (`SHY-NNNN: API read missed it; filled from sidecar`) and on write-back (`board-items.json rewritten: N entries, signed commit <oid>`). Summary counter: `sidecar overlay fills`.

## BDD Scenarios

**Scenario: Stale-empty API read does not duplicate drafts**
- **Given** a populated `.project/board-items.json` listing 47 draft cards and an items API query that returns empty
- **When** the sync runs
- **Then** the overlay fills all 47 from the sidecar and ZERO `addProjectV2DraftIssue` calls are made

**Scenario: Write-back keeps the sidecar current after a create**
- **Given** a new non-bug story with no board item and no sidecar entry
- **When** the sync creates its draft card
- **Then** `.project/board-items.json` is regenerated to include the new SHY → item-id and committed via `createCommitOnBranch`

**Scenario: API-fresh state wins over the sidecar**
- **Given** a sidecar entry marking an issue OPEN and an API result marking it CLOSED
- **When** the sync merges
- **Then** the merged map uses the API's CLOSED state (freshest), and the sidecar is reconciled on write-back

**Scenario: Malformed sidecar degrades gracefully**
- **Given** a corrupt `.project/board-items.json`
- **When** the sync runs
- **Then** it emits a `::warning::`, falls back to the API-only map, completes the run, and rewrites a valid sidecar

**Scenario: Committing the sidecar does not re-trigger the sync**
- **Given** the sync commits `.project/board-items.json` to main
- **When** the push event is evaluated
- **Then** the sync workflow does not run again (path not in triggers + actor guard)

**Scenario: Deleted board item is purged from the sidecar**
- **Given** a draft removed by a type-flip or rebuild teardown
- **When** the write-back runs
- **Then** that SHY's entry is absent from the rewritten `.project/board-items.json`

## Test Plan

- **Layer 1 — mock-`gh` runtime (Jest, `sync-stories-to-issues-board-fields.test.js` or a new sibling):**
  - **Headline reproduction:** seed a sidecar with the draft set + an empty items API response → assert ZERO `addProjectV2DraftIssue` calls + `sidecar overlay fills: N` in the summary (the 2026-06-10 failure, now fixed).
  - Overlay correctness: API-present wins (issue CLOSED in API beats OPEN in sidecar); API-missing filled from sidecar; sidecar-missing+API-missing ⇒ create (true new story).
  - Write-back content: after a create, the regenerated sidecar JSON contains the new SHY→item mapping; after a delete/type-flip, the entry is absent (value-level assertions on the written file).
  - Malformed sidecar → `::warning::` + API-only fallback + run completes + valid sidecar rewritten.
  - `--dry-run` → zero mutations, zero write-back, overlay still applied to the preview decision.
  - bootstrap (absent sidecar) → behaves as SHY-0078 + populates the sidecar.
- **Layer 2 — workflow YAML (Jest structural):** the Release App token step + `createCommitOnBranch` write-back step are present in sync-stories-to-issues.yml; `.project/board-items.json` is NOT in `on.push.paths`; the `github.actor != release-bot` loop guard is present.
- **Layer 3:** validator unaffected (no frontmatter change).
- **Layer 4 — live:** after merge, deliberately reproduce a stale read (or rely on natural lag) and confirm no draft duplication; verify the committed `board-items.json` matches the live board; a release-triggered sync no longer duplicates.
- All AC → named tests at RED before implementation (clause→test map in the PR), per the strict-testing standard.

## Out of Scope

- Replacing the Projects v2 items query entirely (the API stays the freshness source; the sidecar only heals its gaps).
- A general-purpose board cache for non-mirror uses.
- Changing the bug-issue dedup ([[SHY-0078]], already shipped + proven).

## Dependencies

- [[SHY-0078]] (issue-dedup guard + items-map retry) — merged.
- [[SHY-0074]] mirror v2 — merged.
- [[SHY-0063]] signed `createCommitOnBranch` mechanism + Release App token (`RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY`) — live; reused for the write-back.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Write-back commit conflict (main moved) | Low | Low | `expectedHeadOid` optimistic concurrency; next sync rewrites; board already correct |
| Sidecar drifts from the live board | Low | Med | Every mutating run rewrites it; API-wins overlay self-heals; `--rebuild` always rewrites fresh |
| Committing the sidecar loops the workflow | Low | High | Path excluded from triggers + actor guard (belt and braces) |
| Malformed sidecar aborts the sync | Low | Med | Parse-guarded fallback to API-only + `::warning::`; never abort on a bad sidecar |
| First run before bootstrap still dups drafts | Med | Low | Acceptable one-time window; the unblocking merge runs a `--rebuild` (or dispatch) that populates the sidecar before normal syncs rely on it |

## Definition of Done

- [ ] All AC met; tests RED first with a clause→test map in the PR; the stale-empty-no-draft-dup headline regression included.
- [ ] Zero-findings review (reviewer before push).
- [ ] Live: stale read (natural or forced) proven non-duplicating; committed `board-items.json` matches the live board; merge-hold LIFTED.
- [ ] Merged via its own PR; `released_in:` at the release cut before Done flip. **Unblocks resuming story-PR merges.**

## Notes (running log)

- 2026-06-11 ~15:10 BST — Implemented + reviewed (feature-dev:code-reviewer, ZERO critical). Reviewer surfaced AC edge-3 (deleted-`.md` → purge sidecar entry) as unimplemented + untested → fixed: `--all` prunes `BOARD_ITEMS_JSON` to live corpus SHY IDs before write-back (sync_story skips the prune — partial run), + a regression test (orphan SHY-8888 purged, live SHY-8808 kept). All other dimensions verified correct (jq `+` API-wins, array-subtraction fill count, write-back lifecycle incl rebuild reset, no-loop path+actor guard, createCommitOnBranch parity with sync-roadmap-data, test isolation across all 4 suites). The `# v3.2.0` app-token comment is pre-existing + SHA-pinned + identical to sync-roadmap-data.yml — left consistent.
- 2026-06-11 14:20 BST — Filed after the operator chose the sidecar (option b of SHY-0078's deferred draft-dedup decision). Confirmed the [[SHY-0063]] `createCommitOnBranch` + Release-App mechanism is the reusable signed write-back path; `.project/board-items.json` stays OUT of the sync workflow trigger paths so the write-back doesn't loop. Sequenced BEFORE the SHY-0074/0078 release cut (a release edits those .md files → push → --all sync → would re-dup drafts under lag; the sidecar makes that sync deterministic first). Board currently clean at 74 (47 drafts + 27 issues); merge-hold stays until this ships.
