---
id: SHY-0078
status: Done
owner: claude
created: 2026-06-10
priority: P1
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0001
public: false
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1243
released_in: v0.97.10
---

# SHY-0078: Mirror create-path idempotency guard against Projects v2 read-after-write lag

## User Story

As the operator, I want the story→board/issue mirror to NEVER create a duplicate board item or issue for a SHY that already has one, even when the Projects v2 `items` query transiently returns a stale/empty result, so that successive sync runs (especially shortly after a large mutation) converge instead of multiplying the board.

## Why

Found in production on 2026-06-10 while verifying [[SHY-0074]] (mirror architecture v2). Three sync runs within ~16 minutes — the sanctioned `--rebuild`, a confirming `workflow_dispatch`, and the evidence-PR merge push-sync — EACH re-created the full 73-item set, leaving **220 board items (~3×) and tripled bug issues**. A `--rebuild` cleaned it (deleted 220 items + 78 issues, recreated 73), but the root cause remains.

Root cause: [[SHY-0074]]'s `load_items_map` treats the Projects v2 `items(first:100)` GraphQL query as the authoritative create-vs-update oracle. That query is **eventually consistent** — shortly after a large mutation, a replica can return an empty/partial node set. The existing guard only aborts on query *failure* (HTTP error → exit 40 pre-mutation); a *successful-but-stale-empty* response is indistinguishable from "board genuinely empty", so every story routes to the create path and the whole board is duplicated. Evidence the cause is replica lag, not determinism: a local `--all` run at nearly the same time returned `73 skipped` (saw the items) while the CI confirming run returned `73 created` (saw empty) — same board, divergent reads.

Severity P1: every future push-sync carries a non-zero duplication probability (highest immediately after a large mutation). Until fixed, **story PRs must not be merged to main** (each merge triggers a push-sync). This story is the unblocker for resuming merges (incl. [[SHY-0072]]/[[SHY-0073]] and the [[SHY-0062]] migration batches).

## Acceptance Criteria

### Happy path
- [ ] **Bug-issue create guard (consistent source):** before `gh issue create` for a `type: bug` story whose SHY ID is absent from the items map, the sync performs a consistent-source existence check via the Issues API (`gh issue list --search "in:title \"SHY-NNNN:\"" --state all`); if an issue already exists it is treated as the existing backing (update/skip path), NOT re-created. The Issues search API is strongly consistent (unlike Projects v2 items), so a stale items-map can no longer cause a duplicate ISSUE.
- [ ] **Items-map empty-result resilience:** if `load_items_map` returns ZERO keyed items, it retries the query once after a bounded backoff before accepting "empty"; a transient stale-empty replica read is thus self-corrected for the common case. (Retry count + backoff are constants documented in the script.)
- [ ] **Draft duplication mitigation:** because draft items are not title-searchable via a consistent API, the sync additionally guards drafts by deferring to the (now-retried) items map; the residual draft-dup risk window is documented and bounded, and a `--rebuild` remains the deterministic cleanup. (Final draft-guard strategy is an operator decision — see Out of Scope / the options below.)
- [ ] An unchanged steady-state re-run remains a clean no-op (`0 created, 0 updated, N skipped, 0 failed, exit 0`) — the guard adds no spurious creates or updates when the map IS fresh.

### Error paths
- [ ] The consistent-source existence check failing (gh error) → `[gh-error]` + `N_FAILED++` + exit 40, BEFORE any create (never create-on-uncertainty); the run does not duplicate on a failed guard.
- [ ] Items-map retry exhausted and still empty on a board that is genuinely non-empty (unknowable in-band) → the per-bug create is still protected by the consistent-source check; drafts log a `::warning::` that a stale-empty map may have caused draft re-creation and recommend a `--rebuild` to reconcile.

### Edge cases
- [ ] A SHY that legitimately has NO existing issue/item (true first sync) → creates exactly once; the guard's existence check returns empty and does not block the legitimate create.
- [ ] A closed bug issue for a Done/Cancelled SHY → the existence check (`--state all`) finds it; no duplicate open issue is created alongside the closed one.
- [ ] Two near-simultaneous sync runs (concurrency group already serializes per-ref) → with the guard, the second run's consistent-source check sees the first run's issues and skips; drafts rely on the serialized completion + retried map.
- [ ] Title-collision safety: the issue search is anchored on the exact `SHY-NNNN:` prefix so `SHY-0007` never matches `SHY-0070` (verify the search + local filter are prefix-exact, not substring).

### Performance
- [ ] The bug-issue existence check adds at most one Issues-API call per bug story that is missing from the map (i.e. zero extra calls on the steady-state all-skip path, where the map is fresh and nothing routes to create). The items-map retry fires at most once per run and only when the first read is empty.

### Security
- [ ] No new token scopes (Issues read already held by `GH_PAT_PROJECT`); no secret values logged.

### UX
- [ ] Operator-facing: the run summary distinguishes "created" from "skipped-existing-via-guard" so a near-miss duplication is visible in the log rather than silent.

### i18n
- [ ] N/A — operator-facing tooling, English-only.

### Observability
- [ ] Structured log line whenever the guard prevents a duplicate (`SHY-NNNN: existing issue #N found via consistent-source check; routing to update`), and whenever the items-map retry fires (`items-map empty on first read; retried`). Counters: a `dedup-guard-hits` tally in the summary line.

