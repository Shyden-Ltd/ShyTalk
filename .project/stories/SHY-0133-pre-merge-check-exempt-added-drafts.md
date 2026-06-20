---
id: SHY-0133
status: In Review
owner: claude
created: 2026-06-20
priority: P2
effort: S
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0133: Local pre-merge gate refuses added-Draft spec PRs — align with the SHY-0131 CI exemption

## User Story

As a **maintainer running the mandatory local pre-merge gate before a judgment-merge**,
I want **`scripts/pre-merge-check.sh` to exempt a newly-ADDED Draft story file (a spec filing), exactly as the CI Pre-Merge Gate already does**,
So that **a Draft spec-filing PR can pass the local gate and be merged the documented way, instead of the local and CI gates contradicting each other**.

## Why

SHY-0131 made the **CI** Pre-Merge Gate (`scripts/check-pr-story-status.js`) exempt a newly-ADDED story `.md` at status `Draft` — filing a brand-new backlog story is legitimately Draft, and blocking it would make it impossible to land a new story. But SHY-0131 only touched the CI script; it did **not** update the sibling **local** gate `scripts/pre-merge-check.sh`, which still requires `In Review` for **every** changed story (`--diff-filter=ACMR` + a blanket status check at L44/L52), with no added-Draft carve-out.

