---
id: SHY-0085
status: In Review
owner: claude
created: 2026-06-12
priority: P2
type: infra
effort: S
roadmap_ids: []
pr:
epic: EPIC-0001
public: false
mvp: true
---

# SHY-0085: Make a fully-degraded board items-map read LOUD (sidecar-only sync)

## User Story

As the ShyTalk operator maintaining the board mirror,
I want the sync to emit a visible GitHub Actions **warning** when its live board items-map read returns ZERO items and it falls back entirely to the committed `board-items.json` sidecar,
So that a broken/degraded `GH_PAT_PROJECT` read surfaces in the Actions UI instead of hiding behind a buried `[sidecar]` log line — before it can cause churn or (if the sidecar is ever lost) mass-duplicate every story-issue.

## Why

- **Discovered during SHY-0082 (Mirror v4) migration verification (2026-06-12).** In GitHub Actions every post-migration sync logs `[sidecar] API read missed 79 item(s); filled from board-items.json` — the live `organization{projectV2{items}}` read returns an **empty** `items.nodes` array, so `overlay_board_items_sidecar` reconstructs the ENTIRE map from the committed sidecar. The same `GH_PAT_PROJECT` PAT returns all 79 items when run from a laptop, so the CI token apparently cannot traverse-READ Issue-backed project items (Drafts read fine pre-migration — that is why the migration's own read worked).
- **Why it matters even though the board is correct today:** the sidecar (SHY-0079) supplies the item IDs, so the sync takes the UPDATE path and never duplicates — but (a) it cannot hash-skip (the sidecar carries no body), so every run re-updates all 79 issues = ~550 wasted GraphQL mutations per push, and (b) if the sidecar file were ever deleted/corrupted, an empty read would treat every story as new and CREATE 79 duplicate issues. That is a latent footgun hidden behind a non-annotated log line.
- **Operator decision (2026-06-12):** the operator will **re-provision `GH_PAT_PROJECT`** with the missing read scope (restoring the live API read). This story's job is the **observability safety net**: surface the fully-degraded read as a `::warning::` so the next occurrence is impossible to miss, and the API read stays the primary source. (Storing a `bodyHash` per sidecar entry to enable skip-under-overlay is a noted future option, OUT OF SCOPE here — see below.)
- The current code already computes `N_SIDECAR_FILLS` and logs a plain `[sidecar] …` line (script lines 513–517); this is a one-line escalation to a real annotation, gated on the unambiguous *fully-blind* condition (API keyed 0 of N) so normal lag-fills (a few new items) stay quiet.

## Acceptance Criteria

### Happy path

- [ ] When the live items-map read keys ZERO items AND the sidecar provides ≥1 entry (fully-degraded read), the sync emits exactly one `::warning::` line to stderr naming: the sidecar-fill count, that the sync is running sidecar-only, the churn + duplicate-on-sidecar-loss risk, and the actionable hint (check `GH_PAT_PROJECT` can read Issue-backed project items).
- [ ] The existing `[sidecar] API read missed N item(s)…` info line is RETAINED (the warning is additive, not a replacement).
- [ ] A healthy run (API read keys ≥1 item) emits NO such warning, regardless of whether the sidecar also fills a few lagging items.

### Error paths

- [ ] A malformed/absent sidecar path is unchanged (the existing `::warning::board-items.json is malformed…` / bootstrap branches still behave as before; the new warning is independent of them).
- [ ] The warning is observational only — it does NOT change exit code, does NOT abort the sync, and does NOT alter the overlay/merge result (the sidecar fallback still produces the same map).

### Edge cases

- [ ] **Partial degradation is NOT warned:** API keys some-but-not-all items (e.g. 50 of 79, the rest lag-filled) → info log only, no `::warning::` (partial fills are the sidecar's normal Projects-v2-lag purpose; only a fully-blind read is unambiguous).
- [ ] **No sidecar + empty API read** (bootstrap / first run) → no warning (there is nothing to be "blind" relative to; the map is legitimately empty).
- [ ] `DRY_RUN=1` still emits the warning (the degraded read happens identically in dry-run; surfacing it in a dry-run is desirable).

### Performance

- N/A — one extra `jq 'length'` on the already-in-memory API map per run; negligible against the existing per-run GraphQL cost.

### Security

- N/A — emits a static diagnostic string; never logs the token value (the message references the secret NAME only, never its content).

### UX

*(consumer = the operator reading the sync workflow run in the Actions UI)*

- [ ] The warning renders as a yellow annotation on the `Mirror stories to Issues` job (GitHub surfaces `::warning::` lines), so a degraded read is visible from the run summary without scrolling the raw log.
- [ ] The message is actionable in one read: it names the cause hypothesis (`GH_PAT_PROJECT` Issue-read) and the consequence (churn + dup-on-sidecar-loss), not a generic "API read returned 0".

### i18n

- N/A — internal CI diagnostic; never user-facing.

### Observability

- [ ] This IS the observability fix: a fully-degraded read moves from an invisible `[sidecar]` stdout line to a first-class `::warning::` annotation. No other telemetry change.

## BDD Scenarios

**Scenario: fully-blind read warns loudly**
- **Given** a committed sidecar with an entry for SHY-NNNN
- **And** the live `projectV2{items}` read returns an empty `nodes` array
- **When** the sync runs
- **Then** stderr contains a `::warning::` naming the sidecar-only fallback + the `GH_PAT_PROJECT` Issue-read hint
- **And** the run still completes normally (no non-zero exit from the warning)

**Scenario: healthy read is quiet**
- **Given** the live items read returns the board items (keys ≥1)
- **When** the sync runs
- **Then** NO `::warning::` about a degraded/sidecar-only read is emitted

**Scenario: partial lag-fill is quiet**
- **Given** the live read keys most items but the sidecar fills a few newly-added ones
- **When** the sync runs
- **Then** only the existing `[sidecar] API read missed N item(s)` info line is emitted, NOT the `::warning::`

**Scenario: bootstrap (no sidecar, empty read) is quiet**
- **Given** no sidecar file exists and the live read is empty
- **When** the sync runs
- **Then** no degraded-read `::warning::` is emitted (the empty map is legitimate)

## Test Plan

**RED (failing first) — `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js`** (new describe `SHY-0085: loud degraded items-map read`):
- Fully-blind: pre-write `BOARD_ITEMS_FILE` with an ISSUE-backed entry for the story + `EMPTY_ITEMS` items response → run → assert `stderr` matches `/::warning::.*sidecar-only|::warning::.*items-map read returned 0/` AND `res.code === 0`.
- Healthy: items response includes the story's item (keyed) → assert stderr does NOT contain the degraded-read `::warning::`.
- Partial: items response keys the story but the sidecar has an extra (lagging) key → assert the `[sidecar] API read missed` info line present but NO degraded `::warning::`.
- Bootstrap: no `BOARD_ITEMS_FILE` pre-write + `EMPTY_ITEMS` → assert no degraded `::warning::`.

**GREEN — `scripts/sync-stories-to-issues.sh` `overlay_board_items_sidecar()`** (around lines 513–517): compute `api_keyed="$(printf '%s' "$ITEMS_MAP_JSON" | jq 'length')"` (API-only map, before the merge at ~line 520); inside the existing `N_SIDECAR_FILLS > 0` block, add `if [ "${api_keyed:-0}" -eq 0 ]; then printf '::warning::Board items-map API read returned 0 items; relying entirely on the board-items.json sidecar (%s entries) — the sync cannot hash-skip (churn) and would duplicate every story if the sidecar is lost. Check GH_PAT_PROJECT can read Issue-backed project items.\n' "$N_SIDECAR_FILLS" >&2; fi`.

**Green gates:** `shellcheck scripts/sync-stories-to-issues.sh` clean; the new board-fields describe green; full `cd express-api && npm test`; `check-story-frontmatter.sh --scan .project/stories` exit 0.

## Out of Scope

- **Fixing the read itself** — the operator re-provisions `GH_PAT_PROJECT` with Issue-read scope (separate, operator-side action). This story only makes the degradation visible.
- **`bodyHash`-in-sidecar** to enable hash-skip under sidecar-overlay (would kill the churn even when the API read is blind) — a noted future enhancement; deferred to keep this change one-line + low-risk.
- Any change to the migration/`--rebuild` path or the overlay/merge logic itself.

## Dependencies

- Builds on SHY-0079 (the sidecar) + SHY-0082 (v4 typed issues, the context in which the degraded read was observed). No blocking dependency.

## Risks & Mitigations

- **Warning is noisy (fires on benign lag).** *Mitigation:* gated on the unambiguous fully-blind condition (`api_keyed == 0`), NOT a fractional threshold; partial fills stay info-only (tested).
- **Threshold misjudged (a near-blind read of 1/79 wouldn't warn).** *Mitigation:* acceptable — a single keyed item still proves the read path works; the catastrophic case (0 keyed → would-dup-on-sidecar-loss) is exactly what is caught. Note in the message that partial degradation is not flagged.

## Definition of Done

- The `::warning::` fires only on a fully-blind read; tested across blind/healthy/partial/bootstrap; existing info line retained.
- shellcheck + the new tests + full suite green; `code-reviewer` ZERO findings (or self-review for this one-line observability change per the rate-limit-slowdown convention, recorded in Notes); SHY-INDEX row added.
- Merged + released (`released_in: vX.Y.Z`).

## Notes (running log)

- 2026-06-12 ~03:35 BST — **IMPLEMENTED (In Review).** `overlay_board_items_sidecar()` now computes `api_keyed` (the API-only map size, before the overlay merge) and, inside the existing `N_SIDECAR_FILLS > 0` block, emits a `::warning::` when `api_keyed == 0` (fully-blind read) — the existing `[sidecar] API read missed N` info line is retained. Tests: new `SHY-0085` describe in `sync-stories-to-issues-board-fields.test.js` (4 cases, value-level): fully-blind→`::warning::` (+ names the fill count), healthy (API keys the item)→no warning, partial (API keys it + a ghost sidecar key lag-fills)→info line only/no warning, bootstrap (no sidecar + empty API)→no warning. board-fields 156 green; shellcheck clean. **Self-review** (no agent dispatch — low-risk additive observability one-liner per the rate-limit-slowdown convention): api_keyed measured pre-merge ✓; no token value logged (names `GH_PAT_PROJECT` only) ✓; bootstrap path unreached (early return) ✓; partial stays quiet ✓.
- 2026-06-12 ~02:50 BST — Filed from the SHY-0082 v4 migration-verification finding (see SHY-0082 ## Notes). The CI items-map read returns empty (`[sidecar] API read missed 79`) while the same PAT reads all 79 from a laptop → sidecar-only sync (correct but churny + dup-on-loss footgun). Operator chose to re-provision the PAT (fix the read); this story is the observability net (loud `::warning::` on a fully-blind read). P2 — board is healthy. Authored fully-refined; implementation is a ~5-line script change + a 4-case board-fields test (deferred to a focused PR to pace rate limits during the AFK window).