## BDD Scenarios

**Scenario: Stale-empty items map does not duplicate a bug issue**
- **Given** a `type: bug` story whose issue already exists, and an items-map query that (transiently) returns empty
- **When** the sync runs
- **Then** the consistent-source Issues search finds the existing issue and the sync routes to update/skip — no second issue is created

**Scenario: Items-map empty-read is retried**
- **Given** the first `items(first:100)` query returns zero nodes
- **When** `load_items_map` runs
- **Then** it retries once after the backoff before accepting an empty map

**Scenario: Genuine first sync still creates once**
- **Given** a SHY with no existing issue or board item
- **When** the sync runs
- **Then** the guard's existence check returns empty and the item/issue is created exactly once

**Scenario: Prefix-exact existence check**
- **Given** an existing issue titled `SHY-0070: ...`
- **When** the guard checks for `SHY-0007`
- **Then** it does NOT match `SHY-0070` and `SHY-0007` is created/handled independently

**Scenario: Guard-check failure aborts rather than duplicating**
- **Given** the consistent-source existence check returns a gh error
- **When** the sync processes that bug story
- **Then** it increments `N_FAILED`, exits 40, and does NOT create an issue on the uncertain result

## Test Plan

- **Layer 1 — mock-`gh` runtime (Jest, `sync-stories-to-issues-board-fields.test.js` or a new sibling):**
  - stale-empty-map + existing-issue → assert ZERO `issue create`, routed to update (the headline regression test for this defect).
  - items-map first-read empty → assert exactly TWO `items(first:100` calls (retry fired) and, if the retry returns items, normal skip/update.
  - genuine first sync (empty map + no existing issue) → exactly one create per story (no over-guarding).
  - prefix-exact: existing `SHY-0070` issue + a `SHY-0007` story → `SHY-0007` still created; `SHY-0070` not duplicated (value-level, not substring).
  - guard-check gh-error → exit 40, no create.
  - steady-state all-skip unchanged (no new spurious calls when the map is fresh).
- **Layer 4 — live:** after the fix, a deliberate back-to-back sync immediately following a `--rebuild` must NOT duplicate (reproduce the exact failure condition and prove it's fixed).
- All AC clauses → named tests at RED before implementation (clause→test map in the PR), per the strict-testing standard.

## Out of Scope

- A full move off Projects v2 eventual consistency (e.g. caching item ids in a side store) — heavier; this story is the targeted guard.
- Draft-item consistent-source dedup beyond the items-map retry (drafts are not title-searchable). **OPERATOR DECISION** on the residual draft strategy (options): (a) accept bounded draft-dup risk + rely on periodic `--rebuild` cleanup [simplest]; (b) persist a per-SHY draft-item-id map in a committed sidecar file the sync reads as a consistent oracle [robust, more moving parts]; (c) add a short post-mutation settle delay in the workflow before any follow-on sync [mitigation, not a guarantee].
- Changing the workflow concurrency model (already serializes per-ref).

## Dependencies

- [[SHY-0074]] mirror v2 (the code being guarded) — shipped.
- `GH_PAT_PROJECT` Issues read/write (already held).

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Issues-search guard still misses a freshly-created issue (Issues API lag) | Low | Med | Issues search is far more consistent than Projects v2 items; the serialized concurrency group means the prior run completed before this one starts |
| Draft items still occasionally duplicate | Med | Low | Items-map retry + documented `--rebuild` cleanup; operator picks the residual strategy |
| Guard adds latency to large runs | Low | Low | One extra call only per missing-from-map bug story; zero on steady-state skip path |
| Over-guarding blocks a legitimate first create | Low | High | Explicit "empty existence check ⇒ create once" test; prefix-exact matching |

## Definition of Done

- [ ] All AC met; tests RED first with a clause→test map in the PR; the headline stale-empty-no-duplicate regression test included.
- [ ] Zero-findings review (reviewer before push).
- [ ] Live: back-to-back-after-rebuild sync proven non-duplicating (the reproduction is fixed).
- [ ] Merged via its own PR; `released_in:` at the release cut before Done flip. **This story unblocks resuming story-PR merges to main.**

## Notes (running log)

- 2026-06-10 18:50 BST — Filed after [[SHY-0074]] Layer-4 verification surfaced the duplication in production (220 board items / tripled issues from 3 syncs in 16 min). Cleaned via `--rebuild` (board back to 73 = 47 drafts + 26 issues; 22 open + 4 closed issues, no dups — verified via the consistent Issues API). Root cause = Projects v2 `items` query eventual consistency; the existing abort-on-FAILURE guard doesn't catch a successful-but-stale-empty read. HOLD on merges: until this ships, every push-sync risks re-duplicating the board, so [[SHY-0072]]/[[SHY-0073]]/[[SHY-0062]] batch PRs and any story merge are gated behind it. P1. Authored on branch `story/SHY-0078-mirror-idempotent-create-guard`, PR HELD (merging it would itself trigger a push-sync — the fix must be in the SAME PR as this spec so the guard is live before the triggering push lands; sequence: implement guard + this story in one PR, that PR's merge is the first guarded sync).