So the two gates now **disagree**: for a Draft spec-filing PR, the CI `PR Gate` check is GREEN (exempted) while `bash scripts/pre-merge-check.sh <PR#>` REFUSES (`status is "Draft" — must be "In Review"`). Because running `pre-merge-check.sh` to an `OK` is a HARD pre-merge rule (SHY-0127), this contradiction blocks merging **every** Draft spec-filing PR via the documented path — surfaced concretely while trying to merge the SHY-0132 spec (PR #1486). The local gate must mirror the CI gate's `code === 'A' && status === 'Draft'` filing exemption.

The exemption is **add-only** and **Draft-only**, preserving every existing guard: a story **modified** to Draft (a regression), an added story at any non-Draft status, and the local gate's intentional extra strictness on `Done`/`Cancelled` (only `In Review` passes locally — the script header documents this) all still REFUSE.

## Acceptance Criteria

### Happy path
- [ ] A PR whose only story change is a newly-**ADDED** `.project/stories/SHY-XXXX-*.md` at status `Draft` passes `pre-merge-check.sh` and emits `PRE-MERGE-CHECK: OK` (no `In Review` / `Reviewed-up-to` requirement for that filing).
- [ ] The behaviour matches `check-pr-story-status.js` (SHY-0131) for the added-Draft case — the two gates agree.

### Error paths
- [ ] A story **MODIFIED** to `Draft` (code `M`, i.e. an existing story regressed/edited to Draft) still REFUSES (the exemption is add-only).
- [ ] An **added** story at `In Progress` (or any non-Draft, non-allowed status) still REFUSES with the existing "must be In Review" message.
- [ ] `Done` / `Cancelled` stories still REFUSE locally (the local gate stays stricter than CI by design — unchanged).

### Edge cases
- [ ] A PR with NO story `.md` change still REFUSES with "nothing to gate" (unchanged).
- [ ] A mixed PR (one added-Draft filing + one modified `In Review` implementation story) gates the In-Review story normally (status + `Reviewed-up-to` + Gate-3 unreviewed-commit check) while exempting the filing — the exemption is per-story, not whole-PR.
- [ ] A **renamed** story (`R<score>\t<old>\t<new>`) is parsed correctly (the new path is the gated file; rename ≠ add, so it is NOT filing-exempt).
- [ ] An added-Draft filing with NO `Reviewed-up-to` marker still passes (a freshly-filed Draft has no reviewed commit — the exemption skips that requirement too).

### Performance
- N/A — a read-only shell gate over a small `git diff`; no measurable change.

### Security
- [ ] The exemption does NOT weaken the gate: it only lets through what the authoritative CI gate already lets through (added-Draft). All code-bearing / non-Draft / modified-Draft paths still refuse, so no unreviewed implementation can slip through the local gate via this change.

### UX
- [ ] The printed pre-merge checklist is honest for a filing PR — the status line reads as satisfied by "In Review **or** a newly-added Draft filing", not a false "status = In Review".
- [ ] A clear stderr line announces each filing exemption (e.g. `filing exemption: <file> newly-added Draft`) so the operator sees WHY it passed.

### i18n
- N/A — developer tooling; no user-facing strings.

### Observability
- [ ] The exemption emits a visible `filing exemption: …` line to stderr per exempted story, so a passing filing PR is auditable (not a silent skip).

## BDD Scenarios

**Scenario: a newly-added Draft spec filing passes the local gate**
- **Given** a branch whose only story change adds `.project/stories/SHY-0999-x.md` at `status: Draft`
- **When** `bash scripts/pre-merge-check.sh <PR#> --skip-ci-check` runs
- **Then** it exits 0 and prints `PRE-MERGE-CHECK: OK`
- **And** stderr notes the filing exemption for that file

**Scenario: a story modified to Draft is still refused (add-only)**
- **Given** a story that exists on `main` as `In Review`, modified to `status: Draft` on the branch
- **When** the gate runs
- **Then** it REFUSES (non-zero, no OK token) with the "must be In Review" message

**Scenario: an added non-Draft story is still gated**
- **Given** a branch adding a story at `status: In Progress`
- **When** the gate runs
- **Then** it REFUSES (the exemption is Draft-only)

**Scenario: mixed PR gates the implementation story, exempts the filing**
- **Given** a branch that adds a Draft filing AND modifies an implementation story to `In Review` with a valid `Reviewed-up-to`, with an unreviewed code commit after the marker
- **When** the gate runs
- **Then** it REFUSES on the In-Review story's unreviewed commit (the filing exemption does not suppress Gate-3 for the other story)

**Scenario: Done/Cancelled still refused locally (unchanged)**
- **Given** a branch adding a story at `status: Done` (or `Cancelled`)
- **When** the gate runs
- **Then** it REFUSES (local gate stays stricter than CI on terminal statuses)

## Test Plan

**RED (failing-first):** in `express-api/tests/scripts/pre-merge-check.test.js` (drives the REAL `pre-merge-check.sh` against a REAL throwaway git repo — no mocks), replace the single `REFUSES on a Draft story` test with:
- `EXEMPTS a newly-ADDED Draft story (filing — SHY-0131 parity)` — `init()` + add a Draft story + commit; expect exit 0 + `PRE-MERGE-CHECK: OK`. **Fails before the fix** (the script still refuses added Draft).
- `REFUSES a story MODIFIED to Draft (add-only exemption)` — put the story on `main` as `In Review`, modify it to Draft on the branch; expect refuse + `/In Review/`.
- `EXEMPTS the filing but still gates a co-changed In-Review story` (mixed PR) — expect refuse on the In-Review story's unreviewed commit.

All existing tests (In Review OK, no-marker refuse, code-after-marker refuse, Done/Cancelled refuse, nothing-to-gate, bogus-SHA refuse, multi-story marker) must stay green.

**GREEN:** `scripts/pre-merge-check.sh` —
- L44 `git diff --name-only` → `--name-status` (still `--diff-filter=ACMR`); parse each line into `code` (first field, first char) + `file` (last tab-field — the new path on a rename); filter to `STORY_RE` on `file`.
- In the per-story loop: `if [ "$code" = "A" ] && [ "$status" = "Draft" ]` → emit a `filing exemption:` stderr line and `continue` (skip the In-Review + `Reviewed-up-to` requirements). Otherwise run the existing In-Review + marker logic unchanged.
- Preserve the "nothing to gate" guard (a `FOUND_STORY` flag) and the Done/Cancelled-refuse behaviour. Make the printed checklist status line honest for filings.
- bash 3.2-compatible (parameter expansion + `grep`, no `mapfile`/awk intervals).

**Frameworks:** Express/Jest (`pre-merge-check.test.js`) + eslint + prettier (the test file) + shellcheck/actionlint (pre-push hook covers the `.sh`). No app/device surface — `*.md` + script + test only.

## Out of Scope

- The CI gate `check-pr-story-status.js` — already correct (SHY-0131); not touched.
- The Gate-2 CI leg of `pre-merge-check.sh` (`gh pr checks`) and any change to its name-by-name verification — separate concern.
- Loosening the local gate's intentional Done/Cancelled strictness — preserved exactly.
- Any change to the merge lifecycle, the board sync, or the story validator.

## Dependencies

- SHY-0131 (`check-pr-story-status.js` added-Draft exemption) — the canonical behaviour this story mirrors into the local gate.
- SHY-0127 (`pre-merge-check.sh` Gates 2+3) — the script being amended; its existing test harness `pre-merge-check.test.js`.

## Risks & Mitigations

- **Risk:** parsing `--name-status` wrong (codes like `R100`, multi-tab rename lines) → a story is mis-classified. **Mitigation:** take `code` = first char of the first tab-field and `file` = the LAST tab-field (correct for `A`/`M`/`R<old>\t<new>`); a dedicated rename test pins it.
- **Risk:** the exemption accidentally lets unreviewed CODE through on a filing PR. **Mitigation:** the exemption is per-story and Draft+add-only; a co-changed implementation story is still fully gated (mixed-PR test); a pure filing PR is `.md`-only by construction (no code to review). Mirrors exactly what CI already permits.
- **Risk:** breaking an existing guard. **Mitigation:** all pre-existing `pre-merge-check.test.js` cases stay green (regression guard); only the one Draft test is replaced.

## Definition of Done

- RED tests written failing-first then green; all pre-existing `pre-merge-check.test.js` cases stay green; the local gate now agrees with the CI gate on added-Draft.
- `code-reviewer` 100% clean before push; eslint/prettier clean; shellcheck (pre-push) clean; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Verified end-to-end: `pre-merge-check.sh` emits `PRE-MERGE-CHECK: OK` on PR #1486 (the SHY-0132 Draft spec) after this lands.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-20 — **Filed (operator chose "fix the merge-gate" 2026-06-20).** Surfaced while judgment-merging the SHY-0132 spec PR #1486: `pre-merge-check.sh` REFUSED its added Draft while the CI `PR Gate` passed it — SHY-0131 updated the CI gate (`check-pr-story-status.js:87` `code === 'A' && status === 'Draft'`) but not the local sibling. This story closes that oversight: mirror the add-only, Draft-only exemption into `pre-merge-check.sh` and split the `REFUSES on a Draft story` test into added-Draft-EXEMPT + modified-to-Draft-REFUSE. Add-only + Draft-only keeps every other guard (modified-Draft, non-Draft adds, Done/Cancelled, unreviewed code) intact.
- 2026-06-20 — **Implemented + reviewed (filed + built in one PR, SHY-0131 pattern).** RED: split the `REFUSES on a Draft story` test → added-Draft EXEMPT + modified-to-Draft REFUSE; GREEN: `pre-merge-check.sh` `--name-status` + add-only/Draft-only exemption. 17/17 Jest green (incl. mixed-PR, renamed-Draft R≠A, FILINGS=2 multi-filing); shellcheck/eslint/prettier/no-stubs clean. `code-reviewer`: pass 1 = 2 Important + 3 Minor (honest filing-only checklist, FILINGS=2 test, printf, DRY helper) → all fixed; pass 2 (re-review of the fix) = ZERO findings. Status → In Review.

Reviewed-up-to: 30d86b3a641
