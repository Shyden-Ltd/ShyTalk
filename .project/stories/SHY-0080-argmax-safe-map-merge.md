---
id: SHY-0080
status: In Progress
owner: claude
created: 2026-06-11
priority: P0
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0001
public: false
---

# SHY-0080: ARG_MAX-safe items-map merges — the real board-duplication root cause

## User Story

As the operator, I want the mirror's items-map merges to never silently fail when the board holds many full-spec-body draft cards, so that a sync reliably sees the existing board (instead of an empty one) and stops re-creating every draft on every run.

## Why

The board kept duplicating its 47 draft cards on syncs even after the SHY-0078 retry and SHY-0079 sidecar shipped. The SHY-0079 post-merge sync log gave the true cause:

```
scripts/sync-stories-to-issues.sh: line 656: /usr/bin/jq: Argument list too long
jq: invalid JSON text passed to --argjson
```

The items map carries every DRAFT's full spec body (up to ~64K each). The map merges passed the whole map as a `jq --argjson` command-line argument; with ~47 full-body drafts the combined argv exceeds the kernel `ARG_MAX` (~2 MB on Linux runners), so `jq` fails. Under `set -e` an assignment whose `$(...)` subshell fails is NOT fatal — the variable is silently emptied. The result: `load_items_map` produced an EMPTY map, every story routed to the create path, and all 47 drafts were re-created (board → 121/122).

This is **deterministic** (not the eventually-consistent Projects v2 read lag originally suspected — that was a real but secondary effect): any sync with enough full-body drafts overflows. It is the same defect class as [[SHY-0064]] (177 KB roadmap payload exceeding argv). The fix is identical in spirit: pass large JSON via STDIN (`printf` is a bash builtin → not subject to `execve` argv limits) into `jq -s`, never via `--argjson`.

Pre-existing scope ([[feedback-fix-pre-existing-and-new-same]]): the overflowing pagination merge predates [[SHY-0079]] (it shipped in [[SHY-0074]]); [[SHY-0079]]'s overlay reintroduced the same pattern. Both are fixed here.

## Acceptance Criteria

### Happy path
- [ ] **Pagination merge:** `load_items_map` accumulates pages via `printf '%s\n%s\n' "$ITEMS_MAP_JSON" "$page_map" | jq -c -s '.[0] + .[1]'` (stdin), never `--argjson`. A board of 47+ full-body drafts produces a COMPLETE map (every SHY ID present), not an empty one.
- [ ] **Sidecar overlay merge + fill-count:** both pass the (body-laden) API map and the sidecar via stdin (`printf | jq -s`), never `--argjson`. The overlay correctly fills API gaps + counts fills regardless of map size.
- [ ] After the fix, a sync against a many-draft board routes existing drafts to the UPDATE/skip path (map is populated) — ZERO spurious `addProjectV2DraftIssue` for already-present stories.

### Error paths
- [ ] A genuinely malformed page response still fails the run loudly (the existing parse guard), distinct from the silent-empty ARG_MAX failure this fixes.
- [ ] No `set -e` regression: the stdin-piped merges are assignment-via-`$()`; a jq failure empties the var as before, but jq no longer fails on size, so the map populates.

### Edge cases
- [ ] Single page (≤100 items) and multi-page boards both merge correctly via the stdin path.
- [ ] An empty board (`{}`) merged with an empty page → `{}` (no error).
- [ ] Draft bodies containing newlines/quotes/`\x1f` survive the `printf '%s\n%s\n'` framing (jq parses two whitespace-separated JSON values; embedded newlines inside JSON strings are escaped, so the two top-level objects remain unambiguous).

### Performance
- [ ] stdin piping adds no measurable cost vs argv; one `jq -s` per page (unchanged call count). No extra API calls.

### Security
- [ ] No secrets involved; no new scopes; no logging of bodies.

### UX
- [ ] Operator-visible effect: syncs stop duplicating draft cards; `sidecar overlay fills` + the populated map now reflect reality.

### i18n
- [ ] N/A — operator-facing tooling, English-only.

### Observability
- [ ] The silent-empty failure mode is eliminated; the existing `[gh-error]`/parse-guard paths remain for genuine query failures.

## BDD Scenarios

**Scenario: A board with overflow-sized draft bodies still produces a complete map**
- **Given** an items API response listing 40 draft cards whose combined body JSON exceeds ARG_MAX (~2 MB)
- **When** `load_items_map` merges the page
- **Then** the resulting map contains all 40 SHY IDs (not empty), and a story already on the board is NOT re-created

**Scenario: stdin merge is used, not --argjson, for the map**
- **Given** the script source
- **When** the pagination + overlay merges are inspected
- **Then** they pipe via `printf | jq -s` and do NOT pass the map through `--argjson`

**Scenario: overlay fill-count survives a large API map**
- **Given** a large body-laden API map and a sidecar
- **When** the overlay computes fills
- **Then** it returns the correct count without an "Argument list too long" failure

## Test Plan

- **Layer 1 — mock-`gh` runtime (Jest):** a regression test in `sync-stories-to-issues-board-fields.test.js`: an items response listing one asserted story (SHY-90xx) plus ~39 filler drafts each with a ~64K body so the combined map exceeds ARG_MAX. Run `--all`; assert ZERO `addProjectV2DraftIssue` for the asserted story (the map populated → it was found). Pre-fix this test fails (overflow → empty map → create); post-fix it passes. (Bounded to one real story file so only one frontmatter validation runs — fast.)
- **Layer 1 (structural):** pins that the pagination merge + overlay merge + fill-count use `jq -s` / stdin and do NOT use `--argjson` with the map variable.
- **Layer 4 — live:** after merge, a `--rebuild` cleans the currently-duplicated board (122 → 75) and the next normal sync reports the map populated (`sidecar overlay fills: 0` because the API now merges correctly) with ZERO draft creates.
- All AC → named tests at RED before the fix (the overflow test is genuinely RED pre-fix — verified locally: `--argjson` on a 3.2 MB map → "argument list too long").

## Out of Scope

- Shrinking the map by dropping `draftBody` (a possible future optimisation — store only the body hash + status marker); this story keeps the body but makes the merge size-safe.
- The Projects v2 read-after-write lag mitigation ([[SHY-0078]] retry + [[SHY-0079]] sidecar) — those remain valuable for genuine lag; this fixes the deterministic overflow that masqueraded as lag.

## Dependencies

- [[SHY-0074]] (introduced the pagination merge), [[SHY-0078]], [[SHY-0079]] (sidecar overlay) — all merged.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `printf '%s\n%s\n'` framing ambiguity with multi-line JSON | Low | High | jq parses top-level whitespace-separated values; newlines inside JSON strings are escaped — verified by test with body-laden drafts |
| Another `--argjson`-with-map site missed | Low | High | Audited all 5 `--argjson` sites; only the 3 map merges were large; structural pins guard regressions |
| Board stays duplicated until rebuild | Certain (current state) | Med | Operator-sanctioned `--rebuild` cleanup immediately post-merge (Layer 4) |

## Definition of Done

- [ ] All AC met; the overflow regression test RED pre-fix / green post-fix; clause→test map in the PR.
- [ ] Zero-findings review (reviewer before push).
- [ ] Live: `--rebuild` cleans the board to 75; a follow-up normal sync shows the map populated + ZERO draft dups.
- [ ] Merged via its own PR; `released_in:` at the release cut before Done flip.

## Notes (running log)

- 2026-06-11 ~15:35 BST — Filed after the SHY-0079 post-merge sync re-duplicated drafts. Log: `line 656: jq: Argument list too long` + `invalid JSON text passed to --argjson`. Confirmed locally: `jq --argjson b "$BIG"` on a 3.2 MB map (50 × 64K-body drafts) → "argument list too long"; `printf '%s\n%s\n' | jq -s '.[0]+.[1]'` → works. This is the deterministic duplication root cause; the earlier lag theory was secondary. Fixed 3 merge sites; pre-existing pagination merge (SHY-0074) + SHY-0079 overlay both. Board currently 122 (47 dup drafts); --rebuild cleanup queued post-merge.
